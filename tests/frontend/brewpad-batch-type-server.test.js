'use strict';

// Phase 94 review WR-02: get_batch / get_batches now carry batch_type + batch_type_source. The
// detail Type control and the "Needs a type" worklist prefer them over the cached dashboard rows.

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

function renderDetail(b, dash) {
  document.body.innerHTML = '<div id="bp-batch-detail-pane"></div><div id="bp-toast-container"></div>';
  bp._setStateForTest({ _dashData: dash });
  bp._renderBatchDetailForTest({ batch: b, tasks: [], plato_readings: [] });
}

describe('detail Type control uses the server-provided type', function () {
  test('batch missing from the dashboard snapshot shows its server type and source', function () {
    renderDetail(
      { batch_id: 'NEW1', product_name: 'Mystery', status: 'primary', batch_type: 'cider', batch_type_source: 'recipe' },
      { asOf: {}, batches: [] }
    );
    expect(document.getElementById('bp-detail-type').value).toBe('cider');
    expect(document.getElementById('bp-detail-type-hint').textContent).toBe('Set automatically (recipe)');
  });

  test('a fresh get_batch (manual) wins over a stale dashboard row', function () {
    renderDetail(
      { batch_id: 'B1', product_name: 'Pale Ale', status: 'primary', batch_type: 'wine', batch_type_source: 'manual' },
      { asOf: {}, batches: [{ batch_id: 'B1', batch_type: 'beer', batch_type_source: 'zoho' }] }
    );
    expect(document.getElementById('bp-detail-type').value).toBe('wine');
    expect(document.getElementById('bp-detail-type-hint').textContent).toBe('Set by hand');
  });
});

describe('filterBatchesByNeedsType prefers the server type on the batch', function () {
  test('server type on the list row beats a stale overlay', function () {
    var batches = [
      { batch_id: 'a', status: 'primary', batch_type: 'beer', batch_type_source: 'recipe' },
      { batch_id: 'b', status: 'primary', batch_type: 'other', batch_type_source: 'other' }
    ];
    var overlay = {
      a: { batch_type: 'other', batch_type_source: 'other' },
      b: { batch_type: 'wine', batch_type_source: 'zoho' }
    };
    var out = bp.filterBatchesByNeedsType(batches, overlay, {});
    expect(out.map(function (x) { return x.batch_id; })).toEqual(['b']);
  });

  test('a new batch missing from the overlay is classified by its server type', function () {
    var batches = [{ batch_id: 'n', status: 'primary', product_name: 'Mystery', batch_type: 'seltzer', batch_type_source: 'name' }];
    expect(bp.filterBatchesByNeedsType(batches, {}, {})).toEqual([]);
  });
});
