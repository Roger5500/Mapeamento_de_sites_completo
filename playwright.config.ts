import { defineConfig, devices } from "@playwright/test";

/**
 * Config para RODAR os testes gerados em tests/generated - concern separado
 * do browser que o proprio crawler dirige via @playwright/mcp (ver
 * src/mcp/client.ts). `baseURL` e definido por arquivo gerado via
 * `page.goto(<baseUrl absoluto>)` (ver compiler/templates/spec.template.ts),
 * entao nao e necessario aqui.
 */
export default defineConfig({
  testDir: "./tests/generated",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["junit", { outputFile: "test-results/junit.xml" }], ["html", { open: "never" }]] : "list",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
