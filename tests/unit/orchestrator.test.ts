import Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseSiteConfig } from "../../src/config/schema.js";
import { createOrchestrator } from "../../src/crawler/orchestrator.js";
import type { AccessibilityNode } from "../../src/graph/nodeIdentity.js";
import type { McpClientSession } from "../../src/mcp/client.js";
import type { ParsedSnapshot } from "../../src/mcp/snapshotParser.js";

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../src/graph/migrations");

function openTestDatabase(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of files) db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  return db;
}

/**
 * Site falso minimo com um "beco sem saida" de profundidade 2 (home -> a -> a2)
 * e um irmao de a2 (a3) que so fica pendente depois que a2 ja foi visitado -
 * isso forca exatamente um backtrack, de a2 de volta para "a" (nao para a
 * raiz), que e o caso que queremos validar: o backtrack deve navegar so ate
 * a base URL e reclicar o caminho gravado (Home -> A), nunca pular direto
 * para a URL de "a".
 *
 *   home --[A]--> a --[C]--> a2 (beco sem saida)
 *                  \-[F]--> a3 (beco sem saida)
 */
type PageId = "home" | "a" | "a2" | "a3";

const PAGES: Record<PageId, { url: string; heading: string; links: Array<{ ref: string; name: string; to: PageId }> }> = {
  home: { url: "https://x.test/", heading: "Home", links: [{ ref: "link-A", name: "A", to: "a" }] },
  a: {
    url: "https://x.test/a",
    heading: "Page A",
    links: [
      { ref: "link-C", name: "C", to: "a2" },
      { ref: "link-F", name: "F", to: "a3" },
    ],
  },
  a2: { url: "https://x.test/a/2", heading: "Page A2", links: [] },
  a3: { url: "https://x.test/a/3", heading: "Page A3", links: [] },
};

function buildTree(page: PageId): AccessibilityNode {
  const def = PAGES[page];
  return {
    role: "root",
    attributes: {},
    children: [
      { role: "heading", name: def.heading, attributes: {}, children: [] },
      ...def.links.map((link) => ({ role: "link", name: link.name, attributes: { ref: link.ref }, children: [] as AccessibilityNode[] })),
    ],
  };
}

interface FakeSessionOptions {
  /** Se definido, a N-esima chamada de click() (1-indexada) lanca erro, simulando falha no replay. */
  failClickOnCallNumber?: number;
}

function createFakeSession(options: FakeSessionOptions = {}) {
  let currentPage: PageId = "home";
  let clickCallCount = 0;
  const navigates: string[] = [];
  const clicks: string[] = [];

  const tools = {
    navigate: async (url: string) => {
      navigates.push(url);
      const match = (Object.entries(PAGES) as Array<[PageId, (typeof PAGES)[PageId]]>).find(([, def]) => def.url === url);
      if (match) currentPage = match[0];
    },
    snapshot: async (): Promise<ParsedSnapshot> => ({
      url: PAGES[currentPage].url,
      title: PAGES[currentPage].heading,
      tree: buildTree(currentPage),
    }),
    click: async (ref: string) => {
      clickCallCount += 1;
      clicks.push(ref);
      if (options.failClickOnCallNumber === clickCallCount) {
        throw new Error("falha simulada no replay de cliques");
      }
      const target = PAGES[currentPage].links.find((link) => link.ref === ref);
      if (!target) throw new Error(`link nao encontrado para ref ${ref} na pagina ${currentPage}`);
      currentPage = target.to;
    },
    type: async () => {
      throw new Error("type() nao deveria ser chamado neste cenario (nenhum campo de formulario)");
    },
    networkRequests: async () => [],
    consoleMessages: async () => [],
  };

  const session = { tools } as unknown as McpClientSession;
  return { session, navigates, clicks };
}

describe("Orchestrator - backtrack via replay de cliques", () => {
  it("ao voltar para um no ja visitado, navega so ate a base URL e reclica o caminho gravado (nunca pula direto pra URL do alvo)", async () => {
    const db = openTestDatabase();
    const site = parseSiteConfig({
      id: "fake-site",
      baseUrl: "https://x.test/",
      allowedOrigins: ["https://x.test"],
    });
    const { session, navigates, clicks } = createFakeSession();

    const orchestrator = createOrchestrator(session, db, { site, runId: "run-1", maxSteps: 5 });
    const stats = await orchestrator.run();

    expect(stats.nodesDiscovered).toBe(4);
    expect(stats.edgesRecorded).toBe(3);
    expect(stats.actionsFailed).toBe(0);

    // Apenas 2 navigates: o inicial do run() e o do backtrack de volta pra base URL -
    // em nenhum momento um navigate direto pra "https://x.test/a" (o antigo "teleporte").
    expect(navigates).toEqual(["https://x.test/", "https://x.test/"]);

    // "A" e clicado duas vezes: na exploracao inicial (Home->A) e de novo no replay do
    // backtrack (Home->A) antes de finalmente clicar em F.
    expect(clicks).toEqual(["link-A", "link-C", "link-A", "link-F"]);

    db.close();
  });

  it("cai para navigate(url) direto quando o replay de cliques falha no meio do caminho", async () => {
    const db = openTestDatabase();
    const site = parseSiteConfig({
      id: "fake-site",
      baseUrl: "https://x.test/",
      allowedOrigins: ["https://x.test"],
    });
    // A 3a chamada de click() no total e a do replay do backtrack (Home->A) - sabotada.
    const { session, navigates } = createFakeSession({ failClickOnCallNumber: 3 });

    const orchestrator = createOrchestrator(session, db, { site, runId: "run-2", maxSteps: 5 });
    const stats = await orchestrator.run();

    expect(navigates).toContain("https://x.test/a");
    expect(stats.nodesDiscovered).toBe(4);
    expect(stats.edgesRecorded).toBe(3);

    db.close();
  });
});
