import type { McpTools } from "../mcp/tools.js";
import type { ConsoleMessageInfo, NetworkRequestInfo } from "../mcp/types.js";

export interface NetworkBaseline {
  seenKeys: Set<string>;
}

function requestKey(request: NetworkRequestInfo): string {
  return `${request.sequence}|${request.method}|${request.url}`;
}

/**
 * Captura o estado de rede ANTES de executar uma acao. Guardamos as chaves
 * (sequence+method+url) em vez de so o tamanho da lista porque o
 * `browser_network_requests` do @playwright/mcp reinicia a numeracao apos
 * uma navegacao - um diff por indice/tamanho de array pode se confundir
 * quando a acao navega para uma pagina nova. Diff por chave funciona nos
 * dois casos (mesma pagina com novos requests, ou pagina totalmente nova).
 */
export async function captureNetworkBaseline(tools: McpTools): Promise<NetworkBaseline> {
  const requests = await tools.networkRequests();
  return { seenKeys: new Set(requests.map(requestKey)) };
}

export interface ActionValidationResult {
  networkOk: boolean;
  newRequests: NetworkRequestInfo[];
  consoleErrors: ConsoleMessageInfo[];
}

/** Valida rede + console APOS uma acao, comparando contra a baseline capturada antes dela. */
export async function validateAfterAction(tools: McpTools, baseline: NetworkBaseline): Promise<ActionValidationResult> {
  const after = await tools.networkRequests();
  const newRequests = after.filter((request) => !baseline.seenKeys.has(requestKey(request)));
  const networkOk = newRequests.every((request) => request.status === null || request.status < 400);
  const consoleErrors = await tools.consoleMessages("error");
  return { networkOk, newRequests, consoleErrors };
}
