import Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EdgeRepository, NodeRepository, RunRepository, shortestPathsFromRoot, type GraphEdge } from "../../src/graph/repository.js";

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../src/graph/migrations");

function openTestDatabase(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  return db;
}

describe("repositorios SQLite", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openTestDatabase();
  });

  afterEach(() => {
    db.close();
  });

  it("cria um run e os nos/arestas associados", () => {
    const runs = new RunRepository(db);
    const nodes = new NodeRepository(db);
    const edges = new EdgeRepository(db);

    runs.create("run-1", "example-app");
    nodes.upsert({
      id: "node-a",
      runId: "run-1",
      routeKey: "https://example.com/",
      structuralHash: "hash-a",
      lastUrl: "https://example.com/",
      snapshotJson: "{}",
    });
    nodes.upsert({
      id: "node-b",
      runId: "run-1",
      routeKey: "https://example.com/dashboard",
      structuralHash: "hash-b",
      lastUrl: "https://example.com/dashboard",
      snapshotJson: "{}",
    });

    const inserted = edges.insertIfAbsent({
      runId: "run-1",
      fromNodeId: "node-a",
      toNodeId: "node-b",
      actionType: "click",
      elementRole: "link",
      elementAccessibleName: "Dashboard",
      networkOk: true,
      stateChanged: true,
    });

    expect(inserted).toBe(true);
    expect(edges.listForRun("run-1")).toHaveLength(1);
    expect(runs.get("run-1")?.status).toBe("running");
  });

  it("nao duplica a mesma acao (from_node, action_type, role, name) - dedup via UNIQUE", () => {
    const runs = new RunRepository(db);
    const nodes = new NodeRepository(db);
    const edges = new EdgeRepository(db);

    runs.create("run-1", "example-app");
    for (const id of ["node-a", "node-b"]) {
      nodes.upsert({
        id,
        runId: "run-1",
        routeKey: `https://example.com/${id}`,
        structuralHash: "hash",
        lastUrl: `https://example.com/${id}`,
        snapshotJson: "{}",
      });
    }

    const edgeInput = {
      runId: "run-1",
      fromNodeId: "node-a",
      toNodeId: "node-b",
      actionType: "click",
      elementRole: "button",
      elementAccessibleName: "Salvar",
      networkOk: true,
      stateChanged: true,
    };

    expect(edges.insertIfAbsent(edgeInput)).toBe(true);
    expect(edges.insertIfAbsent(edgeInput)).toBe(false);
    expect(edges.listForRun("run-1")).toHaveLength(1);
  });

  it("upsert de no existente incrementa visit_count em vez de duplicar", () => {
    const runs = new RunRepository(db);
    const nodes = new NodeRepository(db);
    runs.create("run-1", "example-app");

    const input = {
      id: "node-a",
      runId: "run-1",
      routeKey: "https://example.com/",
      structuralHash: "hash-a",
      lastUrl: "https://example.com/",
      snapshotJson: "{}",
    };
    nodes.upsert(input);
    nodes.upsert(input);
    const node = nodes.upsert(input);

    expect(node.visit_count).toBe(3);
    expect(nodes.listForRun("run-1")).toHaveLength(1);
  });
});

describe("shortestPathsFromRoot", () => {
  it("encontra o caminho mais curto ate cada no alcancavel a partir da raiz", () => {
    const edges: GraphEdge[] = [
      { fromNodeId: "root", toNodeId: "a", actionType: "click", elementRole: "link", elementAccessibleName: "A" },
      { fromNodeId: "a", toNodeId: "b", actionType: "click", elementRole: "link", elementAccessibleName: "B" },
      { fromNodeId: "root", toNodeId: "b", actionType: "click", elementRole: "link", elementAccessibleName: "B direto" },
    ];

    const paths = shortestPathsFromRoot(edges, "root");

    expect(paths.get("b")?.edges).toHaveLength(1);
    expect(paths.get("b")?.edges[0]?.elementAccessibleName).toBe("B direto");
    expect(paths.get("a")?.edges).toHaveLength(1);
  });

  it("nao inclui nos inalcancaveis a partir da raiz", () => {
    const edges: GraphEdge[] = [
      { fromNodeId: "root", toNodeId: "a", actionType: "click", elementRole: "link", elementAccessibleName: "A" },
      { fromNodeId: "isolated", toNodeId: "z", actionType: "click", elementRole: "link", elementAccessibleName: "Z" },
    ];

    const paths = shortestPathsFromRoot(edges, "root");

    expect(paths.has("z")).toBe(false);
    expect(paths.has("a")).toBe(true);
  });
});
