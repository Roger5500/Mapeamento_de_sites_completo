import type Database from "better-sqlite3";

export interface RunRow {
  id: string;
  site_id: string;
  started_at: number;
  finished_at: number | null;
  status: "running" | "completed" | "failed" | "paused";
}

export interface NodeRow {
  id: string;
  run_id: string;
  route_key: string;
  structural_hash: string;
  last_url: string;
  title: string | null;
  snapshot_json: string;
  first_seen_at: number;
  last_seen_at: number;
  visit_count: number;
  status: "active" | "saturated" | "error";
}

export interface EdgeRow {
  id: number;
  run_id: string;
  from_node_id: string;
  to_node_id: string;
  action_type: string;
  element_role: string;
  element_accessible_name: string;
  element_ref_debug: string | null;
  input_value_json: string | null;
  http_status: number | null;
  network_ok: number;
  console_errors_json: string | null;
  state_changed: number;
  attempt_count: number;
  executed_at: number;
}

export interface FrontierRow {
  id: number;
  run_id: string;
  node_id: string;
  element_role: string;
  element_accessible_name: string;
  priority: number;
  status: "pending" | "done" | "skipped_blacklist" | "skipped_external" | "failed";
  skip_reason: string | null;
  discovered_at: number;
}

export class RunRepository {
  constructor(private readonly db: Database.Database) {}

  create(id: string, siteId: string, startedAt: number = Date.now()): void {
    this.db
      .prepare("INSERT INTO runs (id, site_id, started_at, status) VALUES (?, ?, ?, 'running')")
      .run(id, siteId, startedAt);
  }

  finish(id: string, status: "completed" | "failed" | "paused", finishedAt: number = Date.now()): void {
    this.db.prepare("UPDATE runs SET status = ?, finished_at = ? WHERE id = ?").run(status, finishedAt, id);
  }

  get(id: string): RunRow | undefined {
    return this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as RunRow | undefined;
  }
}

export interface UpsertNodeInput {
  id: string;
  runId: string;
  routeKey: string;
  structuralHash: string;
  lastUrl: string;
  title?: string | null;
  snapshotJson: string;
  now?: number;
}

export class NodeRepository {
  constructor(private readonly db: Database.Database) {}

