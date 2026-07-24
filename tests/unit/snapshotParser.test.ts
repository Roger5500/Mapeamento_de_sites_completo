import { describe, expect, it } from "vitest";
import { computeNodeIdentity, type AccessibilityNode } from "../../src/graph/nodeIdentity.js";
import { parseSnapshotResponse } from "../../src/mcp/snapshotParser.js";

function findByName(name: string, node: AccessibilityNode): AccessibilityNode | undefined {
  if (node.name === name) return node;
  for (const child of node.children ?? []) {
    const found = findByName(name, child);
    if (found) return found;
  }
  return undefined;
}

function findByRole(role: string, node: AccessibilityNode): AccessibilityNode | undefined {
  if (node.role === role) return node;
  for (const child of node.children ?? []) {
    const found = findByRole(role, child);
    if (found) return found;
  }
  return undefined;
}

// Texto real capturado de uma chamada `browser_snapshot` do @playwright/mcp
// contra https://sauce-demo.myshopify.com/ (ver src/mcp/snapshotParser.ts
// para a explicacao do formato). Usado como fixture de regressao do parser.
const REAL_SNAPSHOT_RESPONSE = `### Page
- Page URL: https://sauce-demo.myshopify.com/
- Page Title: Sauce Demo
### Snapshot
\`\`\`yaml
- generic [active] [ref=e1]:
  - banner [ref=e2]:
    - generic [ref=e3]:
      - generic [ref=e5]:
        - search:
          - button "Submit" [ref=e6] [cursor=pointer]
          - textbox "Search" [ref=e7]
      - navigation [ref=e9]:
        - link "Search" [ref=e10] [cursor=pointer]:
          - /url: /search
        - link "About Us" [ref=e11] [cursor=pointer]:
          - /url: /pages/about-us
        - link "Log In" [ref=e12] [cursor=pointer]:
          - /url: /account/login
        - link "Sign up" [ref=e13] [cursor=pointer]:
          - /url: /account/register
      - generic [ref=e15]:
        - link "My Cart (0)" [ref=e16] [cursor=pointer]:
          - /url: "#"
        - link "Check Out" [ref=e17] [cursor=pointer]:
          - /url: /cart
    - generic [ref=e20]:
      - heading [level=1] [ref=e22]:
        - link [ref=e23] [cursor=pointer]:
          - /url: /
          - img "Sauce Demo" [ref=e24]
      - heading "Just a demo site showing off what Sauce can do." [level=3] [ref=e27]
  - generic [ref=e28]:
    - navigation [ref=e30]:
      - list [ref=e31]:
        - listitem [ref=e32]:
          - link "Home" [ref=e33] [cursor=pointer]:
            - /url: /
        - listitem [ref=e34]:
          - link "Catalog" [ref=e35] [cursor=pointer]:
            - /url: /collections/all
    - generic [ref=e52]:
      - link [ref=e54] [cursor=pointer]:
        - /url: /collections/frontpage/products/grey-jacket
        - img "Grey jacket" [ref=e55]
        - heading "Grey jacket" [level=3] [ref=e56]
        - heading "£55.00" [level=4] [ref=e57]
    - contentinfo [ref=e68]:
      - generic [ref=e76]:
        - heading "About Us" [level=2] [ref=e77]
        - paragraph [ref=e79]:
          - strong [ref=e80]:
            - text: This is a demo site created for
            - link "Sauce" [ref=e81] [cursor=pointer]:
              - /url: http://sauceapp.io
            - text: ", an awesome new way to make your Shopify site social."
\`\`\``;

describe("parseSnapshotResponse", () => {
  it("extrai url e title da secao ### Page", () => {
    const parsed = parseSnapshotResponse(REAL_SNAPSHOT_RESPONSE);
    expect(parsed.url).toBe("https://sauce-demo.myshopify.com/");
    expect(parsed.title).toBe("Sauce Demo");
  });

  it("resolve linhas pseudo /url como atributo do no pai, nao como filho separado", () => {
    const parsed = parseSnapshotResponse(REAL_SNAPSHOT_RESPONSE);

    const aboutLink = findByName("About Us", parsed.tree);
    expect(aboutLink?.role).toBe("link");
    expect(aboutLink?.attributes?.url).toBe("/pages/about-us");
    expect(aboutLink?.children).toHaveLength(0);
  });

  it("resolve linhas pseudo text como um no filho real de role 'text', preservando ordem entre irmaos", () => {
    const parsed = parseSnapshotResponse(REAL_SNAPSHOT_RESPONSE);

    const strongNode = findByRole("strong", parsed.tree);
    expect(strongNode?.children?.map((c) => c.role)).toEqual(["text", "link", "text"]);
    expect(strongNode?.children?.[0]?.name).toBe("This is a demo site created for");
  });

  it("extrai atributos entre colchetes (ref, level, cursor, flags booleanas)", () => {
    const parsed = parseSnapshotResponse(REAL_SNAPSHOT_RESPONSE);
    // O root sintetico envolve o unico item de topo do yaml (o "generic [active] [ref=e1]") como filho.
    const topNode = parsed.tree.children?.[0];
    expect(topNode?.attributes?.active).toBe("true");
    expect(topNode?.attributes?.ref).toBe("e1");
  });

  it("a arvore parseada e aceita por computeNodeIdentity sem lancar erro", () => {
    const parsed = parseSnapshotResponse(REAL_SNAPSHOT_RESPONSE);
    expect(() => computeNodeIdentity(parsed.url, parsed.tree)).not.toThrow();
  });

  it("lanca erro descritivo quando o bloco yaml inline nao esta presente", () => {
    const withoutYaml = "### Page\n- Page URL: https://example.com/\n- Page Title: X\n### Snapshot\n- [Snapshot](out.yml)";
    expect(() => parseSnapshotResponse(withoutYaml)).toThrow(/bloco ```yaml``` inline/);
  });
});
