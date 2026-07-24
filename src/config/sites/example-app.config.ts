import { parseSiteConfig, type SiteConfig } from "../schema.js";

/**
 * Config de exemplo - copie este arquivo por site alvo (ex: `my-app.config.ts`)
 * e registre-o em `src/cli/index.ts`. Nunca colocar credenciais literais aqui,
 * apenas os NOMES das variaveis de ambiente que as contem (ver .env.example).
 */
const exampleAppConfig: SiteConfig = parseSiteConfig({
  id: "example-app",
  baseUrl: "https://example.com",
  allowedOrigins: ["https://example.com"],
  credentials: {
    usernameEnvVar: "SITE_EXAMPLE_APP_USERNAME",
    passwordEnvVar: "SITE_EXAMPLE_APP_PASSWORD",
    loginUrl: "https://example.com/login",
  },
  // Termos adicionais especificos deste site somam-se aos DEFAULT_BLACKLIST_TERMS.
  blacklistTerms: [],
  volatileSelectors: [],
  volatilePatterns: [],
  maxRevisits: 3,
  maxPathsPerFeature: 20,
  fakerLocale: "pt_BR",
  productionHostPatterns: ["^www\\.example\\.com$"],
});

export default exampleAppConfig;
