/**
 * Deriva o locator Playwright diretamente de (role, nome acessivel) - os
 * MESMOS dados validados durante o crawl (uma acao so vira aresta se ja foi
 * executada com sucesso), garantindo que o locator gerado ja funcionou pelo
 * menos uma vez contra o site real.
 *
 * `.first()` e deliberado: validado empiricamente contra um site real
 * (sauce-demo.myshopify.com) que links de navegacao (ex: "Search", "About Us")
 * frequentemente se repetem identicos no header E no footer - o MCP resolveu
 * a ambiguidade durante o crawl via `ref` (escopado aquela snapshot especifica),
 * mas um locator `getByRole(role, {name})` gerado sem `.first()` viola o modo
 * estrito do Playwright (erro "resolved to N elements") sempre que isso
 * acontece. Como header/footer costumam apontar para o mesmo destino,
 * `.first()` e um default razoavel para testes de regressao - o tradeoff e
 * nao conseguir distinguir "cliquei no link do header" de "cliquei no do
 * footer" como testes separados, o que nao importa pra maioria dos casos.
 */
export function buildRoleLocatorCode(role: string, name: string): string {
  return `page.getByRole(${jsString(role)}, { name: ${jsString(name)}, exact: true }).first()`;
}

function jsString(value: string): string {
  return JSON.stringify(value);
}
