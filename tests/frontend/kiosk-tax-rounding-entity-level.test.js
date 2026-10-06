'use strict';

// Kiosk client totals must round tax the way the Zoho org does
// (tax_rounding: "entity_level" — each rate rounded on its own, then summed),
// mirroring zoho-middleware/routes/pos.js computeTax. Companion to
// zoho-middleware/__tests__/pos-tax-rounding-entity-level.test.js.
//
// Incident 2026-10-03 (INV-000226): $25-off kit sale. Rounding the summed
// unrounded tax once gave 2.5863 -> 2.59 (total 247.59 charged); Zoho
// invoiced GST 2.04 + BC PST+GST 0.54 = 2.58 (total 247.58), and recording
// the 247.59 payment against the 247.58 invoice failed.

global.window = global.window || {};
global.navigator = global.navigator || { userAgent: 'test' };
global.console = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() };
global.alert = jest.fn();
global.fetch = jest.fn(function () {
  return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({}); } });
});
global.SHEETS_CONFIG = {
  MIDDLEWARE_URL: 'http://localhost:3001',
  MW_API_KEY: 'test-key',
  SPREADSHEET_ID: 'test-id',
  GOOGLE_CLIENT_ID: 'test-client-id',
  STAFF_EMAILS: 'test@example.com',
  API_BASE: 'https://script.google.com/test',
  SERVER_TOKEN: 'test-token'
};

function loadCore() {
  jest.resetModules();
  if (global.window) delete global.window.KioskCore;
  document.body.innerHTML = '';
  require('../../js/kiosk.js'); // eslint-disable-line global-require -- per-test isolation
  return global.window.KioskCore;
}

function line(id, name, rate, pct) {
  return { item: { item_id: id, name: name, rate: rate, tax_percentage: pct }, qty: 1 };
}

describe('kioskCalcTotals — entity_level tax rounding (matches Zoho)', function () {
  test('INV-000226 reproduction: $25 off -> tax 2.58, total 247.58', function () {
    var core = loadCore();
    core.init({ getDiscount: function () { return { scope: 'cart', type: 'fixed', value: 25 }; } });
    core._setCart({
      kit: line('kit', 'Passport Cabernet Mataro Merlot', 220, 0),
      makers: line('makers', 'Makers Fee', 45, 5),
      mat: line('mat', 'Materials Fee', 5, 12)
    });
    var t = core.calcTotals();
    expect(t.discount).toBe(25);
    expect(t.tax).toBe(2.58);
    expect(t.total).toBe(247.58);
  });

  test('lines sharing a rate are rounded together, not per line', function () {
    var core = loadCore();
    core._setCart({
      a: line('a', 'A', 0.5, 5),
      b: line('b', 'B', 0.5, 5)
    });
    expect(core.calcTotals().tax).toBe(0.05);
  });

  test('undiscounted whole-dollar kit sale is unchanged (tax 2.85, total 272.85)', function () {
    var core = loadCore();
    core._setCart({
      kit: line('kit', 'Kit', 220, 0),
      makers: line('makers', 'Makers Fee', 45, 5),
      mat: line('mat', 'Materials Fee', 5, 12)
    });
    var t = core.calcTotals();
    expect(t.tax).toBe(2.85);
    expect(t.total).toBe(272.85);
  });
});
