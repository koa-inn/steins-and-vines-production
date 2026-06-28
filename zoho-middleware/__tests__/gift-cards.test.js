'use strict';

// ---------------------------------------------------------------------------
// Mocks — declared before any require() so Jest hoists them correctly.
// ---------------------------------------------------------------------------

jest.mock('express', function () {
  var router = { get: jest.fn(), post: jest.fn() };
  var express = function () {};
  express.Router = function () { return router; };
  return express;
});

// All Apps Script actions (issue/lookup/next-number/void/update-invoice) are
// called via axios.post — the doPost dispatch block handles them all.
jest.mock('axios', function () {
  return { post: jest.fn().mockResolvedValue({ data: { ok: true } }) };
});

// zohoPost default: return an invoice shape (consumed by issue route).
jest.mock('../lib/zoho-api', function () {
  return {
    zohoGet: jest.fn(),
    zohoPost: jest.fn().mockResolvedValue({
      invoice: { invoice_id: 'inv-test-001', invoice_number: 'INV-TEST-001' }
    }),
    zohoPut: jest.fn()
  };
});

jest.mock('../lib/logger', function () {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
});

jest.mock('../lib/eventLog', function () {
  return { logEvent: jest.fn() };
});

jest.mock('../lib/cache', function () {
  return { get: jest.fn(), set: jest.fn(), del: jest.fn() };
});

// ---------------------------------------------------------------------------
// Test harness — mirrors pos-custom-line.test.js pattern
// ---------------------------------------------------------------------------

