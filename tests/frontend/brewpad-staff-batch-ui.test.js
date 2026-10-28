'use strict';

// Phase 95-07 Task 2: Staff batch checkbox in the detail pane + setStaffBatch (D-08, D-10).

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

var TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' });
var YEAR = +TODAY.slice(0, 4);

function lean(id, type, start) {
  return {
    batch_id: id, status: 'primary', batch_type: type, batch_type_source: 'recipe',
    start_date: start, completed_day: null, completed_at: null, completed_at_source: null,
    vessel_id: null, source: 'kiosk', product_sku: '', product_name: '', product_subcategory: '',
    product_brand: '', product_manufacturer: '', recipe_id: '', schedule_id: '',
    schedule_category: '', target_volume_l: 20, tasks_total: 0, tasks_done: 0
  };
}

function batch(extra) {
  return Object.assign({ batch_id: 'W', product_name: 'Merlot', status: 'primary', source: 'manual', staff_batch: false }, extra || {});
}

function dash() {
  return {
    asOf: { today: TODAY, year: YEAR, tz: 'America/Vancouver' },
    batches: [lean('W', 'wine', YEAR + '-01-02'), lean('X', 'wine', YEAR + '-01-03')],
    staffBatchIds: []
  };
}

function setup(b, d) {
  document.body.innerHTML = '<div id="bp-batch-detail-pane"></div><div id="bp-toast-container"></div>';
  bp._setStateForTest({ _dashData: d === undefined ? dash() : d, _allBatchesData: [] });
  bp._renderBatchDetailForTest({ batch: b, tasks: [], plato_readings: [] });
}

function mockPost(ok) {
  global.fetch.mockReset();
  global.fetch.mockImplementation(function (url, options) {
    if (options && options.method === 'POST') {
      return Promise.resolve({ ok: ok, status: ok ? 200 : 400, json: function () { return Promise.resolve({ ok: ok }); } });
    }
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ ok: true, data: {} }); } });
  });
}

function posts() {
  return global.fetch.mock.calls.filter(function (c) { return c[1] && c[1].method === 'POST'; });
}

function hint() {
  var el = document.getElementById('bp-detail-staff-hint');
  return el ? el.textContent : null;
}

beforeEach(function () {
  global.fetch.mockReset();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/brewpad.html');
});

describe('Staff batch row rendering', function () {
  test('sits directly after the Type row with label, checked box, text', function () {
    setup(batch({ staff_batch: true, source: 'internal' }));
    var rows = document.querySelectorAll('.bp-detail-info-row');
    var labels = Array.prototype.map.call(rows, function (r) { return r.querySelector('.bp-detail-info-label').textContent; });
    expect(labels.indexOf('Staff batch')).toBe(labels.indexOf('Type') + 1);
    var box = document.getElementById('bp-detail-staff');
    expect(box.type).toBe('checkbox');
    expect(box.checked).toBe(true);
    expect(box.closest('.bp-detail-info-row').textContent).toContain('Staff, family or R&D (hidden from mix charts)');
    expect(hint()).toBe('Set automatically (internal batch)');
  });

  test('research source hint, other source is Set by hand, false has no hint', function () {
    setup(batch({ staff_batch: true, source: 'research' }));
    expect(hint()).toBe('Set automatically (research batch)');
    setup(batch({ staff_batch: true, source: 'manual' }));
    expect(hint()).toBe('Set by hand');
    setup(batch({ staff_batch: false, source: 'internal' }));
    expect(hint()).toBeNull();
    expect(document.getElementById('bp-detail-staff').checked).toBe(false);
  });

  test('deleted or disabled batches show plain Yes/No without a checkbox', function () {
    setup(batch({ status: 'disabled', staff_batch: true }));
    expect(document.getElementById('bp-detail-staff')).toBeNull();
    expect(document.getElementById('bp-detail-staff-text').textContent).toBe('Yes');
    setup(batch({ status: 'deleted' }));
    expect(document.getElementById('bp-detail-staff-text').textContent).toBe('No');
  });
});

