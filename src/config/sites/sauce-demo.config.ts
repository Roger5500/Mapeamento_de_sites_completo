import { parseSiteConfig, type SiteConfig } from "../schema.js";

/**
 * Loja de demonstracao publica (Shopify) usada para validar o crawler contra
 * um site real durante o desenvolvimento deste projeto. Nao exige login para
 * navegar o catalogo, entao `credentials` fica omitido (ver
 * config/schema.ts - credentials e opcional justamente para este caso).
 *
 * O fluxo de "Check Out" do Shopify normalmente redireciona para um dominio
 * de checkout separado (fora de sauce-demo.myshopify.com) - isso e
 * BLOQUEADO pelo domainIsolationGuard por design, o que serve como validacao
 * real de que a isolacao de dominio funciona contra um checkout de e-commerce
 * de verdade, nao so contra links externos obvios como redes sociais.
 */
const sauceDemoConfig: SiteConfig = parseSiteConfig({
  id: "sauce-demo",
  baseUrl: "https://sauce-demo.myshopify.com/",
  allowedOrigins: ["https://sauce-demo.myshopify.com"],
  blacklistTerms: [],
  volatileSelectors: [],
  volatilePatterns: [],
  maxRevisits: 3,
  maxPathsPerFeature: 15,
  fakerLocale: "en",
  productionHostPatterns: [],
  // Erro de console pre-existente do proprio site em /account/login (widget de
  // customer-account token do tema Shopify), nao relacionado a nenhuma acao do
  // crawler - triado e permitido explicitamente, em vez de silenciado no
  // codigo do gerador. Descoberto rodando os testes gerados de verdade.
  expectedConsoleErrors: ["Error retrieving a token"],
});

export default sauceDemoConfig;
