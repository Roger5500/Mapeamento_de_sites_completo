import type { ElementCandidate } from "../crawler/frontier.js";
import type { Guard, GuardContext, GuardResult } from "./guards.js";

/**
 * Bloqueia candidatos cujo destino (href, resolvido contra a URL atual)
 * aponta para uma origem fora da allowlist do site. Candidatos sem `url`
 * conhecido (botoes sem link, ou elementos cujo destino so e determinado
 * em runtime via JS) passam - a isolacao de dominio real acontece de novo
 * no crawler apos a acao, comparando a URL resultante.
 */
export function createDomainIsolationGuard(allowedOrigins: readonly string[]): Guard {
  const allowed = new Set(
    allowedOrigins
      .map((origin) => {
        try {
          return new URL(origin).origin;
        } catch {
          return null;
        }
      })
      .filter((origin): origin is string => origin !== null),
  );

  return function domainIsolationGuard(candidate: ElementCandidate, ctx: GuardContext): GuardResult {
    const href = candidate.attributes.url;
    if (!href || href === "#") return { allowed: true };

    let resolved: URL;
    try {
      resolved = new URL(href, ctx.currentUrl);
    } catch {
      return { allowed: true };
    }

    if (allowed.has(resolved.origin)) return { allowed: true };
    return { allowed: false, reason: `dominio fora da allowlist: ${resolved.origin}` };
  };
}
