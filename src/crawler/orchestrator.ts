import type Database from "better-sqlite3";
import type { SiteConfig } from "../config/schema.js";
import { computeNodeIdentity } from "../graph/nodeIdentity.js";
import { EdgeRepository, FrontierRepository, NodeRepository, RunRepository, shortestPathsFromRoot, type GraphEdge, type NodeRow } from "../graph/repository.js";
import type { McpClientSession } from "../mcp/client.js";
import type { ParsedSnapshot } from "../mcp/snapshotParser.js";
import { createDefaultGuards, runPreFilterGuards, type GuardContext } from "../safety/guards.js";
import { shouldMarkSaturated } from "../safety/revisitBacktrack.js";
import { executeWithAutoHeal, type ExecuteActionInput } from "./actionExecutor.js";
import { performLogin } from "./auth.js";
import { generateFieldValue } from "./fakerFill.js";
import { extractInteractiveElements, Frontier, type ElementCandidate } from "./frontier.js";
import { computePriority } from "./priority.js";
import { captureNetworkBaseline, validateAfterAction } from "./validator.js";

const FORM_FIELD_ROLES = new Set(["textbox", "searchbox", "combobox"]);

/**
 * Aresta "leve" usada apenas para recalcular o caminho de replay do backtrack -
 * definida aqui (nao importada de src/compiler/) para o crawler nao depender
 * do compilador de testes, que e uma camada conceitualmente posterior.
 */
interface ReplayEdge extends GraphEdge {
  inputValueJson: string | null;
}

function parseInputValue(inputValueJson: string | null): string {
  if (!inputValueJson) return "";
  try {
    const value: unknown = JSON.parse(inputValueJson);
    return typeof value === "string" ? value : String(value);
  } catch {
    return "";
  }
}

export interface OrchestratorOptions {
  site: SiteConfig;
  runId: string;
  /**
   * Cap de passos de execucao. Nao faz parte do algoritmo original do plano
   * (que roda ate a fronteira esvaziar sozinha), mas e necessario na pratica
   * para runs previsiveis contra sites reais grandes (dev, CI, demonstracao) -
   * ver gap "rate limiting/politeness" no plano.
   */
  maxSteps: number;
}

export interface OrchestratorStats {
  steps: number;
  nodesDiscovered: number;
  edgesRecorded: number;
  actionsFailed: number;
  actionsSkippedByGuard: number;
}

/**
 * Loop principal de crawl (secoes A/C do plano): descobre o no atual,
 * enfileira seus candidatos (ja filtrados pelos guards de seguranca),
 * escolhe a proxima acao (DFS-local com backtrack global via Frontier),
 * executa com auto-heal, valida e registra a aresta resultante.
 */
export class Orchestrator {
  private readonly runs: RunRepository;
  private readonly nodes: NodeRepository;
  private readonly edges: EdgeRepository;
  private readonly frontier: Frontier;
  private readonly guards: ReturnType<typeof createDefaultGuards>;
  private readonly depthByNode = new Map<string, number>();
  private readonly failedAttempts = new Map<string, number>();
  private rootNodeId: string | undefined;
  private readonly stats: OrchestratorStats = { steps: 0, nodesDiscovered: 0, edgesRecorded: 0, actionsFailed: 0, actionsSkippedByGuard: 0 };

  constructor(
    private readonly session: McpClientSession,
    db: Database.Database,
    private readonly site: SiteConfig,
    private readonly runId: string,
    private readonly maxSteps: number,
  ) {
    this.runs = new RunRepository(db);
    this.nodes = new NodeRepository(db);
    this.edges = new EdgeRepository(db);
    this.frontier = new Frontier(new FrontierRepository(db));
    this.guards = createDefaultGuards(site);
  }

