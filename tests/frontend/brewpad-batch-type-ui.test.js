'use strict';

// Phase 94-08 (B3, D-06/D-07): "Needs a type" chip + detail-pane Type select.

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
global.sessionStorage = global.localStorage;
global.SHEETS_CONFIG = {
  MIDDLEWARE_URL: 'http://mw.test',
  MW_API_KEY: 'k',
  SPREADSHEET_ID: 'id',
  GOOGLE_CLIENT_ID: 'cid',
  STAFF_EMAILS: 'a@b.c',
  API_BASE: 'https://script.google.com/test',
  SERVER_TOKEN: 't',
  ADMIN_API_URL: 'https://script.google.com/test/admin'
};

var _auth = require('../../js/lib/auth');
global.waitForGoogleIdentity = _auth.waitForGoogleIdentity;
global.gsiInitTokenClient = _auth.gsiInitTokenClient;
global.fetchGoogleUserInfo = _auth.fetchGoogleUserInfo;

var bp = require('../../js/brewpad');

function flush() {
  return new Promise(function (resolve) { setTimeout(resolve, 0); });
}

function dashRows() {
  return [
    { batch_id: 'A', batch_type: 'other', batch_type_source: 'other', status: 'primary' },
    { batch_id: 'B', batch_type: 'wine', batch_type_source: 'zoho', status: 'primary' },
    { batch_id: 'C', batch_type: 'other', batch_type_source: 'manual', status: 'primary' },
    { batch_id: 'D', batch_type: 'other', batch_type_source: 'other', status: 'disabled' }
  ];
}

function allBatches() {
  return ['A', 'B', 'C', 'D'].map(function (id) {
    return { batch_id: id, product_name: 'P' + id, status: id === 'D' ? 'disabled' : 'primary', zoho_so_number: 'INV-1' };
  });
}

function mountList(filter, dash, all) {
  document.body.innerHTML = '<div id="bp-batch-list-pane"></div>';
  bp._setStateForTest({
    _allBatchesData: all || allBatches(),
    _batchStatusFilter: filter || 'active',
    _batchesData: [],
    _dashData: dash === undefined ? { asOf: { today: '2026-10-27' }, batches: dashRows() } : dash
  });
  bp.applyBatchFilter();
  bp._renderBatchListForTest();
}

function chip() {
  return document.querySelector('.bp-filter-btn[data-status="needsType"]');
}

describe('Needs a type chip', function () {
  test('counts only non-manual, non-disabled other rows and lists them', function () {
    mountList('needsType');
    expect(chip().textContent).toBe('Needs a type (1)');
    expect(chip().querySelector('span')).toBeNull();
    var ids = bp.getStateForTest()._batchesData.map(function (b) { return b.batch_id; });
    expect(ids).toEqual(['A']);
  });

  test('shows (0) and the empty state when nothing needs a type', function () {
    mountList('needsType', { asOf: {}, batches: [] }, [{ batch_id: 'B', product_name: 'Wine X', batch_type: 'wine', status: 'primary' }]);
    expect(chip().textContent).toBe('Needs a type (0)');
    var empty = document.querySelector('#bp-batch-results .bp-empty');
    expect(empty.textContent).toBe('Every batch has a type.');
  });

  test('null _dashData falls back to effectiveBatchType for the count', function () {
    mountList('active', null, [
      { batch_id: 'X', product_name: 'Mystery', status: 'primary' },
      { batch_id: 'Y', product_name: 'Mystery 2', status: 'primary', batch_type: 'beer' }
    ]);
    expect(chip().textContent).toBe('Needs a type (1)');
  });

  test('persisted shell refreshes the count text after state changes', function () {
    mountList('active');
    expect(chip().textContent).toBe('Needs a type (1)');
    var d = bp.getStateForTest()._dashData;
    d.batches[0].batch_type_source = 'manual';
    bp._renderBatchListForTest();
    expect(chip().textContent).toBe('Needs a type (0)');
  });
});

