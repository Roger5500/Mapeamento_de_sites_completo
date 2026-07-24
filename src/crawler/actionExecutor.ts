import type { AccessibilityNode } from "../graph/nodeIdentity.js";
import type { McpTools } from "../mcp/tools.js";
import { detectAndDismissOverlay } from "../safety/overlayAutoHeal.js";
import { resolveAccessibleName } from "./accessibleName.js";
import type { ElementCandidate } from "./frontier.js";

export class StaleElementError extends Error {
  constructor(candidate: ElementCandidate) {
    super(`elemento nao encontrado na snapshot atual: ${candidate.role} "${candidate.name}"`);
    this.name = "StaleElementError";
  }
}

export class ActionFailedError extends Error {
  constructor(candidate: ElementCandidate, cause?: unknown) {
    super(`acao falhou apos retries: ${candidate.role} "${candidate.name}"`, { cause });
    this.name = "ActionFailedError";
  }
}

/**
 * Compara pelo nome EFETIVO (direto ou derivado do conteudo aninhado - ver
 * accessibleName.ts), nao so pelo `node.name` cru - senao um candidato cujo
 * nome foi derivado na descoberta (ex: card de produto sem nome direto)
 * nunca seria reencontrado aqui, porque a snapshot fresca tambem nao traz
 * esse nome diretamente.
 */
function findMatchingNode(tree: AccessibilityNode, role: string, name: string): AccessibilityNode | undefined {
  function walk(node: AccessibilityNode): AccessibilityNode | undefined {
    if (node.role === role && resolveAccessibleName(node) === name) return node;
    for (const child of node.children ?? []) {
      const found = walk(child);
      if (found) return found;
    }
    return undefined;
  }
  return walk(tree);
}

export interface ExecuteActionInput {
  candidate: ElementCandidate;
  /** Presente quando role for textbox/searchbox - dispara `type()` em vez de `click()`. */
  typeValue?: string;
  /** Presente quando o candidato e um combobox/listbox com opcoes reais - dispara `selectOption()`. */
  selectValues?: string[];
}

export interface ExecuteActionResult {
  overlayDismissed: boolean;
}

/**
 * Resolve o elemento por (role, name) numa snapshot FRESCA a cada tentativa -
 * nunca reusa um `ref` obtido antes desta chamada, porque refs sao efemeros
 * e invalidam a qualquer mutacao do DOM (ver nota em mcp/tools.ts). Se a
 * acao falhar (ex: click interceptado por overlay), tenta detectar e
 * dispensar um overlay bloqueando a pagina e repete a acao original uma vez.
 *
 * Simplificacao conhecida (documentada, nao um bug): formularios multi-campo
 * sao preenchidos campo a campo via `type()`, nao em lote via
 * `browser_fill_form` - o agrupamento de campos por `<form>` a partir da
 * arvore de acessibilidade precisa de calibracao contra mais sites reais
 * antes de valer a complexidade extra (ver plano, secao "Proximos passos").
 */
export async function executeWithAutoHeal(tools: McpTools, input: ExecuteActionInput, maxRetries = 1): Promise<ExecuteActionResult> {
  const { candidate, typeValue, selectValues } = input;
  let overlayDismissed = false;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const snap = await tools.snapshot();
    const node = findMatchingNode(snap.tree, candidate.role, candidate.name);
    const ref = node?.attributes?.ref;
    if (!node || !ref) {
      throw new StaleElementError(candidate);
    }

    try {
      if (selectValues !== undefined) {
        await tools.selectOption(ref, `${candidate.role} "${candidate.name}"`, selectValues);
      } else if (typeValue !== undefined) {
        await tools.type(ref, `${candidate.role} "${candidate.name}"`, typeValue);
      } else {
        await tools.click(ref, `${candidate.role} "${candidate.name}"`);
      }
      return { overlayDismissed };
    } catch (error) {
      if (attempt >= maxRetries) {
        throw new ActionFailedError(candidate, error);
      }
      const healResult = await detectAndDismissOverlay(tools);
      if (!healResult.dismissed) {
        throw new ActionFailedError(candidate, error);
      }
      overlayDismissed = true;
      // continua o loop: re-snapshot e tenta a acao original de novo
    }
  }

  throw new ActionFailedError(candidate);
}