  async run(): Promise<OrchestratorStats> {
    this.runs.create(this.runId, this.site.id);

    try {
      if (this.site.credentials) {
        await performLogin(this.session.tools, this.site);
      }

      await this.session.tools.navigate(this.site.baseUrl);
      let currentNodeId = await this.syncNode(await this.session.tools.snapshot(), 0);
      this.rootNodeId = currentNodeId;

      for (let step = 0; step < this.maxSteps; step++) {
        this.stats.steps = step + 1;

        const frontierRow = this.frontier.popNext(this.runId, currentNodeId);
        if (!frontierRow) break;

        if (frontierRow.node_id !== currentNodeId) {
          const targetNode = this.nodes.get(frontierRow.node_id);
          if (!targetNode) {
            this.frontier.markFailed(frontierRow.id);
            continue;
          }

          const replayedViaClicks = await this.backtrackTo(targetNode);
          if (!replayedViaClicks) {
            // Fallback de robustez: o replay clicando pelo caminho gravado falhou (ex: conteudo
            // dinamico mudou entre a descoberta e agora) - pula direto pra URL pra nao travar o crawl.
            await this.session.tools.navigate(targetNode.last_url);
          }

          currentNodeId = await this.syncNode(await this.session.tools.snapshot(), this.depthByNode.get(frontierRow.node_id) ?? 0);
          if (currentNodeId !== frontierRow.node_id) {
            // Pagina mudou entre a descoberta e agora (conteudo dinamico) - alvo original nao existe mais.
            this.frontier.markFailed(frontierRow.id);
            continue;
          }
        }

        const candidate: ElementCandidate = {
          role: frontierRow.element_role,
          name: frontierRow.element_accessible_name,
          attributes: {},
        };
        const isFormField = FORM_FIELD_ROLES.has(candidate.role);
        const typeValue = isFormField ? generateFieldValue(candidate, { locale: this.site.fakerLocale }) : undefined;

        const baseline = await captureNetworkBaseline(this.session.tools);
        const executeInput: ExecuteActionInput = { candidate, typeValue };

        try {
          await executeWithAutoHeal(this.session.tools, executeInput);
        } catch {
          this.frontier.markFailed(frontierRow.id);
          this.stats.actionsFailed += 1;
          this.bumpFailedAttempts(currentNodeId, candidate);
          continue;
        }

        const validation = await validateAfterAction(this.session.tools, baseline);
        const newSnap = await this.session.tools.snapshot();
        const toNodeId = await this.syncNode(newSnap, (this.depthByNode.get(currentNodeId) ?? 0) + 1);

        const inserted = this.edges.insertIfAbsent({
          runId: this.runId,
          fromNodeId: currentNodeId,
          toNodeId,
          actionType: isFormField ? "type" : "click",
          elementRole: candidate.role,
          elementAccessibleName: candidate.name,
          inputValueJson: typeValue !== undefined ? JSON.stringify(typeValue) : null,
          networkOk: validation.networkOk,
          consoleErrorsJson: validation.consoleErrors.length > 0 ? JSON.stringify(validation.consoleErrors) : null,
          stateChanged: toNodeId !== currentNodeId,
        });
        if (inserted) this.stats.edgesRecorded += 1;

        this.frontier.markDone(frontierRow.id);
        currentNodeId = toNodeId;
      }

      this.runs.finish(this.runId, "completed");
    } catch (error) {
      this.runs.finish(this.runId, "failed");
      throw error;
    }

    return this.stats;
  }

