'use strict';

// Pull from Zoho helpers — Jest test suite
// Tests the pure helper functions added to js/brewpad.js for the Pull from Zoho feature.

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

// auth.js primitives are loaded via <script> in the browser; in tests wire them as globals.
var _auth = require('../../js/lib/auth');
global.waitForGoogleIdentity = _auth.waitForGoogleIdentity;
global.gsiInitTokenClient = _auth.gsiInitTokenClient;
global.fetchGoogleUserInfo = _auth.fetchGoogleUserInfo;

var bp = require('../../js/brewpad');

// ---------------------------------------------------------------------------
// Pull from Zoho — buildPullCandidateRowHtml
// ---------------------------------------------------------------------------
describe('buildPullCandidateRowHtml', function () {
  var fn = bp.buildPullCandidateRowHtml;

  it('returns an HTML string containing the invoice_number', function () {
    var html = fn({
      invoice_id: 'INV-123',
      invoice_number: 'INV-000123',
      customer_name: 'Jane Smith',
      customer_id: 'ZC-001',
      status: 'sent',
      kit_items: []
    });
    expect(html).toContain('INV-000123');
  });

  it('returns an HTML string containing the customer_name', function () {
    var html = fn({
      invoice_id: 'INV-123',
      invoice_number: 'INV-000123',
      customer_name: 'Jane Smith',
      customer_id: 'ZC-001',
      status: 'sent',
      kit_items: []
    });
    expect(html).toContain('Jane Smith');
  });

  it('escapes XSS in customer_name', function () {
    var html = fn({
      invoice_id: 'INV-456',
      invoice_number: 'INV-000456',
      customer_name: '<script>alert(1)</script>',
      customer_id: 'ZC-002',
      status: 'paid',
      kit_items: []
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes XSS in invoice_number', function () {
    var html = fn({
      invoice_id: 'INV-789',
      invoice_number: '<b>bad</b>',
      customer_name: 'Bob',
      customer_id: 'ZC-003',
      status: 'paid',
      kit_items: []
    });
    expect(html).not.toContain('<b>bad</b>');
    expect(html).toContain('&lt;b&gt;bad&lt;/b&gt;');
  });

  it('includes DRAFT badge when status === "draft" (D-05)', function () {
    var html = fn({
      invoice_id: 'INV-999',
      invoice_number: 'INV-000999',
      customer_name: 'Draft Customer',
      customer_id: 'ZC-099',
      status: 'draft',
      kit_items: []
    });
    expect(html).toContain('DRAFT');
  });

  it('omits DRAFT badge when status === "sent"', function () {
    var html = fn({
      invoice_id: 'INV-100',
      invoice_number: 'INV-000100',
      customer_name: 'Sent Customer',
      customer_id: 'ZC-100',
      status: 'sent',
      kit_items: []
    });
    expect(html).not.toContain('DRAFT');
  });

  it('omits DRAFT badge when status === "paid"', function () {
    var html = fn({
      invoice_id: 'INV-101',
      invoice_number: 'INV-000101',
      customer_name: 'Paid Customer',
      customer_id: 'ZC-101',
      status: 'paid',
      kit_items: []
    });
    expect(html).not.toContain('DRAFT');
  });

  it('lists each kit_items name in the output', function () {
    var html = fn({
      invoice_id: 'INV-200',
      invoice_number: 'INV-000200',
      customer_name: 'Kit Customer',
      customer_id: 'ZC-200',
      status: 'paid',
      kit_items: [
        { sku: 'WK-RED-001', name: 'Merlot Wine Kit' },
        { sku: 'WK-WHT-002', name: 'Chardonnay Kit' }
      ]
    });
    expect(html).toContain('Merlot Wine Kit');
    expect(html).toContain('Chardonnay Kit');
  });

  it('handles empty kit_items without error', function () {
    expect(function () {
      fn({
        invoice_id: 'INV-300',
        invoice_number: 'INV-000300',
        customer_name: 'No Kit',
        customer_id: 'ZC-300',
        status: 'paid',
        kit_items: []
      });
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Pull from Zoho — buildBulkCreatePayload (D-06: client supplies intent only)
// ---------------------------------------------------------------------------
describe('buildBulkCreatePayload', function () {
  var fn = bp.buildBulkCreatePayload;

  it('returns an object with invoice_ids array', function () {
    var result = fn([
      { invoice_id: 'INV-001', invoice_number: 'INV-000001', customer_name: 'Alice', status: 'paid', kit_items: [] },
      { invoice_id: 'INV-002', invoice_number: 'INV-000002', customer_name: 'Bob', status: 'sent', kit_items: [] }
    ]);
    expect(result).toEqual({ invoice_ids: ['INV-001', 'INV-002'] });
  });

  it('contains only invoice_id values — no customer fields (D-06)', function () {
    var result = fn([
      { invoice_id: 'INV-010', invoice_number: 'INV-000010', customer_name: 'Charlie', customer_id: 'ZC-010', status: 'paid', kit_items: [{ sku: 'WK-001', name: 'Kit A' }] }
    ]);
    expect(Object.keys(result)).toEqual(['invoice_ids']);
    expect(result.invoice_ids).toEqual(['INV-010']);
    // Critically: no product_name, customer_name, customer_id etc. leak into payload
    expect(result).not.toHaveProperty('customer_name');
    expect(result).not.toHaveProperty('customer_id');
    expect(result).not.toHaveProperty('product_name');
    expect(result).not.toHaveProperty('kit_items');
    expect(result).not.toHaveProperty('invoice_number');
  });

  it('returns empty invoice_ids array for empty input', function () {
    var result = fn([]);
    expect(result).toEqual({ invoice_ids: [] });
  });

  it('handles single candidate', function () {
    var result = fn([
      { invoice_id: 'INV-500', invoice_number: 'INV-000500', customer_name: 'Solo', status: 'draft', kit_items: [] }
    ]);
    expect(result).toEqual({ invoice_ids: ['INV-500'] });
  });
});

// ---------------------------------------------------------------------------
// Pull from Zoho — summarizeBulkResults
// ---------------------------------------------------------------------------
describe('summarizeBulkResults', function () {
  var fn = bp.summarizeBulkResults;

  it('returns okCount and failCount for mixed results', function () {
    var results = [
      { invoice_number: 'INV-001', ok: true, batch_id: 'SV-B-000001' },
      { invoice_number: 'INV-002', ok: false, error: 'duplicate_so_number' },
      { invoice_number: 'INV-003', ok: true, batch_id: 'SV-B-000002' }
    ];
    var summary = fn(results);
    expect(summary.okCount).toBe(2);
    expect(summary.failCount).toBe(1);
  });

  it('message contains "Created N batch(es); M failed" for partial failure', function () {
    var results = [
      { invoice_number: 'INV-001', ok: true, batch_id: 'SV-B-000001' },
      { invoice_number: 'INV-002', ok: false, error: 'duplicate_so_number' }
    ];
    var summary = fn(results);
    expect(summary.message).toContain('Created 1 batch(es)');
    expect(summary.message).toContain('1 failed');
  });

  it('all ok: okCount equals total, failCount is 0', function () {
    var results = [
      { invoice_number: 'INV-001', ok: true, batch_id: 'SV-B-000001' },
      { invoice_number: 'INV-002', ok: true, batch_id: 'SV-B-000002' }
    ];
    var summary = fn(results);
    expect(summary.okCount).toBe(2);
    expect(summary.failCount).toBe(0);
  });

  it('all failed: okCount is 0, failCount equals total', function () {
    var results = [
      { invoice_number: 'INV-001', ok: false, error: 'duplicate_so_number' },
      { invoice_number: 'INV-002', ok: false, error: 'some_error' }
    ];
    var summary = fn(results);
    expect(summary.okCount).toBe(0);
    expect(summary.failCount).toBe(2);
  });

  it('returns a message string', function () {
    var summary = fn([{ invoice_number: 'INV-001', ok: true, batch_id: 'SV-B-000001' }]);
    expect(typeof summary.message).toBe('string');
    expect(summary.message.length).toBeGreaterThan(0);
  });

  it('handles empty results array', function () {
    var summary = fn([]);
    expect(summary.okCount).toBe(0);
    expect(summary.failCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Pull from Zoho — isValidImportNumber (D-09)
// ---------------------------------------------------------------------------
describe('isValidImportNumber', function () {
  var fn = bp.isValidImportNumber;

  it('returns true for "INV-000123"', function () {
    expect(fn('INV-000123')).toBe(true);
  });

  it('returns true for "so-42" (case-insensitive)', function () {
    expect(fn('so-42')).toBe(true);
  });

  it('returns true for "SO-0001"', function () {
    expect(fn('SO-0001')).toBe(true);
  });

  it('returns true for "inv-1" (lowercase)', function () {
    expect(fn('inv-1')).toBe(true);
  });

  it('returns false for plain number "12345"', function () {
    expect(fn('12345')).toBe(false);
  });

  it('returns false for empty string', function () {
    expect(fn('')).toBe(false);
  });

  it('returns false for null', function () {
    expect(fn(null)).toBe(false);
  });

  it('returns false for "ORDER-123" (wrong prefix)', function () {
    expect(fn('ORDER-123')).toBe(false);
  });

  it('returns false for "INV-" (no digits)', function () {
    expect(fn('INV-')).toBe(false);
  });

  it('returns false for "INV-abc" (non-numeric suffix)', function () {
    expect(fn('INV-abc')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// filterBatchesByStatus — contract tests (guards Fix A: pending filter after Pull-from-Zoho)
// ---------------------------------------------------------------------------
describe('filterBatchesByStatus — pending filter contract', function () {
  var fn = bp.filterBatchesByStatus;

  var sampleBatches = [
    { batch_id: 'SV-B-000001', status: 'pending' },
    { batch_id: 'SV-B-000002', status: 'Primary' },
    { batch_id: 'SV-B-000003', status: 'secondary' },
    { batch_id: 'SV-B-000004', status: 'PENDING' },
    { batch_id: 'SV-B-000005', status: 'complete' }
  ];

  it('returns only pending batches (case-insensitive) when filter is "pending"', function () {
    var result = fn(sampleBatches, 'pending');
    expect(result.length).toBe(2);
    expect(result.map(function (b) { return b.batch_id; })).toEqual(['SV-B-000001', 'SV-B-000004']);
  });

  it('does not include active or complete batches in a "pending" filter', function () {
    var result = fn(sampleBatches, 'pending');
    var ids = result.map(function (b) { return b.batch_id; });
    expect(ids).not.toContain('SV-B-000002'); // Primary
    expect(ids).not.toContain('SV-B-000003'); // secondary
    expect(ids).not.toContain('SV-B-000005'); // complete
  });

  it('returns empty array when no batches match "pending"', function () {
    var activeBatches = [
      { batch_id: 'SV-B-000010', status: 'primary' },
      { batch_id: 'SV-B-000011', status: 'secondary' }
    ];
    var result = fn(activeBatches, 'pending');
    expect(result).toEqual([]);
  });

  it('returns empty array when input is empty', function () {
    var result = fn([], 'pending');
    expect(result).toEqual([]);
  });

  it('active filter includes primary and secondary but NOT pending', function () {
    var result = fn(sampleBatches, 'active');
    var ids = result.map(function (b) { return b.batch_id; });
    expect(ids).toContain('SV-B-000002'); // Primary
    expect(ids).toContain('SV-B-000003'); // secondary
    expect(ids).not.toContain('SV-B-000001'); // pending excluded
    expect(ids).not.toContain('SV-B-000004'); // PENDING excluded
  });
});

// ---------------------------------------------------------------------------
// eagerLoad partial-failure resilience — structural verification
// ---------------------------------------------------------------------------
// eagerLoad() is inside the IIFE and cannot be required from the outside.
// The fix wraps each adminApiGet call with a settle() helper so Promise.all
// never rejects on a partial failure. We verify the key structural elements:
//   1. A settle() wrapper function is present inside eagerLoad.
//   2. Each adminApiGet call is wrapped in settle().
//   3. The .catch() on Promise.all itself is gone (no longer needed).
//   4. Each result is guarded (if (rN)) before assignment.
describe('eagerLoad partial-failure resilience (structural)', function () {
  var fs = require('fs');
  var path = require('path');
  var src;
  beforeAll(function () {
    src = fs.readFileSync(path.join(__dirname, '../../js/brewpad.js'), 'utf8');
  });

  it('eagerLoad defines a settle() wrapper to absorb individual call rejections', function () {
    // settle wraps each promise to return null on rejection
    expect(src).toMatch(/function settle\(p\)/);
    expect(src).toMatch(/\.catch\(function\s*\(\)\s*\{\s*return null;\s*\}\)/);
  });

  it('all five adminApiGet calls in eagerLoad are wrapped in settle()', function () {
    // Extract the eagerLoad function body (from its declaration to the closing brace)
    var eagerMatch = src.match(/function eagerLoad\(\)[\s\S]*?^\s{2}\}/m);
    var body = eagerMatch ? eagerMatch[0] : '';
    // Expect settle() to wrap each of the 5 calls
    var settleWraps = (body.match(/settle\(adminApiGet\(/g) || []).length;
    expect(settleWraps).toBe(5);
  });

  it('each result slot is guarded with if(rN) before assignment', function () {
    // The fix uses r0..r4 with null-guards so partial results still apply
    expect(src).toMatch(/if\s*\(r0\)/);
    expect(src).toMatch(/if\s*\(r1\)/);
    expect(src).toMatch(/if\s*\(r2\)/);
    expect(src).toMatch(/if\s*\(r3\)/);
    expect(src).toMatch(/if\s*\(r4\)/);
  });

  it('falls back to loadDashboard() when core results (r0 and r1) both fail', function () {
    // The fallback path is guarded by: if (r0 || r1) { ... } else { loadDashboard(); ... }
    expect(src).toMatch(/if\s*\(r0\s*\|\|\s*r1\)/);
  });
});

// ---------------------------------------------------------------------------
// WR-02: openPullFromZohoSheet backdrop handler — structural verification
// ---------------------------------------------------------------------------
// WR-02 fix is a one-liner in openPullFromZohoSheet (brewpad.js ~line 2283):
//   sheet.removeEventListener('click', _pullSheetBackdropHandler); // added
//   sheet.addEventListener('click', _pullSheetBackdropHandler);
//
// openPullFromZohoSheet is inside the IIFE at line 305-6596 and cannot be required
// from the outside — DOM behaviour tests are infeasible without restructuring the IIFE.
// The fix is verified by code review and grep-checkable in source.
// See 29.3-REVIEW.md WR-02 and 29.3-HUMAN-UAT.md for manual verification steps.
describe('WR-02: _pullSheetBackdropHandler guard (structural)', function () {
  it('brewpad.js source contains removeEventListener guard before backdrop addEventListener', function () {
    var fs = require('fs');
    var path = require('path');
    var src = fs.readFileSync(path.join(__dirname, '../../js/brewpad.js'), 'utf8');
    // The fix must appear as removeEventListener(...) immediately before addEventListener(...)
    // for _pullSheetBackdropHandler within openPullFromZohoSheet.
    expect(src).toMatch(/removeEventListener\('click',\s*_pullSheetBackdropHandler\)[\s\S]{0,120}addEventListener\('click',\s*_pullSheetBackdropHandler\)/);
  });
});
