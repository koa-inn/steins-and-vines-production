'use strict';

// Phase 95 code review fixes (95-REVIEW.md WR-01..WR-06, IN-01): regression tests.

global.google = { accounts: { oauth2: { initTokenClient: jest.fn() } } };
global.fetch = jest.fn();
global.sessionStorage = {
  _d: {},
  getItem: function (k) { return this._d[k] !== undefined ? this._d[k] : null; },
  setItem: function (k, v) { this._d[k] = v; },
  removeItem: function (k) { delete this._d[k]; },
  clear: function () { this._d = {}; }
};
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

function flush() { return new Promise(function (r) { setTimeout(r, 0); }); }

function jsonResponse(data, status) {
  return Promise.resolve({
    ok: (status || 200) === 200,
    status: status || 200,
    json: function () { return Promise.resolve(data); }
  });
}

function cardIds() {
  return Array.prototype.map.call(document.querySelectorAll('.bp-batch-card'), function (c) {
    return c.getAttribute('data-batch-id');
  }).sort();
}

beforeEach(function () {
  global.fetch.mockReset();
  window.localStorage.clear();
});

describe('WR-01: bulk create from the pull sheet clears an active dashboard drill', function () {
  afterEach(function () { bp._clearDashDrillForTest(); });

  test('the new pending batches show and the drill is gone', async function () {
    document.body.innerHTML = '<div id="bp-panel-batches"><div id="bp-batch-list-pane"></div></div>' +
      '<div id="bp-toast-container"></div>' +
      '<div id="bp-pull-sheet"><div id="bp-pull-sheet-inner"></div></div>';
    bp._setStateForTest({
      _allBatchesData: [
        { batch_id: 'A', product_name: 'PA', status: 'primary' },
        { batch_id: 'B', product_name: 'PB', status: 'complete' }
      ],
      _batchStatusFilter: 'active',
      _batchesData: []
    });
    bp._openDashDrillForTest({ ids: ['A', 'B'], label: 'From dashboard: Wine started · 2 batches' });
    expect(bp.getStateForTest()._dashDrill).not.toBeNull();

    global.fetch.mockImplementation(function (url) {
      if (/bulk-create/.test(url)) return jsonResponse({ results: [{ ok: true }] });
      return jsonResponse({ ok: true, data: { batches: [
        { batch_id: 'A', product_name: 'PA', status: 'primary' },
        { batch_id: 'B', product_name: 'PB', status: 'complete' },
        { batch_id: 'NEW', product_name: 'PN', status: 'pending' }
      ] } });
    });

    bp._renderPullCandidatesForTest([{ invoice_id: 'i1', invoice_number: 'INV-1', customer_name: 'C', kit_items: [] }]);
    document.getElementById('bp-pull-create-btn').click();
    for (var i = 0; i < 6; i++) await flush();

    var st = bp.getStateForTest();
    expect(st._dashDrill).toBeNull();
    expect(st._batchStatusFilter).toBe('pending');
    expect(cardIds()).toEqual(['NEW']);
    expect(document.querySelector('.bp-drill-banner')).toBeNull();
  });
});

function lean(id, start, extra) {
  return Object.assign({
    batch_id: id, status: 'primary', batch_type: 'wine', batch_type_source: 'recipe',
    start_date: start, completed_day: null, completed_at: null, completed_at_source: null,
    vessel_id: null, source: 'kiosk', product_sku: '', product_name: '', product_subcategory: '',
    product_brand: '', product_manufacturer: '', recipe_id: '', schedule_id: '',
    schedule_category: '', target_volume_l: 20, tasks_total: 0, tasks_done: 0
  }, extra || {});
}

describe('WR-03: v2 never renders zero tiles when no data source is loaded', function () {
  var TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' });

  function mountV2() {
    document.body.innerHTML = '<div id="bp-dashboard-inner"></div><div id="bp-toast-container"></div>';
    bp._setDashV2ForTest(true);
  }

  afterEach(function () { bp._setDashV2ForTest(false); });

  test('shows a skeleton, loads the batch list, then renders real numbers', async function () {
    var resolveBatches;
    global.fetch.mockImplementation(function () {
      return new Promise(function (r) { resolveBatches = r; });
    });
    bp._setStateForTest({ _dashData: null, _allBatchesData: [], _batchesLoaded: false, _dashWineSkuLookup: {} });
    mountV2();
    bp._renderDashboardV2ForTest();

    var tiles = document.getElementById('bp-dash-v2-tiles');
    expect(tiles.querySelector('.bp-skeleton-block')).not.toBeNull();
    expect(tiles.textContent).not.toMatch(/Fermenting now/);
    expect(bp.getStateForTest()._dashV2Model).toBeNull();
    expect(document.querySelector('[data-dash-ctl="type"]')).not.toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    resolveBatches({
      ok: true, status: 200,
      json: function () {
        return Promise.resolve({ ok: true, data: { batches: [
          { batch_id: 'R1', status: 'primary', start_date: TODAY, product_name: 'Merlot', source: 'kiosk' }
        ] } });
      }
    });
    for (var i = 0; i < 6; i++) await flush();

    tiles = document.getElementById('bp-dash-v2-tiles');
    expect(tiles.querySelector('.bp-skeleton-block')).toBeNull();
    expect(tiles.textContent).toMatch(/Fermenting now/);
    expect(bp.getStateForTest()._dashV2Model.cur.activeNow).toBe(1);
  });

  test('a failed load says so instead of showing zeros', async function () {
    global.fetch.mockImplementation(function () { return jsonResponse({ ok: false, message: 'down' }, 500); });
    bp._setStateForTest({ _dashData: null, _allBatchesData: [], _batchesLoaded: false });
    mountV2();
    bp._renderDashboardV2ForTest();
    for (var i = 0; i < 10; i++) await flush();
    var tiles = document.getElementById('bp-dash-v2-tiles');
    expect(tiles.textContent).not.toMatch(/Fermenting now/);
    expect(tiles.textContent).toMatch(/could not load/i);
  });

  test('fallback mode: the staff tick updates the list row before the dashboard refresh', async function () {
    var row = {
      batch_id: 'S1', status: 'primary', start_date: TODAY, product_name: 'Merlot', source: 'kiosk',
      batch_type: 'wine', batch_type_source: 'manual', staff_batch: false
    };
    bp._setStateForTest({ _dashData: null, _allBatchesData: [row], _batchesLoaded: true });
    mountV2();
    bp._renderDashboardV2ForTest();
    expect(bp.getStateForTest()._dashV2Model.cur.mix.staffHidden).toBe(0);
    global.fetch.mockImplementation(function (url, options) {
      if (options && options.method === 'POST' && /update_batch/.test(options.body)) {
        return jsonResponse({ ok: true });
      }
      return new Promise(function () {});
    });
    await bp._setStaffBatchForTest('S1', true);
    // Staff batches are hidden from the mix by default, so the refreshed model drops S1 from it.
    var m = bp.getStateForTest()._dashV2Model;
    expect(m.cur.mix.staffHidden).toBe(1);
    expect(m.cur.mix.wine.length).toBe(0);
    expect(row.staff_batch).toBe(true);
  });
});

