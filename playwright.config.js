// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  expect: { timeout: 10000 },

  // 1 retry in CI to handle transient network hiccups
  retries: process.env.CI ? 1 : 0,

  // Serial in CI to avoid hammering staging/Zoho concurrently
  workers: process.env.CI ? 1 : undefined,

  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: process.env.BASE_URL || 'https://staging.steinsandvines.ca',
    // staging.steinsandvines.ca sits behind Cloudflare Access. A headless
    // runner cannot sign in, so CI presents an Access *service token* as
    // headers (Cloudflare Zero Trust -> Access -> Service Auth; the Access
    // policy for the staging app needs a Service Auth rule for it). Locally,
    // leave the env unset and sign in once in the browser instead.
    extraHTTPHeaders: (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET)
      ? {
          'CF-Access-Client-Id': process.env.CF_ACCESS_CLIENT_ID,
          'CF-Access-Client-Secret': process.env.CF_ACCESS_CLIENT_SECRET,
        }
      : {},
    headless: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
