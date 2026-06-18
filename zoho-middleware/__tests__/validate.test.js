'use strict';

const { validateLineItems, classifyZohoError, validateBody } = require('../lib/validate');

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

// ---------------------------------------------------------------------------
// validateBody — appended tests (PII-02 / D-08)
// Existing validateLineItems and classifyZohoError tests above are UNCHANGED.
// ---------------------------------------------------------------------------

describe('validateBody', function () {
  var SCHEMA = {
    allowed: ['name', 'sku', 'rate', 'status'],
    required: ['name'],
    types: { rate: 'number' }
  };

  describe('body object check', function () {
    test('rejects null body', function () {
      var result = validateBody(null, SCHEMA);
      expect(result.error).toMatch(/must be a JSON object/);
      expect(result.clean).toEqual({});
    });

    test('rejects string body', function () {
      var result = validateBody('just-a-string', SCHEMA);
      expect(result.error).toMatch(/must be a JSON object/);
      expect(result.clean).toEqual({});
    });

    test('rejects array body', function () {
      var result = validateBody([{ name: 'foo' }], SCHEMA);
      expect(result.error).toMatch(/must be a JSON object/);
      expect(result.clean).toEqual({});
    });

    test('rejects undefined body', function () {
      var result = validateBody(undefined, SCHEMA);
      expect(result.error).toMatch(/must be a JSON object/);
      expect(result.clean).toEqual({});
    });

    test('accepts a plain object', function () {
      var result = validateBody({ name: 'Widget' }, SCHEMA);
      expect(result.error).toBeNull();
    });
  });

  describe('required field check', function () {
    test('returns error when required field is missing', function () {
      var result = validateBody({ sku: 'SKU-1' }, SCHEMA);
      expect(result.error).toMatch(/name/);
      expect(result.clean).toEqual({});
    });

    test('returns error when required field is empty string', function () {
      var result = validateBody({ name: '' }, SCHEMA);
      expect(result.error).toMatch(/name/);
      expect(result.clean).toEqual({});
    });

    test('returns error when required field is null', function () {
      var result = validateBody({ name: null }, SCHEMA);
      expect(result.error).toMatch(/name/);
      expect(result.clean).toEqual({});
    });

    test('passes when all required fields are present', function () {
      var result = validateBody({ name: 'Widget' }, SCHEMA);
      expect(result.error).toBeNull();
    });
  });

  describe('type checking', function () {
    test('rejects rate as object', function () {
      var result = validateBody({ name: 'Widget', rate: { nested: 'obj' } }, SCHEMA);
      expect(result.error).toMatch(/rate/);
      expect(result.clean).toEqual({});
    });

    test('rejects rate as string', function () {
      var result = validateBody({ name: 'Widget', rate: 'not-a-number' }, SCHEMA);
      expect(result.error).toMatch(/rate/);
    });

    test('accepts rate as number', function () {
      var result = validateBody({ name: 'Widget', rate: 29.99 }, SCHEMA);
      expect(result.error).toBeNull();
      expect(result.clean.rate).toBe(29.99);
    });

    test('accepts rate as zero', function () {
      var result = validateBody({ name: 'Widget', rate: 0 }, SCHEMA);
      expect(result.error).toBeNull();
      expect(result.clean.rate).toBe(0);
    });
  });

  describe('field stripping (no field smuggling)', function () {
    test('strips unknown fields from output', function () {
      var result = validateBody({
        name: 'Widget',
        unknown_key: 'evil-value',
        __proto__: 'attack'
      }, SCHEMA);
      expect(result.error).toBeNull();
      expect(result.clean.name).toBe('Widget');
      expect(result.clean.unknown_key).toBeUndefined();
    });

    test('includes all known allowed fields present in input', function () {
      var result = validateBody({ name: 'Widget', sku: 'W-1', rate: 10, status: 'active' }, SCHEMA);
      expect(result.error).toBeNull();
      expect(result.clean).toEqual({ name: 'Widget', sku: 'W-1', rate: 10, status: 'active' });
    });

    test('omits allowed fields that are not present in input', function () {
      var result = validateBody({ name: 'Widget' }, SCHEMA);
      expect(result.error).toBeNull();
      expect(result.clean).toEqual({ name: 'Widget' });
      expect(result.clean.sku).toBeUndefined();
    });
  });

  describe('schema with no required fields (partial update pattern)', function () {
    var PARTIAL_SCHEMA = {
      allowed: ['rate', 'status'],
      required: [],
      types: { rate: 'number' }
    };

    test('accepts empty body for partial update', function () {
      var result = validateBody({}, PARTIAL_SCHEMA);
      expect(result.error).toBeNull();
      expect(result.clean).toEqual({});
    });

    test('still strips unknown fields', function () {
      var result = validateBody({ rate: 20, evil: 'payload' }, PARTIAL_SCHEMA);
      expect(result.error).toBeNull();
      expect(result.clean).toEqual({ rate: 20 });
    });
  });

  describe('backward-compat: original exports still work', function () {
    test('validateLineItems still exported and works', function () {
      expect(typeof validateLineItems).toBe('function');
      expect(validateLineItems([])).toMatch(/non-empty/);
    });

    test('classifyZohoError still exported and works', function () {
      expect(typeof classifyZohoError).toBe('function');
      var r = classifyZohoError({});
      expect(r.status).toBe(502);
    });
  });
});
