'use strict';

var EventEmitter = require('events');

// ---------------------------------------------------------------------------
// Mocks — must be declared before require()
// ---------------------------------------------------------------------------
jest.mock('https');
jest.mock('express', () => {
  var router = { get: jest.fn(), post: jest.fn() };
  var express = function () {};
  express.Router = function () { return router; };
  return express;
});
jest.mock('../lib/helcim', () => ({
  isEnabled: jest.fn().mockReturnValue(true),
  initializeCheckout: jest.fn().mockResolvedValue({ checkoutToken: 'tok-test-123' }),
  getDepositAmount: jest.fn().mockReturnValue(10000),
  voidTransaction: jest.fn().mockResolvedValue({ ok: true, transactionId: 'txn-mock' }),
  getTerminalDiagnostics: jest.fn().mockReturnValue({})
}));
jest.mock('../lib/zoho-api', () => ({
  zohoPost: jest.fn(), zohoGet: jest.fn()
}));
jest.mock('../lib/cache', () => ({
  get: jest.fn(), set: jest.fn(), del: jest.fn()
}));
jest.mock('../lib/mailer', () => ({
  sendReservationNotification: jest.fn().mockResolvedValue(),
  sendOfflineOrderNotification: jest.fn().mockResolvedValue()
}));
jest.mock('axios', () => ({ post: jest.fn().mockResolvedValue({ data: { ok: true } }) }));
jest.mock('querystring', () => require.requireActual
  ? require.requireActual('querystring')
  : jest.requireActual('querystring'));

var https = require('https');
var helpers = require('../lib/checkout-helpers');
var verifyRecaptcha = helpers.verifyRecaptcha;
var buildLineItems = helpers.buildLineItems;
var buildContactPayload = helpers.buildContactPayload;
var findMakersFeeItem = helpers.findMakersFeeItem;
var findMaterialsFeeItem = helpers.findMaterialsFeeItem;
var payments = require('../routes/payments');
var handlePaymentInitialize = payments.handlePaymentInitialize;

// ---------------------------------------------------------------------------
// HTTPS mock helpers (same pattern as zohoAuth tests)
// ---------------------------------------------------------------------------
function mockHttpsSuccess(responseBody) {
  var res = new EventEmitter();
  var req = new EventEmitter();
  req.write = jest.fn();
  req.end = jest.fn(function () {
    var calls = https.request.mock.calls;
    var cb = calls[calls.length - 1][1];
    cb(res);
    res.emit('data', Buffer.from(JSON.stringify(responseBody)));
    res.emit('end');
  });
  https.request.mockReturnValue(req);
}

function mockHttpsNetworkError(err) {
  var req = new EventEmitter();
  req.write = jest.fn();
  req.end = jest.fn(function () { req.emit('error', err); });
  https.request.mockReturnValue(req);
}

function mockHttpsBadJson() {
  var res = new EventEmitter();
  var req = new EventEmitter();
  req.write = jest.fn();
  req.end = jest.fn(function () {
    var calls = https.request.mock.calls;
    var cb = calls[calls.length - 1][1];
    cb(res);
    res.emit('data', Buffer.from('not-valid-json!!!'));
    res.emit('end');
  });
  https.request.mockReturnValue(req);
}

