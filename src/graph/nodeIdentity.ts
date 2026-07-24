import { createHash } from "node:crypto";

/**
 * Arvore de acessibilidade estruturada, ja parseada a partir da snapshot do MCP
 * (ver src/mcp/snapshotParser.ts). Mantida generica aqui para nao acoplar o
 * hashing de identidade ao formato bruto do `@playwright/mcp`.
 */
export interface AccessibilityNode {
  role: string;
  name?: string;
  attributes?: Record<string, string>;
  children?: AccessibilityNode[];
}

export interface CanonicalNode {
  role: string;
  name: string;
  children: CanonicalNode[];
}

export interface CanonicalizeOptions {
  /** Fontes de regex (case-insensitive) - nomes acessiveis que casarem sao tratados como volateis e descartados. */
  volatilePatterns?: readonly string[];
  /** Valores de `id`/`data-testid` conhecidos como volateis para este site (ex: badge de notificacao). */
  volatileSelectors?: readonly string[];
}

export interface RouteKeyOptions {
  queryParamDenylist?: readonly string[];
}

export interface NodeIdentity {
  nodeId: string;
  routeKey: string;
  structuralHash: string;
}

const IGNORED_ROLES = new Set(["none", "presentation"]);

const NUMERIC_SEGMENT = /^\d+$/;
const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONGO_ID_SEGMENT = /^[0-9a-f]{24}$/i;
const DATE_SEGMENT = /^\d{4}-\d{2}-\d{2}$/;

function normalizeSegment(segment: string): string {
  if (NUMERIC_SEGMENT.test(segment)) return ":id";
  if (UUID_SEGMENT.test(segment)) return ":uuid";
  if (MONGO_ID_SEGMENT.test(segment)) return ":id";
  if (DATE_SEGMENT.test(segment)) return ":date";
  return segment;
}

function normalizePathLike(pathLike: string): string {
  return pathLike
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(normalizeSegment)
    .join("/");
}

/**
 * Normaliza uma URL em uma "route key" estavel: segmentos numericos/UUID/data
 * viram placeholders, query params volateis (denylist + `utm_*`) sao
 * descartados e o restante e ordenado alfabeticamente. Roteamento SPA via
 * hash (`#/foo/123`, `#!/foo/123`) e normalizado com as mesmas regras.
 */
export function computeRouteKey(rawUrl: string, options: RouteKeyOptions = {}): string {
  const denylist = new Set((options.queryParamDenylist ?? []).map((param) => param.toLowerCase()));
  const url = new URL(rawUrl);

  const normalizedPath = normalizePathLike(url.pathname);
  const hashLooksLikeRoute = /^#!?\//.test(url.hash);
  const normalizedHash = hashLooksLikeRoute ? normalizePathLike(url.hash.replace(/^#!?/, "")) : "";

  const keptParams: Array<[string, string]> = [];
  for (const [key, value] of url.searchParams.entries()) {
    const lowerKey = key.toLowerCase();
    if (denylist.has(lowerKey) || lowerKey.startsWith("utm_")) continue;
    keptParams.push([key, value]);
  }
  keptParams.sort(([a], [b]) => a.localeCompare(b));
  const query = keptParams.map(([key, value]) => `${key}=${value}`).join("&");

  const origin = `${url.protocol}//${url.host}`;
  const path = hashLooksLikeRoute ? `${normalizedPath}#${normalizedHash}` : normalizedPath;
  return query ? `${origin}/${path}?${query}` : `${origin}/${path}`;
}

function normalizeName(name: string | undefined): string {
  return (name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function isVolatile(node: AccessibilityNode, volatileRegexes: RegExp[], volatileSelectors: Set<string>): boolean {
  if (node.attributes?.["aria-live"]) return true;
  const selectorHint = node.attributes?.["data-testid"] ?? node.attributes?.["id"];
  if (selectorHint !== undefined && volatileSelectors.has(selectorHint)) return true;
  const name = node.name ?? "";
  return volatileRegexes.some((regex) => regex.test(name));
}

/** Nó puramente decorativo (presentation/none sem nome acessível) - mesmo critério usado por canonicalizeTree. */
export function isDecorativeNode(node: AccessibilityNode): boolean {
  return IGNORED_ROLES.has(node.role) && !node.name;
}

/**
 * Wrapper publico de `isVolatile` para reuso FORA do hashing de identidade -
 * ex: o compilador de testes (compiler/assertionBuilder.ts) usa isso para
 * escolher um landmark estavel para assertions, preservando o nome acessivel
 * ORIGINAL (com case/acentuacao intactos, diferente de CanonicalNode.name
 * que e normalizado para fins de hash). Existir aqui evita que "o que conta
 * como estavel" seja definido duas vezes em lugares que podem divergir.
 */
export function isVolatileNode(node: AccessibilityNode, options: CanonicalizeOptions = {}): boolean {
  const volatileRegexes = (options.volatilePatterns ?? []).map((source) => new RegExp(source, "i"));
  const volatileSelectors = new Set(options.volatileSelectors ?? []);
  return isVolatile(node, volatileRegexes, volatileSelectors);
}

/**
 * Canonicaliza a arvore de acessibilidade preservando a ordem dos filhos
 * (significativa para ordem de leitura/tab). Nos puramente decorativos e nos
 * volateis (aria-live, padroes/seletores configurados) sao removidos - ver
 * o tradeoff documentado no plano: essa classificacao e deliberadamente
 * configuravel por site, nao um heuristico generico "esperto".
 */
export function canonicalizeTree(node: AccessibilityNode, options: CanonicalizeOptions = {}): CanonicalNode | null {
  const volatileRegexes = (options.volatilePatterns ?? []).map((source) => new RegExp(source, "i"));
  const volatileSelectors = new Set(options.volatileSelectors ?? []);

  function walk(current: AccessibilityNode): CanonicalNode | null {
    if (IGNORED_ROLES.has(current.role) && !current.name) return null;
    if (isVolatile(current, volatileRegexes, volatileSelectors)) return null;

    const children: CanonicalNode[] = [];
    for (const child of current.children ?? []) {
      const canonicalChild = walk(child);
      if (canonicalChild !== null) children.push(canonicalChild);
    }

    return { role: current.role, name: normalizeName(current.name), children };
  }

  return walk(node);
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hashCanonicalTree(tree: CanonicalNode | null): string {
  return sha256(JSON.stringify(tree));
}

/**
 * Identidade completa de um no do grafo: route key (URL normalizada) +
 * hash estrutural (arvore de acessibilidade canonicalizada). O nodeId final
 * combina os dois para que paginas com a mesma URL mas conteudo
 * estruturalmente diferente (ex: estados de um wizard na mesma rota)
 * ainda sejam distinguidas.
 */
export function computeNodeIdentity(
  rawUrl: string,
  tree: AccessibilityNode,
  options: RouteKeyOptions & CanonicalizeOptions = {},
): NodeIdentity {
  const routeKey = computeRouteKey(rawUrl, { queryParamDenylist: options.queryParamDenylist });
  const canonical = canonicalizeTree(tree, {
    volatilePatterns: options.volatilePatterns,
    volatileSelectors: options.volatileSelectors,
  });
  const structuralHash = hashCanonicalTree(canonical);
  const nodeId = sha256(`${routeKey}::${structuralHash}`).slice(0, 24);
  return { nodeId, routeKey, structuralHash };
}
