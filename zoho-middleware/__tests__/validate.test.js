'use strict';

const { validateLineItems, classifyZohoError } = require('../lib/validate');

describe('validateLineItems', () => {
  test('rejects empty array', () => {
    expect(validateLineItems([])).toMatch(/non-empty/);
  });

  test('rejects non-array', () => {
    expect(validateLineItems(null)).toMatch(/non-empty/);
    expect(validateLineItems('foo')).toMatch(/non-empty/);
    expect(validateLineItems(undefined)).toMatch(/non-empty/);
  });

  test('rejects too many items (default max 50)', () => {
    var items = Array.from({ length: 51 }, function (_, i) {
      return { item_id: 'id' + i, quantity: 1, rate: 0 };
    });
    expect(validateLineItems(items)).toMatch(/Too many/);
  });

  test('accepts exactly maxItems items', () => {
    var items = Array.from({ length: 50 }, function (_, i) {
      return { item_id: 'id' + i, quantity: 1, rate: 0 };
    });
    expect(validateLineItems(items)).toBeNull();
  });

  test('custom maxItems option', () => {
    var items = Array.from({ length: 3 }, function (_, i) {
      return { item_id: 'id' + i, quantity: 1, rate: 0 };
    });
    expect(validateLineItems(items, { maxItems: 2 })).toMatch(/Too many/);
    expect(validateLineItems(items, { maxItems: 3 })).toBeNull();
  });

  test('rejects missing item_id', () => {
    expect(validateLineItems([{ quantity: 1, rate: 0 }])).toMatch(/item_id/);
  });

  test('rejects empty item_id string', () => {
    expect(validateLineItems([{ item_id: '', quantity: 1, rate: 0 }])).toMatch(/item_id/);
    expect(validateLineItems([{ item_id: '   ', quantity: 1, rate: 0 }])).toMatch(/item_id/);
  });

  test('rejects non-string item_id', () => {
    expect(validateLineItems([{ item_id: 123, quantity: 1, rate: 0 }])).toMatch(/item_id/);
  });

  test('rejects fractional quantity', () => {
    expect(validateLineItems([{ item_id: 'x', quantity: 1.5, rate: 0 }])).toMatch(/quantity/);
  });

  test('rejects quantity less than 1', () => {
    expect(validateLineItems([{ item_id: 'x', quantity: 0, rate: 0 }])).toMatch(/quantity/);
    expect(validateLineItems([{ item_id: 'x', quantity: -1, rate: 0 }])).toMatch(/quantity/);
  });

  test('rejects quantity greater than maxQty', () => {
    expect(validateLineItems([{ item_id: 'x', quantity: 10000, rate: 0 }])).toMatch(/quantity/);
  });

  test('custom maxQty option', () => {
    expect(validateLineItems([{ item_id: 'x', quantity: 5, rate: 0 }], { maxQty: 4 })).toMatch(/quantity/);
    expect(validateLineItems([{ item_id: 'x', quantity: 5, rate: 0 }], { maxQty: 5 })).toBeNull();
  });

  test('rejects negative rate', () => {
    expect(validateLineItems([{ item_id: 'x', quantity: 1, rate: -0.01 }])).toMatch(/rate/);
  });

  test('accepts rate of 0', () => {
    expect(validateLineItems([{ item_id: 'x', quantity: 1, rate: 0 }])).toBeNull();
  });

  test('rejects rate exceeding maxRate', () => {
    expect(validateLineItems([{ item_id: 'x', quantity: 1, rate: 100001 }])).toMatch(/rate/);
  });

  test('custom maxRate option', () => {
    expect(validateLineItems([{ item_id: 'x', quantity: 1, rate: 200 }], { maxRate: 100 })).toMatch(/rate/);
    expect(validateLineItems([{ item_id: 'x', quantity: 1, rate: 200 }], { maxRate: 200 })).toBeNull();
  });

  test('accepts valid single item', () => {
    expect(validateLineItems([{ item_id: 'abc123', quantity: 1, rate: 99.99 }])).toBeNull();
  });

  test('accepts multiple valid items', () => {
    var items = [
      { item_id: 'a', quantity: 2, rate: 10 },
      { item_id: 'b', quantity: 5, rate: 0 }
    ];
    expect(validateLineItems(items)).toBeNull();
  });

  test('reports correct index for invalid second item', () => {
    var items = [
      { item_id: 'a', quantity: 1, rate: 0 },
      { item_id: '', quantity: 1, rate: 0 }
    ];
    var err = validateLineItems(items);
    expect(err).toMatch(/1/);
  });
});