describe('Detail-pane Type row', function () {
  function batch(extra) {
    return Object.assign({ batch_id: 'B1', product_name: 'Pale Ale', status: 'primary' }, extra || {});
  }
  function setup(b, dash) {
    document.body.innerHTML = '<div id="bp-batch-detail-pane"></div><div id="bp-toast-container"></div>';
    bp._setStateForTest({
      _dashData: dash === undefined ? { asOf: {}, batches: [{ batch_id: b.batch_id, batch_type: 'beer', batch_type_source: 'zoho', status: b.status }] } : dash
    });
    bp._renderBatchDetailForTest({ batch: b, tasks: [], plato_readings: [] });
  }
  function mockPost(result) {
    global.fetch.mockReset();
    global.fetch.mockImplementation(function (url, options) {
      if (options && options.method === 'POST') {
        return Promise.resolve(result);
      }
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ ok: true, data: {} }); } });
    });
  }
  function postCalls() {
    return global.fetch.mock.calls.filter(function (c) { return c[1] && c[1].method === 'POST'; });
  }

  test('renders ordered options, effective value and provenance hint', function () {
    setup(batch());
    var sel = document.getElementById('bp-detail-type');
    expect(sel.className).toBe('bp-select');
    expect(sel.getAttribute('aria-label')).toBe('Batch type');
    expect(Array.prototype.map.call(sel.options, function (o) { return o.value; })).toEqual(['wine', 'beer', 'cider', 'seltzer', 'other']);
    expect(Array.prototype.map.call(sel.options, function (o) { return o.textContent; })).toEqual(['Wine', 'Beer', 'Cider', 'Seltzer', 'Other']);
    expect(sel.value).toBe('beer');
    expect(document.getElementById('bp-detail-type-hint').textContent).toBe('Set automatically (Zoho product)');
  });

  test.each([
    ['recipe', 'Set automatically (recipe)'],
    ['schedule', 'Set automatically (schedule)'],
    ['name', 'Set automatically (product name)'],
    ['other', 'Not recognised, please choose'],
    ['manual', 'Set by hand']
  ])('hint for source %s', function (src, hint) {
    var b = batch();
    setup(b, { asOf: {}, batches: [{ batch_id: 'B1', batch_type: src === 'other' ? 'other' : 'cider', batch_type_source: src }] });
    expect(document.getElementById('bp-detail-type-hint').textContent).toBe(hint);
  });

  test('NULL source: fallback wine -> schedule hint; fallback other -> Not yet classified', function () {
    setup(batch({ schedule_category: 'wine' }), { asOf: {}, batches: [{ batch_id: 'B1', batch_type: null, batch_type_source: null }] });
    expect(document.getElementById('bp-detail-type').value).toBe('wine');
    expect(document.getElementById('bp-detail-type-hint').textContent).toBe('Set automatically (schedule)');
    setup(batch({ product_name: 'Mystery' }), { asOf: {}, batches: [{ batch_id: 'B1', batch_type: null, batch_type_source: null }] });
    expect(document.getElementById('bp-detail-type').value).toBe('other');
    expect(document.getElementById('bp-detail-type-hint').textContent).toBe('Not yet classified');
  });

  test('change saves via update_batch with nested updates, then shows Set by hand', async function () {
    setup(batch());
    mockPost({ ok: true, status: 200, json: function () { return Promise.resolve({ ok: true }); } });
    var sel = document.getElementById('bp-detail-type');
    sel.value = 'cider';
    sel.dispatchEvent(new Event('change'));
    expect(sel.disabled).toBe(true);
    await flush();
    await flush();
    var posts = postCalls();
    expect(posts.length).toBe(1);
    var body = JSON.parse(posts[0][1].body);
    expect(body.action).toBe('update_batch');
    expect(body.batch_id).toBe('B1');
    expect(body.updates).toEqual({ batch_type: 'cider' });
    expect(body.batch_type).toBeUndefined();
    expect(sel.disabled).toBe(false);
    expect(document.getElementById('bp-detail-type-hint').textContent).toBe('Set by hand');
    expect(document.getElementById('bp-toast-container').textContent).toContain('Type updated');
    var row = bp.getStateForTest()._dashData.batches[0];
    expect(row.batch_type).toBe('cider');
    expect(row.batch_type_source).toBe('manual');
  });

  test('server error reverts the select and shows the failure toast', async function () {
    setup(batch());
    mockPost({ ok: false, status: 400, json: function () { return Promise.resolve({ ok: false, error: 'invalid_input' }); } });
    var sel = document.getElementById('bp-detail-type');
    sel.value = 'cider';
    sel.dispatchEvent(new Event('change'));
    await flush();
    await flush();
    expect(sel.value).toBe('beer');
    expect(sel.disabled).toBe(false);
    expect(document.getElementById('bp-toast-container').textContent).toContain('Could not update type. Try again.');
    expect(bp.getStateForTest()._dashData.batches[0].batch_type).toBe('beer');
  });

  test('disabled batch renders plain text, no select', function () {
    setup(batch({ status: 'disabled' }), { asOf: {}, batches: [{ batch_id: 'B1', batch_type: 'beer', batch_type_source: 'zoho' }] });
    expect(document.getElementById('bp-detail-type')).toBeNull();
    expect(document.getElementById('bp-detail-type-text').textContent).toBe('Beer');
  });

  test('sheets mode (no aggregate) renders plain text, no select', function () {
    setup(batch({ schedule_category: 'beer' }), null);
    expect(document.getElementById('bp-detail-type')).toBeNull();
    expect(document.getElementById('bp-detail-type-text').textContent).toBe('Beer');
  });

  test('product name is escaped', function () {
    setup(batch({ product_name: '<img src=x onerror=alert(1)>' }));
    expect(document.querySelector('#bp-batch-detail-pane img')).toBeNull();
  });
});
