import { describe, expect, it } from "vitest";
import {
  canonicalizeTree,
  computeNodeIdentity,
  computeRouteKey,
  type AccessibilityNode,
} from "../../src/graph/nodeIdentity.js";

describe("computeRouteKey", () => {
  it("normaliza segmentos numericos, UUID e data para placeholders", () => {
    const key = computeRouteKey(
      "https://example.com/users/42/orders/550e8400-e29b-41d4-a716-446655440000/2024-01-15",
    );
    expect(key).toBe("https://example.com/users/:id/orders/:uuid/:date");
  });

  it("remove parametros voláteis (denylist + utm_*) e ordena o restante alfabeticamente", () => {
    const key = computeRouteKey("https://example.com/search?zebra=1&session=abc&utm_source=ads&apple=2", {
      queryParamDenylist: ["session"],
    });
    expect(key).toBe("https://example.com/search?apple=2&zebra=1");
  });

  it("trata roteamento SPA baseado em hash (#/rota) com as mesmas regras de segmento", () => {
    const key = computeRouteKey("https://example.com/app#/products/123");
    expect(key).toBe("https://example.com/app#products/:id");
  });

  it("nao trata hash que nao parece uma rota como segmento de rota", () => {
    const key = computeRouteKey("https://example.com/page#section-2");
    expect(key).toBe("https://example.com/page");
  });

  it("e estavel independente da ordem original da query string", () => {
    const a = computeRouteKey("https://example.com/x?b=2&a=1");
    const b = computeRouteKey("https://example.com/x?a=1&b=2");
    expect(a).toBe(b);
  });
});

describe("canonicalizeTree", () => {
  const baseTree: AccessibilityNode = {
    role: "main",
    children: [
      { role: "heading", name: "  Pedido   Confirmado  " },
      { role: "presentation" },
      { role: "status", name: "atualizado há 3 minutos", attributes: { "aria-live": "polite" } },
      { role: "button", name: "Salvar" },
    ],
  };

  it("remove nos presentation/none sem nome acessivel", () => {
    const canonical = canonicalizeTree(baseTree);
    expect(canonical?.children.some((c) => c.role === "presentation")).toBe(false);
  });

  it("remove nos com aria-live (volateis por definicao)", () => {
    const canonical = canonicalizeTree(baseTree);
    expect(canonical?.children.some((c) => c.role === "status")).toBe(false);
  });

  it("remove nos cujo nome bate com um volatilePattern configurado", () => {
    const treeWithTimestamp: AccessibilityNode = {
      role: "main",
      children: [{ role: "text", name: "2024-01-15T10:30:00" }],
    };
    const canonical = canonicalizeTree(treeWithTimestamp, {
      volatilePatterns: ["\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}"],
    });
    expect(canonical?.children).toHaveLength(0);
  });

  it("normaliza espacos em branco e maiusculas/minusculas do nome, preservando a ordem dos filhos", () => {
    const canonical = canonicalizeTree(baseTree);
    const names = canonical?.children.map((c) => c.name);
    expect(names).toEqual(["pedido confirmado", "salvar"]);
  });
});

describe("computeNodeIdentity", () => {
  it("produz o mesmo nodeId para a mesma URL e a mesma arvore", () => {
    const tree: AccessibilityNode = { role: "main", children: [{ role: "heading", name: "Dashboard" }] };
    const a = computeNodeIdentity("https://example.com/dashboard", tree);
    const b = computeNodeIdentity("https://example.com/dashboard", tree);
    expect(a.nodeId).toBe(b.nodeId);
  });

  it("colapsa no mesmo no quando so o conteudo volatil muda", () => {
    const treeAt10h: AccessibilityNode = {
      role: "main",
      children: [
        { role: "heading", name: "Notificacoes" },
        { role: "status", name: "atualizado ha 2 minutos", attributes: { "aria-live": "polite" } },
      ],
    };
    const treeAt11h: AccessibilityNode = {
      role: "main",
      children: [
        { role: "heading", name: "Notificacoes" },
        { role: "status", name: "atualizado ha 47 minutos", attributes: { "aria-live": "polite" } },
      ],
    };
    const a = computeNodeIdentity("https://example.com/notificacoes", treeAt10h);
    const b = computeNodeIdentity("https://example.com/notificacoes", treeAt11h);
    expect(a.nodeId).toBe(b.nodeId);
  });

  it("gera nodeId diferente quando o conteudo estrutural realmente muda", () => {
    const emptyState: AccessibilityNode = { role: "main", children: [{ role: "heading", name: "Nenhum pedido" }] };
    const filledState: AccessibilityNode = {
      role: "main",
      children: [
        { role: "heading", name: "Pedidos" },
        { role: "listitem", name: "Pedido #1" },
      ],
    };
    const a = computeNodeIdentity("https://example.com/pedidos", emptyState);
    const b = computeNodeIdentity("https://example.com/pedidos", filledState);
    expect(a.nodeId).not.toBe(b.nodeId);
  });

  it("gera nodeId diferente para rotas diferentes mesmo com a mesma arvore", () => {
    const tree: AccessibilityNode = { role: "main", children: [{ role: "heading", name: "Detalhe" }] };
    const a = computeNodeIdentity("https://example.com/users/1", tree);
    const b = computeNodeIdentity("https://example.com/users/2", tree);
    // Ambas colapsam para a mesma route key (:id), entao o nodeId deve ser igual aqui -
    // este teste documenta esse comportamento esperado (mesmo template de pagina).
    expect(a.nodeId).toBe(b.nodeId);

    const c = computeNodeIdentity("https://example.com/orders/1", tree);
    expect(a.nodeId).not.toBe(c.nodeId);
  });
});