describe('validateLineItems with allowDecimal', function () {
  test('accepts decimal quantities like 0.5 and 2.75', function () {
    var items = [
      { item_id: 'a', quantity: 0.5, rate: 10 },
      { item_id: 'b', quantity: 2.75, rate: 5 }
    ];
    expect(validateLineItems(items, { allowDecimal: true })).toBeNull();
  });

  test('accepts the minimum decimal quantity 0.001', function () {
    var items = [{ item_id: 'a', quantity: 0.001, rate: 10 }];
    expect(validateLineItems(items, { allowDecimal: true })).toBeNull();
  });

  test('rejects quantity below 0.001 when allowDecimal is true', function () {
    var items = [{ item_id: 'a', quantity: 0.0001, rate: 10 }];
    expect(validateLineItems(items, { allowDecimal: true })).toMatch(/quantity/);
  });

  test('rejects zero quantity when allowDecimal is true', function () {
    var items = [{ item_id: 'a', quantity: 0, rate: 10 }];
    expect(validateLineItems(items, { allowDecimal: true })).toMatch(/quantity/);
  });

  test('rejects negative quantity when allowDecimal is true', function () {
    var items = [{ item_id: 'a', quantity: -0.5, rate: 10 }];
    expect(validateLineItems(items, { allowDecimal: true })).toMatch(/quantity/);
  });

  test('still rejects fractional quantity when allowDecimal is false (default)', function () {
    var items = [{ item_id: 'a', quantity: 1.5, rate: 10 }];
    expect(validateLineItems(items)).toMatch(/whole number/);
    expect(validateLineItems(items, { allowDecimal: false })).toMatch(/whole number/);
  });

  test('error message mentions range instead of whole number when allowDecimal is true', function () {
    var items = [{ item_id: 'a', quantity: -1, rate: 10 }];
    var err = validateLineItems(items, { allowDecimal: true });
    expect(err).toMatch(/between 0\.001/);
    expect(err).not.toMatch(/whole number/);
  });

  test('respects maxQty with decimal quantities', function () {
    var items = [{ item_id: 'a', quantity: 10.5, rate: 10 }];
    expect(validateLineItems(items, { allowDecimal: true, maxQty: 10 })).toMatch(/quantity/);
    expect(validateLineItems(items, { allowDecimal: true, maxQty: 11 })).toBeNull();
  });
});

describe('classifyZohoError', () => {
  test('4xx error relays Zoho message and returns status 400', () => {
    var err = { response: { status: 400, data: { message: 'Invalid account' } } };
    var result = classifyZohoError(err, 'fallback');
    expect(result.status).toBe(400);
    expect(result.message).toBe('Invalid account');
  });

  test('422 error uses data.error field if message absent', () => {
    var err = { response: { status: 422, data: { error: 'Validation failed' } } };
    var result = classifyZohoError(err);
    expect(result.status).toBe(400);
    expect(result.message).toBe('Validation failed');
  });

  test('4xx with no message uses fallback', () => {
    var err = { response: { status: 403, data: {} } };
    var result = classifyZohoError(err, 'Access denied');
    expect(result.status).toBe(400);
    expect(result.message).toBe('Access denied');
  });

  test('5xx error returns 502 with fallback message', () => {
    var err = { response: { status: 500, data: { message: 'Internal error' } } };
    var result = classifyZohoError(err, 'upstream failed');
    expect(result.status).toBe(502);
    expect(result.message).toBe('upstream failed');
  });

  test('network error (no response) returns 502', () => {
    var err = { message: 'Network Error' };
    var result = classifyZohoError(err, 'Connection failed');
    expect(result.status).toBe(502);
    expect(result.message).toBe('Connection failed');
  });

  test('uses default fallback message when not provided', () => {
    var err = {};
    var result = classifyZohoError(err);
    expect(result.status).toBe(502);
    expect(result.message).toBe('An unexpected error occurred');
  });
});
