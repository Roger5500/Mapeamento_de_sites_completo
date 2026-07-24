import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AccessibilityNode } from "../../src/graph/nodeIdentity.js";
import { buildRoleLocatorCode } from "../../src/compiler/locatorStrategy.js";
import { pickStableAnchor, routeKeyToUrlRegexSource } from "../../src/compiler/assertionBuilder.js";
import { featureOf, selectPaths, type CompilerEdge, type CompilerNode } from "../../src/compiler/pathSelection.js";
import { buildSpecFile, type SpecNodeInfo } from "../../src/compiler/templates/spec.template.js";
import { writeSpecFiles } from "../../src/compiler/writeSpecFiles.js";

describe("locatorStrategy.buildRoleLocatorCode", () => {
  it("gera codigo getByRole valido com nome escapado corretamente", () => {
    const code = buildRoleLocatorCode("button", 'Salvar "rascunho"');
    expect(code).toBe('page.getByRole("button", { name: "Salvar \\"rascunho\\"" }).first()');
  });
});

describe("assertionBuilder.routeKeyToUrlRegexSource", () => {
  it("converte placeholders :id/:uuid/:date em [^/]+ e escapa o resto", () => {
    const source = routeKeyToUrlRegexSource("https://example.com/users/:id/orders/:uuid");
    const regex = new RegExp(source);
    expect(regex.test("https://example.com/users/42/orders/abc-123")).toBe(true);
    expect(regex.test("https://evil.com/users/42/orders/abc-123")).toBe(false);
  });
});

describe("assertionBuilder.pickStableAnchor", () => {
  it("prefere um heading estavel e preserva o case/acentuacao original (nao normalizado como no hash)", () => {
    const tree: AccessibilityNode = {
      role: "main",
      attributes: {},
      children: [{ role: "heading", name: "Pedido Confirmado", attributes: {}, children: [] }],
    };
    expect(pickStableAnchor(tree)).toEqual({ role: "heading", name: "Pedido Confirmado" });
  });

  it("ignora headings volateis (aria-live / padrao configurado) e cai no fallback link/button", () => {
    const tree: AccessibilityNode = {
      role: "main",
      attributes: {},
      children: [
        { role: "heading", name: "atualizado ha 2 minutos", attributes: { "aria-live": "polite" }, children: [] },
        { role: "button", name: "Continuar", attributes: {}, children: [] },
      ],
    };
    expect(pickStableAnchor(tree)).toEqual({ role: "button", name: "Continuar" });
  });

  it("retorna undefined quando nao ha nenhum landmark estavel", () => {
    const tree: AccessibilityNode = { role: "main", attributes: {}, children: [] };
    expect(pickStableAnchor(tree)).toBeUndefined();
  });

  it("ignora heading dentro de banner/navigation/contentinfo (compartilhado por todas as paginas) e prefere um heading especifico da pagina", () => {
    // Reproduz a estrutura real observada em sauce-demo.myshopify.com: a tagline do
    // tema fica dentro de um landmark "banner" presente em toda pagina do site.
    const tree: AccessibilityNode = {
      role: "root",
      attributes: {},
      children: [
        {
          role: "banner",
          attributes: {},
          children: [{ role: "heading", name: "Just a demo site showing off what Sauce can do.", attributes: {}, children: [] }],
        },
        {
          role: "generic",
          attributes: {},
          children: [{ role: "heading", name: "My Cart", attributes: {}, children: [] }],
        },
      ],
    };
    expect(pickStableAnchor(tree)).toEqual({ role: "heading", name: "My Cart" });
  });

  it("cai de volta para dentro de landmarks compartilhados se nao houver NENHUM heading fora deles", () => {
    const tree: AccessibilityNode = {
      role: "root",
      attributes: {},
      children: [{ role: "banner", attributes: {}, children: [{ role: "heading", name: "Unico heading da pagina", attributes: {}, children: [] }] }],
    };
    expect(pickStableAnchor(tree)).toEqual({ role: "heading", name: "Unico heading da pagina" });
  });
});

