/**
 * Regra de revisita/backtrack (secao C.3 do plano) - checada ao POUSAR num
 * no, nao como filtro de candidato. Um no que ultrapassa `maxRevisits` vira
 * saturated e passa a ser tratado como esgotado, forcando o crawler a cair
 * para a fronteira global. Isso tambem funciona como defesa natural contra
 * scroll infinito/"carregar mais": o hash estrutural muda a cada clique
 * (novo item na lista), entao visit_count so para de crescer quando o cap
 * interrompe o loop.
 */
export interface RevisitableNode {
  visitCount: number;
  status: string;
}

export function shouldMarkSaturated(node: RevisitableNode, maxRevisits: number): boolean {
  return node.status !== "saturated" && node.visitCount > maxRevisits;
}

export function isNodeSaturated(node: RevisitableNode, maxRevisits: number): boolean {
  return node.status === "saturated" || node.visitCount > maxRevisits;
}
