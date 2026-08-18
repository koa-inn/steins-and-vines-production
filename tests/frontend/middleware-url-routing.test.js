'use strict';

// Pins the hostname-based MIDDLEWARE_URL selection in js/sheets-config.js
// (staging-middleware Phase 1). Only staging.steinsandvines.ca may route to the
// staging middleware; every other host — production domain, kiosk iPad, local
// dev, and the no-location fallback — MUST resolve to production. A regression
// here would silently point live traffic at the wrong middleware.

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var PROD_MW = 'https://svmiddleware-production.up.railway.app';
var STAGING_MW = 'https://svmiddleware-staging.up.railway.app';

var CONFIG_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'js', 'sheets-config.js'), 'utf8'
);

// Evaluate sheets-config.js in an isolated context with a mocked `location`,
// then read the resolved SHEETS_CONFIG.MIDDLEWARE_URL.
function middlewareUrlForHost(hostname) {
  var sandbox = {};
  if (hostname !== undefined) sandbox.location = { hostname: hostname };
  vm.createContext(sandbox);
  vm.runInContext(CONFIG_SRC, sandbox);
  return sandbox.SHEETS_CONFIG.MIDDLEWARE_URL;
}

describe('MIDDLEWARE_URL hostname routing (sheets-config.js)', function () {
  test('staging.steinsandvines.ca → staging middleware', function () {
    expect(middlewareUrlForHost('staging.steinsandvines.ca')).toBe(STAGING_MW);
  });

  test('production domain → production middleware', function () {
    expect(middlewareUrlForHost('steinsandvines.ca')).toBe(PROD_MW);
    expect(middlewareUrlForHost('www.steinsandvines.ca')).toBe(PROD_MW);
  });

  test('kiosk iPad / local dev / arbitrary host → production middleware', function () {
    expect(middlewareUrlForHost('localhost')).toBe(PROD_MW);
    expect(middlewareUrlForHost('127.0.0.1')).toBe(PROD_MW);
    expect(middlewareUrlForHost('koa-inn.github.io')).toBe(PROD_MW);
  });

  test('no location available (fail-safe) → production middleware', function () {
    expect(middlewareUrlForHost(undefined)).toBe(PROD_MW);
  });
});
