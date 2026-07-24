import { isDecorativeNode, isVolatileNode, type AccessibilityNode, type CanonicalizeOptions } from "../graph/nodeIdentity.js";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Converte uma route key normalizada (com placeholders `:id`/`:uuid`/`:date`)
 * numa fonte de regex que casa a URL real correspondente - usada em
 * `expect(page).toHaveURL(/.../)`.
 */
export function routeKeyToUrlRegexSource(routeKey: string): string {
  try {
    const url = new URL(routeKey);
    const originPattern = escapeRegExp(`${url.protocol}//${url.host}`);
    const pathPattern = url.pathname
      .split("/")
      .map((segment) => (segment === ":id" || segment === ":uuid" || segment === ":date" ? "[^/]+" : escapeRegExp(segment)))
      .join("/");
    return `^${originPattern}${pathPattern}`;
  } catch {
    return escapeRegExp(routeKey);
  }
}

export interface StableAnchor {
  role: string;
  name: string;
}

const HEADING_ROLES = ["heading", "main"];
const FALLBACK_ROLES = ["link", "button"];

// Landmarks tipicamente compartilhados por TODA pagina do site (header/nav/footer) -
// um heading dentro deles (ex: tagline do banner) nao ajuda a distinguir a
// pagina de destino de qualquer outra pagina. Descoberto empiricamente
// rodando o crawler contra um site real (sauce-demo.myshopify.com): sem essa
// exclusao, quase toda pagina "ancorava" na mesma tagline do banner do tema.
const SHARED_LANDMARK_ROLES = new Set(["banner", "navigation", "contentinfo"]);

function findFirstStable(
  node: AccessibilityNode,
  roles: readonly string[],
  options: CanonicalizeOptions,
  excludeSharedLandmarks: boolean,
): AccessibilityNode | undefined {
  if (excludeSharedLandmarks && SHARED_LANDMARK_ROLES.has(node.role)) return undefined;

  const hasUsableName = node.name !== undefined && node.name.trim().length > 0;
  if (roles.includes(node.role) && hasUsableName && !isDecorativeNode(node) && !isVolatileNode(node, options)) {
    return node;
  }
  for (const child of node.children ?? []) {
    const found = findFirstStable(child, roles, options, excludeSharedLandmarks);
    if (found) return found;
  }
  return undefined;
}

/**
 * Escolhe um landmark estavel (heading/main; ou link/button como fallback)
 * do no de destino para a assertion de visibilidade. Reaproveita a MESMA
 * logica de filtragem de "volatil" usada no hashing de identidade (secao B
 * do plano) via `isDecorativeNode`/`isVolatileNode` de graph/nodeIdentity.ts -
 * evita que "o que e seguro afirmar" seja definido duas vezes e possa
 * divergir. Preserva o nome ORIGINAL (case/acentuacao), diferente do
 * CanonicalNode usado no hash, que normaliza para minusculas.
 *
 * Primeiro tenta fora de landmarks compartilhados (banner/navigation/
 * contentinfo); so cai para a arvore inteira se nao achar nada fora deles.
 */
export function pickStableAnchor(tree: AccessibilityNode, options: CanonicalizeOptions = {}): StableAnchor | undefined {
  const heading = findFirstStable(tree, HEADING_ROLES, options, true) ?? findFirstStable(tree, HEADING_ROLES, options, false);
  if (heading) return { role: heading.role, name: heading.name! };

  const fallback = findFirstStable(tree, FALLBACK_ROLES, options, true) ?? findFirstStable(tree, FALLBACK_ROLES, options, false);
  return fallback ? { role: fallback.role, name: fallback.name! } : undefined;
}
