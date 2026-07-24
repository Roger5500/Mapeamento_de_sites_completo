import { writeFileSync } from "node:fs";
import type { OrchestratorStats } from "../crawler/orchestrator.js";
import type { EdgeRow, FrontierRow, NodeRow } from "../graph/repository.js";

export interface RunReportData {
  runId: string;
  siteId: string;
  stats: OrchestratorStats;
  nodes: readonly NodeRow[];
  edges: readonly EdgeRow[];
  skippedFrontier: readonly FrontierRow[];
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Relatorio HTML simples do run - nao substitui logs estruturados, mas da uma visao rapida do que o crawler viu/evitou. */
export function buildRunReportHtml(data: RunReportData): string {
  const nodeRows = data.nodes
    .map((node) => `<tr><td>${escapeHtml(node.route_key)}</td><td>${escapeHtml(node.status)}</td><td>${node.visit_count}</td></tr>`)
    .join("\n");

  const skippedRows = data.skippedFrontier
    .map(
      (frontier) =>
        `<tr><td>${escapeHtml(frontier.element_role)}</td><td>${escapeHtml(frontier.element_accessible_name)}</td><td>${escapeHtml(frontier.status)}</td><td>${escapeHtml(frontier.skip_reason ?? "")}</td></tr>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Relatorio de crawl - ${escapeHtml(data.runId)}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; }
    table { border-collapse: collapse; margin-bottom: 2rem; width: 100%; }
    th, td { border: 1px solid #ccc; padding: 0.4rem 0.6rem; text-align: left; font-size: 0.9rem; }
    th { background: #f0f0f0; }
  </style>
</head>
<body>
  <h1>Relatorio de crawl</h1>
  <p>Run: <code>${escapeHtml(data.runId)}</code> | Site: <code>${escapeHtml(data.siteId)}</code></p>
  <ul>
    <li>Passos executados: ${data.stats.steps}</li>
    <li>Nos descobertos: ${data.stats.nodesDiscovered}</li>
    <li>Arestas registradas: ${data.stats.edgesRecorded}</li>
    <li>Acoes com falha: ${data.stats.actionsFailed}</li>
    <li>Candidatos bloqueados pelos guards: ${data.stats.actionsSkippedByGuard}</li>
  </ul>

  <h2>Nos descobertos (${data.nodes.length})</h2>
  <table>
    <thead><tr><th>Route key</th><th>Status</th><th>Visitas</th></tr></thead>
    <tbody>${nodeRows}</tbody>
  </table>

  <h2>Candidatos bloqueados pelos guards de seguranca</h2>
  <table>
    <thead><tr><th>Role</th><th>Nome</th><th>Status</th><th>Motivo</th></tr></thead>
    <tbody>${skippedRows || '<tr><td colspan="4">Nenhum</td></tr>'}</tbody>
  </table>
</body>
</html>
`;
}

export function writeRunReport(filePath: string, data: RunReportData): void {
  writeFileSync(filePath, buildRunReportHtml(data), "utf8");
}
