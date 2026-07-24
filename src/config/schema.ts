import { z } from "zod";

/**
 * Termos padrao considerados destrutivos (PT/EN). Combinados com os termos
 * especificos do site em SiteConfig.blacklistTerms - nunca substituidos.
 */
export const DEFAULT_BLACKLIST_TERMS: readonly string[] = [
  "excluir",
  "deletar",
  "apagar",
  "remover",
  "cancelar assinatura",
  "encerrar conta",
  "logout",
  "sair",
  "delete",
  "remove",
  "unsubscribe",
  "deactivate account",
  "close account",
];

/** Padroes de texto volatil ignorados tanto no hashing de estado quanto nas assertions geradas. */
export const DEFAULT_VOLATILE_PATTERNS: readonly string[] = [
  "\\b\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}", // timestamp ISO
  "\\b(há|ha)\\s+\\d+\\s+(segundo|minuto|hora|dia)s?\\b", // "há 3 minutos"
  "\\b\\d+\\s+(second|minute|hour|day)s?\\s+ago\\b",
  "\\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\b", // UUID
];

/** Parametros de query descartados ao normalizar a route key (nao afetam identidade do no). */
export const DEFAULT_QUERY_PARAM_DENYLIST: readonly string[] = [
  "session",
  "sessionid",
  "ts",
  "_cb",
  "csrf",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
];

const credentialsSchema = z.object({
  usernameEnvVar: z.string().min(1),
  passwordEnvVar: z.string().min(1),
  loginUrl: z.string().url().optional(),
});

const uploadFixtureSchema = z.object({
  /** Regex (fonte) aplicada ao nome/label acessivel do campo de arquivo. */
  fieldNamePattern: z.string().min(1),
  filePath: z.string().min(1),
});

export const siteConfigSchema = z.object({
  id: z.string().min(1),
  baseUrl: z.string().url(),
  allowedOrigins: z.array(z.string().min(1)).min(1),
  /** Omitir quando o site nao exige autenticacao para ser varrido (ex: catalogo publico). */
  credentials: credentialsSchema.optional(),
  blacklistTerms: z.array(z.string().min(1)).default([]),
  volatileSelectors: z.array(z.string().min(1)).default([]),
  volatilePatterns: z.array(z.string().min(1)).default([]),
  queryParamDenylist: z.array(z.string().min(1)).default([]),
  maxRevisits: z.number().int().positive().default(3),
  maxPathsPerFeature: z.number().int().positive().default(20),
  fakerLocale: z.string().min(1).default("pt_BR"),
  expectedConsoleErrors: z.array(z.string().min(1)).default([]),
  uploadFixtures: z.array(uploadFixtureSchema).default([]),
  actionDelayMs: z.number().int().nonnegative().default(150),
  productionHostPatterns: z.array(z.string().min(1)).default([]),
});

export type SiteConfigInput = z.input<typeof siteConfigSchema>;
export type SiteConfig = z.output<typeof siteConfigSchema>;

/**
 * Valida e normaliza a config de um site, mesclando as listas padrao
 * (blacklist/volatile patterns) com as especificas do site em vez de
 * substitui-las - erros de omissao no config nao devem remover as defaults.
 */
export function parseSiteConfig(input: SiteConfigInput): SiteConfig {
  const parsed = siteConfigSchema.parse(input);
  return {
    ...parsed,
    blacklistTerms: dedupe([...DEFAULT_BLACKLIST_TERMS, ...parsed.blacklistTerms]),
    volatilePatterns: dedupe([...DEFAULT_VOLATILE_PATTERNS, ...parsed.volatilePatterns]),
    queryParamDenylist: dedupe([...DEFAULT_QUERY_PARAM_DENYLIST, ...parsed.queryParamDenylist]),
  };
}

function dedupe(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}