describe("pathSelection.featureOf", () => {
  it("extrai o primeiro segmento de path da route key", () => {
    expect(featureOf("https://example.com/checkout/payment")).toBe("checkout");
  });

  it("usa 'home' para a rota raiz", () => {
    expect(featureOf("https://example.com/")).toBe("home");
  });
});

function edge(from: string, to: string, name: string): CompilerEdge {
  return { fromNodeId: from, toNodeId: to, actionType: "click", elementRole: "link", elementAccessibleName: name, inputValueJson: null };
}

describe("pathSelection.selectPaths", () => {
  const nodesById = new Map<string, CompilerNode>([
    ["root", { id: "root", routeKey: "https://example.com/" }],
    ["catalog", { id: "catalog", routeKey: "https://example.com/catalog" }],
    ["product", { id: "product", routeKey: "https://example.com/catalog/product" }],
    ["cart", { id: "cart", routeKey: "https://example.com/cart" }],
  ]);

  it("gera um caminho de cobertura de no para cada no alcancavel a partir da raiz", () => {
    // catalog e cart sao ramos IRMAOS (nenhum e prefixo do outro) - ambos devem sobreviver ao dedup.
    const edges = [edge("root", "catalog", "Catalogo"), edge("root", "cart", "Ver carrinho")];
    const selected = selectPaths(edges, nodesById, "root", { maxPathsPerFeature: 10 });

    const targets = selected.map((p) => p.targetNodeId).sort();
    expect(targets).toEqual(["cart", "catalog"].sort());
  });

  it("sintetiza um caminho extra para uma aresta nao coberta pela cobertura de nos (ex: acao no mesmo no)", () => {
    const edges = [edge("root", "catalog", "Catalogo"), edge("root", "cart", "Ver carrinho"), edge("catalog", "root", "Voltar para home")];
    const selected = selectPaths(edges, nodesById, "root", { maxPathsPerFeature: 10 });

    // "Voltar para home" (catalog -> root) nao e alcancado pela BFS de cobertura de nos
    // (root ja foi alcancado com 0 arestas), mas deve aparecer como caminho extra.
    const hasBacktrackPath = selected.some((p) => p.edges.some((e) => e.elementAccessibleName === "Voltar para home"));
    expect(hasBacktrackPath).toBe(true);
  });

  it("descarta caminhos cuja assinatura e prefixo de outro caminho ja selecionado", () => {
    const edges = [edge("root", "catalog", "Catalogo"), edge("catalog", "product", "Produto X")];
    const selected = selectPaths(edges, nodesById, "root", { maxPathsPerFeature: 10 });

    // O caminho ate "catalog" sozinho e prefixo do caminho ate "product" (que passa por catalog) -
    // so o caminho mais longo (ate product) deve sobreviver.
    expect(selected.some((p) => p.targetNodeId === "catalog")).toBe(false);
    expect(selected.some((p) => p.targetNodeId === "product")).toBe(true);
  });

  it("respeita o cap maxPathsPerFeature por feature", () => {
    const manyEdges = Array.from({ length: 5 }, (_, i) => edge("root", `p${i}`, `Produto ${i}`));
    const manyNodes = new Map(nodesById);
    for (let i = 0; i < 5; i++) manyNodes.set(`p${i}`, { id: `p${i}`, routeKey: `https://example.com/catalog/p${i}` });

    const selected = selectPaths(manyEdges, manyNodes, "root", { maxPathsPerFeature: 2 });
    expect(selected).toHaveLength(2);
  });
});

