'use strict';

// Phase 90-06 Task 1: Unlinked filter chip, empty state, Internal badge.

global.google = { accounts: { oauth2: { initTokenClient: jest.fn() } } };
global.fetch = jest.fn(function () {
  return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ ok: true, data: {} }); } });
});
global.localStorage = {
  _data: {},
  getItem: function (k) { return this._data[k] || null; },
  setItem: function (k, v) { this._data[k] = v; },
  removeItem: function (k) { delete this._data[k]; },
  clear: function () { this._data = {}; }
};
var _ssData = {};
global.sessionStorage = {
  getItem: function (k) { return _ssData[k] !== undefined ? _ssData[k] : null; },
  setItem: function (k, v) { _ssData[k] = v; },
  removeItem: function (k) { delete _ssData[k]; },
  clear: function () { Object.keys(_ssData).forEach(function (k) { delete _ssData[k]; }); }
};

var _auth = require('../../js/lib/auth');
global.waitForGoogleIdentity = _auth.waitForGoogleIdentity;
global.gsiInitTokenClient = _auth.gsiInitTokenClient;
global.fetchGoogleUserInfo = _auth.fetchGoogleUserInfo;

var bp = require('../../js/brewpad');

describe('filterBatchesByUnlinked', function () {
  test('keeps blank-source legacy batches and manual complete batches with blank/whitespace invoice', function () {
    var rows = [
      { batch_id: 'a', zoho_so_number: '', source: '' },
      { batch_id: 'b', zoho_so_number: '  ', source: 'manual', status: 'complete' }
    ];
    expect(bp.filterBatchesByUnlinked(rows).map(function (r) { return r.batch_id; })).toEqual(['a', 'b']);
  });

  test('drops linked, internal, disabled and deleted batches', function () {
    var rows = [
      { batch_id: 'a', zoho_so_number: 'INV-1' },
      { batch_id: 'b', zoho_so_number: '', source: 'Internal' },
      { batch_id: 'c', zoho_so_number: '', status: 'disabled' },
      { batch_id: 'd', zoho_so_number: '', status: 'deleted' }
    ];
    expect(bp.filterBatchesByUnlinked(rows)).toEqual([]);
  });

  test('works across every status', function () {
    var rows = ['primary', 'secondary', 'complete', 'pending'].map(function (s, i) {
      return { batch_id: 'x' + i, zoho_so_number: '', status: s };
    });
    expect(bp.filterBatchesByUnlinked(rows).length).toBe(4);
  });

  test('null/undefined input gives []', function () {
    expect(bp.filterBatchesByUnlinked(null)).toEqual([]);
    expect(bp.filterBatchesByUnlinked(undefined)).toEqual([]);
  });
});

describe('isBatchSourceEditable / shouldShowInternalBadge', function () {
  test('editable only for blank, manual, internal', function () {
    ['', undefined, 'manual', ' Internal '].forEach(function (s) {
      expect(bp.isBatchSourceEditable(s)).toBe(true);
    });
    ['kiosk', 'kiosk_recipe', 'online', 'zoho_scan', 'research', 'foo'].forEach(function (s) {
      expect(bp.isBatchSourceEditable(s)).toBe(false);
    });
  });

  test('internal badge only for internal, case/space-insensitive', function () {
    expect(bp.shouldShowInternalBadge('internal')).toBe(true);
    expect(bp.shouldShowInternalBadge(' INTERNAL ')).toBe(true);
    expect(bp.shouldShowInternalBadge('manual')).toBe(false);
    expect(bp.shouldShowInternalBadge('')).toBe(false);
    expect(bp.shouldShowInternalBadge(undefined)).toBe(false);
  });
});

describe('Unlinked chip, filter and empty state', function () {
  function dataset() {
    return [
      { batch_id: 'SV-B-000001', product_name: 'Pale', status: 'primary', zoho_so_number: '', source: 'manual' },
      { batch_id: 'SV-B-000002', product_name: 'Stout', status: 'complete', zoho_so_number: '', source: '' },
      { batch_id: 'SV-B-000003', product_name: 'IPA', status: 'primary', zoho_so_number: 'INV-1', source: 'manual' },
      { batch_id: 'SV-B-000004', product_name: 'Lager', status: 'primary', zoho_so_number: '', source: 'internal' }
    ];
  }

  function mount(rows, filter) {
    document.body.innerHTML = '<div id="bp-batch-list-pane"></div>';
    bp._setStateForTest({ _allBatchesData: rows, _batchStatusFilter: filter || 'active', _batchesData: [] });
    bp.applyBatchFilter();
    bp._renderBatchListForTest();
  }

  test('chip shows the unlinked count', function () {
    mount(dataset());
    var chip = document.querySelector('.bp-filter-btn[data-status="unlinked"]');
    expect(chip).not.toBeNull();
    expect(chip.textContent).toBe('Unlinked (2)');
  });

  test('chip shows (0) when none are unlinked', function () {
    mount([{ batch_id: 'SV-B-000003', status: 'primary', zoho_so_number: 'INV-1', source: 'manual' }]);
    expect(document.querySelector('.bp-filter-btn[data-status="unlinked"]').textContent).toBe('Unlinked (0)');
  });

  test('selecting the chip leaves exactly the unlinked rows', function () {
    mount(dataset(), 'unlinked');
    var ids = bp.getStateForTest()._batchesData.map(function (b) { return b.batch_id; });
    expect(ids).toEqual(['SV-B-000001', 'SV-B-000002']);
    expect(document.querySelectorAll('.bp-batch-card').length).toBe(2);
  });

  test('empty Unlinked filter shows the all-linked message', function () {
    mount([{ batch_id: 'SV-B-000003', status: 'primary', zoho_so_number: 'INV-1' }], 'unlinked');
    var text = document.getElementById('bp-batch-results').textContent;
    expect(text).toContain('Every batch is linked');
    expect(text).toContain('Batches without an invoice are marked Internal.');
  });

  test('internal batch row carries the Internal badge', function () {
    mount(dataset(), 'all');
    var badges = document.querySelectorAll('.bp-source-badge--internal');
    expect(badges.length).toBe(1);
    expect(badges[0].textContent).toBe('Internal');
    expect(badges[0].closest('.bp-batch-card').getAttribute('data-batch-id')).toBe('SV-B-000004');
  });

  test('existing chips are unchanged', function () {
    mount(dataset());
    var labels = Array.prototype.map.call(document.querySelectorAll('.bp-filter-btn'), function (b) {
      return b.getAttribute('data-status');
    });
    expect(labels).toEqual(['pending', 'active', 'primary', 'secondary', 'complete', 'readyToBottle', 'unlinked']);
  });
});
