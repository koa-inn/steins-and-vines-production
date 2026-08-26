'use strict';

// WR-01 gap-closure regression: summarizeBulkResults must treat a batch the Apps
// Script guard reports as already-existing (`duplicate: true`) as a benign
// convergence outcome, NOT a failure. Before the fix, an idempotent re-run of a
// fully-batched invoice showed "All N failed" and a partial convergence showed
// "M failed", spurious failure toasts indistinguishable from real errors.

// brewpad.js runs its IIFE on load -- stub the globals it touches at the top level.
global.document = global.document || {};
global.window = global.window || {};
global.navigator = global.navigator || {};
global.google = { accounts: { oauth2: { initTokenClient: jest.fn() } } };
global.fetch = jest.fn();
global.localStorage = {
  _data: {},
  getItem: function (k) { return this._data[k] || null; },
  setItem: function (k, v) { this._data[k] = v; },
  removeItem: function (k) { delete this._data[k]; },
  clear: function () { this._data = {}; }
};
global.sessionStorage = {
  _data: {},
  getItem: function (k) { return this._data[k] || null; },
  setItem: function (k, v) { this._data[k] = v; },
  removeItem: function (k) { delete this._data[k]; },
  clear: function () { this._data = {}; }
};

var _auth = require('../../js/lib/auth');
global.waitForGoogleIdentity = _auth.waitForGoogleIdentity;
global.gsiInitTokenClient = _auth.gsiInitTokenClient;
global.fetchGoogleUserInfo = _auth.fetchGoogleUserInfo;

var bp = require('../../js/brewpad');

describe('WR-01 summarizeBulkResults treats duplicate units as benign convergence', function () {
  var fn = bp.summarizeBulkResults;

  it('idempotent re-run (all kit units duplicate) → 0 failures, dupCount counts them, success message', function () {
    var results = [
      { invoice_number: 'INV-000171', ok: true, duplicate: true, kit_results: [
        { sku: '80087352', ok: false, duplicate: true, error: 'duplicate_so_number' },
        { sku: '80087352', ok: false, duplicate: true, error: 'duplicate_so_number' },
        { sku: '80087352', ok: false, duplicate: true, error: 'duplicate_so_number' }
      ] }
    ];
    var summary = fn(results);
    expect(summary.failCount).toBe(0);
    expect(summary.okCount).toBe(0);
    expect(summary.dupCount).toBe(3);
    expect(summary.message).toContain('already exist');
    // Must NOT read as a failure to the operator.
    expect(summary.message).not.toContain('failed');
  });

  it('partial convergence (2 created + 1 duplicate) → okCount 2, dupCount 1, no failures', function () {
    var results = [
      { invoice_number: 'INV-000171', ok: true, kit_results: [
        { sku: '80087352', ok: true, batch_id: 'SV-B-000002' },
        { sku: '80087352', ok: true, batch_id: 'SV-B-000003' },
        { sku: '80087352', ok: false, duplicate: true, error: 'duplicate_so_number' }
      ] }
    ];
    var summary = fn(results);
    expect(summary.okCount).toBe(2);
    expect(summary.dupCount).toBe(1);
    expect(summary.failCount).toBe(0);
    expect(summary.message).toContain('Created 2 batch(es)');
    expect(summary.message).toContain('1 already existed');
    expect(summary.message).not.toContain('failed');
  });

  it('single-unit invoice flagged duplicate at the invoice level → not counted as a failure', function () {
    var results = [
      { invoice_number: 'INV-000200', ok: true, duplicate: true }
    ];
    var summary = fn(results);
    expect(summary.failCount).toBe(0);
    expect(summary.dupCount).toBe(1);
    expect(summary.okCount).toBe(0);
  });

  it('a real per-unit failure (not a duplicate) is still counted as a failure', function () {
    var results = [
      { invoice_number: 'INV-000300', ok: false, kit_results: [
        { sku: 'KIT-A', ok: true, batch_id: 'SV-B-000010' },
        { sku: 'KIT-A', ok: false, error: 'apps_script_error' }
      ] }
    ];
    var summary = fn(results);
    expect(summary.okCount).toBe(1);
    expect(summary.failCount).toBe(1);
    expect(summary.dupCount).toBe(0);
    expect(summary.message).toContain('1 failed');
  });

  it('mixed real failure + duplicate: duplicate is benign, the real failure still surfaces', function () {
    var results = [
      { invoice_number: 'INV-000400', ok: false, kit_results: [
        { sku: 'KIT-A', ok: false, duplicate: true, error: 'duplicate_so_number' },
        { sku: 'KIT-A', ok: false, error: 'apps_script_error' }
      ] }
    ];
    var summary = fn(results);
    expect(summary.dupCount).toBe(1);
    expect(summary.failCount).toBe(1);
    expect(summary.okCount).toBe(0);
    expect(summary.message).toContain('failed');
  });
});
