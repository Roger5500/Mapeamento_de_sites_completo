import { shortestPathsFromRoot, type GraphEdge, type GraphPath } from "../graph/repository.js";

export interface CompilerEdge extends GraphEdge {
  inputValueJson: string | null;
}

export interface CompilerNode {
  id: string;
  routeKey: string;
}

export interface SelectedPath {
  targetNodeId: string;
  edges: CompilerEdge[];
  feature: string;
}

export interface SelectPathsOptions {
  maxPathsPerFeature: number;
}

function edgeKey(edge: GraphEdge): string {
  return `${edge.fromNodeId}|${edge.actionType}|${edge.elementRole}|${edge.elementAccessibleName}`;
}

/** Primeiro segmento de path da route key normalizada - usado para agrupar specs por feature (ex: "/checkout/*" -> "checkout"). */
export function featureOf(routeKey: string): string {
  try {
    const url = new URL(routeKey);
    const firstSegment = url.pathname.split("/").find((segment) => segment.length > 0);
    return firstSegment ?? "home";
  } catch {
    return "home";
  }
}

function pathSignature(path: GraphPath<CompilerEdge>, nodesById: ReadonlyMap<string, CompilerNode>): string {
  return path.edges
    .map((edge) => {
      const toRouteKey = nodesById.get(edge.toNodeId)?.routeKey ?? edge.toNodeId;
      return `${toRouteKey}|${edge.actionType}|${edge.elementRole}|${edge.elementAccessibleName}`;
    })
    .join(">");
}

/**
 * Selecao de caminhos por cobertura (secao D.1-D.4 do plano):
 *  1. Cobertura de nos: caminho mais curto (BFS) da raiz ate CADA no descoberto.
 *  2. Cobertura de interacoes: para arestas nao alcancadas pelo passo 1
 *     (toggles no mesmo no, submits que revisitam um no existente), sintetiza
 *     caminho curto ate from_node + essa aresta.
 *  3. Dedup por assinatura (route_key, action_type, role, name) do destino -
 *     descarta caminhos cuja assinatura e PREFIXO de outro ja selecionado.
 *  4. Agrupamento por feature, respeitando `maxPathsPerFeature`.
 */
export function selectPaths(
  edges: readonly CompilerEdge[],
  nodesById: ReadonlyMap<string, CompilerNode>,
  rootNodeId: string,
  options: SelectPathsOptions,
): SelectedPath[] {
  const nodeCoveragePaths = shortestPathsFromRoot(edges, rootNodeId);

  const coveredEdgeKeys = new Set<string>();
  const candidatePaths: GraphPath<CompilerEdge>[] = [];
  for (const path of nodeCoveragePaths.values()) {
    if (path.edges.length === 0) continue; // a propria raiz, nao vira um "caminho" de teste
    candidatePaths.push(path);
    for (const edge of path.edges) coveredEdgeKeys.add(edgeKey(edge));
  }

  for (const edge of edges) {
    if (coveredEdgeKeys.has(edgeKey(edge))) continue;
    const basePath = nodeCoveragePaths.get(edge.fromNodeId);
    if (!basePath) continue; // fromNode inalcancavel a partir da raiz - nao deveria acontecer, mas defensivo
    candidatePaths.push({ targetNodeId: edge.toNodeId, edges: [...basePath.edges, edge] });
    coveredEdgeKeys.add(edgeKey(edge));
  }

  const withSignature = candidatePaths.map((path) => ({ path, signature: pathSignature(path, nodesById) }));
  withSignature.sort((a, b) => b.signature.length - a.signature.length);

  const kept: Array<{ path: GraphPath<CompilerEdge>; signature: string }> = [];
  for (const candidate of withSignature) {
    const isPrefixOfAlreadyKept = kept.some((k) => k.signature.startsWith(candidate.signature));
    if (!isPrefixOfAlreadyKept) kept.push(candidate);
  }

  const countByFeature = new Map<string, number>();
  const selected: SelectedPath[] = [];
  for (const { path } of kept) {
    const targetRouteKey = nodesById.get(path.targetNodeId)?.routeKey ?? "";
    const feature = featureOf(targetRouteKey);
    const countSoFar = countByFeature.get(feature) ?? 0;
    if (countSoFar >= options.maxPathsPerFeature) continue;
    countByFeature.set(feature, countSoFar + 1);
    selected.push({ targetNodeId: path.targetNodeId, edges: path.edges, feature });
  }

  return selected;
}
