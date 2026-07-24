import { describe, expect, it } from "vitest";
import { DEFAULT_BLACKLIST_TERMS, parseSiteConfig } from "../../src/config/schema.js";
import type { ElementCandidate } from "../../src/crawler/frontier.js";
import { createBlacklistTermGuard } from "../../src/safety/blacklist.js";
import { createDomainIsolationGuard } from "../../src/safety/domainIsolation.js";
import { createDefaultGuards, runPreFilterGuards, type GuardContext } from "../../src/safety/guards.js";
import { findDismissButton, findFirstOverlay } from "../../src/safety/overlayAutoHeal.js";
import { isNodeSaturated, shouldMarkSaturated } from "../../src/safety/revisitBacktrack.js";
import type { AccessibilityNode } from "../../src/graph/nodeIdentity.js";

function candidate(name: string, role = "button", attributes: Record<string, string> = {}): ElementCandidate {
  return { role, name, attributes };
}

describe("createBlacklistTermGuard", () => {
  const guard = createBlacklistTermGuard(DEFAULT_BLACKLIST_TERMS);
  const ctx: GuardContext = { currentUrl: "https://example.com/" };

  it("bloqueia um botao cujo nome bate exatamente com um termo da blacklist", () => {
    expect(guard(candidate("Excluir"), ctx).allowed).toBe(false);
  });

  it("bloqueia independente de acento/maiusculas (normalizacao)", () => {
    expect(guard(candidate("EXCLUÍR conta"), ctx).allowed).toBe(false);
    expect(guard(candidate("Sair"), ctx).allowed).toBe(false);
  });

  it("nao bloqueia por substring parcial sem word boundary", () => {
    // "sairmos" contem "sair" mas nao e a palavra "sair" isolada
    expect(guard(candidate("Vamos sairmos daqui"), ctx).allowed).toBe(true);
  });

  it("bloqueia quando o termo aparece apenas no href, com nome generico (botao so-icone)", () => {
    const iconOnlyDelete = candidate("Confirmar", "link", { url: "/account/delete" });
    expect(guard(iconOnlyDelete, ctx).allowed).toBe(false);
  });

  it("permite acoes normais nao relacionadas a nenhum termo da blacklist", () => {
    expect(guard(candidate("Adicionar ao carrinho"), ctx).allowed).toBe(true);
  });
});

describe("createDomainIsolationGuard", () => {
  const guard = createDomainIsolationGuard(["https://example.com"]);
  const ctx: GuardContext = { currentUrl: "https://example.com/produtos" };

  it("permite links relativos (mesma origem implicita)", () => {
    expect(guard(candidate("Detalhes", "link", { url: "/produtos/1" }), ctx).allowed).toBe(true);
  });

  it("permite links absolutos para a origem permitida", () => {
    expect(guard(candidate("Home", "link", { url: "https://example.com/" }), ctx).allowed).toBe(true);
  });

  it("bloqueia links para dominios externos", () => {
    const result = guard(candidate("Facebook", "link", { url: "https://facebook.com/example" }), ctx);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/facebook\.com/);
  });

  it("permite candidatos sem href conhecido (botoes, ou href '#')", () => {
    expect(guard(candidate("Abrir menu", "button", {}), ctx).allowed).toBe(true);
    expect(guard(candidate("Carrinho", "link", { url: "#" }), ctx).allowed).toBe(true);
  });
});

describe("runPreFilterGuards / createDefaultGuards", () => {
  const site = parseSiteConfig({
    id: "test-site",
    baseUrl: "https://example.com",
    allowedOrigins: ["https://example.com"],
    credentials: { usernameEnvVar: "X_USER", passwordEnvVar: "X_PASS" },
  });

  it("para no primeiro guard que negar e nao avalia os seguintes", () => {
    const guards = createDefaultGuards(site);
    const ctx: GuardContext = { currentUrl: "https://example.com/" };

    const blacklisted = runPreFilterGuards(candidate("Excluir conta", "button", { url: "https://facebook.com/x" }), ctx, guards);
    expect(blacklisted.allowed).toBe(false);
    expect(blacklisted.reason).toMatch(/blacklist/);
  });

  it("permite quando nenhum guard nega", () => {
    const guards = createDefaultGuards(site);
    const ctx: GuardContext = { currentUrl: "https://example.com/" };
    expect(runPreFilterGuards(candidate("Comprar agora", "button"), ctx, guards).allowed).toBe(true);
  });
});

describe("revisitBacktrack", () => {
  it("nao satura antes de exceder maxRevisits", () => {
    expect(shouldMarkSaturated({ visitCount: 3, status: "active" }, 3)).toBe(false);
    expect(isNodeSaturated({ visitCount: 3, status: "active" }, 3)).toBe(false);
  });

  it("satura ao exceder maxRevisits", () => {
    expect(shouldMarkSaturated({ visitCount: 4, status: "active" }, 3)).toBe(true);
    expect(isNodeSaturated({ visitCount: 4, status: "active" }, 3)).toBe(true);
  });

  it("um no ja marcado saturated e sempre tratado como esgotado", () => {
    expect(isNodeSaturated({ visitCount: 1, status: "saturated" }, 3)).toBe(true);
  });
});

describe("overlayAutoHeal", () => {
  const cookieBanner: AccessibilityNode = {
    role: "dialog",
    name: "Cookies",
    attributes: {},
    children: [
      { role: "paragraph", name: "Usamos cookies...", attributes: {}, children: [] },
      { role: "button", name: "Aceitar todos", attributes: { ref: "e99" }, children: [] },
    ],
  };

  const pageTree: AccessibilityNode = {
    role: "root",
    attributes: {},
    children: [{ role: "main", attributes: {}, children: [{ role: "heading", name: "Home", attributes: {}, children: [] }] }, cookieBanner],
  };

  it("encontra o overlay (dialog/alertdialog) em qualquer profundidade da arvore", () => {
    expect(findFirstOverlay(pageTree)?.name).toBe("Cookies");
  });

  it("retorna undefined quando nao ha overlay", () => {
    const withoutOverlay: AccessibilityNode = { role: "root", attributes: {}, children: [{ role: "main", attributes: {}, children: [] }] };
    expect(findFirstOverlay(withoutOverlay)).toBeUndefined();
  });

  it("encontra o botao de dispensa dentro do overlay pelo nome (aceitar/fechar/ok/...)", () => {
    const button = findDismissButton(cookieBanner);
    expect(button?.name).toBe("Aceitar todos");
    expect(button?.attributes?.ref).toBe("e99");
  });

  it("nao encontra botao de dispensa quando nenhum nome bate com os termos conhecidos", () => {
    const unknownOverlay: AccessibilityNode = {
      role: "dialog",
      name: "Promo",
      attributes: {},
      children: [{ role: "button", name: "Ver oferta", attributes: {}, children: [] }],
    };
    expect(findDismissButton(unknownOverlay)).toBeUndefined();
  });
});
