import { parse as parseYamlDocument } from "yaml";
import type { AccessibilityNode } from "../graph/nodeIdentity.js";

/**
 * Parser do texto retornado por `browser_snapshot` do @playwright/mcp.
 *
 * Formato real observado (verificado empiricamente contra o servidor, nao
 * documentado formalmente pelo projeto upstream):
 *
 *   ### Page
 *   - Page URL: https://example.com/
 *   - Page Title: Exemplo
 *   ### Snapshot
 *   ```yaml
 *   - generic [active] [ref=e1]:
 *     - link "Entrar" [ref=e10] [cursor=pointer]:
 *       - /url: /login
 *     - text: "Ola mundo"
 *   ```
 *
 * O bloco `yaml` e YAML valido (sequencias/mapeamentos aninhados por
 * indentacao) - cada item e ou uma string escalar "role \"nome\" [attrs]"
 * (no folha, sem filhos) ou um mapeamento de 1 chave "role \"nome\" [attrs]"
 * -> lista de filhos. Duas chaves pseudo aparecem como filhos comuns nesse
 * mapeamento mas na verdade carregam metadados do PAI, nao sao nos reais:
 *   - `/url: <href>`  -> vira attributes.url do no pai (links/imagens)
 *   - `text: <valor>` -> vira um no filho real de role "text" (preserva ordem)
 *
 * Por isso usamos um parser YAML de verdade (lib `yaml`) para lidar com
 * aspas/escapes corretamente, e so interpretamos manualmente a gramatica
 * "role \"nome\" [attrs]" dentro de cada chave/escalar.
 */

export interface ParsedSnapshot {
  url: string;
  title: string;
  tree: AccessibilityNode;
}

type YamlScalar = string;
type YamlValue = YamlScalar | YamlEntry[];
type YamlEntry = YamlScalar | Record<string, YamlValue>;

const SNAPSHOT_FENCE_RE = /```yaml\n([\s\S]*?)```/;
const URL_LINE_RE = /Page URL:\s*(\S+)/;
const TITLE_LINE_RE = /Page Title:\s*(.*)/;

// role ["nome" com aspas escapaveis] ([attr] | [flag])*
const LABEL_RE = /^([A-Za-z_][\w-]*)(?:\s+"((?:[^"\\]|\\.)*)")?((?:\s*\[[^\]]*])*)\s*$/;
const BRACKET_RE = /\[([^\]]*)]/g;

function unescapeQuoted(value: string): string {
  return value.replace(/\\(.)/g, "$1");
}

function parseLabel(label: string): { role: string; name?: string; attributes: Record<string, string> } {
  const match = LABEL_RE.exec(label.trim());
  if (!match) {
    // Fallback defensivo: formato inesperado nao deve derrubar o crawl inteiro,
    // apenas perde a granularidade de nome/atributos deste no especifico.
    return { role: label.trim(), attributes: {} };
  }
  const [, role, rawName, attrsPart] = match;
  const attributes: Record<string, string> = {};
  for (const bracketMatch of attrsPart!.matchAll(BRACKET_RE)) {
    const raw = bracketMatch[1]!;
    const eqIndex = raw.indexOf("=");
    if (eqIndex === -1) {
      attributes[raw] = "true";
    } else {
      attributes[raw.slice(0, eqIndex)] = raw.slice(eqIndex + 1);
    }
  }
  return { role: role!, name: rawName !== undefined ? unescapeQuoted(rawName) : undefined, attributes };
}

function isPseudoUrlEntry(key: string, value: YamlValue): value is YamlScalar {
  return key.startsWith("/") && typeof value === "string";
}

function isPseudoTextEntry(key: string, value: YamlValue): value is YamlScalar {
  return key === "text" && typeof value === "string";
}

function buildChildren(items: YamlEntry[], ownerAttributes: Record<string, string>): AccessibilityNode[] {
  const children: AccessibilityNode[] = [];
  for (const item of items) {
    if (typeof item === "object") {
      const keys = Object.keys(item);
      if (keys.length === 1) {
        const key = keys[0]!;
        const value = item[key]!;
        if (isPseudoUrlEntry(key, value)) {
          ownerAttributes[key.slice(1)] = value;
          continue;
        }
        if (isPseudoTextEntry(key, value)) {
          children.push({ role: "text", name: value, attributes: {}, children: [] });
          continue;
        }
      }
    }
    children.push(buildNode(item));
  }
  return children;
}

function buildNode(entry: YamlEntry): AccessibilityNode {
  if (typeof entry === "string") {
    const { role, name, attributes } = parseLabel(entry);
    return { role, name, attributes, children: [] };
  }

  const keys = Object.keys(entry);
  if (keys.length !== 1) {
    throw new Error(`snapshot: esperado exatamente 1 chave por item da arvore, recebido ${keys.length} (${keys.join(", ")})`);
  }
  const label = keys[0]!;
  const value = entry[label]!;
  const { role, name, attributes } = parseLabel(label);
  const node: AccessibilityNode = { role, name, attributes, children: [] };

  if (typeof value === "string") {
    // Mapeamento de 1 chave cujo valor e escalar direto (nao uma lista) -
    // formato incomum; preserva o conteudo como um filho de texto.
    node.children = [{ role: "text", name: value, attributes: {}, children: [] }];
    return node;
  }

  node.children = buildChildren(value, node.attributes!);
  return node;
}

/**
 * Extrai `url`, `title` e a arvore de acessibilidade estruturada a partir do
 * texto retornado pela tool `browser_snapshot`. Lanca erro descritivo se a
 * resposta nao contiver o bloco yaml inline (ex: quando `--output-mode` do
 * @playwright/mcp estiver configurado para salvar a snapshot em arquivo em
 * vez de inline - nao suportado por este parser ainda).
 */
export function parseSnapshotResponse(rawText: string): ParsedSnapshot {
  const urlMatch = URL_LINE_RE.exec(rawText);
  const titleMatch = TITLE_LINE_RE.exec(rawText);
  const fenceMatch = SNAPSHOT_FENCE_RE.exec(rawText);

  if (!urlMatch) {
    throw new Error("snapshot: 'Page URL' nao encontrada na resposta de browser_snapshot");
  }
  if (!fenceMatch) {
    throw new Error(
      "snapshot: bloco ```yaml``` inline nao encontrado na resposta de browser_snapshot " +
        "(verifique se --output-mode do @playwright/mcp nao esta salvando a snapshot em arquivo)",
    );
  }

  const topLevel = (parseYamlDocument(fenceMatch[1]!) ?? []) as YamlEntry[];
  const rootChildren = buildChildren(topLevel, {});

  return {
    url: urlMatch[1]!,
    title: titleMatch?.[1]?.trim() ?? "",
    tree: { role: "root", attributes: {}, children: rootChildren },
  };
}
