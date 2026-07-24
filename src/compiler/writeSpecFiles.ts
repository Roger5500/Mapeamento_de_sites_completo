import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SelectedPath } from "./pathSelection.js";
import { buildSpecFile, type SpecNodeInfo } from "./templates/spec.template.js";

export interface WriteSpecFilesOptions {
  /** Diretorio raiz dos testes gerados, ex: tests/generated. */
  outputDir: string;
  nodesById: ReadonlyMap<string, SpecNodeInfo>;
  volatilePatterns: readonly string[];
  volatileSelectors: readonly string[];
  expectedConsoleErrors: readonly string[];
  baseUrl: string;
}

function groupByFeature(paths: readonly SelectedPath[]): Map<string, SelectedPath[]> {
  const grouped = new Map<string, SelectedPath[]>();
  for (const path of paths) {
    const list = grouped.get(path.feature) ?? [];
    list.push(path);
    grouped.set(path.feature, list);
  }
  return grouped;
}

/**
 * Escreve um `.spec.ts` por feature em `outputDir/<feature>/<feature>.spec.ts`.
 * Unico componente do compilador que efetivamente grava arquivos - o resto
 * (pathSelection, locatorStrategy, assertionBuilder, spec.template) e puro.
 */
export function writeSpecFiles(paths: readonly SelectedPath[], options: WriteSpecFilesOptions): string[] {
  const grouped = groupByFeature(paths);
  const writtenFiles: string[] = [];

  for (const [feature, featurePaths] of grouped) {
    const content = buildSpecFile({
      featureName: feature,
      paths: featurePaths,
      nodesById: options.nodesById,
      volatilePatterns: options.volatilePatterns,
      volatileSelectors: options.volatileSelectors,
      expectedConsoleErrors: options.expectedConsoleErrors,
      baseUrl: options.baseUrl,
    });

    const featureDir = path.join(options.outputDir, feature);
    mkdirSync(featureDir, { recursive: true });
    const filePath = path.join(featureDir, `${feature}.spec.ts`);
    writeFileSync(filePath, content, "utf8");
    writtenFiles.push(filePath);
  }

  return writtenFiles;
}
