import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { parseSnapshotResponse, type ParsedSnapshot } from "./snapshotParser.js";
import type { ConsoleMessageInfo, NetworkRequestInfo, TabInfo } from "./types.js";

/**
 * Wrappers tipados sobre as tools cruas do @playwright/mcp. Isola o resto do
 * codigo do formato de resposta MCP (`{content:[{type:'text', text}]}`) e dos
 * nomes/formatos exatos de cada tool - verificados empiricamente contra o
 * servidor real (0.0.78), nao apenas documentados. Se o servidor mudar o
 * formato entre versoes, so este arquivo (e snapshotParser.ts) precisam mudar.
 *
 * Nota importante confirmada empiricamente: a resposta de acoes como
 * `browser_click`/`browser_type`/`browser_navigate` NUNCA inclui a snapshot
 * inline (ela e salva em arquivo: "- [Snapshot](.playwright-mcp/page-*.yml)").
 * Apenas uma chamada dedicada a `browser_snapshot` retorna o bloco yaml
 * inline parseavel. Por isso o loop do orquestrador sempre chama `snapshot()`
 * como um passo separado apos qualquer acao, nunca tenta extrair a arvore da
 * resposta da propria acao.
 */
export class McpTools {
  constructor(private readonly client: Client) {}

  private async callText(name: string, args: Record<string, unknown> = {}): Promise<string> {
    const result = await this.client.callTool({ name, arguments: args });
    const text = extractText(result);
    if ((result as { isError?: boolean }).isError) {
      throw new McpToolError(name, text ?? "erro desconhecido");
    }
    if (text === undefined) {
      throw new McpToolError(name, "resposta sem conteudo de texto");
    }
    return text;
  }

  async navigate(url: string): Promise<void> {
    await this.callText("browser_navigate", { url });
  }

  async navigateBack(): Promise<void> {
    await this.callText("browser_navigate_back");
  }

  /** Unica fonte confiavel da arvore de acessibilidade completa - ver nota da classe. */
  async snapshot(): Promise<ParsedSnapshot> {
    const text = await this.callText("browser_snapshot");
    return parseSnapshotResponse(text);
  }

  async click(target: string, element: string, options: { doubleClick?: boolean; button?: "left" | "right" | "middle" } = {}): Promise<void> {
    await this.callText("browser_click", { target, element, ...options });
  }

  async type(target: string, element: string, text: string, submit = false): Promise<void> {
    await this.callText("browser_type", { target, element, text, submit });
  }

  async fillForm(fields: Array<{ target: string; element: string; name: string; type: string; value: string }>): Promise<void> {
    await this.callText("browser_fill_form", { fields });
  }

  async selectOption(target: string, element: string, values: string[]): Promise<void> {
    await this.callText("browser_select_option", { target, element, values });
  }

  async hover(target: string, element: string): Promise<void> {
    await this.callText("browser_hover", { target, element });
  }

  async pressKey(key: string): Promise<void> {
    await this.callText("browser_press_key", { key });
  }

  async fileUpload(paths: string[]): Promise<void> {
    await this.callText("browser_file_upload", { paths });
  }

  async handleDialog(accept: boolean, promptText?: string): Promise<void> {
    await this.callText("browser_handle_dialog", { accept, promptText });
  }

  async waitFor(options: { text?: string; textGone?: string; time?: number }): Promise<void> {
    await this.callText("browser_wait_for", options);
  }

  /** Leitura somente-consulta via JS no contexto da pagina - usado para location.href, deteccao de iframe, etc. */
  async evaluate(fn: string): Promise<unknown> {
    const text = await this.callText("browser_evaluate", { function: fn });
    const resultSection = extractResultSection(text);
    if (resultSection === undefined) return undefined;
    try {
      return JSON.parse(resultSection) as unknown;
    } catch {
      return resultSection;
    }
  }

  async currentUrl(): Promise<string> {
    const result = await this.evaluate("() => location.href");
    return String(result);
  }

  /** `level` segue a semantica do MCP: inclui mensagens do nivel escolhido PRA CIMA em severidade (error < warning < info < debug). */
  async consoleMessages(level: "error" | "warning" | "info" | "debug" = "info"): Promise<ConsoleMessageInfo[]> {
    const text = await this.callText("browser_console_messages", { level });
    return parseConsoleMessages(text);
  }

