/**
 * Score de prioridade de um candidato dentro da fronteira - ver secao C do
 * plano. Papeis de navegacao (link/button) pesam mais que campos de forms;
 * profundidade e tentativas falhas anteriores penalizam; um pequeno bonus
 * incentiva completar formularios com varios campos em vez de abandona-los
 * pela metade.
 */
export interface PriorityContext {
  depthFromRoot: number;
  previousFailedAttempts: number;
  isMultiFieldForm?: boolean;
}

const ROLE_WEIGHT: Record<string, number> = {
  link: 3,
  button: 3,
  tab: 2,
  menuitem: 2,
  textbox: 1,
  searchbox: 1,
  combobox: 1,
  checkbox: 1,
  radio: 1,
  switch: 1,
  option: 1,
};

const FORM_FIELD_ROLES = new Set(["textbox", "searchbox", "combobox"]);

export function computePriority(role: string, ctx: PriorityContext): number {
  const base = ROLE_WEIGHT[role] ?? 0.5;
  let score = base - 0.3 * ctx.depthFromRoot - 1.5 * ctx.previousFailedAttempts;
  if (ctx.isMultiFieldForm && FORM_FIELD_ROLES.has(role)) {
    score += 0.5;
  }
  return score;
}
