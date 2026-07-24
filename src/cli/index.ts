import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import type { CompilerEdge, CompilerNode } from "../compiler/pathSelection.js";
import { selectPaths } from "../compiler/pathSelection.js";
import type { SpecNodeInfo } from "../compiler/templates/spec.template.js";
import { writeSpecFiles } from "../compiler/writeSpecFiles.js";
import { createOrchestrator } from "../crawler/orchestrator.js";
import type { SiteConfig } from "../config/schema.js";
import { openDatabase } from "../graph/db.js";
import { EdgeRepository, FrontierRepository, NodeRepository } from "../graph/repository.js";
import { McpClientSession } from "../mcp/client.js";
import { createLogger } from "../logging/logger.js";
import { writeRunReport } from "../logging/report.js";

const SITE_LOADERS: Record<string, () => Promise<{ default: SiteConfig }>> = {
  "example-app": () => import("../config/sites/example-app.config.js"),
  "sauce-demo": () => import("../config/sites/sauce-demo.config.js"),
};

async function loadSite(id: string): Promise<SiteConfig> {
  const loader = SITE_LOADERS[id];
  if (!loader) {
    throw new Error(`site desconhecido: "${id}". Sites disponiveis: ${Object.keys(SITE_LOADERS).join(", ")}`);
  }
  const mod = await loader();
  return mod.default;
}

const logger = createLogger("cli");
const program = new Command();

program.name("mapeador").description("Mapeador autonomo de sites (Playwright + MCP) e gerador de testes de regressao");

program
  .command("crawl")
  .description("Varre um site configurado e grava o grafo de navegacao em data/<runId>/graph.sqlite")
  .requiredOption("--site <id>", "id do site configurado em src/config/sites")
  .option("--max-steps <n>", "numero maximo de passos de execucao", "50")
  .option("--headed", "roda com o browser visivel (default: headless)", false)
  .action(async (opts: { site: string; maxSteps: string; headed: boolean }) => {
    const site = await loadSite(opts.site);
    const runId = randomUUID();
    const dataDir = path.resolve("data", runId);
    mkdirSync(dataDir, { recursive: true });

    logger.info({ runId, site: site.id, dataDir }, "iniciando crawl");

    const db = openDatabase(path.join(dataDir, "graph.sqlite"));
    const session = await McpClientSession.start({
      headless: !opts.headed,
      userDataDir: path.join(dataDir, "profile"),
      allowedOrigins: site.allowedOrigins,
      caps: ["network", "storage", "testing"],
    });

    try {
      const orchestrator = createOrchestrator(session, db, { site, runId, maxSteps: Number(opts.maxSteps) });
      const stats = await orchestrator.run();
      logger.info(stats, "crawl finalizado");

      const nodes = new NodeRepository(db).listForRun(runId);
      const edges = new EdgeRepository(db).listForRun(runId);
      const skippedFrontier = new FrontierRepository(db).listSkipped(runId);
      const reportPath = path.join(dataDir, "run-report.html");
      writeRunReport(reportPath, { runId, siteId: site.id, stats, nodes, edges, skippedFrontier });

      console.log(`\nRun ${runId} concluido.`);
      console.log(`  Grafo: ${path.join(dataDir, "graph.sqlite")}`);
      console.log(`  Relatorio: ${reportPath}`);
      console.log(`  Nos: ${stats.nodesDiscovered} | Arestas: ${stats.edgesRecorded} | Falhas: ${stats.actionsFailed} | Bloqueados por guards: ${stats.actionsSkippedByGuard}`);
    } finally {
      await session.close();
      db.close();
    }
  });

program
  .command("compile")
  .description("Compila o grafo de um run em arquivos .spec.ts do Playwright")
  .requiredOption("--run <runId>", "id do run (pasta em data/<runId>)")
  .requiredOption("--site <id>", "id do site (para volatilePatterns/expectedConsoleErrors/etc)")
  .option("--output <dir>", "diretorio de saida dos specs gerados", "tests/generated")
  .action(async (opts: { run: string; site: string; output: string }) => {
    const site = await loadSite(opts.site);
    const dbPath = path.resolve("data", opts.run, "graph.sqlite");
    const db = openDatabase(dbPath);

    try {
      const nodeRows = new NodeRepository(db).listForRun(opts.run);
      const edgeRows = new EdgeRepository(db).listForRun(opts.run);
      if (nodeRows.length === 0) {
        throw new Error(`nenhum no encontrado para o run "${opts.run}" - o crawl gerou algum resultado?`);
      }

      const rootNode = [...nodeRows].sort((a, b) => a.first_seen_at - b.first_seen_at)[0]!;

      const nodesById = new Map<string, SpecNodeInfo & CompilerNode>(
        nodeRows.map((node) => [
          node.id,
          {
            id: node.id,
            routeKey: node.route_key,
            lastUrl: node.last_url,
            title: node.title,
            snapshotJson: node.snapshot_json,
          },
        ]),
      );

      const compilerEdges: CompilerEdge[] = edgeRows.map((edge) => ({
        fromNodeId: edge.from_node_id,
        toNodeId: edge.to_node_id,
        actionType: edge.action_type,
        elementRole: edge.element_role,
        elementAccessibleName: edge.element_accessible_name,
        inputValueJson: edge.input_value_json,
      }));

      const selected = selectPaths(compilerEdges, nodesById, rootNode.id, { maxPathsPerFeature: site.maxPathsPerFeature });
      const outputDir = path.resolve(opts.output);
      const written = writeSpecFiles(selected, {
        outputDir,
        nodesById,
        volatilePatterns: site.volatilePatterns,
        volatileSelectors: site.volatileSelectors,
        expectedConsoleErrors: site.expectedConsoleErrors,
        baseUrl: site.baseUrl,
      });

      console.log(`\nGerados ${written.length} arquivo(s) de teste a partir de ${selected.length} caminho(s):`);
      for (const file of written) console.log(`  ${file}`);
    } finally {
      db.close();
    }
  });

await program.parseAsync(process.argv);
