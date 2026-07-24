import type { AccessibilityNode } from "../../graph/nodeIdentity.js";
import { pickStableAnchor, routeKeyToUrlRegexSource } from "../assertionBuilder.js";
import { buildRoleLocatorCode } from "../locatorStrategy.js";
import type { CompilerEdge, SelectedPath } from "../pathSelection.js";

export interface SpecNodeInfo {
  id: string;
  routeKey: string;
  lastUrl: string;
  title: string | null;
  /** JSON de um AccessibilityNode, como persistido em nodes.snapshot_json. */
  snapshotJson: string;
}

export interface BuildSpecFileOptions {
  featureName: string;
  paths: readonly SelectedPath[];
  nodesById: ReadonlyMap<string, SpecNodeInfo>;
  volatilePatterns: readonly string[];
  volatileSelectors: readonly string[];
  expectedConsoleErrors: readonly string[];
  baseUrl: string;
}

function jsString(value: string): string {
  return JSON.stringify(value);
}

function describePath(path: SelectedPath): string {
  return path.edges.map((edge) => `${edge.actionType} ${edge.elementRole} "${edge.elementAccessibleName}"`).join(" > ") || "(estado inicial)";
}

function parseInputValue(inputValueJson: string | null): string {
  if (!inputValueJson) return "";
  try {
    const value: unknown = JSON.parse(inputValueJson);
    return typeof value === "string" ? value : String(value);
  } catch {
    return "";
  }
}

function buildStepAssertions(edge: CompilerEdge, nodesById: ReadonlyMap<string, SpecNodeInfo>, options: BuildSpecFileOptions): string[] {
  const toNode = nodesById.get(edge.toNodeId);
  if (!toNode) return [];

  const lines: string[] = [];
  const urlRegexSource = routeKeyToUrlRegexSource(toNode.routeKey);
  lines.push(`    await expect(page).toHaveURL(new RegExp(${jsString(urlRegexSource)}));`);

  try {
    const tree = JSON.parse(toNode.snapshotJson) as AccessibilityNode;
    const anchor = pickStableAnchor(tree, {
      volatilePatterns: options.volatilePatterns,
      volatileSelectors: options.volatileSelectors,
    });
    if (anchor) {
      lines.push(`    await expect(${buildRoleLocatorCode(anchor.role, anchor.name)}).toBeVisible();`);
    }
  } catch {
    // snapshot_json ausente/invalido para este no - mantem so a assertion de URL.
  }

  return lines;
}

function buildStepCode(edge: CompilerEdge, nodesById: ReadonlyMap<string, SpecNodeInfo>, options: BuildSpecFileOptions): string {
  const locator = buildRoleLocatorCode(edge.elementRole, edge.elementAccessibleName);
  const actionLine =
    edge.actionType === "type"
      ? `    await ${locator}.fill(${jsString(parseInputValue(edge.inputValueJson))});`
      : `    await ${locator}.click();`;

  const assertions = buildStepAssertions(edge, nodesById, options);
  return [actionLine, ...assertions].join("\n");
}

function buildTestBlock(path: SelectedPath, index: number, options: BuildSpecFileOptions): string {
  const testName = `caminho ${index + 1}: ${describePath(path)}`;
  const steps = path.edges.map((edge) => buildStepCode(edge, options.nodesById, options)).join("\n\n");

  return `  test(${jsString(testName)}, async ({ page }) => {
    await page.goto(${jsString(options.baseUrl)});

${steps}
  });`;
}

/**
 * Gera o conteudo de um arquivo `.spec.ts` para uma feature (grupo de
 * caminhos com o mesmo primeiro segmento de rota). Locators sao
 * `getByRole(role, {name})` derivados dos MESMOS dados validados durante o
 * crawl; assertions de URL/visibilidade reaproveitam a logica de "o que e
 * estavel" de graph/nodeIdentity.ts (ver assertionBuilder.ts) para nao
 * divergir da definicao usada no hashing de identidade dos nos. Erros de
 * console sao verificados a cada teste contra a allowlist configurada por
 * site (`expectedConsoleErrors`).
 */
export function buildSpecFile(options: BuildSpecFileOptions): string {
  const testBlocks = options.paths.map((path, index) => buildTestBlock(path, index, options)).join("\n\n");
  const allowlistSource = options.expectedConsoleErrors.map((pattern) => `/${pattern}/`).join(", ");

  return `import { test, expect } from "@playwright/test";
${allowlistSource ? `\nconst ALLOWED_CONSOLE_ERROR_PATTERNS = [${allowlistSource}];\n` : ""}
test.describe(${jsString(options.featureName)}, () => {
  const consoleErrors: string[] = [];

  test.beforeEach(({ page }) => {
    consoleErrors.length = 0;
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
  });

  test.afterEach(() => {
    ${
      allowlistSource
        ? "const unexpected = consoleErrors.filter((text) => !ALLOWED_CONSOLE_ERROR_PATTERNS.some((pattern) => pattern.test(text)));"
        : "const unexpected = consoleErrors;"
    }
    expect(unexpected, \`erros de console inesperados: \${unexpected.join(", ")}\`).toEqual([]);
  });

${testBlocks}
});
`;
}