  /**
   * Backtrack "como um usuario real": em vez de pular direto pra URL do no
   * alvo, volta pra home e refaz, clicando, o mesmo caminho de acoes que o
   * grafo ja registrou pra chegar la (reaproveita `shortestPathsFromRoot`,
   * a mesma funcao usada pelo compilador de testes para escolher caminhos).
   * Retorna false se nao houver caminho conhecido ou se o replay falhar em
   * qualquer passo - nesses casos o chamador cai para o navigate(url) direto.
   */
  private async backtrackTo(targetNode: NodeRow): Promise<boolean> {
    if (!this.rootNodeId) return false;

    const edges: ReplayEdge[] = this.edges.listForRun(this.runId).map((row) => ({
      fromNodeId: row.from_node_id,
      toNodeId: row.to_node_id,
      actionType: row.action_type,
      elementRole: row.element_role,
      elementAccessibleName: row.element_accessible_name,
      inputValueJson: row.input_value_json,
    }));

    const paths = shortestPathsFromRoot(edges, this.rootNodeId);
    const path = paths.get(targetNode.id);
    if (!path) return false;

    try {
      await this.session.tools.navigate(this.site.baseUrl);
      for (const edge of path.edges) {
        const candidate: ElementCandidate = { role: edge.elementRole, name: edge.elementAccessibleName, attributes: {} };
        const typeValue = edge.actionType === "type" ? parseInputValue(edge.inputValueJson) : undefined;
        await executeWithAutoHeal(this.session.tools, { candidate, typeValue });
      }
      return true;
    } catch {
      return false;
    }
  }

  private candidateKey(nodeId: string, candidate: ElementCandidate): string {
    return `${nodeId}|${candidate.role}|${candidate.name}`;
  }

  private bumpFailedAttempts(nodeId: string, candidate: ElementCandidate): void {
    const key = this.candidateKey(nodeId, candidate);
    this.failedAttempts.set(key, (this.failedAttempts.get(key) ?? 0) + 1);
  }

  /** Faz upsert do no na snapshot atual e, se for a primeira vez que o vemos, enfileira seus candidatos (ja passados pelos guards). */
  private async syncNode(snap: ParsedSnapshot, depth: number): Promise<string> {
    const identity = computeNodeIdentity(snap.url, snap.tree, {
      queryParamDenylist: this.site.queryParamDenylist,
      volatilePatterns: this.site.volatilePatterns,
      volatileSelectors: this.site.volatileSelectors,
    });

    const wasKnown = this.depthByNode.has(identity.nodeId);
    if (!wasKnown) {
      this.depthByNode.set(identity.nodeId, depth);
      this.stats.nodesDiscovered += 1;
    }

    const nodeRow = this.nodes.upsert({
      id: identity.nodeId,
      runId: this.runId,
      routeKey: identity.routeKey,
      structuralHash: identity.structuralHash,
      lastUrl: snap.url,
      title: snap.title,
      snapshotJson: JSON.stringify(snap.tree),
    });

    if (shouldMarkSaturated({ visitCount: nodeRow.visit_count, status: nodeRow.status }, this.site.maxRevisits)) {
      this.nodes.markSaturated(identity.nodeId);
    }

    if (!wasKnown) {
      this.enqueueCandidates(identity.nodeId, snap, depth);
    }

    return identity.nodeId;
  }

  private enqueueCandidates(nodeId: string, snap: ParsedSnapshot, depth: number): void {
    const guardCtx: GuardContext = { currentUrl: snap.url };
    const candidates = extractInteractiveElements(snap.tree);
    const scored: Array<{ candidate: ElementCandidate; priority: number }> = [];

    for (const candidate of candidates) {
      const guardResult = runPreFilterGuards(candidate, guardCtx, this.guards);
      if (!guardResult.allowed) {
        const kind = guardResult.reason?.includes("dominio") ? "skipped_external" : "skipped_blacklist";
        this.frontier.enqueueSkipped(this.runId, nodeId, candidate, kind, guardResult.reason ?? "bloqueado");
        this.stats.actionsSkippedByGuard += 1;
        continue;
      }
      const priority = computePriority(candidate.role, {
        depthFromRoot: depth,
        previousFailedAttempts: this.failedAttempts.get(this.candidateKey(nodeId, candidate)) ?? 0,
      });
      scored.push({ candidate, priority });
    }

    this.frontier.enqueueMany(this.runId, nodeId, scored);
  }
}

export function createOrchestrator(session: McpClientSession, db: Database.Database, options: OrchestratorOptions): Orchestrator {
  return new Orchestrator(session, db, options.site, options.runId, options.maxSteps);
}
