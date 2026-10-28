'use strict';

// Phase 95-07 Task 1: dashboard click-through drill, banner and chip intersection (D-14).

global.google = { accounts: { oauth2: { initTokenClient: jest.fn() } } };
global.fetch = jest.fn();
global.sessionStorage = {
  _d: {},
  getItem: function (k) { return this._d[k] !== undefined ? this._d[k] : null; },
  setItem: function (k, v) { this._d[k] = v; },
  removeItem: function (k) { delete this._d[k]; },
  clear: function () { this._d = {}; }
};

var _auth = require('../../js/lib/auth');
global.waitForGoogleIdentity = _auth.waitForGoogleIdentity;
global.gsiInitTokenClient = _auth.gsiInitTokenClient;
global.fetchGoogleUserInfo = _auth.fetchGoogleUserInfo;

var bp = require('../../js/brewpad');

function rows() {
  return [
    { batch_id: 'A', product_name: 'PA', status: 'primary', zoho_so_number: '' },
    { batch_id: 'B', product_name: 'PB', status: 'primary', zoho_so_number: 'INV-1' },
    { batch_id: 'C', product_name: 'PC', status: 'complete', zoho_so_number: 'INV-2' }
  ];
}

function flush() { return new Promise(function (r) { setTimeout(r, 0); }); }

function cardIds() {
  return Array.prototype.map.call(document.querySelectorAll('.bp-batch-card'), function (c) {
    return c.getAttribute('data-batch-id');
  }).sort();
}

function mount() {
  document.body.innerHTML = '<div id="bp-panel-batches"><div id="bp-batch-list-pane"></div></div>' +
    '<div id="bp-dashboard-inner"><button class="bp-pipeline-tile" data-status="primary">x</button></div>';
  bp._setStateForTest({ _allBatchesData: rows(), _batchStatusFilter: 'active', _batchesData: [] });
  bp._clearDashDrillForTest();
}

beforeEach(function () {
  global.fetch.mockReset();
  mount();
});

afterEach(function () {
  bp._clearDashDrillForTest();
});

describe('openDashDrill', function () {
  test('shows exactly the id set with chip all and a status banner', function () {
    bp._openDashDrillForTest({ ids: ['A', 'C'], label: 'From dashboard: Wine started in Jun 2026 · 2 batches' });
    expect(cardIds()).toEqual(['A', 'C']);
    var st = bp.getStateForTest();
    expect(st._batchStatusFilter).toBe('all');
    expect(st._batchSearch).toBe('');
    expect(st._batchProductFilter).toBe('');
    var banner = document.querySelector('.bp-drill-banner');
    expect(banner.getAttribute('role')).toBe('status');
    expect(banner.textContent).toContain('From dashboard: Wine started in Jun 2026 · 2 batches');
    var close = banner.querySelector('button');
    expect(close.getAttribute('aria-label')).toBe('Clear dashboard filter');
    var slot = document.getElementById('bp-drill-banner-slot');
    var chips = document.querySelector('.bp-batch-filters');
    expect(slot.compareDocumentPosition(chips) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('a status chip narrows the set; banner count unchanged; heading shows visible count', async function () {
    bp._openDashDrillForTest({ ids: ['A', 'C'], label: 'L · 2 batches' });
    var btn = document.createElement('button');
    btn.setAttribute('data-status', 'active');
    await bp.selectBatchStatusFilter(btn);
    expect(cardIds()).toEqual(['A']);
    expect(bp.getStateForTest()._dashDrill.count).toBe(2);
    expect(document.querySelector('.bp-drill-heading').textContent).toBe('1 batch shown');
  });

  test('clear restores the normal active list and removes the banner', function () {
    bp._openDashDrillForTest({ ids: ['C'], label: 'L' });
    bp._clearDashDrillForTest();
    var st = bp.getStateForTest();
    expect(st._dashDrill).toBeNull();
    expect(st._batchStatusFilter).toBe('active');
    expect(cardIds()).toEqual(['A', 'B']);
    expect(document.querySelector('.bp-drill-banner')).toBeNull();
  });

  test('close button click clears the drill via delegation', function () {
    bp._initDelegationForTest();
    bp._openDashDrillForTest({ ids: ['C'], label: 'L' });
    document.querySelector('.bp-drill-banner-close').click();
    expect(bp.getStateForTest()._dashDrill).toBeNull();
    expect(cardIds()).toEqual(['A', 'B']);
  });

  test('empty intersection shows the empty message and a dismissible banner', function () {
    bp._openDashDrillForTest({ ids: ['ZZ'], label: 'L' });
    expect(document.querySelector('#bp-batch-results .bp-empty').textContent).toBe('No batches in this set any more.');
    expect(document.querySelector('.bp-drill-banner-close')).not.toBeNull();
  });

  test('emptied cache path refetches, then shows the intersection', async function () {
    bp._setStateForTest({ _allBatchesData: [] });
    global.fetch.mockImplementation(function () {
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ ok: true, data: { batches: rows() } }); } });
    });
    bp._openDashDrillForTest({ ids: ['A', 'C'], label: 'L' });
    await flush();
    await flush();
    expect(global.fetch).toHaveBeenCalled();
    expect(cardIds()).toEqual(['A', 'C']);
  });

  test('a v1 pipeline tile click clears the drill', function () {
    bp._initDelegationForTest();
    bp._openDashDrillForTest({ ids: ['A'], label: 'L' });
    document.querySelector('.bp-pipeline-tile').click();
    expect(bp.getStateForTest()._dashDrill).toBeNull();
  });

  test('unlinked chip intersects with the drill set', function () {
    bp._openDashDrillForTest({ ids: ['A', 'B'], label: 'L' });
    bp._setStateForTest({ _batchStatusFilter: 'unlinked' });
    bp.applyBatchFilter();
    expect(bp.getStateForTest()._batchesData.map(function (b) { return b.batch_id; })).toEqual(['A']);
  });

  test('needsType chip intersects with the drill set', function () {
    bp._openDashDrillForTest({ ids: ['A'], label: 'L' });
    bp._setStateForTest({ _batchStatusFilter: 'needsType' });
    bp.applyBatchFilter();
    var ids = bp.getStateForTest()._batchesData.map(function (b) { return b.batch_id; });
    expect(ids.every(function (id) { return id === 'A'; })).toBe(true);
  });

  test('label is escaped, not parsed as HTML', function () {
    bp._openDashDrillForTest({ ids: ['A'], label: '<b>bold</b> · 1 batch' });
    var text = document.querySelector('.bp-drill-banner-text');
    expect(text.querySelector('b')).toBeNull();
    expect(text.textContent).toBe('<b>bold</b> · 1 batch');
  });
});