describe('Staff batch toggle', function () {
  test('posts nested updates, disables while in flight, toasts, updates staff ids', async function () {
    setup(batch());
    mockPost(true);
    var box = document.getElementById('bp-detail-staff');
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(box.disabled).toBe(true);
    await flush();
    await flush();
    var p = posts();
    expect(p.length).toBe(1);
    var body = JSON.parse(p[0][1].body);
    expect(body.action).toBe('update_batch');
    expect(body.batch_id).toBe('W');
    expect(body.updates).toEqual({ staff_batch: true });
    expect(body.staff_batch).toBeUndefined();
    expect(document.getElementById('bp-toast-container').textContent).toContain('Staff flag updated');
    expect(bp.getStateForTest()._dashData.staffBatchIds).toEqual(['W']);
  });

  test('unticking removes the id', async function () {
    var d = dash();
    d.staffBatchIds = ['W'];
    setup(batch({ staff_batch: true }), d);
    mockPost(true);
    var box = document.getElementById('bp-detail-staff');
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    await flush();
    await flush();
    expect(JSON.parse(posts()[0][1].body).updates).toEqual({ staff_batch: false });
    expect(bp.getStateForTest()._dashData.staffBatchIds).toEqual([]);
  });

  test('failure reverts the checkbox, re-enables it and shows the error toast', async function () {
    setup(batch());
    mockPost(false);
    var box = document.getElementById('bp-detail-staff');
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    await flush();
    await flush();
    expect(box.checked).toBe(false);
    expect(box.disabled).toBe(false);
    expect(document.getElementById('bp-toast-container').textContent).toContain('Could not update staff flag. Try again.');
    expect(bp.getStateForTest()._dashData.staffBatchIds).toEqual([]);
  });

  describe('v2 dashboard refresh', function () {
    function renderV2() {
      window.history.replaceState(null, '', '/brewpad.html?dash=v2');
      document.body.insertAdjacentHTML('afterbegin', '<div><button type="button" id="bp-dash-switch" hidden></button></div><div id="bp-dashboard-inner"></div>');
      bp._initDashV2FlagForTest();
      bp._setStateForTest({ _dashSummary: {}, _dashWineSkuLookup: {} });
      bp._renderDashboardForTest();
    }

    test('ticking a started-in-window wine batch removes it from the mix; unticking restores it', async function () {
      setup(batch());
      renderV2();
      var ids = function () { return bp.getStateForTest()._dashV2Model.cur.mix.wine.map(function (r) { return r.batch_id; }).sort(); };
      expect(ids()).toEqual(['W', 'X']);
      var hiddenBefore = bp.getStateForTest()._dashV2Model.cur.mix.staffHidden;
      mockPost(true);
      var box = document.getElementById('bp-detail-staff');
      box.checked = true;
      box.dispatchEvent(new Event('change'));
      await flush();
      await flush();
      expect(ids()).toEqual(['X']);
      expect(bp.getStateForTest()._dashV2Model.cur.mix.staffHidden).toBe(hiddenBefore + 1);

      // re-render detail (afterBatchWrite may have refreshed it) and untick
      bp._renderBatchDetailForTest({ batch: batch({ staff_batch: true }), tasks: [], plato_readings: [] });
      var box2 = document.getElementById('bp-detail-staff');
      box2.checked = false;
      box2.dispatchEvent(new Event('change'));
      await flush();
      await flush();
      expect(ids()).toEqual(['W', 'X']);
    });

    test('with v2 off the dashboard model is not rebuilt', async function () {
      setup(batch());
      bp._setStateForTest({ _dashSummary: {} });
      window.history.replaceState(null, '', '/brewpad.html?dash=v1');
      bp._initDashV2FlagForTest();
      var before = bp.getStateForTest()._dashV2Model;
      mockPost(true);
      var box = document.getElementById('bp-detail-staff');
      box.checked = true;
      box.dispatchEvent(new Event('change'));
      await flush();
      await flush();
      expect(bp.getStateForTest()._dashV2Model).toBe(before);
    });
  });
});
