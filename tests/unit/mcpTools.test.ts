import { describe, expect, it } from "vitest";
import {
  extractResultSection,
  parseConsoleMessages,
  parseNetworkRequests,
  parseTabsList,
} from "../../src/mcp/tools.js";

// Todas as strings de fixture abaixo foram capturadas de chamadas reais ao
// @playwright/mcp@0.0.78 contra https://sauce-demo.myshopify.com/ - nao sao
// suposicoes sobre o formato, ver a nota em src/mcp/tools.ts.

describe("extractResultSection", () => {
  it("extrai apenas o conteudo entre '### Result' e a proxima secao", () => {
    const raw = '### Result\n"https://sauce-demo.myshopify.com/pages/about-us"\n### Ran Playwright code\n```js\nawait page.evaluate(...)\n```';
    expect(extractResultSection(raw)).toBe('"https://sauce-demo.myshopify.com/pages/about-us"');
  });

  it("funciona quando '### Result' e a ultima secao (sem cabecalho seguinte)", () => {
    const raw = "### Result\nTotal messages: 0 (Errors: 0, Warnings: 0)\n";
    expect(extractResultSection(raw)).toBe("Total messages: 0 (Errors: 0, Warnings: 0)");
  });
});

describe("parseConsoleMessages", () => {
  it("retorna lista vazia quando nao ha mensagens", () => {
    expect(parseConsoleMessages("### Result\nTotal messages: 0 (Errors: 0, Warnings: 0)\n")).toEqual([]);
  });

  it("parseia uma mensagem de erro real", () => {
    const raw = "### Result\nTotal messages: 1 (Errors: 1, Warnings: 0)\n\n[ERROR] mapeador-probe-error-123 @ :0";
    const messages = parseConsoleMessages(raw);
    expect(messages).toEqual([{ type: "error", text: "mapeador-probe-error-123 @ :0" }]);
  });
});

describe("parseNetworkRequests", () => {
  it("parseia requests com status numerico, FAILED e sem status/arrow", () => {
    const raw = [
      "### Result",
      "21. [GET] https://dk7vxmpleem9z.cloudfront.net/sgmnt.min.js => [FAILED] net::ERR_BLOCKED_BY_ORB",
      "32. [POST] https://sauce-demo.myshopify.com/api/collect => [200] ",
      "35. [POST] https://otlp-http-production.shopifysvc.com/v1/metrics",
      "",
      'Note: 40 static requests not shown, run with "static" option to see them.',
    ].join("\n");

    const requests = parseNetworkRequests(raw);

    expect(requests).toEqual([
      { sequence: 21, method: "GET", url: "https://dk7vxmpleem9z.cloudfront.net/sgmnt.min.js", status: null },
      { sequence: 32, method: "POST", url: "https://sauce-demo.myshopify.com/api/collect", status: 200 },
      { sequence: 35, method: "POST", url: "https://otlp-http-production.shopifysvc.com/v1/metrics", status: null },
    ]);
  });
});

describe("parseTabsList", () => {
  it("parseia uma unica aba ativa em formato de link markdown", () => {
    const raw = "### Result\n- 0: (current) [Sauce Demo](https://sauce-demo.myshopify.com/)";
    expect(parseTabsList(raw)).toEqual([
      { index: 0, active: true, title: "Sauce Demo", url: "https://sauce-demo.myshopify.com/" },
    ]);
  });

  it("parseia multiplas abas, apenas uma marcada como current", () => {
    const raw = [
      "### Result",
      "- 0: [Sauce Demo](https://sauce-demo.myshopify.com/)",
      "- 1: (current) [Example](https://example.com/)",
    ].join("\n");
    const tabs = parseTabsList(raw);
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toEqual({ index: 0, active: false, title: "Sauce Demo", url: "https://sauce-demo.myshopify.com/" });
    expect(tabs[1]).toEqual({ index: 1, active: true, title: "Example", url: "https://example.com/" });
  });
});
