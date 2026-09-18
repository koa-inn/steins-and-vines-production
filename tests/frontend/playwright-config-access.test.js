'use strict';

// =============================================================================
// The E2E job runs Playwright against staging.steinsandvines.ca, which sits
// behind Cloudflare Access. A headless runner cannot sign in, so the config
// presents an Access service token as request headers when CI provides it,
// and sends nothing extra otherwise (local runs with a signed-in browser).
// =============================================================================

// @playwright/test cannot load under the jsdom test environment; the config
// only needs defineConfig (identity) and the devices table.
jest.mock('@playwright/test', function () {
  return { defineConfig: function (c) { return c; }, devices: { 'Desktop Chrome': {} } };
});

var path = require('path');
var CONFIG = path.join(__dirname, '..', '..', 'playwright.config.js');

function loadConfig(env) {
  var saved = { id: process.env.CF_ACCESS_CLIENT_ID, secret: process.env.CF_ACCESS_CLIENT_SECRET };
  delete process.env.CF_ACCESS_CLIENT_ID;
  delete process.env.CF_ACCESS_CLIENT_SECRET;
  Object.keys(env || {}).forEach(function (k) { process.env[k] = env[k]; });
  jest.resetModules();
  var cfg = require(CONFIG);
  if (saved.id !== undefined) process.env.CF_ACCESS_CLIENT_ID = saved.id; else delete process.env.CF_ACCESS_CLIENT_ID;
  if (saved.secret !== undefined) process.env.CF_ACCESS_CLIENT_SECRET = saved.secret; else delete process.env.CF_ACCESS_CLIENT_SECRET;
  return cfg;
}

describe('playwright.config.js — Cloudflare Access service token', function () {
  test('sends the two Access headers when both secrets are present', function () {
    var cfg = loadConfig({ CF_ACCESS_CLIENT_ID: 'id-123', CF_ACCESS_CLIENT_SECRET: 'secret-456' });
    expect(cfg.use.extraHTTPHeaders).toEqual({
      'CF-Access-Client-Id': 'id-123',
      'CF-Access-Client-Secret': 'secret-456'
    });
  });

  test('sends no extra headers when the secrets are absent', function () {
    var cfg = loadConfig({});
    expect(cfg.use.extraHTTPHeaders).toEqual({});
  });

  test('half a token pair is treated as none (never sends a lone header)', function () {
    var cfg = loadConfig({ CF_ACCESS_CLIENT_ID: 'id-only' });
    expect(cfg.use.extraHTTPHeaders).toEqual({});
  });

  test('CI workflow passes the secrets to the E2E step', function () {
    var fs = require('fs');
    var yml = fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'workflows', 'tests.yml'), 'utf8');
    expect(yml).toMatch(/CF_ACCESS_CLIENT_ID: \$\{\{ secrets\.CF_ACCESS_CLIENT_ID \}\}/);
    expect(yml).toMatch(/CF_ACCESS_CLIENT_SECRET: \$\{\{ secrets\.CF_ACCESS_CLIENT_SECRET \}\}/);
  });
});
