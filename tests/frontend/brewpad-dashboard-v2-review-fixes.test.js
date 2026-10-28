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
