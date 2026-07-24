import type { SiteConfig } from "../config/schema.js";
import type { ElementCandidate } from "../crawler/frontier.js";
import { createBlacklistTermGuard } from "./blacklist.js";
import { createDomainIsolationGuard } from "./domainIsolation.js";

export interface GuardContext {
  /** URL atual da pagina (usada para resolver hrefs relativos na checagem de dominio). */
  currentUrl: string;
}

export interface GuardResult {
  allowed: boolean;
  reason?: string;
}

export type Guard = (candidate: ElementCandidate, ctx: GuardContext) => GuardResult;

/**
 * Roda os pre-filter guards (sem interacao com o browser) em ordem, parando
 * no primeiro que negar. Candidatos negados nunca chegam a fronteira de
 * execucao - ver Frontier.markSkipped para o registro de auditoria.
 */
export function runPreFilterGuards(candidate: ElementCandidate, ctx: GuardContext, guards: readonly Guard[]): GuardResult {
  for (const guard of guards) {
    const result = guard(candidate, ctx);
    if (!result.allowed) return result;
  }
  return { allowed: true };
}

export function createDefaultGuards(site: SiteConfig): Guard[] {
  return [createBlacklistTermGuard(site.blacklistTerms), createDomainIsolationGuard(site.allowedOrigins)];
}
