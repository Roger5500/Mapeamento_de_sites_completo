import type { AccessibilityNode } from "../graph/nodeIdentity.js";

/**
 * Resolve o nome "efetivo" de um no interativo: usa o nome reportado
 * diretamente pelo @playwright/mcp quando existe, senao deriva um nome a
 * partir do conteudo aninhado (name-from-content), na ordem heading -> img/text.
 *
 * Necessario porque o @playwright/mcp (verificado empiricamente na versao
 * 0.0.78) omite o nome de links "cartao" que embrulham imagem+heading (ex:
 * cards de produto em lojas Shopify) - mesmo o Playwright real computando um
 * nome de verdade pra esse elemento via accessible-name-from-content. Sem
 * essa derivacao, extractInteractiveElements descarta esses elementos por
 * "nao ter nome", e o crawler nunca descobre produtos/cards, so navegacao.
 *
 * Usada nos DOIS lugares que precisam concordar sobre o nome de um elemento -
 * descoberta (frontier.ts) e re-resolucao numa snapshot fresca (actionExecutor.ts) -
 * pra um candidato com nome derivado poder ser reencontrado depois.
 */
export function resolveAccessibleName(node: AccessibilityNode): string | undefined {
  const direct = node.name?.trim();
  if (direct) return direct;

  const heading = findFirstNamedDescendant(node, ["heading"]);
  if (heading) return heading;

  return findFirstNamedDescendant(node, ["img", "text"]);
}

function findFirstNamedDescendant(node: AccessibilityNode, roles: readonly string[]): string | undefined {
  for (const child of node.children ?? []) {
    const name = child.name?.trim();
    if (roles.includes(child.role) && name) return name;
    const found = findFirstNamedDescendant(child, roles);
    if (found) return found;
  }
  return undefined;
}