describe('WR-06: the filter bar follows a phone/tablet width change', function () {
  var TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' });
  var phone = false;
  var listeners = [];

  beforeEach(function () {
    phone = false;
    listeners = [];
    window.matchMedia = function (q) {
      return {
        get matches() { return phone && q.indexOf('600') !== -1; },
        addEventListener: function (type, fn) { if (q.indexOf('600') !== -1) listeners.push(fn); },
        removeEventListener: function () {}
      };
    };
  });

  afterEach(function () {
    delete window.matchMedia;
    bp._setDashV2ForTest(false);
  });

  function flip(on) {
    phone = on;
    listeners.forEach(function (fn) { fn({ matches: on }); });
  }

  test('rebuilds the bar and closes an open sheet when the width crosses 600px', function () {
    document.body.innerHTML = '<div id="bp-dashboard-inner"></div>';
    bp._setStateForTest({
      _dashData: { asOf: { today: TODAY, year: +TODAY.slice(0, 4), tz: 'America/Vancouver' }, batches: [lean('A', TODAY)], staffBatchIds: [] },
      _allBatchesData: [],
      _dashWineSkuLookup: {}
    });
    bp._setDashV2ForTest(true);
    bp._renderDashboardV2ForTest();
    var bar = document.getElementById('bp-dash-filters');
    expect(bar.getAttribute('data-mode')).toBe('tablet');
    expect(listeners.length).toBe(1);

    flip(true);
    expect(bar.getAttribute('data-mode')).toBe('phone');
    expect(bar.querySelector('[data-dash-open-sheet]')).not.toBeNull();

    bar.querySelector('[data-dash-open-sheet]').click();
    expect(document.getElementById('bp-dash-sheet')).not.toBeNull();

    flip(false);
    expect(bar.getAttribute('data-mode')).toBe('tablet');
    expect(document.getElementById('bp-dash-sheet')).toBeNull();
    expect(bar.querySelector('[data-dash-ctl="type"]')).not.toBeNull();

    // A second render does not register a second listener.
    bp._renderDashboardV2ForTest();
    expect(listeners.length).toBe(1);
  });
});

describe('WR-02: a custom range past the aggregate asOf day is clamped and labelled honestly', function () {
  var ASOF = { today: '2026-10-28', year: 2026, tz: 'America/Vancouver' };
  var ROWS = [lean('A', '2026-10-02'), lean('B', '2026-03-01'), lean('C', '2025-06-01')];

  test('to is one day after asOf.today: window ends on asOf.today, label matches the window', function () {
    var st = bp.sanitizeDashFilters({ period: 'custom', from: '2026-10-01', to: '2026-10-29' }, '2026-10-29');
    expect(st.period).toBe('custom');
    var m = bp.buildDashV2Model(ROWS, ASOF, st, {}, {});
    expect(m.win).toEqual({ key: 'custom', start: '2026-10-01', end: '2026-10-28' });
    expect(m.periodLabel).toBe('Oct 1 – Oct 28');
    expect(m.cur.started).toBe(1);
  });

  test('a range wholly after asOf.today falls back to YTD and says YTD', function () {
    var st = bp.sanitizeDashFilters({ period: 'custom', from: '2026-10-29', to: '2026-10-29' }, '2026-10-29');
    var m = bp.buildDashV2Model(ROWS, ASOF, st, {}, {});
    expect(m.win.key).toBe('ytd');
    expect(m.periodLabel).toBe('YTD');
  });

  test('an in-range custom window is unchanged', function () {
    var st = bp.sanitizeDashFilters({ period: 'custom', from: '2026-06-01', to: '2026-06-30' }, '2026-10-29');
    var m = bp.buildDashV2Model(ROWS, ASOF, st, {}, {});
    expect(m.win).toEqual({ key: 'custom', start: '2026-06-01', end: '2026-06-30' });
    expect(m.periodLabel).toBe('Jun 1 – Jun 30');
  });
});
