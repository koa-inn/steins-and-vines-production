'use strict';

// ---------------------------------------------------------------------------
// pos-client-error-itemid.test.js — 57-04 (server half of 57-DIAGNOSIS beacon
// finding 2)
//
// POST /api/kiosk/client-error's scrubClientErrorText redacts any 13-19 digit
// run in `message` as a PAN-shape heuristic. Zoho item_ids are 18-19 digits,
// so the one 2026-07-15 kiosk error ("Item not found in current catalog:
// 1099000000000109115") would have been logged as
// "...current catalog: [REDACTED]." had the beacon captured it — destroying
// the one field that made the diagnosis possible.
//
// This suite proves the fix is a NEW, narrowly-validated `item_id` field
// (not a weakening of the message redaction): a value shaped like a real
// Zoho item_id (15-19 digits, digits only) is stored un-redacted; anything
// else is omitted entirely (never passed through un-validated — that would
// be a PAN-smuggling hole, T-57-04-03). The free-text `message` field must
// keep its full PAN redaction unchanged.
//
// Harness mirrors pos-client-error.test.js exactly (do NOT edit that file —
// its own 8 tests must remain green and unedited per the plan).
// ---------------------------------------------------------------------------

jest.mock('express', function () {
  var router = { get: jest.fn(), post: jest.fn(), put: jest.fn() };
  var express = function () {};
  express.Router = function () { return router; };
  express.json = function () { return function () {}; };
  return express;
});

jest.mock('../lib/sentry-capture', function () {
  return { captureExceptionSafe: jest.fn() };
});

jest.mock('../lib/logger', function () {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
});

// Load-time deps pos.js requires — mocked so requiring the router doesn't reach
// the network / Redis. Mirrors pos-client-error.test.js's roster.
jest.mock('../lib/helcim', function () {
  return {
    isTerminalEnabled: jest.fn(function () { return false; }),
    generateIdempotencyKey: jest.fn(function () { return 'idem'; })
  };
});
jest.mock('../lib/zoho-api', function () {
  return { zohoGet: jest.fn(), zohoPost: jest.fn() };
});
jest.mock('../lib/cache', function () {
  return {
    get: jest.fn(function () { return Promise.resolve(null); }),
    set: jest.fn(function () { return Promise.resolve(); }),
    del: jest.fn(function () { return Promise.resolve(); }),
    getClient: jest.fn(function () { return Promise.resolve(null); }),
    acquireLock: jest.fn(function () { return Promise.resolve(true); })
  };
});
jest.mock('../lib/eventLog', function () { return { logEvent: jest.fn() }; });
jest.mock('../lib/mailer', function () { return { sendVoidFailureAlert: jest.fn() }; });
jest.mock('../lib/inventory-ledger', function () {
  return { overlayStock: jest.fn(function (i) { return Promise.resolve(i); }), decrementStock: jest.fn() };
});
// 57-04: pos.js now requires routes/catalog.js (for rebuildKioskCatalog).
// Mock it so this test file doesn't have to satisfy catalog.js's own
// dependency surface (fs / authTiers / etc).
jest.mock('../routes/catalog', function () {
  return { rebuildKioskCatalog: jest.fn() };
});

describe('POST /api/kiosk/client-error — validated item_id field (57-04)', function () {
  var handler, capture, log;

  function loadHandler() {
    jest.resetModules();
    require('../routes/pos');
    // Re-require AFTER resetModules so we hold the same mock instances pos.js uses.
    capture = require('../lib/sentry-capture');
    log = require('../lib/logger');
    var router = require('express').Router();
    var found = null;
    router.post.mock.calls.forEach(function (call) {
      if (call[0] === '/api/kiosk/client-error') found = call[call.length - 1];
    });
    return found;
  }

  function mockRes() {
    var res = { statusCode: null, ended: false };
    res.status = jest.fn(function (c) { res.statusCode = c; return res; });
    res.end = jest.fn(function () { res.ended = true; return res; });
    res.json = jest.fn(function () { return res; });
    return res;
  }

  beforeEach(function () {
    handler = loadHandler();
    capture.captureExceptionSafe.mockClear();
    log.warn.mockClear();
  });

  test('Test A: a valid Zoho-shaped item_id is stored un-redacted as a tag', function () {
    var res = mockRes();
    handler({ body: {
      message: 'Item not found in current catalog: 1099000000000109115.',
      endpoint: '/api/kiosk/sale',
      auth_state: 'device-token',
      item_id: '1099000000000109115'
    } }, res);

    expect(res.statusCode).toBe(204);
    var args = capture.captureExceptionSafe.mock.calls[0];
    expect(args[1].tags.item_id).toBe('1099000000000109115');
  });

  test('Test B1: a value failing the Zoho-id shape (16-digit card-like) is omitted, not passed through', function () {
    var res = mockRes();
    handler({ body: {
      message: 'boom',
      endpoint: '/api/kiosk/sale',
      auth_state: 'device-token',
      item_id: '4111111111111111' // 16 digits, card-shaped — must NOT be trusted as an item_id
    } }, res);

    var args = capture.captureExceptionSafe.mock.calls[0];
    expect(args[1].tags.item_id).toBeUndefined();
    var serialized = JSON.stringify(args);
    expect(serialized).not.toContain('4111111111111111');
  });

  test('Test B2: a non-digit item_id is omitted, not passed through', function () {
    var res = mockRes();
    handler({ body: {
      message: 'boom',
      endpoint: '/api/kiosk/sale',
      auth_state: 'device-token',
      item_id: '<script>alert(1)</script>'
    } }, res);

    var args = capture.captureExceptionSafe.mock.calls[0];
    expect(args[1].tags.item_id).toBeUndefined();
  });

  test('Test B3: item_id absent entirely — no tag, no crash', function () {
    var res = mockRes();
    expect(function () {
      handler({ body: { message: 'boom', endpoint: '/api/kiosk/sale', auth_state: 'none' } }, res);
    }).not.toThrow();
    expect(res.statusCode).toBe(204);
    var args = capture.captureExceptionSafe.mock.calls[0];
    expect(args[1].tags.item_id).toBeUndefined();
  });

  test('Test C: the free-text message field still redacts 13-19 digit runs (PAN protection unchanged)', function () {
    var res = mockRes();
    handler({ body: {
      message: 'Item not found in current catalog: 1099000000000109115. Refresh and try again.',
      endpoint: '/api/kiosk/sale',
      auth_state: 'device-token',
      item_id: '1099000000000109115'
    } }, res);

    var msg = capture.captureExceptionSafe.mock.calls[0][0].message;
    expect(msg).not.toContain('1099000000000109115');
    expect(msg).toContain('[REDACTED]');
    // But the validated item_id tag still carries the real value un-redacted.
    var args = capture.captureExceptionSafe.mock.calls[0];
    expect(args[1].tags.item_id).toBe('1099000000000109115');
  });
});