  async networkRequests(includeStatic = false): Promise<NetworkRequestInfo[]> {
    const text = await this.callText("browser_network_requests", { static: includeStatic });
    return parseNetworkRequests(text);
  }

  async tabsList(): Promise<TabInfo[]> {
    const text = await this.callText("browser_tabs", { action: "list" });
    return parseTabsList(text);
  }

  async tabsSelect(index: number): Promise<void> {
    await this.callText("browser_tabs", { action: "select", index });
  }

  async tabsClose(index?: number): Promise<void> {
    await this.callText("browser_tabs", index === undefined ? { action: "close" } : { action: "close", index });
  }

  async generateLocator(target: string, element: string): Promise<string> {
    return this.callText("browser_generate_locator", { target, element });
  }

  async storageState(): Promise<unknown> {
    const text = await this.callText("browser_storage_state");
    const section = extractResultSection(text) ?? text;
    return JSON.parse(section) as unknown;
  }
}

export class McpToolError extends Error {
  constructor(
    public readonly toolName: string,
    message: string,
  ) {
    super(`MCP tool '${toolName}' falhou: ${message}`);
    this.name = "McpToolError";
  }
}

interface McpTextContent {
  type: string;
  text?: string;
}

interface McpCallToolLikeResult {
  content?: unknown;
  isError?: boolean;
}

function extractText(result: unknown): string | undefined {
  const typed = result as McpCallToolLikeResult;
  const content = typed.content;
  if (!Array.isArray(content)) return undefined;
  const textItem = (content as McpTextContent[]).find((item) => item.type === "text" && typeof item.text === "string");
  return textItem?.text;
}

/**
 * A maioria das respostas de tools segue o padrao "### Result\n<conteudo>\n### <proxima secao>".
 * Extrai apenas o conteudo da secao Result, descartando cabecalhos e o bloco
 * "### Ran Playwright code" que normalmente segue.
 */
export function extractResultSection(text: string): string | undefined {
  const match = /### Result\n([\s\S]*?)(?:\n### |$)/.exec(text);
  return match?.[1]?.trim();
}

/**
 * Formato confirmado empiricamente: "### Result\nTotal messages: N (Errors: X, Warnings: Y)\n\n[LEVEL] texto @ local"
 * uma linha por mensagem, nivel em maiusculas entre colchetes.
 */
export function parseConsoleMessages(text: string): ConsoleMessageInfo[] {
  const lines = text.split("\n");
  const messages: ConsoleMessageInfo[] = [];
  const lineRe = /^\[(\w+)]\s*(.*)$/;
  for (const line of lines) {
    const match = lineRe.exec(line.trim());
    if (match) {
      messages.push({ type: match[1]!.toLowerCase(), text: match[2]! });
    }
  }
  return messages;
}

/**
 * Formato confirmado empiricamente: "### Result\nN. [METHOD] url => [STATUS] motivo"
 * ou "N. [METHOD] url" (sem "=>" quando o request ainda nao tem status/nao rastreado),
 * mais uma linha final "Note: N static requests not shown..." a ser ignorada.
 */
export function parseNetworkRequests(text: string): NetworkRequestInfo[] {
  const lines = text.split("\n");
  const requests: NetworkRequestInfo[] = [];
  const lineRe = /^(\d+)\.\s*\[(\w+)]\s+(\S+)(?:\s*=>\s*\[(FAILED|\d+)])?/;
  for (const line of lines) {
    const match = lineRe.exec(line.trim());
    if (match) {
      const statusToken = match[4];
      const status = statusToken === undefined || statusToken === "FAILED" ? null : Number(statusToken);
      requests.push({ sequence: Number(match[1]), method: match[2]!, url: match[3]!, status });
    }
  }
  return requests;
}

/**
 * Formato confirmado empiricamente: "### Result\n- 0: (current) [Titulo](url)"
 * uma linha por aba, link em estilo markdown.
 */
export function parseTabsList(text: string): TabInfo[] {
  const lines = text.split("\n");
  const tabs: TabInfo[] = [];
  const lineRe = /^-\s*(\d+):\s*(\(current\)\s*)?\[([^\]]*)]\(([^)]+)\)/;
  for (const line of lines) {
    const match = lineRe.exec(line.trim());
    if (match) {
      tabs.push({ index: Number(match[1]), active: Boolean(match[2]), title: match[3]!, url: match[4]! });
    }
  }
  return tabs;
}