  /** Insere o no ou, se ja existir, atualiza snapshot/last_seen e incrementa visit_count. */
  upsert(input: UpsertNodeInput): NodeRow {
    const now = input.now ?? Date.now();
    const existing = this.get(input.id);
    if (existing) {
      this.db
        .prepare(
          "UPDATE nodes SET last_url = ?, title = ?, snapshot_json = ?, last_seen_at = ?, visit_count = visit_count + 1 WHERE id = ?",
        )
        .run(input.lastUrl, input.title ?? null, input.snapshotJson, now, input.id);
      return this.get(input.id)!;
    }
    this.db
      .prepare(
        `INSERT INTO nodes (id, run_id, route_key, structural_hash, last_url, title, snapshot_json, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.runId,
        input.routeKey,
        input.structuralHash,
        input.lastUrl,
        input.title ?? null,
        input.snapshotJson,
        now,
        now,
      );
    return this.get(input.id)!;
  }

  get(id: string): NodeRow | undefined {
    return this.db.prepare("SELECT * FROM nodes WHERE id = ?").get(id) as NodeRow | undefined;
  }

  markSaturated(id: string): void {
    this.db.prepare("UPDATE nodes SET status = 'saturated' WHERE id = ?").run(id);
  }

  listForRun(runId: string): NodeRow[] {
    return this.db.prepare("SELECT * FROM nodes WHERE run_id = ?").all(runId) as NodeRow[];
  }
}

export interface InsertEdgeInput {
  runId: string;
  fromNodeId: string;
  toNodeId: string;
  actionType: string;
  elementRole: string;
  elementAccessibleName: string;
  elementRefDebug?: string | null;
  inputValueJson?: string | null;
  httpStatus?: number | null;
  networkOk: boolean;
  consoleErrorsJson?: string | null;
  stateChanged: boolean;
  attemptCount?: number;
  executedAt?: number;
}

export class EdgeRepository {
  constructor(private readonly db: Database.Database) {}

  /**
   * Insere a aresta se a acao (from_node, action_type, role, name) ainda nao
   * foi tentada - o UNIQUE constraint da tabela e o mecanismo real de dedup,
   * evitando reenfileirar uma acao ja registrada.
   */
  insertIfAbsent(input: InsertEdgeInput): boolean {
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO edges
           (run_id, from_node_id, to_node_id, action_type, element_role, element_accessible_name,
            element_ref_debug, input_value_json, http_status, network_ok, console_errors_json,
            state_changed, attempt_count, executed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.runId,
        input.fromNodeId,
        input.toNodeId,
        input.actionType,
        input.elementRole,
        input.elementAccessibleName,
        input.elementRefDebug ?? null,
        input.inputValueJson ?? null,
        input.httpStatus ?? null,
        input.networkOk ? 1 : 0,
        input.consoleErrorsJson ?? null,
        input.stateChanged ? 1 : 0,
        input.attemptCount ?? 1,
        input.executedAt ?? Date.now(),
      );
    return result.changes > 0;
  }

  listForRun(runId: string): EdgeRow[] {
    return this.db.prepare("SELECT * FROM edges WHERE run_id = ?").all(runId) as EdgeRow[];
  }
}

export interface EnqueueFrontierInput {
  runId: string;
  nodeId: string;
  elementRole: string;
  elementAccessibleName: string;
  priority: number;
  discoveredAt?: number;
  /** Default 'pending'. Usar 'skipped_blacklist'/'skipped_external' para registrar candidatos ja negados pelos pre-filter guards, sem executa-los. */
  status?: FrontierRow["status"];
  skipReason?: string;
}

export class FrontierRepository {
  constructor(private readonly db: Database.Database) {}

  enqueue(input: EnqueueFrontierInput): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO frontier (run_id, node_id, element_role, element_accessible_name, priority, discovered_at, status, skip_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.runId,
        input.nodeId,
        input.elementRole,
        input.elementAccessibleName,
        input.priority,
        input.discoveredAt ?? Date.now(),
        input.status ?? "pending",
        input.skipReason ?? null,
      );
  }

  markStatus(id: number, status: FrontierRow["status"], skipReason?: string): void {
    this.db.prepare("UPDATE frontier SET status = ?, skip_reason = ? WHERE id = ?").run(status, skipReason ?? null, id);
  }

  /** Itens pendentes de um no especifico (preferencia DFS-local), por prioridade desc. */
  pendingForNode(runId: string, nodeId: string): FrontierRow[] {
    return this.db
      .prepare("SELECT * FROM frontier WHERE run_id = ? AND node_id = ? AND status = 'pending' ORDER BY priority DESC")
      .all(runId, nodeId) as FrontierRow[];
  }

  /** Fila global de pendentes (usada apenas quando o no atual esta esgotado). */
  pendingGlobal(runId: string): FrontierRow[] {
    return this.db
      .prepare("SELECT * FROM frontier WHERE run_id = ? AND status = 'pending' ORDER BY priority DESC")
      .all(runId) as FrontierRow[];
  }

  /** Candidatos bloqueados pelos pre-filter guards (blacklist/dominio) - usado no relatorio de run para auditoria. */
  listSkipped(runId: string): FrontierRow[] {
    return this.db
      .prepare("SELECT * FROM frontier WHERE run_id = ? AND status IN ('skipped_blacklist', 'skipped_external') ORDER BY id ASC")
      .all(runId) as FrontierRow[];
  }
}

/** Aresta simplificada usada por algoritmos de grafo puros (testaveis sem SQLite). */
export interface GraphEdge {
  fromNodeId: string;
  toNodeId: string;
  actionType: string;
  elementRole: string;
  elementAccessibleName: string;
}

export interface GraphPath<E extends GraphEdge = GraphEdge> {
  targetNodeId: string;
  edges: E[];
}

/**
 * BFS a partir da raiz, retornando o caminho mais curto (em numero de arestas)
 * ate cada no alcancavel. Usado pelo compilador de testes para a estrategia
 * de "cobertura de nos" (seção D do plano) - implementado sobre uma lista
 * pura de arestas para ser testavel sem precisar de um SQLite real. Generico
 * em `E` para que o compilador possa passar arestas com campos extras (ex:
 * `inputValueJson`) e recebe-los de volta sem type casts.
 */
export function shortestPathsFromRoot<E extends GraphEdge = GraphEdge>(edges: readonly E[], rootNodeId: string): Map<string, GraphPath<E>> {
  const adjacency = new Map<string, E[]>();
  for (const edge of edges) {
    const list = adjacency.get(edge.fromNodeId) ?? [];
    list.push(edge);
    adjacency.set(edge.fromNodeId, list);
  }

  const paths = new Map<string, GraphPath<E>>();
  paths.set(rootNodeId, { targetNodeId: rootNodeId, edges: [] });

  const queue: string[] = [rootNodeId];
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const currentPath = paths.get(currentId)!;
    for (const edge of adjacency.get(currentId) ?? []) {
      if (paths.has(edge.toNodeId)) continue;
      paths.set(edge.toNodeId, { targetNodeId: edge.toNodeId, edges: [...currentPath.edges, edge] });
      queue.push(edge.toNodeId);
    }
  }

  return paths;
}