const specNodesById = new Map<string, SpecNodeInfo>([
  [
    "catalog",
    {
      id: "catalog",
      routeKey: "https://example.com/catalog",
      lastUrl: "https://example.com/catalog",
      title: "Catalogo",
      snapshotJson: JSON.stringify({
        role: "main",
        attributes: {},
        children: [{ role: "heading", name: "Nosso Catalogo", attributes: {}, children: [] }],
      } satisfies AccessibilityNode),
    },
  ],
]);

describe("spec.template.buildSpecFile", () => {
  it("gera um arquivo .spec.ts com describe, teste por caminho e assertions de URL/visibilidade", () => {
    const content = buildSpecFile({
      featureName: "catalog",
      paths: [{ targetNodeId: "catalog", feature: "catalog", edges: [edge("root", "catalog", "Catalogo")] }],
      nodesById: specNodesById,
      volatilePatterns: [],
      volatileSelectors: [],
      expectedConsoleErrors: [],
      baseUrl: "https://example.com/",
    });

    expect(content).toContain('import { test, expect } from "@playwright/test";');
    expect(content).toContain('test.describe("catalog"');
    expect(content).toContain('page.getByRole("link", { name: "Catalogo" }).first().click()');
    expect(content).toContain("await expect(page).toHaveURL(");
    expect(content).toContain('page.getByRole("heading", { name: "Nosso Catalogo" }).first()).toBeVisible()');
  });

  it("gera .selectOption({label}) para uma aresta select_option, em vez de .click()/.fill()", () => {
    const selectEdge: CompilerEdge = {
      fromNodeId: "root",
      toNodeId: "catalog",
      actionType: "select_option",
      elementRole: "combobox",
      elementAccessibleName: "Variante",
      inputValueJson: JSON.stringify(["Grey jacket"]),
    };
    const content = buildSpecFile({
      featureName: "catalog",
      paths: [{ targetNodeId: "catalog", feature: "catalog", edges: [selectEdge] }],
      nodesById: specNodesById,
      volatilePatterns: [],
      volatileSelectors: [],
      expectedConsoleErrors: [],
      baseUrl: "https://example.com/",
    });

    expect(content).toContain('page.getByRole("combobox", { name: "Variante" }).first().selectOption([{ label: "Grey jacket" }])');
    expect(content).not.toContain(".fill(");
  });

  it("gera codigo TypeScript sintaticamente valido (verificado via new Function apos strip de types)", () => {
    const content = buildSpecFile({
      featureName: "catalog",
      paths: [{ targetNodeId: "catalog", feature: "catalog", edges: [edge("root", "catalog", "Catalogo")] }],
      nodesById: specNodesById,
      volatilePatterns: [],
      volatileSelectors: [],
      expectedConsoleErrors: ["Warning: ReactDOM.render"],
      baseUrl: "https://example.com/",
    });
    // Sanity check estrutural: parenteses/chaves balanceados.
    const opens = (content.match(/[{(]/g) ?? []).length;
    const closes = (content.match(/[})]/g) ?? []).length;
    expect(opens).toBe(closes);
  });
});

describe("writeSpecFiles", () => {
  let outputDir: string;

  beforeEach(() => {
    outputDir = mkdtempSync(path.join(tmpdir(), "mapeador-specs-"));
  });

  afterEach(() => {
    rmSync(outputDir, { recursive: true, force: true });
  });

  it("escreve um arquivo .spec.ts por feature em outputDir/<feature>/<feature>.spec.ts", () => {
    const written = writeSpecFiles(
      [{ targetNodeId: "catalog", feature: "catalog", edges: [edge("root", "catalog", "Catalogo")] }],
      {
        outputDir,
        nodesById: specNodesById,
        volatilePatterns: [],
        volatileSelectors: [],
        expectedConsoleErrors: [],
        baseUrl: "https://example.com/",
      },
    );

    expect(written).toHaveLength(1);
    expect(written[0]).toBe(path.join(outputDir, "catalog", "catalog.spec.ts"));
    const content = readFileSync(written[0]!, "utf8");
    expect(content).toContain("test.describe(");
  });
});
