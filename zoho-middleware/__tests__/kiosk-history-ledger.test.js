'use strict';

jest.mock('../lib/zoho-api', function () { return { zohoGet: jest.fn(), zohoPost: jest.fn(), zohoPut: jest.fn() }; });
jest.mock('../lib/cache', function () { return {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  isConnected: jest.fn().mockReturnValue(true)
}; });
jest.mock('../lib/logger', function () { return { info: jest.fn(), warn: jest.fn(), error: jest.fn() }; });

var _routeRegistry = { get: [] };
jest.mock('express', function () {
  var router = {
    get: jest.fn(function (path, handler) { _routeRegistry.get.push({ path: path, handler: handler }); }),
    post: jest.fn(), put: jest.fn(), delete: jest.fn(), patch: jest.fn()
  };
  var express = function () {};
  express.Router = function () { return router; };
  return express;
});

var zohoApi = require('../lib/zoho-api');
var cache = require('../lib/cache');
var log = require('../lib/logger');
var C = require('../lib/constants');
var hist = require('../lib/kiosk-history');
var authTiers = require('../lib/authTiers');
var router = require('../routes/kiosk-history');
var fixture = require('./fixtures/zoho-past-sales-shapes.json');

function findHandler(path) {
  for (var i = 0; i < _routeRegistry.get.length; i++) {
    if (_routeRegistry.get[i].path === path) return _routeRegistry.get[i].handler;
  }
  throw new Error('No GET handler for ' + path);
}
function makeReq(query, headers) { return { body: {}, query: query || {}, headers: headers || {} }; }
function makeRes() {
  var res = { _status: null, _json: null, headersSent: false };
  res.status = jest.fn(function (c) { res._status = c; return res; });
  res.json = jest.fn(function (d) { res._json = d; res.headersSent = true; return res; });
  return res;
}
function flushPromises() { return new Promise(function (r) { setImmediate(r); }); }
async function settle() { for (var i = 0; i < 10; i++) { await flushPromises(); } }

describe('authTiers past-sales registration', function () {
  test('KIOSK_ROUTES lists the past-sales paths', function () {
    expect(authTiers.KIOSK_ROUTES).toEqual(expect.arrayContaining([
      '/api/kiosk/past-sales/ledger', '/api/kiosk/past-sales/customer', '/api/kiosk/past-sales/invoice/:id'
    ]));
  });
  test('isKioskRoute', function () {
    expect(authTiers.isKioskRoute('/api/kiosk/past-sales/invoice/123456789')).toBe(true);
    expect(authTiers.isKioskRoute('/api/kiosk/past-sales/ledger')).toBe(true);
    expect(authTiers.isKioskRoute('/api/kiosk/past-sales/other')).toBe(false);
    expect(authTiers.isKioskRoute('/api/invoices')).toBe(false);
  });
});

describe('indexPaymentsByInvoice', function () {
  test('fixture invoice_numbers linkage with description notes', function () {
    var idx = hist.indexPaymentsByInvoice(fixture.customerpayments_list.customerpayments, fixture._meta.linkage_field, fixture._meta.notes_field);
    expect(idx['INV-900001']).toEqual([{ payment_mode: 'creditcard', note: '' }]);
    expect(idx['INV-900002'][0].note).toBe('Kiosk POS terminal payment.');
  });
  test('comma string splits to several invoices; no linkage yields {}', function () {
    var idx = hist.indexPaymentsByInvoice([{ invoice_numbers: 'INV-1, INV-2', payment_mode: 'cash', description: 'x' }, { payment_mode: 'cash' }], 'invoice_numbers', 'description');
    expect(Object.keys(idx).sort()).toEqual(['INV-1', 'INV-2']);
    expect(hist.indexPaymentsByInvoice([{ payment_mode: 'cash' }], 'invoice_numbers', 'description')).toEqual({});
  });
  test('invoices[] array linkage', function () {
    var idx = hist.indexPaymentsByInvoice([{ invoices: [{ invoice_id: 7, invoice_number: 'INV-7' }], payment_mode: 'cash', notes: 'n' }], 'invoices', 'notes');
    expect(idx['7']).toEqual([{ payment_mode: 'cash', note: 'n' }]);
    expect(idx['INV-7']).toHaveLength(1);
  });
});

describe('validateConfig', function () {
  test('accepts and rejects', function () {
    expect(function () { router.validateConfig({ joinMode: 'list-join' }); }).not.toThrow();
    expect(function () { router.validateConfig({ joinMode: 'bogus' }); }).toThrow();
    expect(function () { router.validateConfig({ joinMode: 'none', noneBlankPolicy: null }); }).toThrow();
    expect(function () { router.validateConfig({ joinMode: 'none', noneBlankPolicy: 'exclude' }); }).not.toThrow();
  });
  test('shipped config is list-join', function () {
    expect(router._config.joinMode).toBe('list-join');
  });
});
