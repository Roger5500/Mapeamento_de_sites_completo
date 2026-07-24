import type { AccessibilityNode } from "../graph/nodeIdentity.js";
import type { McpTools } from "../mcp/tools.js";

const OVERLAY_ROLES = new Set(["dialog", "alertdialog"]);
const DISMISS_NAME_RE = /aceitar|accept|fechar|close|\bok\b|entendi|dismiss|got it|agree|concordo/i;

export function findFirstOverlay(tree: AccessibilityNode): AccessibilityNode | undefined {
  if (OVERLAY_ROLES.has(tree.role)) return tree;
  for (const child of tree.children ?? []) {
    const found = findFirstOverlay(child);
    if (found) return found;
  }
  return undefined;
}

export function findDismissButton(overlay: AccessibilityNode): AccessibilityNode | undefined {
  function walk(node: AccessibilityNode): AccessibilityNode | undefined {
    if ((node.role === "button" || node.role === "link") && node.name && DISMISS_NAME_RE.test(node.name)) {
      return node;
    }
    for (const child of node.children ?? []) {
      const found = walk(child);
      if (found) return found;
    }
    return undefined;
  }
  return walk(overlay);
}

export interface AutoHealResult {
  dismissed: boolean;
  overlayRole?: string;
  overlayName?: string;
}

/**
 * Detecta um overlay/modal bloqueando a pagina (role dialog/alertdialog) e
 * tenta fecha-lo clicando no primeiro botao/link cujo nome bate com termos
 * comuns de dispensa (aceitar, fechar, ok, entendi...). Retorna
 * dismissed=false quando nao ha overlay OU quando ha um overlay mas nenhum
 * botao de fechar reconhecivel foi encontrado - nesse segundo caso o
 * chamador deve desistir em vez de clicar as cegas em algo arbitrario.
 */
export async function detectAndDismissOverlay(tools: McpTools): Promise<AutoHealResult> {
  const snap = await tools.snapshot();
  const overlay = findFirstOverlay(snap.tree);
  if (!overlay) return { dismissed: false };

  const dismissButton = findDismissButton(overlay);
  const ref = dismissButton?.attributes?.ref;
  if (!dismissButton || !ref) {
    return { dismissed: false, overlayRole: overlay.role, overlayName: overlay.name };
  }

  await tools.click(ref, `dismiss overlay button "${dismissButton.name}"`);
  return { dismissed: true, overlayRole: overlay.role, overlayName: overlay.name };
}
