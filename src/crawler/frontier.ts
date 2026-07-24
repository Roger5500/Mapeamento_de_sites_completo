import type { AccessibilityNode } from "../graph/nodeIdentity.js";
import { FrontierRepository, type FrontierRow } from "../graph/repository.js";

/** Elemento interativo extraido da arvore de acessibilidade, ainda nao filtrado pelos guards. */
export interface ElementCandidate {
  role: string;
  name: string;
  attributes: Record<string, string>;
}

const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "combobox",
  "checkbox",
  "radio",
  "menuitem",
  "tab",
  "switch",
  "option",
]);

/**
 * Extrai candidatos interativos da arvore. Elementos interativos sem nome
 * acessivel (icone sem aria-label, bug de acessibilidade da propria
 * aplicacao) sao descartados aqui - sem nome nao ha como construir um
 * locator `getByRole(role, {name})` estavel nem checar a blacklist contra
 * o nome, e o ref efemero da snapshot nao serve como identidade durave.
 */
export function extractInteractiveElements(tree: AccessibilityNode): ElementCandidate[] {
  const candidates: ElementCandidate[] = [];

  function walk(node: AccessibilityNode): void {
    if (INTERACTIVE_ROLES.has(node.role) && node.name && node.name.trim().length > 0) {
      candidates.push({ role: node.role, name: node.name, attributes: node.attributes ?? {} });
    }
    for (const child of node.children ?? []) walk(child);
  }

  walk(tree);
  return candidates;
}

/**
 * Fila de candidatos persistida em SQLite (via FrontierRepository). Aplica a
 * estrategia hibrida do plano: DFS-local (prioriza o no atual, que ja esta
 * carregado no browser) com backtrack global somente quando o no atual esgota.
 */
export class Frontier {
  constructor(private readonly repo: FrontierRepository) {}

  enqueueMany(runId: string, nodeId: string, scored: ReadonlyArray<{ candidate: ElementCandidate; priority: number }>): void {
    for (const { candidate, priority } of scored) {
      this.repo.enqueue({
        runId,
        nodeId,
        elementRole: candidate.role,
        elementAccessibleName: candidate.name,
        priority,
      });
    }
  }

  /** Registra um candidato ja negado por um pre-filter guard - nunca sera executado, so fica visivel para auditoria. */
  enqueueSkipped(runId: string, nodeId: string, candidate: ElementCandidate, kind: "skipped_blacklist" | "skipped_external", reason: string): void {
    this.repo.enqueue({
      runId,
      nodeId,
      elementRole: candidate.role,
      elementAccessibleName: candidate.name,
      priority: 0,
      status: kind,
      skipReason: reason,
    });
  }

  popNext(runId: string, currentNodeId: string): FrontierRow | undefined {
    const local = this.repo.pendingForNode(runId, currentNodeId);
    if (local.length > 0) return local[0];
    return this.repo.pendingGlobal(runId)[0];
  }

  markDone(id: number): void {
    this.repo.markStatus(id, "done");
  }

  markSkipped(id: number, reason: string, kind: "skipped_blacklist" | "skipped_external"): void {
    this.repo.markStatus(id, kind, reason);
  }

  markFailed(id: number): void {
    this.repo.markStatus(id, "failed");
  }
}
