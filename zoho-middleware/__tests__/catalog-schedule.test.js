'use strict';

// Quick task 261029-zq1 Task 1 — staging must not spend the shared Zoho
// Inventory quota on a schedule.
//
// Incident 2026-10-29: staging and production share ONE Zoho org (one
// 1,000-calls/day Inventory quota). Both environments ran the boot pre-warm,
// the 05:00/13:00 UTC warm-up and the */10 kiosk catalog cron, so staging
// alone burned ~half the day's quota and the production kiosk went blank.
//
// ZOHO_SCHEDULED_JOBS=off disables all three scheduled catalog jobs. Anything
// else (unset included) keeps today's behaviour.

var catalogSchedule = require('../lib/catalog-schedule');

function makeDeps(opts) {
  opts = opts || {};
  var scheduled = [];
  var deps = {
    cron: {
      schedule: jest.fn(function (expr, fn, options) {
        scheduled.push({ expr: expr, fn: fn, options: options });
      })
    },
    catalog: {
      refreshProducts: jest.fn().mockResolvedValue([]),
      refreshIngredients: jest.fn().mockResolvedValue([]),
      refreshKioskCatalogInBackground: jest.fn().mockResolvedValue([])
    },
    zohoAuth: { isAuthenticated: jest.fn().mockReturnValue(opts.authenticated !== false) },
    log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    setTimeout: jest.fn(function (fn) { fn(); }),
    env: opts.env || {}
  };
  deps.scheduled = scheduled;
  return deps;
}

function flush() {
  return new Promise(function (r) { setImmediate(r); });
}

describe('scheduledJobsEnabled', function () {
  test('defaults to enabled when unset', function () {
    expect(catalogSchedule.scheduledJobsEnabled({})).toBe(true);
  });

  test('"off" disables (case and whitespace insensitive)', function () {
    expect(catalogSchedule.scheduledJobsEnabled({ ZOHO_SCHEDULED_JOBS: 'off' })).toBe(false);
    expect(catalogSchedule.scheduledJobsEnabled({ ZOHO_SCHEDULED_JOBS: ' OFF ' })).toBe(false);
  });

  test('any other value keeps jobs enabled', function () {
    expect(catalogSchedule.scheduledJobsEnabled({ ZOHO_SCHEDULED_JOBS: 'on' })).toBe(true);
    expect(catalogSchedule.scheduledJobsEnabled({ ZOHO_SCHEDULED_JOBS: '' })).toBe(true);
  });
});

describe('registerCatalogJobs', function () {
  test('enabled: pre-warms products then ingredients and registers both crons', function () {
    var d = makeDeps();
    var result = catalogSchedule.registerCatalogJobs(d);
    expect(result.enabled).toBe(true);
    return flush().then(function () {
      expect(d.catalog.refreshProducts).toHaveBeenCalledTimes(1);
      expect(d.catalog.refreshIngredients).toHaveBeenCalledTimes(1);
      var exprs = d.scheduled.map(function (s) { return s.expr; });
      expect(exprs).toEqual(expect.arrayContaining(['0 5,13 * * *', '*/10 9-19 * * *']));
      var kiosk = d.scheduled.find(function (s) { return s.expr === '*/10 9-19 * * *'; });
      expect(kiosk.options).toEqual({ timezone: 'America/Vancouver' });
    });
  });

  test('enabled: the kiosk cron refreshes the kiosk catalog when authenticated', function () {
    var d = makeDeps();
    catalogSchedule.registerCatalogJobs(d);
    var kiosk = d.scheduled.find(function (s) { return s.expr === '*/10 9-19 * * *'; });
    kiosk.fn();
    expect(d.catalog.refreshKioskCatalogInBackground).toHaveBeenCalledTimes(1);
  });

  test('enabled but not authenticated at boot: no pre-warm, kiosk cron still registered', function () {
    var d = makeDeps({ authenticated: false });
    catalogSchedule.registerCatalogJobs(d);
    return flush().then(function () {
      expect(d.catalog.refreshProducts).not.toHaveBeenCalled();
      var exprs = d.scheduled.map(function (s) { return s.expr; });
      expect(exprs).toEqual(['*/10 9-19 * * *']);
    });
  });

  test('ZOHO_SCHEDULED_JOBS=off: no pre-warm, no crons, one boot log line', function () {
    var d = makeDeps({ env: { ZOHO_SCHEDULED_JOBS: 'off' } });
    var result = catalogSchedule.registerCatalogJobs(d);
    expect(result.enabled).toBe(false);
    return flush().then(function () {
      expect(d.cron.schedule).not.toHaveBeenCalled();
      expect(d.catalog.refreshProducts).not.toHaveBeenCalled();
      expect(d.catalog.refreshIngredients).not.toHaveBeenCalled();
      expect(d.catalog.refreshKioskCatalogInBackground).not.toHaveBeenCalled();
      var lines = d.log.info.mock.calls.map(function (c) { return c[0]; });
      expect(lines.filter(function (l) { return /ZOHO_SCHEDULED_JOBS/.test(l); })).toHaveLength(1);
    });
  });

  test('enabled: logs the state once at boot', function () {
    var d = makeDeps();
    catalogSchedule.registerCatalogJobs(d);
    var lines = d.log.info.mock.calls.map(function (c) { return c[0]; });
    expect(lines.filter(function (l) { return /ZOHO_SCHEDULED_JOBS/.test(l); })).toHaveLength(1);
  });
});
