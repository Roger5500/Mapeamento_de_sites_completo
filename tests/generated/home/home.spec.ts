import { test, expect } from "@playwright/test";

const ALLOWED_CONSOLE_ERROR_PATTERNS = [/Error retrieving a token/];

test.describe("home", () => {
  const consoleErrors: string[] = [];

  test.beforeEach(({ page }) => {
    consoleErrors.length = 0;
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
  });

  test.afterEach(() => {
    const unexpected = consoleErrors.filter((text) => !ALLOWED_CONSOLE_ERROR_PATTERNS.some((pattern) => pattern.test(text)));
    expect(unexpected, `erros de console inesperados: ${unexpected.join(", ")}`).toEqual([]);
  });

  test("caminho 1: click button \"Submit\" > click link \"Home\"", async ({ page }) => {
    await page.goto("https://sauce-demo.myshopify.com/");

    await page.getByRole("button", { name: "Submit", exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp("^https://sauce-demo\\.myshopify\\.com/search"));
    await expect(page.getByRole("heading", { name: "Search Results", exact: true }).first()).toBeVisible();

    await page.getByRole("link", { name: "Home", exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp("^https://sauce-demo\\.myshopify\\.com/"));
    await expect(page.getByRole("heading", { name: "Grey jacket", exact: true }).first()).toBeVisible();
  });
});
