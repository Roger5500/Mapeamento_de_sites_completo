import type { ElementCandidate } from "../crawler/frontier.js";
import type { Guard, GuardResult } from "./guards.js";

// Construido via code points (em vez de um literal de regex com a faixa Unicode
// escrita diretamente no source) para evitar qualquer risco de mangling de
// caracteres combinantes ao editar este arquivo.
const COMBINING_DIACRITICS_RE = new RegExp(`[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`, "gu");

function normalize(text: string): string {
  return text.normalize("NFD").replace(COMBINING_DIACRITICS_RE, "").toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Bloqueia candidatos cujo nome acessivel OU destino (href) contenha um termo
 * da blacklist (sem acento, case-insensitive, com word boundary). O nome
 * acessivel ja resolve aria-label (e a forma como o navegador computa o nome
 * exposto na arvore), entao nao ha necessidade de checar aria-label a parte -
 * mas o href e checado separadamente porque um botao/link pode ter um rotulo
 * generico ("Confirmar") enquanto a URL de destino revela a acao real
 * (ex: /account/delete).
 */
export function createBlacklistTermGuard(blacklistTerms: readonly string[]): Guard {
  const normalizedTerms = blacklistTerms.map(normalize).filter((term) => term.length > 0);

  return function blacklistTermGuard(candidate: ElementCandidate): GuardResult {
    const haystack = normalize(`${candidate.name} ${candidate.attributes.url ?? ""}`);
    for (const term of normalizedTerms) {
      const boundaryRegex = new RegExp(`\\b${escapeRegExp(term)}\\b`, "i");
      if (boundaryRegex.test(haystack)) {
        return { allowed: false, reason: `termo bloqueado pela blacklist: "${term}"` };
      }
    }
    return { allowed: true };
  };
}
