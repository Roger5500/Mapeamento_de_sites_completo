import type { SiteConfig } from "../config/schema.js";
import type { McpTools } from "../mcp/tools.js";
import { extractInteractiveElements } from "./frontier.js";

export interface AuthResult {
  performedLogin: boolean;
}

/**
 * Executa o login se o site tiver `credentials` configuradas; caso
 * contrario pula esta fase (nem todo alvo exige autenticacao para ser
 * varrido, ex: catalogo publico - e o caso do site de teste usado durante o
 * desenvolvimento deste projeto). Localiza os campos de usuario/senha e o
 * botao de submit por heuristica de nome acessivel.
 *
 * Nao verificado empiricamente contra um fluxo de login real ainda (o site
 * de teste disponivel nao exige autenticacao) - calibrar contra um site com
 * login real antes de depender disso em producao.
 */
export async function performLogin(tools: McpTools, site: SiteConfig): Promise<AuthResult> {
  if (!site.credentials) return { performedLogin: false };

  const username = process.env[site.credentials.usernameEnvVar];
  const password = process.env[site.credentials.passwordEnvVar];
  if (!username || !password) {
    throw new Error(
      `credenciais ausentes: defina as variaveis de ambiente ${site.credentials.usernameEnvVar} e ${site.credentials.passwordEnvVar}`,
    );
  }

  await tools.navigate(site.credentials.loginUrl ?? site.baseUrl);

  const snap = await tools.snapshot();
  const candidates = extractInteractiveElements(snap.tree);
  const usernameField = candidates.find((c) => c.role === "textbox" && /e-?mail|usu[aá]rio|username|login/i.test(c.name));
  const passwordField = candidates.find((c) => c.role === "textbox" && /senha|password/i.test(c.name));
  const submitButton = candidates.find((c) => c.role === "button" && /entrar|login|log ?in|sign ?in|acessar/i.test(c.name));

  if (!usernameField?.attributes.ref || !passwordField?.attributes.ref) {
    throw new Error("nao foi possivel localizar os campos de usuario/senha na pagina de login");
  }

  await tools.type(usernameField.attributes.ref, `textbox "${usernameField.name}"`, username);

  // Re-snapshot: o ref do campo de senha pode ter mudado apos o type() anterior mutar o DOM.
  const afterUsername = extractInteractiveElements((await tools.snapshot()).tree);
  const freshPassword = afterUsername.find((c) => c.role === "textbox" && c.name === passwordField.name);
  if (!freshPassword?.attributes.ref) {
    throw new Error("campo de senha nao encontrado apos preencher o usuario");
  }
  await tools.type(freshPassword.attributes.ref, `textbox "${freshPassword.name}"`, password, submitButton === undefined);

  if (submitButton) {
    const afterPassword = extractInteractiveElements((await tools.snapshot()).tree);
    const freshSubmit = afterPassword.find((c) => c.role === "button" && c.name === submitButton.name);
    if (freshSubmit?.attributes.ref) {
      await tools.click(freshSubmit.attributes.ref, `button "${freshSubmit.name}"`);
    }
  }

  return { performedLogin: true };
}
