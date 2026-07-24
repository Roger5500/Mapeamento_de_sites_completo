import { describe, expect, it } from "vitest";
import { generateFieldValue } from "../../src/crawler/fakerFill.js";
import type { ElementCandidate } from "../../src/crawler/frontier.js";
import { computePriority } from "../../src/crawler/priority.js";
import { captureNetworkBaseline, validateAfterAction } from "../../src/crawler/validator.js";
import type { NetworkRequestInfo } from "../../src/mcp/types.js";

describe("computePriority", () => {
  it("da prioridade maior para links/botoes do que para campos de texto", () => {
    const linkScore = computePriority("link", { depthFromRoot: 0, previousFailedAttempts: 0 });
    const textboxScore = computePriority("textbox", { depthFromRoot: 0, previousFailedAttempts: 0 });
    expect(linkScore).toBeGreaterThan(textboxScore);
  });

  it("penaliza profundidade maior a partir da raiz", () => {
    const shallow = computePriority("link", { depthFromRoot: 0, previousFailedAttempts: 0 });
    const deep = computePriority("link", { depthFromRoot: 5, previousFailedAttempts: 0 });
    expect(deep).toBeLessThan(shallow);
  });

  it("penaliza tentativas falhas anteriores mais fortemente que profundidade", () => {
    const withFailure = computePriority("link", { depthFromRoot: 0, previousFailedAttempts: 1 });
    const deep = computePriority("link", { depthFromRoot: 1, previousFailedAttempts: 0 });
    expect(withFailure).toBeLessThan(deep);
  });

  it("da um bonus a campos de texto quando fazem parte de um formulario multi-campo", () => {
    const withBonus = computePriority("textbox", { depthFromRoot: 0, previousFailedAttempts: 0, isMultiFieldForm: true });
    const withoutBonus = computePriority("textbox", { depthFromRoot: 0, previousFailedAttempts: 0, isMultiFieldForm: false });
    expect(withBonus).toBeGreaterThan(withoutBonus);
  });

  it("usa um peso default baixo para roles desconhecidos", () => {
    const score = computePriority("marquee", { depthFromRoot: 0, previousFailedAttempts: 0 });
    expect(score).toBe(0.5);
  });
});

describe("generateFieldValue", () => {
  function field(name: string): ElementCandidate {
    return { role: "textbox", name, attributes: {} };
  }

  it("gera um email valido para campos rotulados como email", () => {
    const value = generateFieldValue(field("E-mail"));
    expect(value).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  });

  it("gera uma data ISO para campos rotulados como data", () => {
    const value = generateFieldValue(field("Data de nascimento"));
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("usa geradores especificos do site ANTES dos defaults", () => {
    const value = generateFieldValue(field("CPF"), {
      extraGenerators: [{ pattern: /cpf/i, generate: () => "000.000.000-00" }],
    });
    expect(value).toBe("000.000.000-00");
  });

  it("cai para texto generico quando nenhum padrao conhecido casa com o label", () => {
    const value = generateFieldValue(field("Campo totalmente desconhecido xyz"));
    expect(typeof value).toBe("string");
    expect(value.length).toBeGreaterThan(0);
  });

  it("e deterministico o suficiente para produzir valores nao vazios em varias chamadas", () => {
    for (let i = 0; i < 5; i++) {
      expect(generateFieldValue(field("Nome completo")).length).toBeGreaterThan(0);
    }
  });
});

function fakeTools(sequence: { before: NetworkRequestInfo[]; after: NetworkRequestInfo[] }, consoleErrors: Array<{ type: string; text: string }> = []) {
  let call = 0;
  return {
    networkRequests: async () => {
      call += 1;
      return call === 1 ? sequence.before : sequence.after;
    },
    consoleMessages: async () => consoleErrors,
  } as unknown as Parameters<typeof captureNetworkBaseline>[0];
}

describe("validator (captureNetworkBaseline + validateAfterAction)", () => {
  it("identifica apenas os requests novos apos a acao, ignorando os ja vistos na baseline", async () => {
    const before: NetworkRequestInfo[] = [{ sequence: 1, method: "GET", url: "https://x.com/a", status: 200 }];
    const after: NetworkRequestInfo[] = [
      { sequence: 1, method: "GET", url: "https://x.com/a", status: 200 },
      { sequence: 2, method: "POST", url: "https://x.com/b", status: 201 },
    ];
    const tools = fakeTools({ before, after });

    const baseline = await captureNetworkBaseline(tools);
    const result = await validateAfterAction(tools, baseline);

    expect(result.newRequests).toHaveLength(1);
    expect(result.newRequests[0]?.url).toBe("https://x.com/b");
    expect(result.networkOk).toBe(true);
  });

  it("marca networkOk=false quando algum request novo falhou (status >= 400 ou FAILED/null)", async () => {
    const before: NetworkRequestInfo[] = [];
    const after: NetworkRequestInfo[] = [{ sequence: 1, method: "GET", url: "https://x.com/broken", status: 500 }];
    const tools = fakeTools({ before, after });

    const baseline = await captureNetworkBaseline(tools);
    const result = await validateAfterAction(tools, baseline);

    expect(result.networkOk).toBe(false);
  });

  it("trata requests com status null (FAILED por bloqueio de terceiros) como nao contando pra reprovar a acao isoladamente", async () => {
    // status null so significa "sem status HTTP" (ex: bloqueado por ORB antes de completar) -
    // nao e necessariamente um erro DA APLICACAO sendo testada, entao nao reprova sozinho.
    const before: NetworkRequestInfo[] = [];
    const after: NetworkRequestInfo[] = [{ sequence: 1, method: "GET", url: "https://ads.example.com/x", status: null }];
    const tools = fakeTools({ before, after });

    const baseline = await captureNetworkBaseline(tools);
    const result = await validateAfterAction(tools, baseline);

    expect(result.networkOk).toBe(true);
  });

  it("repassa os erros de console retornados pela tool", async () => {
    const tools = fakeTools({ before: [], after: [] }, [{ type: "error", text: "TypeError: x is not a function" }]);
    const baseline = await captureNetworkBaseline(tools);
    const result = await validateAfterAction(tools, baseline);
    expect(result.consoleErrors).toEqual([{ type: "error", text: "TypeError: x is not a function" }]);
  });
});