describe('gift-card routes', function () {
  var axiosMock, zohoApi, router, handlers;

  /**
   * Reset all module state and re-require the route module so each test
   * starts with fresh mocks and handler registrations.
   */
  function getHandlers() {
    jest.resetModules();
    axiosMock = require('axios');
    zohoApi = require('../lib/zoho-api');
    require('../routes/gift-cards');
    router = require('express').Router();
    handlers = {};
    router.post.mock.calls.forEach(function (call) {
      handlers[call[0]] = call[call.length - 1];
    });
    router.get.mock.calls.forEach(function (call) {
      handlers[call[0]] = call[call.length - 1];
    });
  }

  function mockRes() {
    var res = { json: jest.fn(), status: jest.fn(), headersSent: false };
    res.status.mockReturnValue(res);
    return res;
  }

  beforeEach(function () {
    getHandlers();
    process.env.KIOSK_GIFT_CARD_ITEM_ID = 'gc-item-test-123';
    process.env.KIOSK_CONTACT_ID = 'contact-walkin-test';
    process.env.APPS_SCRIPT_URL = 'https://script.google.com/test';
    process.env.APPS_SCRIPT_SERVER_TOKEN = 'test-server-token';
  });

  afterEach(function () {
    delete process.env.KIOSK_GIFT_CARD_ITEM_ID;
    delete process.env.KIOSK_CONTACT_ID;
    delete process.env.APPS_SCRIPT_URL;
    delete process.env.APPS_SCRIPT_SERVER_TOKEN;
  });

  // -------------------------------------------------------------------------
  // GET /api/kiosk/gift-card/next-number
  // -------------------------------------------------------------------------

  describe('GET /api/kiosk/gift-card/next-number', function () {
    test('returns suggested cert number from Apps Script', function () {
      axiosMock.post.mockResolvedValueOnce({ data: { ok: true, suggested: 'GC-000001' } });

      var req = {};
      var res = mockRes();

      return handlers['/api/kiosk/gift-card/next-number'](req, res).then(function () {
        expect(res.status).toHaveBeenCalledWith(200);
        var body = res.json.mock.calls[0][0];
        expect(body.ok).toBe(true);
        expect(body.suggested).toBe('GC-000001');

        // Verify Apps Script call used correct action
        var callPayload = JSON.parse(axiosMock.post.mock.calls[0][1]);
        expect(callPayload.action).toBe('get_next_cert_number');
        expect(callPayload.server_token).toBe('test-server-token');
      });
    });

    test('Apps Script error → 500', function () {
      axiosMock.post.mockResolvedValueOnce({ data: { ok: false, error: 'script_error' } });

      var req = {};
      var res = mockRes();

      return handlers['/api/kiosk/gift-card/next-number'](req, res).then(function () {
        expect(res.status).toHaveBeenCalledWith(500);
      });
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/kiosk/gift-card/lookup
  // -------------------------------------------------------------------------

  describe('GET /api/kiosk/gift-card/lookup', function () {
    test('found cert → 200 with current_balance, status, face_value', function () {
      axiosMock.post.mockResolvedValueOnce({
        data: {
          ok: true,
          data: { current_balance: 50, status: 'active', face_value: 100 }
        }
      });

      var req = { query: { cert_number: 'GC-000001' } };
      var res = mockRes();

      return handlers['/api/kiosk/gift-card/lookup'](req, res).then(function () {
        expect(res.status).toHaveBeenCalledWith(200);
        var body = res.json.mock.calls[0][0];
        expect(body.ok).toBe(true);
        expect(body.data.current_balance).toBe(50);
        expect(body.data.status).toBe('active');

        // Verify Apps Script call
        var callPayload = JSON.parse(axiosMock.post.mock.calls[0][1]);
        expect(callPayload.action).toBe('lookup_gift_card');
        expect(callPayload.cert_number).toBe('GC-000001');
      });
    });

    test('unknown cert → 404', function () {
      axiosMock.post.mockResolvedValueOnce({ data: { ok: false, error: 'not_found' } });

      var req = { query: { cert_number: 'GC-000099' } };
      var res = mockRes();

      return handlers['/api/kiosk/gift-card/lookup'](req, res).then(function () {
        expect(res.status).toHaveBeenCalledWith(404);
        var body = res.json.mock.calls[0][0];
        expect(body.ok).toBe(false);
      });
    });

    test('invalid cert_number format (too short) → 400, no Apps Script call', function () {
      var req = { query: { cert_number: 'GC-12' } };
      var res = mockRes();

      handlers['/api/kiosk/gift-card/lookup'](req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(axiosMock.post).not.toHaveBeenCalled();
    });

    test('invalid cert_number format (wrong prefix) → 400', function () {
      var req = { query: { cert_number: 'X-000001' } };
      var res = mockRes();

      handlers['/api/kiosk/gift-card/lookup'](req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(axiosMock.post).not.toHaveBeenCalled();
    });

    test('lowercase cert_number is normalised and accepted', function () {
      axiosMock.post.mockResolvedValueOnce({
        data: { ok: true, data: { current_balance: 100, status: 'active', face_value: 100 } }
      });

      var req = { query: { cert_number: 'gc-000001' } };
      var res = mockRes();

      return handlers['/api/kiosk/gift-card/lookup'](req, res).then(function () {
        expect(res.status).toHaveBeenCalledWith(200);
        var callPayload = JSON.parse(axiosMock.post.mock.calls[0][1]);
        expect(callPayload.cert_number).toBe('GC-000001');
      });
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/kiosk/gift-card/issue
  // -------------------------------------------------------------------------

  describe('POST /api/kiosk/gift-card/issue', function () {
    test('valid issue → 201 with correct body; invoice line has no tax_id (D-03); payment_mode creditcard', function () {
      // issue_gift_card → ok
      axiosMock.post.mockResolvedValueOnce({ data: { ok: true } });
      // update_gift_card_invoice → ok
      axiosMock.post.mockResolvedValueOnce({ data: { ok: true } });
      // zohoPost '/invoices' → invoice data (mockResolvedValueOnce overrides default)
      zohoApi.zohoPost.mockResolvedValueOnce({
        invoice: { invoice_id: 'inv-001', invoice_number: 'INV-001' }
      });
      // zohoPost '/invoices/.../submit' → any (non-fatal, .catch swallows)
      zohoApi.zohoPost.mockResolvedValueOnce({});
      // zohoPost '/customerpayments' → any
      zohoApi.zohoPost.mockResolvedValueOnce({});

      var req = { body: { cert_number: 'GC-000001', face_value: 100 } };
      var res = mockRes();

      return handlers['/api/kiosk/gift-card/issue'](req, res).then(function () {
        expect(res.status).toHaveBeenCalledWith(201);
        var body = res.json.mock.calls[0][0];
        expect(body.ok).toBe(true);
        expect(body.cert_number).toBe('GC-000001');
        expect(body.face_value).toBe(100);
        expect(body.zoho_invoice_number).toBe('INV-001');

        // Verify issue_gift_card Apps Script call
        var issueCall = axiosMock.post.mock.calls[0];
        var issuePayload = JSON.parse(issueCall[1]);
        expect(issuePayload.action).toBe('issue_gift_card');
        expect(issuePayload.cert_number).toBe('GC-000001');
        expect(issuePayload.face_value).toBe(100);
        expect(issuePayload.server_token).toBe('test-server-token');

        // D-03: invoice line must NOT have a tax_id (item's own EXEMPT setting)
        var invoiceArgs = zohoApi.zohoPost.mock.calls.find(function (c) { return c[0] === '/invoices'; });
        expect(invoiceArgs).toBeTruthy();
        var lineItem = invoiceArgs[1].line_items[0];
        expect(lineItem.item_id).toBe('gc-item-test-123');
        expect(lineItem.tax_id).toBeUndefined();
        expect(lineItem.rate).toBe(100);
        expect(lineItem.quantity).toBe(1);

        // Payment must be creditcard for face_value (D-03, not 'others')
        var payArgs = zohoApi.zohoPost.mock.calls.find(function (c) { return c[0] === '/customerpayments'; });
        expect(payArgs).toBeTruthy();
        expect(payArgs[1].payment_mode).toBe('creditcard');
        expect(payArgs[1].amount).toBe(100);
        expect(payArgs[1].invoices[0].amount_applied).toBe(100);

        // update_gift_card_invoice was called
        var updateCall = axiosMock.post.mock.calls[1];
        var updatePayload = JSON.parse(updateCall[1]);
        expect(updatePayload.action).toBe('update_gift_card_invoice');
        expect(updatePayload.cert_number).toBe('GC-000001');
        expect(updatePayload.zoho_invoice_number).toBe('INV-001');
      });
    });

    // D-02: cert_number normalised to uppercase before matching
    test('lowercase cert_number is normalised and accepted', function () {
      axiosMock.post.mockResolvedValueOnce({ data: { ok: true } });
      axiosMock.post.mockResolvedValueOnce({ data: { ok: true } });
      zohoApi.zohoPost.mockResolvedValueOnce({ invoice: { invoice_id: 'inv-002', invoice_number: 'INV-002' } });
      zohoApi.zohoPost.mockResolvedValueOnce({});
      zohoApi.zohoPost.mockResolvedValueOnce({});

      var req = { body: { cert_number: 'gc-000001', face_value: 50 } };
      var res = mockRes();

      return handlers['/api/kiosk/gift-card/issue'](req, res).then(function () {
        expect(res.status).toHaveBeenCalledWith(201);
        var body = res.json.mock.calls[0][0];
        expect(body.cert_number).toBe('GC-000001');
      });
    });

    // Pitfall 4 / T-44-04: fail-closed if env not configured
    test('KIOSK_GIFT_CARD_ITEM_ID unset → 503 BEFORE any Apps Script or Zoho call', function () {
      delete process.env.KIOSK_GIFT_CARD_ITEM_ID;

      var req = { body: { cert_number: 'GC-000001', face_value: 100 } };
      var res = mockRes();

      handlers['/api/kiosk/gift-card/issue'](req, res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(axiosMock.post).not.toHaveBeenCalled();
      expect(zohoApi.zohoPost).not.toHaveBeenCalled();
    });

    // D-02: duplicate cert number
    test('duplicate cert (Apps Script error:duplicate) → 409, no Zoho call', function () {
      axiosMock.post.mockResolvedValueOnce({ data: { ok: false, error: 'duplicate' } });

      var req = { body: { cert_number: 'GC-000001', face_value: 100 } };
      var res = mockRes();

      return handlers['/api/kiosk/gift-card/issue'](req, res).then(function () {
        expect(res.status).toHaveBeenCalledWith(409);
        expect(zohoApi.zohoPost).not.toHaveBeenCalled();
      });
    });

    // T-44-08: face_value bounds
    test('face_value 0 → 400, no Apps Script call', function () {
      var req = { body: { cert_number: 'GC-000001', face_value: 0 } };
      var res = mockRes();

      handlers['/api/kiosk/gift-card/issue'](req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(axiosMock.post).not.toHaveBeenCalled();
    });

    test('face_value negative → 400', function () {
      var req = { body: { cert_number: 'GC-000001', face_value: -10 } };
      var res = mockRes();

      handlers['/api/kiosk/gift-card/issue'](req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(axiosMock.post).not.toHaveBeenCalled();
    });

    test('face_value 2001 (over limit) → 400, no Apps Script call', function () {
      var req = { body: { cert_number: 'GC-000001', face_value: 2001 } };
      var res = mockRes();

      handlers['/api/kiosk/gift-card/issue'](req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(axiosMock.post).not.toHaveBeenCalled();
    });

    test('face_value 2000 (at limit) → allowed (not 400)', function () {
      axiosMock.post.mockResolvedValueOnce({ data: { ok: true } });
      axiosMock.post.mockResolvedValueOnce({ data: { ok: true } });
      zohoApi.zohoPost.mockResolvedValueOnce({ invoice: { invoice_id: 'inv-003', invoice_number: 'INV-003' } });
      zohoApi.zohoPost.mockResolvedValueOnce({});
      zohoApi.zohoPost.mockResolvedValueOnce({});

      var req = { body: { cert_number: 'GC-000001', face_value: 2000 } };
      var res = mockRes();

      return handlers['/api/kiosk/gift-card/issue'](req, res).then(function () {
        expect(res.status).toHaveBeenCalledWith(201);
      });
    });

    test('face_value "abc" (non-numeric) → 400', function () {
      var req = { body: { cert_number: 'GC-000001', face_value: 'abc' } };
      var res = mockRes();

      handlers['/api/kiosk/gift-card/issue'](req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(axiosMock.post).not.toHaveBeenCalled();
    });

    // D-02 / T-44-09: cert_number format validation
    test('cert_number "GC-12" (too short, only 2 digits) → 400', function () {
      var req = { body: { cert_number: 'GC-12', face_value: 100 } };
      var res = mockRes();

      handlers['/api/kiosk/gift-card/issue'](req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(axiosMock.post).not.toHaveBeenCalled();
    });

    test('cert_number "X-000001" (wrong prefix) → 400', function () {
      var req = { body: { cert_number: 'X-000001', face_value: 100 } };
      var res = mockRes();

      handlers['/api/kiosk/gift-card/issue'](req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(axiosMock.post).not.toHaveBeenCalled();
    });

    test('cert_number "GC-1234567" (7 digits) → 400', function () {
      var req = { body: { cert_number: 'GC-1234567', face_value: 100 } };
      var res = mockRes();

      handlers['/api/kiosk/gift-card/issue'](req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(axiosMock.post).not.toHaveBeenCalled();
    });

    test('cert_number missing → 400', function () {
      var req = { body: { face_value: 100 } };
      var res = mockRes();

      handlers['/api/kiosk/gift-card/issue'](req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(axiosMock.post).not.toHaveBeenCalled();
    });

    // T-44-12: Void-on-Zoho-failure (atomic safety)
    test('zohoPost rejects after Sheets row created → void_gift_card called, 502 returned', function () {
      // issue_gift_card succeeds — Sheets row is now created
      axiosMock.post.mockResolvedValueOnce({ data: { ok: true } });
      // void_gift_card (called in the catch) also succeeds (fire-and-forget)
      axiosMock.post.mockResolvedValueOnce({ data: { ok: true } });

      // ALL zohoPost calls reject — invoice creation fails immediately
      zohoApi.zohoPost.mockRejectedValue(new Error('Zoho Books unavailable'));

      var req = { body: { cert_number: 'GC-000042', face_value: 75 } };
      var res = mockRes();

      return handlers['/api/kiosk/gift-card/issue'](req, res).then(function () {
        // Response must be 502
        expect(res.status).toHaveBeenCalledWith(502);

        // void_gift_card must have been called (second axios.post call)
        var calls = axiosMock.post.mock.calls;
        expect(calls.length).toBe(2);

        var issuePayload = JSON.parse(calls[0][1]);
        expect(issuePayload.action).toBe('issue_gift_card');

        var voidPayload = JSON.parse(calls[1][1]);
        expect(voidPayload.action).toBe('void_gift_card');
        expect(voidPayload.cert_number).toBe('GC-000042');
        expect(voidPayload.reason).toBe('zoho_invoice_failed');

        // No zohoPost customerpayments should have been attempted
        var payCall = zohoApi.zohoPost.mock.calls.find(function (c) { return c[0] === '/customerpayments'; });
        expect(payCall).toBeUndefined();
      });
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/kiosk/gift-card/reload (GIFTCARD-01d)
  // -------------------------------------------------------------------------

  describe('POST /api/kiosk/gift-card/reload', function () {
    test('valid reload → 200 with cert_number and new_balance; reload_gift_card called first then zohoPost invoice+payment (zero-tax)', function () {
      // reload_gift_card → ok with new balance (increment first)
      axiosMock.post.mockResolvedValueOnce({ data: { ok: true, new_balance: 150, status: 'active' } });
      // zohoPost '/invoices' → invoice data
      zohoApi.zohoPost.mockResolvedValueOnce({ invoice: { invoice_id: 'inv-reload-001', invoice_number: 'INV-R-001' } });
      // zohoPost '/invoices/.../submit' → any (non-fatal)
      zohoApi.zohoPost.mockResolvedValueOnce({});
      // zohoPost '/customerpayments' → any
      zohoApi.zohoPost.mockResolvedValueOnce({});

      var req = { body: { cert_number: 'GC-000042', amount: 50 } };
      var res = mockRes();

      return handlers['/api/kiosk/gift-card/reload'](req, res).then(function () {
        expect(res.status).toHaveBeenCalledWith(200);
        var body = res.json.mock.calls[0][0];
        expect(body.ok).toBe(true);
        expect(body.cert_number).toBe('GC-000042');
        expect(body.new_balance).toBe(150);

        // reload_gift_card is the first Apps Script call (increment-first ordering)
        var reloadCall = axiosMock.post.mock.calls[0];
        var reloadPayload = JSON.parse(reloadCall[1]);
        expect(reloadPayload.action).toBe('reload_gift_card');
        expect(reloadPayload.cert_number).toBe('GC-000042');
        expect(reloadPayload.amount).toBe(50);

        // D-03: Zoho invoice line must NOT have a tax_id (same zero-tax as issue)
        var invoiceArgs = zohoApi.zohoPost.mock.calls.find(function (c) { return c[0] === '/invoices'; });
        expect(invoiceArgs).toBeTruthy();
        var lineItem = invoiceArgs[1].line_items[0];
        expect(lineItem.item_id).toBe('gc-item-test-123');
        expect(lineItem.tax_id).toBeUndefined();
        expect(lineItem.rate).toBe(50);
        expect(lineItem.quantity).toBe(1);

        // Payment must be creditcard for the reload amount
        var payArgs = zohoApi.zohoPost.mock.calls.find(function (c) { return c[0] === '/customerpayments'; });
        expect(payArgs).toBeTruthy();
        expect(payArgs[1].payment_mode).toBe('creditcard');
        expect(payArgs[1].amount).toBe(50);
        expect(payArgs[1].invoices[0].amount_applied).toBe(50);
      });
    });

    // Pitfall 4 / T-44-22: fail-closed if KIOSK_GIFT_CARD_ITEM_ID not set
    test('KIOSK_GIFT_CARD_ITEM_ID unset → 503 before any Apps Script or Zoho call', function () {
      delete process.env.KIOSK_GIFT_CARD_ITEM_ID;

      var req = { body: { cert_number: 'GC-000042', amount: 50 } };
      var res = mockRes();

      handlers['/api/kiosk/gift-card/reload'](req, res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(axiosMock.post).not.toHaveBeenCalled();
      expect(zohoApi.zohoPost).not.toHaveBeenCalled();
    });

    // T-44-19: unknown cert
    test('unknown cert (Apps Script not_found) → 404, no Zoho call', function () {
      axiosMock.post.mockResolvedValueOnce({ data: { ok: false, error: 'not_found' } });

      var req = { body: { cert_number: 'GC-000099', amount: 50 } };
      var res = mockRes();

      return handlers['/api/kiosk/gift-card/reload'](req, res).then(function () {
        expect(res.status).toHaveBeenCalledWith(404);
        expect(zohoApi.zohoPost).not.toHaveBeenCalled();
      });
    });

    // T-44-19: voided cert
    test('voided cert (Apps Script invalid_status) → 409, no Zoho call', function () {
      axiosMock.post.mockResolvedValueOnce({ data: { ok: false, error: 'invalid_status', status: 'void' } });

      var req = { body: { cert_number: 'GC-000042', amount: 50 } };
      var res = mockRes();

      return handlers['/api/kiosk/gift-card/reload'](req, res).then(function () {
        expect(res.status).toHaveBeenCalledWith(409);
        expect(zohoApi.zohoPost).not.toHaveBeenCalled();
      });
    });

    // T-44-18: amount bounds
    test('amount 0 → 400, no Apps Script call', function () {
      var req = { body: { cert_number: 'GC-000042', amount: 0 } };
      var res = mockRes();

      handlers['/api/kiosk/gift-card/reload'](req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(axiosMock.post).not.toHaveBeenCalled();
    });

    test('amount 2001 (over limit) → 400, no Apps Script call', function () {
      var req = { body: { cert_number: 'GC-000042', amount: 2001 } };
      var res = mockRes();

      handlers['/api/kiosk/gift-card/reload'](req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(axiosMock.post).not.toHaveBeenCalled();
    });

    test('amount "x" (non-numeric) → 400, no Apps Script call', function () {
      var req = { body: { cert_number: 'GC-000042', amount: 'x' } };
      var res = mockRes();

      handlers['/api/kiosk/gift-card/reload'](req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(axiosMock.post).not.toHaveBeenCalled();
    });

    // T-44-20: increment-first ordering — Zoho failure after increment
    test('zohoPost rejects after increment → 502 with needs_manual_review; reload_gift_card WAS called (no auto-reversal)', function () {
      // reload_gift_card succeeds — balance already incremented
      axiosMock.post.mockResolvedValueOnce({ data: { ok: true, new_balance: 150, status: 'active' } });
      // ALL zohoPost calls reject
      zohoApi.zohoPost.mockRejectedValue(new Error('Zoho Books unavailable'));

      var req = { body: { cert_number: 'GC-000042', amount: 50 } };
      var res = mockRes();

      return handlers['/api/kiosk/gift-card/reload'](req, res).then(function () {
        // Response must be 502 with needs_manual_review flag
        expect(res.status).toHaveBeenCalledWith(502);
        var body = res.json.mock.calls[0][0];
        expect(body.needs_manual_review).toBe(true);

        // reload_gift_card WAS called (increment happened first — deliberate ordering)
        // Crucially: only ONE Apps Script call (no void/reversal call unlike issue-Zoho-failure)
        var calls = axiosMock.post.mock.calls;
        expect(calls.length).toBe(1);
        var reloadPayload = JSON.parse(calls[0][1]);
        expect(reloadPayload.action).toBe('reload_gift_card');
      });
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/kiosk/gift-card/void (GIFTCARD-01e)
  // -------------------------------------------------------------------------

  describe('POST /api/kiosk/gift-card/void', function () {
    test('known cert with reason → 200 {ok}; void_gift_card called with cert_number and reason', function () {
      axiosMock.post.mockResolvedValueOnce({ data: { ok: true } });

      var req = { body: { cert_number: 'GC-000042', reason: 'customer requested cancellation' } };
      var res = mockRes();

      return handlers['/api/kiosk/gift-card/void'](req, res).then(function () {
        expect(res.status).toHaveBeenCalledWith(200);
        var body = res.json.mock.calls[0][0];
        expect(body.ok).toBe(true);

        var voidCall = axiosMock.post.mock.calls[0];
        var voidPayload = JSON.parse(voidCall[1]);
        expect(voidPayload.action).toBe('void_gift_card');
        expect(voidPayload.cert_number).toBe('GC-000042');
        expect(voidPayload.reason).toBe('customer requested cancellation');
      });
    });

    test('unknown cert (Apps Script not_found) → 404', function () {
      axiosMock.post.mockResolvedValueOnce({ data: { ok: false, error: 'not_found' } });

      var req = { body: { cert_number: 'GC-000099', reason: 'lost' } };
      var res = mockRes();

      return handlers['/api/kiosk/gift-card/void'](req, res).then(function () {
        expect(res.status).toHaveBeenCalledWith(404);
      });
    });

    test('missing reason → 400, no Apps Script call', function () {
      var req = { body: { cert_number: 'GC-000042' } };
      var res = mockRes();

      handlers['/api/kiosk/gift-card/void'](req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(axiosMock.post).not.toHaveBeenCalled();
    });

    test('empty reason string → 400, no Apps Script call', function () {
      var req = { body: { cert_number: 'GC-000042', reason: '' } };
      var res = mockRes();

      handlers['/api/kiosk/gift-card/void'](req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(axiosMock.post).not.toHaveBeenCalled();
    });
  });
});