// ---------------------------------------------------------------------------
// verifyRecaptcha
// ---------------------------------------------------------------------------
describe('verifyRecaptcha', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.RECAPTCHA_SECRET_KEY;
  });

  test('no secret key configured → success with score 1.0 (allow all)', async () => {
    var result = await verifyRecaptcha('any-token');
    expect(result).toEqual({ success: true, score: 1.0 });
    expect(https.request).not.toHaveBeenCalled();
  });

  test('secret key set but no token → failure with score 0', async () => {
    process.env.RECAPTCHA_SECRET_KEY = 'secret123';
    var result = await verifyRecaptcha('');
    expect(result).toEqual({ success: false, score: 0 });
    expect(https.request).not.toHaveBeenCalled();
  });

  test('secret key set, null token → failure with score 0', async () => {
    process.env.RECAPTCHA_SECRET_KEY = 'secret123';
    var result = await verifyRecaptcha(null);
    expect(result).toEqual({ success: false, score: 0 });
  });

  test('valid token → calls Google and returns parsed result', async () => {
    process.env.RECAPTCHA_SECRET_KEY = 'secret123';
    mockHttpsSuccess({ success: true, score: 0.9, action: 'checkout' });
    var result = await verifyRecaptcha('tok-abc');
    expect(result).toEqual({ success: true, score: 0.9, action: 'checkout' });
  });

  test('calls correct Google endpoint', async () => {
    process.env.RECAPTCHA_SECRET_KEY = 'secret123';
    mockHttpsSuccess({ success: true, score: 0.8 });
    await verifyRecaptcha('tok-xyz');
    expect(https.request).toHaveBeenCalledWith(
      expect.objectContaining({
        hostname: 'www.google.com',
        path: '/recaptcha/api/siteverify',
        method: 'POST'
      }),
      expect.any(Function)
    );
  });

  test('low score returned as-is (caller decides threshold)', async () => {
    process.env.RECAPTCHA_SECRET_KEY = 'secret123';
    mockHttpsSuccess({ success: true, score: 0.1 });
    var result = await verifyRecaptcha('tok-low');
    expect(result.score).toBe(0.1);
    expect(result.success).toBe(true);
  });

  test('Google returns failure with error-codes', async () => {
    process.env.RECAPTCHA_SECRET_KEY = 'secret123';
    mockHttpsSuccess({ success: false, 'error-codes': ['invalid-input-response'] });
    var result = await verifyRecaptcha('bad-tok');
    expect(result.success).toBe(false);
    expect(result['error-codes']).toContain('invalid-input-response');
  });

  test('network error → fails open (success)', async () => {
    process.env.RECAPTCHA_SECRET_KEY = 'secret123';
    mockHttpsNetworkError(new Error('ECONNREFUSED'));
    var result = await verifyRecaptcha('tok');
    expect(result.success).toBe(true);
    expect(result.score).toBe(1.0);
  });

  test('invalid JSON response → fails open (success)', async () => {
    process.env.RECAPTCHA_SECRET_KEY = 'secret123';
    mockHttpsBadJson();
    var result = await verifyRecaptcha('tok');
    expect(result.success).toBe(true);
    expect(result.score).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// buildLineItems
// ---------------------------------------------------------------------------
describe('buildLineItems', () => {
  test('uses catalog price when catalog is available', () => {
    var catalogMap = { 'item1': 10.00 };
    var items = [{ item_id: 'item1', name: 'Wine Kit', quantity: 2, rate: 999 }];
    var result = buildLineItems(items, catalogMap, true);
    expect(result.lineItems[0].rate).toBe(10.00);
    expect(result.orderTotal).toBe(20.00);
  });

  test('uses client-supplied rate when catalog unavailable', () => {
    var items = [{ item_id: 'item1', name: 'Wine Kit', quantity: 2, rate: 14.99 }];
    var result = buildLineItems(items, {}, false);
    expect(result.lineItems[0].rate).toBe(14.99);
    expect(result.orderTotal).toBe(29.98);
  });

  test('applies percentage discount to effective rate', () => {
    var catalogMap = { 'item1': 100 };
    var items = [{ item_id: 'item1', name: 'Kit', quantity: 1, rate: 100, discount: 10 }];
    var result = buildLineItems(items, catalogMap, true);
    expect(result.lineItems[0].discount).toBe('10%');
    expect(result.orderTotal).toBe(90);
  });

  test('discount field absent when discount is 0', () => {
    var catalogMap = { 'item1': 50 };
    var items = [{ item_id: 'item1', name: 'Kit', quantity: 1, rate: 50, discount: 0 }];
    var result = buildLineItems(items, catalogMap, true);
    expect(result.lineItems[0].discount).toBeUndefined();
  });

  test('discount field absent when discount not provided', () => {
    var catalogMap = { 'item1': 50 };
    var items = [{ item_id: 'item1', name: 'Kit', quantity: 1, rate: 50 }];
    var result = buildLineItems(items, catalogMap, true);
    expect(result.lineItems[0].discount).toBeUndefined();
  });

  test('multiple items accumulate into orderTotal', () => {
    var catalogMap = { 'a': 10, 'b': 20 };
    var items = [
      { item_id: 'a', name: 'A', quantity: 2, rate: 0 },
      { item_id: 'b', name: 'B', quantity: 1, rate: 0 }
    ];
    var result = buildLineItems(items, catalogMap, true);
    expect(result.orderTotal).toBe(40.00);
  });

  test('orderTotal rounded to 2 decimal places', () => {
    // 3 × 0.1 = 0.30000000000000004 in floating point — must round to 0.30
    var items = [{ item_id: 'x', name: 'X', quantity: 3, rate: 0.1 }];
    var result = buildLineItems(items, {}, false);
    expect(result.orderTotal).toBe(0.30);
  });

  test('invalid quantity coerced to 1', () => {
    var items = [{ item_id: 'x', name: 'X', quantity: 0, rate: 10 }];
    var result = buildLineItems(items, {}, false);
    expect(result.lineItems[0].quantity).toBe(1);
    expect(result.orderTotal).toBe(10);
  });

  test('invalid rate coerced to 0 when catalog unavailable', () => {
    var items = [{ item_id: 'x', name: 'X', quantity: 1, rate: 'bad' }];
    var result = buildLineItems(items, {}, false);
    expect(result.lineItems[0].rate).toBe(0);
    expect(result.orderTotal).toBe(0);
  });

  test('preserves item_id and name on each line item', () => {
    var catalogMap = { 'sku-99': 25 };
    var items = [{ item_id: 'sku-99', name: 'Pinot Noir Kit', quantity: 1, rate: 0 }];
    var result = buildLineItems(items, catalogMap, true);
    expect(result.lineItems[0].item_id).toBe('sku-99');
    expect(result.lineItems[0].name).toBe('Pinot Noir Kit');
  });

  test('empty name falls back to empty string', () => {
    var items = [{ item_id: 'x', quantity: 1, rate: 5 }];
    var result = buildLineItems(items, {}, false);
    expect(result.lineItems[0].name).toBe('');
  });

  test('empty cart returns zero total', () => {
    var result = buildLineItems([], {}, true);
    expect(result.lineItems).toHaveLength(0);
    expect(result.orderTotal).toBe(0);
  });

  test('25% discount on $80 item = $60', () => {
    var catalogMap = { 'k': 80 };
    var items = [{ item_id: 'k', name: 'Kit', quantity: 1, rate: 80, discount: 25 }];
    var result = buildLineItems(items, catalogMap, true);
    expect(result.orderTotal).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// buildContactPayload
//
// Regression: INV-000078 (2026-06-01) created a Zoho contact with only the
// display name — email, phone, and first/last name were all blank, so the
// customer's order-confirmation email had no recipient on the contact and staff
// had to re-key the name. Root cause: email/phone were sent at the top level of
// the contact payload, which Zoho Books silently drops. They must be nested
// under contact_persons.
// ---------------------------------------------------------------------------
describe('buildContactPayload', () => {
  test('nests email under contact_persons (NOT top-level) — the INV-000078 bug', () => {
    var payload = buildContactPayload('Anne MacDougall', 'anne@example.com', '');
    expect(payload.contact_persons[0].email).toBe('anne@example.com');
    // The old bug: top-level email, which Zoho ignores. Guard against regressing.
    expect(payload.email).toBeUndefined();
  });

  test('splits full name into first_name / last_name on the primary contact person', () => {
    var payload = buildContactPayload('Anne MacDougall', 'anne@example.com', '');
    expect(payload.contact_persons[0].first_name).toBe('Anne');
    expect(payload.contact_persons[0].last_name).toBe('MacDougall');
    expect(payload.contact_persons[0].is_primary_contact).toBe(true);
  });

  test('keeps contact_name as the full display name', () => {
    var payload = buildContactPayload('Anne MacDougall', 'anne@example.com', '');
    expect(payload.contact_name).toBe('Anne MacDougall');
    expect(payload.contact_type).toBe('customer');
  });

  test('nests phone under contact_persons when provided', () => {
    var payload = buildContactPayload('Anne MacDougall', 'anne@example.com', '604-555-0100');
    expect(payload.contact_persons[0].phone).toBe('604-555-0100');
    expect(payload.phone).toBeUndefined();
  });

  test('omits phone from contact person when not provided', () => {
    var payload = buildContactPayload('Anne MacDougall', 'anne@example.com', '');
    expect(payload.contact_persons[0].phone).toBeUndefined();
  });

  test('multi-word last name preserved (e.g. "Mary Van Der Berg")', () => {
    var payload = buildContactPayload('Mary Van Der Berg', 'mary@example.com', '');
    expect(payload.contact_persons[0].first_name).toBe('Mary');
    expect(payload.contact_persons[0].last_name).toBe('Van Der Berg');
  });

  test('single-word name → first_name set, last_name empty', () => {
    var payload = buildContactPayload('Madonna', 'm@example.com', '');
    expect(payload.contact_persons[0].first_name).toBe('Madonna');
    expect(payload.contact_persons[0].last_name).toBe('');
  });

  test('email-as-name fallback (blank name at checkout) still carries email', () => {
    // checkout.js defaults customerName to the email when no name is supplied
    var payload = buildContactPayload('bob@example.com', 'bob@example.com', '');
    expect(payload.contact_name).toBe('bob@example.com');
    expect(payload.contact_persons[0].email).toBe('bob@example.com');
  });

  test('trims surrounding whitespace and collapses inner spacing', () => {
    var payload = buildContactPayload('  Anne   MacDougall  ', 'anne@example.com', '');
    expect(payload.contact_name).toBe('Anne   MacDougall'.trim());
    expect(payload.contact_persons[0].first_name).toBe('Anne');
    expect(payload.contact_persons[0].last_name).toBe('MacDougall');
  });
});

// ---------------------------------------------------------------------------
// findMakersFeeItem
// ---------------------------------------------------------------------------
describe('findMakersFeeItem', () => {
  var services = [
    { item_id: '111', name: 'Milling Fee', sku: 'MILLED', rate: 10 },
    { item_id: '222', name: 'Makers Fee', sku: 'MAKERS-FEE', rate: 50 },
    { item_id: '333', name: 'Wine Carbonation', sku: 'CARB-WINE', rate: 35 }
  ];

  test('finds by explicit item_id match (MAKERS_FEE_ITEM_ID env var)', () => {
    expect(findMakersFeeItem(services, '222')).toEqual(services[1]);
  });

  test('item_id match takes priority — returns first match by id regardless of SKU', () => {
    // item_id '111' is Milling, not Maker's Fee — but explicit id wins
    expect(findMakersFeeItem(services, '111')).toEqual(services[0]);
  });

  test('finds by SKU MAKERS-FEE when item_id env var is empty', () => {
    expect(findMakersFeeItem(services, '')).toEqual(services[1]);
  });

  test('finds by name containing "makers fee" (case-insensitive)', () => {
    var svcs = [{ item_id: '99', name: 'Makers Fee Service', sku: 'OTHER', rate: 50 }];
    expect(findMakersFeeItem(svcs, '')).toEqual(svcs[0]);
  });

  test('finds by name containing "maker\'s fee" (apostrophe variant)', () => {
    var svcs = [{ item_id: '88', name: "Maker's Fee", sku: 'OTHER', rate: 50 }];
    expect(findMakersFeeItem(svcs, '')).toEqual(svcs[0]);
  });

  test('returns null when no match found', () => {
    var svcs = [{ item_id: '1', name: 'Milling', sku: 'MILL', rate: 10 }];
    expect(findMakersFeeItem(svcs, '')).toBeNull();
  });

  test('returns null for empty services array', () => {
    expect(findMakersFeeItem([], '222')).toBeNull();
  });

  test('returns null for null services', () => {
    expect(findMakersFeeItem(null, '')).toBeNull();
  });

  test('returns null for non-array services', () => {
    expect(findMakersFeeItem('not-an-array', '')).toBeNull();
  });

  test('skips null entries in services array gracefully', () => {
    var svcs = [null, { item_id: '222', name: 'Makers Fee', sku: 'MAKERS-FEE', rate: 50 }];
    expect(findMakersFeeItem(svcs, '')).toEqual(svcs[1]);
  });

  test('falls through to SKU match when item_id env var does not match', () => {
    // '999' does not match any item_id, so SKU 'MAKERS-FEE' match fires instead
    expect(findMakersFeeItem(services, '999')).toEqual(services[1]);
  });
});

// ---------------------------------------------------------------------------
// findMaterialsFeeItem
// ---------------------------------------------------------------------------
describe('findMaterialsFeeItem', () => {
  var services = [
    { item_id: '111', name: 'Milling Fee', sku: 'MILLED', rate: 10 },
    { item_id: '222', name: 'Makers Fee', sku: 'MAKERS-FEE', rate: 45 },
    { item_id: '444', name: 'Materials Fee', sku: 'MAT-FEE', rate: 5, tax_percentage: 12, tax_name: 'GST+PST' },
    { item_id: '333', name: 'Wine Carbonation', sku: 'CARB-WINE', rate: 35 }
  ];

  test('finds by explicit item_id match (MATERIALS_FEE_ITEM_ID env var)', () => {
    expect(findMaterialsFeeItem(services, '444')).toEqual(services[2]);
  });

  test('item_id match takes priority — returns first match by id regardless of SKU', () => {
    expect(findMaterialsFeeItem(services, '111')).toEqual(services[0]);
  });

  test('finds by SKU MAT-FEE when item_id env var is empty', () => {
    expect(findMaterialsFeeItem(services, '')).toEqual(services[2]);
  });

  test('finds by name containing "materials fee" (case-insensitive)', () => {
    var svcs = [{ item_id: '99', name: 'Materials Fee Service', sku: 'OTHER', rate: 5 }];
    expect(findMaterialsFeeItem(svcs, '')).toEqual(svcs[0]);
  });

  test('returns null when no match found', () => {
    var svcs = [{ item_id: '1', name: 'Milling', sku: 'MILL', rate: 10 }];
    expect(findMaterialsFeeItem(svcs, '')).toBeNull();
  });

  test('returns null for empty services array', () => {
    expect(findMaterialsFeeItem([], '444')).toBeNull();
  });

  test('returns null for null services', () => {
    expect(findMaterialsFeeItem(null, '')).toBeNull();
  });

  test('returns null for non-array services', () => {
    expect(findMaterialsFeeItem('not-an-array', '')).toBeNull();
  });

  test('skips null entries in services array gracefully', () => {
    var svcs = [null, { item_id: '444', name: 'Materials Fee', sku: 'MAT-FEE', rate: 5 }];
    expect(findMaterialsFeeItem(svcs, '')).toEqual(svcs[1]);
  });

  test('falls through to SKU match when item_id env var does not match', () => {
    expect(findMaterialsFeeItem(services, '999')).toEqual(services[2]);
  });
});

// ---------------------------------------------------------------------------
// /api/payment/initialize route handler
// ---------------------------------------------------------------------------
describe('/api/payment/initialize', () => {
  var helcimLib = require('../lib/helcim');

  function mockRes() {
    var res = { statusCode: 200, body: null };
    res.status = function (code) { res.statusCode = code; return res; };
    res.json = function (data) { res.body = data; };
    return res;
  }

  test('returns 400 when amount is missing (empty body)', () => {
    var req = { body: {} };
    var res = mockRes();
    handlePaymentInitialize(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Invalid amount/i);
  });

  test('returns 400 when amount is zero', () => {
    var req = { body: { amount: 0 } };
    var res = mockRes();
    handlePaymentInitialize(req, res);
    expect(res.statusCode).toBe(400);
  });

  test('returns 400 when amount is negative', () => {
    var req = { body: { amount: -10 } };
    var res = mockRes();
    handlePaymentInitialize(req, res);
    expect(res.statusCode).toBe(400);
  });

  test('returns checkoutToken when amount is valid', async () => {
    helcimLib.initializeCheckout.mockResolvedValue({ checkoutToken: 'tok-abc' });
    var req = { body: { amount: 112.50 } };
    var res = mockRes();
    handlePaymentInitialize(req, res);
    await new Promise(process.nextTick);
    expect(helcimLib.initializeCheckout).toHaveBeenCalledWith(112.50, 'CAD');
    expect(res.body.checkoutToken).toBe('tok-abc');
    expect(res.body.depositAmount).toBe(112.50);
  });

  test('returns 503 when Helcim is not configured', () => {
    helcimLib.isEnabled.mockReturnValueOnce(false);
    var req = { body: { amount: 50 } };
    var res = mockRes();
    handlePaymentInitialize(req, res);
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toMatch(/not configured/i);
  });
});
