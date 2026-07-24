import { test, expect } from "@playwright/test";

const ALLOWED_CONSOLE_ERROR_PATTERNS = [/Error retrieving a token/];

test.describe("search", () => {
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

  test("caminho 1: click button \"Submit\" > click link \"Sign up\" > click button \"Submit\"", async ({ page }) => {
    await page.goto("https://sauce-demo.myshopify.com/");

    await page.getByRole("button", { name: "Submit", exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp("^https://sauce-demo\\.myshopify\\.com/search"));
    await expect(page.getByRole("heading", { name: "Search Results", exact: true }).first()).toBeVisible();

    await page.getByRole("link", { name: "Sign up", exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp("^https://sauce-demo\\.myshopify\\.com/account/register"));
    await expect(page.getByRole("heading", { name: "Create Account", exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: "Submit", exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp("^https://sauce-demo\\.myshopify\\.com/search"));
    await expect(page.getByRole("heading", { name: "Search Results", exact: true }).first()).toBeVisible();
  });

  test("caminho 2: click button \"Submit\" > click link \"About Us\" > click button \"Submit\"", async ({ page }) => {
    await page.goto("https://sauce-demo.myshopify.com/");

    await page.getByRole("button", { name: "Submit", exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp("^https://sauce-demo\\.myshopify\\.com/search"));
    await expect(page.getByRole("heading", { name: "Search Results", exact: true }).first()).toBeVisible();

    await page.getByRole("link", { name: "About Us", exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp("^https://sauce-demo\\.myshopify\\.com/pages/about-us"));
    await expect(page.getByRole("heading", { name: "About Us", exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: "Submit", exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp("^https://sauce-demo\\.myshopify\\.com/search"));
    await expect(page.getByRole("heading", { name: "Search Results", exact: true }).first()).toBeVisible();
  });

  test("caminho 3: click button \"Submit\" > click link \"Log In\" > click button \"Submit\"", async ({ page }) => {
    await page.goto("https://sauce-demo.myshopify.com/");

    await page.getByRole("button", { name: "Submit", exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp("^https://sauce-demo\\.myshopify\\.com/search"));
    await expect(page.getByRole("heading", { name: "Search Results", exact: true }).first()).toBeVisible();

    await page.getByRole("link", { name: "Log In", exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp("^https://sauce-demo\\.myshopify\\.com/account/login"));
    await expect(page.getByRole("heading", { name: "Customer Login", exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: "Submit", exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp("^https://sauce-demo\\.myshopify\\.com/search"));
    await expect(page.getByRole("heading", { name: "Search Results", exact: true }).first()).toBeVisible();
  });

  test("caminho 4: click button \"Submit\" > click link \"Check Out\" > click button \"Submit\"", async ({ page }) => {
    await page.goto("https://sauce-demo.myshopify.com/");

    await page.getByRole("button", { name: "Submit", exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp("^https://sauce-demo\\.myshopify\\.com/search"));
    await expect(page.getByRole("heading", { name: "Search Results", exact: true }).first()).toBeVisible();

    await page.getByRole("link", { name: "Check Out", exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp("^https://sauce-demo\\.myshopify\\.com/cart"));
    await expect(page.getByRole("heading", { name: "My Cart", exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: "Submit", exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp("^https://sauce-demo\\.myshopify\\.com/search"));
    await expect(page.getByRole("heading", { name: "Search Results", exact: true }).first()).toBeVisible();
  });

  test("caminho 5: click button \"Submit\" > click link \"Sign up\" > click link \"Search\"", async ({ page }) => {
    await page.goto("https://sauce-demo.myshopify.com/");

    await page.getByRole("button", { name: "Submit", exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp("^https://sauce-demo\\.myshopify\\.com/search"));
    await expect(page.getByRole("heading", { name: "Search Results", exact: true }).first()).toBeVisible();

    await page.getByRole("link", { name: "Sign up", exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp("^https://sauce-demo\\.myshopify\\.com/account/register"));
    await expect(page.getByRole("heading", { name: "Create Account", exact: true }).first()).toBeVisible();

    await page.getByRole("link", { name: "Search", exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp("^https://sauce-demo\\.myshopify\\.com/search"));
    await expect(page.getByRole("heading", { name: "Search Results", exact: true }).first()).toBeVisible();
  });

  test("caminho 6: click button \"Submit\" > click link \"About Us\" > click link \"Search\"", async ({ page }) => {
    await page.goto("https://sauce-demo.myshopify.com/");

    await page.getByRole("button", { name: "Submit", exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp("^https://sauce-demo\\.myshopify\\.com/search"));
    await expect(page.getByRole("heading", { name: "Search Results", exact: true }).first()).toBeVisible();

    await page.getByRole("link", { name: "About Us", exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp("^https://sauce-demo\\.myshopify\\.com/pages/about-us"));
    await expect(page.getByRole("heading", { name: "About Us", exact: true }).first()).toBeVisible();

    await page.getByRole("link", { name: "Search", exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp("^https://sauce-demo\\.myshopify\\.com/search"));
    await expect(page.getByRole("heading", { name: "Search Results", exact: true }).first()).toBeVisible();
  });

  test("caminho 7: click button \"Submit\" > click link \"Log In\" > click link \"Search\"", async ({ page }) => {
    await page.goto("https://sauce-demo.myshopify.com/");

    await page.getByRole("button", { name: "Submit", exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp("^https://sauce-demo\\.myshopify\\.com/search"));
    await expect(page.getByRole("heading", { name: "Search Results", exact: true }).first()).toBeVisible();

    await page.getByRole("link", { name: "Log In", exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp("^https://sauce-demo\\.myshopify\\.com/account/login"));
    await expect(page.getByRole("heading", { name: "Customer Login", exact: true }).first()).toBeVisible();

    await page.getByRole("link", { name: "Search", exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp("^https://sauce-demo\\.myshopify\\.com/search"));
    await expect(page.getByRole("heading", { name: "Search Results", exact: true }).first()).toBeVisible();
  });

  test("caminho 8: click button \"Submit\" > click link \"Check Out\" > click link \"Search\"", async ({ page }) => {
    await page.goto("https://sauce-demo.myshopify.com/");

    await page.getByRole("button", { name: "Submit", exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp("^https://sauce-demo\\.myshopify\\.com/search"));
    await expect(page.getByRole("heading", { name: "Search Results", exact: true }).first()).toBeVisible();

    await page.getByRole("link", { name: "Check Out", exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp("^https://sauce-demo\\.myshopify\\.com/cart"));
    await expect(page.getByRole("heading", { name: "My Cart", exact: true }).first()).toBeVisible();

    await page.getByRole("link", { name: "Search", exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp("^https://sauce-demo\\.myshopify\\.com/search"));
    await expect(page.getByRole("heading", { name: "Search Results", exact: true }).first()).toBeVisible();
  });

  test("caminho 9: click button \"Submit\" > click link \"My Cart (0)\"", async ({ page }) => {
    await page.goto("https://sauce-demo.myshopify.com/");

    await page.getByRole("button", { name: "Submit", exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp("^https://sauce-demo\\.myshopify\\.com/search"));
    await expect(page.getByRole("heading", { name: "Search Results", exact: true }).first()).toBeVisible();

    await page.getByRole("link", { name: "My Cart (0)", exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp("^https://sauce-demo\\.myshopify\\.com/search"));
    await expect(page.getByRole("heading", { name: "Search Results", exact: true }).first()).toBeVisible();
  });

  test("caminho 10: click button \"Submit\" > click button \"Submit\"", async ({ page }) => {
    await page.goto("https://sauce-demo.myshopify.com/");

    await page.getByRole("button", { name: "Submit", exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp("^https://sauce-demo\\.myshopify\\.com/search"));
    await expect(page.getByRole("heading", { name: "Search Results", exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: "Submit", exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp("^https://sauce-demo\\.myshopify\\.com/search"));
    await expect(page.getByRole("heading", { name: "Search Results", exact: true }).first()).toBeVisible();
  });

  test("caminho 11: click button \"Submit\" > click link \"Search\"", async ({ page }) => {
    await page.goto("https://sauce-demo.myshopify.com/");

    await page.getByRole("button", { name: "Submit", exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp("^https://sauce-demo\\.myshopify\\.com/search"));
    await expect(page.getByRole("heading", { name: "Search Results", exact: true }).first()).toBeVisible();

    await page.getByRole("link", { name: "Search", exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp("^https://sauce-demo\\.myshopify\\.com/search"));
    await expect(page.getByRole("heading", { name: "Search Results", exact: true }).first()).toBeVisible();
  });

  test("caminho 12: click link \"Search\" > click button \"Submit\"", async ({ page }) => {
    await page.goto("https://sauce-demo.myshopify.com/");

    await page.getByRole("link", { name: "Search", exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp("^https://sauce-demo\\.myshopify\\.com/search"));
    await expect(page.getByRole("heading", { name: "Search Results", exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: "Submit", exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp("^https://sauce-demo\\.myshopify\\.com/search"));
    await expect(page.getByRole("heading", { name: "Search Results", exact: true }).first()).toBeVisible();
  });

  test("caminho 13: click link \"Search\" > click link \"My Cart (0)\"", async ({ page }) => {
    await page.goto("https://sauce-demo.myshopify.com/");

    await page.getByRole("link", { name: "Search", exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp("^https://sauce-demo\\.myshopify\\.com/search"));
    await expect(page.getByRole("heading", { name: "Search Results", exact: true }).first()).toBeVisible();

    await page.getByRole("link", { name: "My Cart (0)", exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp("^https://sauce-demo\\.myshopify\\.com/search"));
    await expect(page.getByRole("heading", { name: "Search Results", exact: true }).first()).toBeVisible();
  });

  test("caminho 14: click link \"Search\" > click link \"Search\"", async ({ page }) => {
    await page.goto("https://sauce-demo.myshopify.com/");

    await page.getByRole("link", { name: "Search", exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp("^https://sauce-demo\\.myshopify\\.com/search"));
    await expect(page.getByRole("heading", { name: "Search Results", exact: true }).first()).toBeVisible();

    await page.getByRole("link", { name: "Search", exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp("^https://sauce-demo\\.myshopify\\.com/search"));
    await expect(page.getByRole("heading", { name: "Search Results", exact: true }).first()).toBeVisible();
  });
});
