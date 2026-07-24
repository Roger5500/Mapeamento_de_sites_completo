import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createRequire } from "node:module";
import path from "node:path";
import { McpTools } from "./tools.js";

/**
 * Resolve o caminho do cli.js do @playwright/mcp via resolucao de modulo Node
 * (nao por um path relativo tipo "node_modules/@playwright/mcp/cli.js"),
 * para funcionar independente do cwd de onde o processo foi iniciado.
 * package.json do pacote so exporta "./package.json" e ".", entao resolvemos
 * o package.json (que e exportado) e derivamos cli.js a partir do campo "bin".
 */
function resolvePlaywrightMcpCliPath(): string {
  const require = createRequire(import.meta.url);
  const packageJsonPath = require.resolve("@playwright/mcp/package.json");
  return path.join(path.dirname(packageJsonPath), "cli.js");
}

export interface McpClientOptions {
  /** Diretorio de perfil persistente do Chromium (nao usar junto com isolated=true). */
  userDataDir?: string;
  /** Sessao efemera em memoria - usar para runs que nao precisam sobreviver a um restart do processo. */
  isolated?: boolean;
  headless?: boolean;
  browser?: "chrome" | "chromium" | "firefox" | "webkit" | "msedge";
  allowedOrigins?: string[];
  caps?: Array<"network" | "storage" | "testing" | "pdf" | "vision" | "devtools">;
}

/**
 * Sobe o @playwright/mcp como subprocesso stdio e devolve um client MCP +
 * wrappers tipados (McpTools) prontos para uso. Usa o binario local instalado
 * via node_modules/.bin (nao `npx @playwright/mcp@latest`) para nao depender
 * de rede a cada crawl e para garantir que a versao fixada no package.json
 * seja sempre a executada.
 */
export class McpClientSession {
  private constructor(
    private readonly client: Client,
    private readonly transport: StdioClientTransport,
    readonly tools: McpTools,
  ) {}

  static async start(options: McpClientOptions = {}): Promise<McpClientSession> {
    const args: string[] = [
      `--browser=${options.browser ?? "chromium"}`,
      options.headless === false ? "" : "--headless",
    ].filter((arg) => arg.length > 0);

    if (options.isolated) {
      args.push("--isolated");
    } else if (options.userDataDir) {
      args.push("--user-data-dir", options.userDataDir);
    }

    if (options.caps && options.caps.length > 0) {
      args.push(`--caps=${options.caps.join(",")}`);
    }

    if (options.allowedOrigins && options.allowedOrigins.length > 0) {
      args.push("--allowed-origins", options.allowedOrigins.join(";"));
    }

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolvePlaywrightMcpCliPath(), ...args],
    });

    const client = new Client({ name: "mapeador-mcp", version: "0.1.0" });
    await client.connect(transport);

    // Falha rapido se a negociacao de capacidades nao trouxe as tools esperadas,
    // em vez de descobrir isso so no meio de um crawl de horas.
    const { tools: toolList } = await client.listTools();
    const requiredTools = ["browser_snapshot", "browser_click", "browser_navigate", "browser_evaluate"];
    const missing = requiredTools.filter((name) => !toolList.some((tool) => tool.name === name));
    if (missing.length > 0) {
      await client.close();
      throw new Error(`@playwright/mcp nao expos as tools esperadas: ${missing.join(", ")}`);
    }

    return new McpClientSession(client, transport, new McpTools(client));
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
