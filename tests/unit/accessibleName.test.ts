import { describe, expect, it } from "vitest";
import { resolveAccessibleName } from "../../src/crawler/accessibleName.js";
import type { AccessibilityNode } from "../../src/graph/nodeIdentity.js";

describe("resolveAccessibleName", () => {
  it("usa o nome direto quando ja existe (caso comum, nao mexe em nada)", () => {
    const node: AccessibilityNode = { role: "link", name: "About Us", attributes: {}, children: [] };
    expect(resolveAccessibleName(node)).toBe("About Us");
  });

  it("deriva o nome de um heading aninhado quando o no nao tem nome direto (card de produto)", () => {
    // Reproduz o caso real confirmado contra sauce-demo.myshopify.com: o @playwright/mcp
    // reporta esse link sem nome, mesmo o Playwright real computando um a partir do conteudo.
    const productCard: AccessibilityNode = {
      role: "link",
      attributes: {},
      children: [
        { role: "img", name: "Grey jacket", attributes: {}, children: [] },
        { role: "heading", name: "Grey jacket", attributes: {}, children: [] },
        { role: "heading", name: "£55.00", attributes: {}, children: [] },
      ],
    };
    expect(resolveAccessibleName(productCard)).toBe("Grey jacket");
  });

  it("cai para img/text quando nao ha heading aninhado", () => {
    const iconLinkWithImgOnly: AccessibilityNode = {
      role: "link",
      attributes: {},
      children: [{ role: "img", name: "Facebook", attributes: {}, children: [] }],
    };
    expect(resolveAccessibleName(iconLinkWithImgOnly)).toBe("Facebook");
  });

  it("retorna undefined quando nao ha nome direto nem nada nomeado nos descendentes", () => {
    const trulyIconOnly: AccessibilityNode = {
      role: "link",
      attributes: {},
      children: [{ role: "generic", attributes: {}, children: [] }],
    };
    expect(resolveAccessibleName(trulyIconOnly)).toBeUndefined();
  });

  it("prioriza heading sobre img/text quando ambos existem", () => {
    const node: AccessibilityNode = {
      role: "link",
      attributes: {},
      children: [
        { role: "text", name: "texto generico", attributes: {}, children: [] },
        { role: "heading", name: "Titulo Real", attributes: {}, children: [] },
      ],
    };
    expect(resolveAccessibleName(node)).toBe("Titulo Real");
  });
});
