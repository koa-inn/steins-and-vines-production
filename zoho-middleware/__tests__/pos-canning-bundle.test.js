'use strict';

// Phase 90 Plan 90-02: server-owned canning bundle on the kiosk money path.
// Every money assertion runs against BOTH /api/kiosk/sale and /api/kiosk/sale/confirm.

jest.mock('express', function () {
  var router = { get: jest.fn(), post: jest.fn(), put: jest.fn() };
  var express = function () {};
  express.Router = function () { return router; };
  return express;
});
jest.mock('../lib/helcim', function () {
  return {
    isTerminalEnabled: jest.fn().mockReturnValue(true),
    isEnabled: jest.fn().mockReturnValue(true),
    terminalPurchase: jest.fn().mockResolvedValue({ idempotencyKey: 'idem-1' }),
    pollTerminalResult: jest.fn(),
    voidTransaction: jest.fn().mockResolvedValue({}),
    getTerminalDiagnostics: jest.fn().mockReturnValue({}),
    generateIdempotencyKey: jest.fn().mockReturnValue('idem-so-1'),
    getCardTransactionById: jest.fn()
  };
});
jest.mock('../lib/zoho-api', function () {
  return {
    zohoGet: jest.fn(),
    zohoPost: jest.fn().mockResolvedValue({ invoice: { invoice_id: 'inv-1', invoice_number: 'INV-001' } }),
    zohoPut: jest.fn()
  };
});
jest.mock('../lib/cache', function () {
  return {
    get: jest.fn(),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    acquireLock: jest.fn().mockResolvedValue(true),
    releaseLock: jest.fn().mockResolvedValue(1)
  };
});
jest.mock('../lib/logger', function () {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
});
jest.mock('../lib/eventLog', function () { return { logEvent: jest.fn() }; });
jest.mock('../lib/mailer', function () { return { sendVoidFailureAlert: jest.fn() }; });
jest.mock('../lib/inventory-ledger', function () {
  return {
    decrementStock: jest.fn().mockResolvedValue({}),
    reconcileFromZoho: jest.fn()
  };
});
jest.mock('../lib/constants', function () {
  return {
    CACHE_KEYS: {
      KIOSK_PRODUCTS: 'test:kiosk-products',
      RECENT_ORDERS: 'test:recent-orders',
      KIOSK_IDEM_PREFIX: 'test:idem:',
      KIOSK_SALESORDERS: 'test:kiosk-salesorders',
      KIOSK_DISCOUNT_PRESETS: 'test:kiosk-discount-presets',
      CONSIGNMENT_REPORT_PREFIX: 'test:consignment:report:'
    },
    LEDGER_KEYS: {},
    RATE_LIMIT_PREFIX: 'test:rl:'
  };
});

var fx = require('./fixtures/canning-bundle-carts');

var SALE = '/api/kiosk/sale';
var CONFIRM = '/api/kiosk/sale/confirm';
var ENV_KEYS = ['ZOHO_TAX_STANDARD_ID', 'ZOHO_TAX_STANDARD_RULE', 'KIOSK_GST_TAX_ID', 'KIOSK_CONTACT_ID'];

function clone(o) { return JSON.parse(JSON.stringify(o)); }

describe('pos routes — server-owned canning bundle (Phase 90)', function () {
  var cache, zohoApi, helcimLib, ledger, router, handlers, savedEnv;

  function load() {
    jest.resetModules();
    cache = require('../lib/cache');
    zohoApi = require('../lib/zoho-api');
    helcimLib = require('../lib/helcim');
    ledger = require('../lib/inventory-ledger');
    require('../routes/pos');
    router = require('express').Router();
    handlers = {};
    router.post.mock.calls.forEach(function (call) { handlers[call[0]] = call[call.length - 1]; });
  }

  function useCatalog(catalog) {
    cache.get.mockImplementation(function (key) {
      if (key === 'test:kiosk-products') return Promise.resolve(catalog);
      if (key === 'test:kiosk-discount-presets') return Promise.resolve(fx.DISCOUNT_PRESETS);
      return Promise.resolve(null);
    });
  }

  beforeEach(function () {
    savedEnv = {};
    ENV_KEYS.forEach(function (k) { savedEnv[k] = process.env[k]; delete process.env[k]; });
    process.env.KIOSK_CONTACT_ID = 'contact-walkin';
    load();
    useCatalog(clone(fx.CATALOG));
  });
  afterEach(function () {
    ENV_KEYS.forEach(function (k) {
      if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
    });
  });

  // Runs a handler and resolves with { status, body } on the first response.
  // opts.noTxn: confirm without a terminal transaction id. opts.captured: Helcim captured amount.
  function send(route, bodyIn, opts) {
    opts = opts || {};
    var body = clone(bodyIn);
    if (route === CONFIRM) {
      body.idempotency_key = body.idempotency_key || 'idem-confirm-1';
      if (!opts.noTxn) body.transaction_id = 'txn-1';
      if (opts.captured !== undefined) {
        helcimLib.getCardTransactionById.mockResolvedValue({ status: 'APPROVED', amount: opts.captured });
      }
    }
    return new Promise(function (resolve, reject) {
      var res = { headersSent: false, locals: {} };
      var statusCode = 200;
      res.status = jest.fn(function (c) { statusCode = c; return res; });
      res.json = jest.fn(function (b) { resolve({ status: statusCode, body: b }); return res; });
      try {
        handlers[route]({ body: body, id: 'req-1' }, res);
      } catch (e) { reject(e); }
    });
  }

  function invoiceLines() {
    var call = zohoApi.zohoPost.mock.calls.find(function (c) { return c[0] === '/invoices'; });
    return call ? call[1].line_items : null;
  }

  function cartOf(name) {
    var c = fx.CARTS.filter(function (x) { return x.name.indexOf(name) === 0; })[0];
    return clone(c);
  }

  function bodyOf(cart, extra) {
    var b = { items: cart.items };
    if (cart.discount) b.discount = cart.discount;
    Object.keys(extra || {}).forEach(function (k) { b[k] = extra[k]; });
    return b;
  }

  describe.each([SALE, CONFIRM])('%s', function (route) {

    function chargedTotal() {
      return route === SALE ? helcimLib.terminalPurchase.mock.calls[0][0] : null;
    }

    test('beer-25 bundle with tampered client rate/taxable: server prices 40.00 + 4.80 = 44.80', async function () {
      var cart = cartOf('beer-25 + 52 x can-473');
      cart.items[0].rate = 0.01;
      cart.items[0].taxable = false;
      cart.items[0].description = 'FREE BEER';
      var r = await send(route, bodyOf(cart), { captured: 44.80 });
      expect(r.status).toBe(route === SALE ? 202 : 201);
      if (route === SALE) {
        expect(chargedTotal()).toBe(44.80);
      } else {
        var lines = invoiceLines();
        expect(lines).toHaveLength(2);
        expect(lines[0]).toMatchObject({
          custom: true,
          description: 'Canning Bundle — Beer 25 L (473 mL)',
          rate: 40,
          quantity: 1,
          tax_percentage: 12,
          tax_id: fx.STANDARD_TAX_ID
        });
        expect(lines[1]).toMatchObject({
          item_id: fx.CAN_473_ID, quantity: 52, rate: 0, tax_id: fx.STANDARD_TAX_ID
        });
        // D-11: the real can count reaches decrementStock unchanged.
        await new Promise(function (resolve) { setImmediate(resolve); });
        var ledgerLines = ledger.decrementStock.mock.calls[0][0];
        var ledgerCan = ledgerLines.filter(function (l) { return l.item_id === fx.CAN_473_ID; })[0];
        expect(ledgerCan.quantity).toBe(52);
      }
    });

    test('cider-23 bundle: 35.00 + 4.20 = 39.20', async function () {
      var cart = cartOf('cider-23 + 64 x can-355');
      var r = await send(route, bodyOf(cart), { captured: 39.20 });
      expect(r.status).toBe(route === SALE ? 202 : 201);
      if (route === SALE) expect(chargedTotal()).toBe(39.20);
      else {
        expect(invoiceLines()[0].description).toBe('Canning Bundle — Cider / sparkling wine 23 L (355 mL)');
        expect(invoiceLines()[0].rate).toBe(35);
      }
    });

    test('D-12: 60 cans on beer-25 / can-473 (above the 55 cap) is still 44.80', async function () {
      var cart = cartOf('beer-25 + 52 x can-473');
      cart.items[1].quantity = 60;
      var r = await send(route, bodyOf(cart), { captured: 44.80 });
      expect(r.status).toBe(route === SALE ? 202 : 201);
      if (route === SALE) expect(chargedTotal()).toBe(44.80);
      else expect(invoiceLines()[1].quantity).toBe(60);
    });

    test('a bundle cart does not need the 5% GST tax id', async function () {
      useCatalog(clone(fx.CATALOG).filter(function (p) { return p.item_id !== 'item-gst'; }));
      var cart = cartOf('beer-25 + 52 x can-473');
      var r = await send(route, bodyOf(cart), { captured: 44.80 });
      expect(r.status).toBe(route === SALE ? 202 : 201);
    });

    test('D-14 fixture (c): fixed $10 cart discount skips the bundle; totals match the fixture literals', async function () {
      var cart = cartOf('beer-25 + 52 x can-473 + 0% kit');
      expect(cart.expected).toEqual({ subtotal: 160.00, tax: 10.34, total: 170.34, discount: 10.00 });
      var r = await send(route, bodyOf(cart), { captured: cart.expected.total });
      expect(r.status).toBe(route === SALE ? 202 : 201);
      if (route === SALE) {
        expect(chargedTotal()).toBe(170.34);
      } else {
        var lines = invoiceLines();
        expect(lines[0].discount).toBeUndefined(); // bundle (custom) never discounted
        expect(lines[1].discount).toBe(0);          // $0 can line takes no share
        expect(lines[2].discount).toBe(6.15);
        expect(lines[3].discount).toBe(3.85);       // last matched line absorbs the remainder
        var discountTotal = lines.reduce(function (s, l) { return s + (l.discount || 0); }, 0);
        expect(Math.round(discountTotal * 100) / 100).toBe(cart.expected.discount);
      }
    });

    test('can line without a bundle line is rejected before any charge', async function () {
      var cart = cartOf('beer-25 + 52 x can-473');
      cart.items = [cart.items[1]];
      var r = await send(route, bodyOf(cart), { noTxn: true });
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/canning bundle/i);
      expect(helcimLib.terminalPurchase).not.toHaveBeenCalled();
      expect(zohoApi.zohoPost).not.toHaveBeenCalled();
    });

    test('bundle line without a can line is rejected', async function () {
      var cart = cartOf('beer-25 + 52 x can-473');
      cart.items = [cart.items[0]];
      var r = await send(route, bodyOf(cart), { noTxn: true });
      expect(r.status).toBe(400);
      expect(helcimLib.terminalPurchase).not.toHaveBeenCalled();
    });

    test('D-13: unknown bundle key (wine-still) rejected', async function () {
      var cart = cartOf('beer-25 + 52 x can-473');
      cart.items[0].bundle_key = 'wine-still';
      var r = await send(route, bodyOf(cart), { noTxn: true });
      expect(r.status).toBe(400);
      expect(helcimLib.terminalPurchase).not.toHaveBeenCalled();
    });

    test('two bundle lines rejected', async function () {
      var cart = cartOf('beer-25 + 52 x can-473');
      cart.items.push(clone(cart.items[0]));
      var r = await send(route, bodyOf(cart), { noTxn: true });
      expect(r.status).toBe(400);
    });

    test('bundle_can on a non-can SKU rejected (no free goods)', async function () {
      var cart = cartOf('beer-25 + 52 x can-473');
      cart.items[1].item_id = 'kit-fee-12';
      var r = await send(route, bodyOf(cart), { noTxn: true });
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/canning bundle/i);
    });

    test('bundle_can quantity 101 rejected', async function () {
      var cart = cartOf('beer-25 + 52 x can-473');
      cart.items[1].quantity = 101;
      var r = await send(route, bodyOf(cart), { noTxn: true });
      expect(r.status).toBe(400);
    });

    test('a client-sent bundle_can on a gift_cert line is rejected', async function () {
      var cart = cartOf('beer-25 + 52 x can-473');
      cart.items.push({ gift_cert: true, bundle_can: true, cert_number: 'GC-000001', rate: 50, quantity: 1 });
      process.env.KIOSK_GIFT_CARD_ITEM_ID = 'gc-item';
      try {
        var r = await send(route, bodyOf(cart), { noTxn: true });
        expect(r.status).toBe(400);
      } finally {
        delete process.env.KIOSK_GIFT_CARD_ITEM_ID;
      }
    });

    test('standard tax unresolvable (no env, no standard-rule item) fails closed with a canning bundle message', async function () {
      var catalog = clone(fx.CATALOG).map(function (p) {
        if (p.sales_tax_rule_id === '109900000000033423') p.sales_tax_rule_id = 'rule-other';
        return p;
      });
      useCatalog(catalog);
      var cart = cartOf('beer-25 + 52 x can-473');
      var r = await send(route, bodyOf(cart), { noTxn: true });
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/canning bundle/i);
      expect(r.body.error).toMatch(/ZOHO_TAX_STANDARD_ID/);
      expect(helcimLib.terminalPurchase).not.toHaveBeenCalled();
      expect(zohoApi.zohoPost).not.toHaveBeenCalled();
    });

    test('ZOHO_TAX_STANDARD_ID env is used for the bundle line tax_id', async function () {
      process.env.ZOHO_TAX_STANDARD_ID = 'env-standard-tax';
      var cart = cartOf('beer-25 + 52 x can-473');
      var r = await send(route, bodyOf(cart), { captured: 44.80 });
      expect(r.status).toBe(route === SALE ? 202 : 201);
      if (route === CONFIRM) expect(invoiceLines()[0].tax_id).toBe('env-standard-tax');
    });
  });

  describe('/api/kiosk/sale only — pre-charge client_grand_total assertion', function () {
    test('44.80 passes', async function () {
      var r = await send(SALE, bodyOf(cartOf('beer-25 + 52 x can-473'), { client_grand_total: 44.80 }));
      expect(r.status).toBe(202);
      expect(helcimLib.terminalPurchase).toHaveBeenCalledTimes(1);
    });
    test('40.32 is rejected 400 and no terminal charge starts', async function () {
      var r = await send(SALE, bodyOf(cartOf('beer-25 + 52 x can-473'), { client_grand_total: 40.32 }));
      expect(r.status).toBe(400);
      expect(helcimLib.terminalPurchase).not.toHaveBeenCalled();
    });
  });

  describe('/api/kiosk/sale/confirm — Phase 67 invariant (never a bare 400 once a charge exists)', function () {
    var invalidCarts = {
      'orphan can line': function (c) { c.items = [c.items[1]]; },
      'unknown bundle key': function (c) { c.items[0].bundle_key = 'wine-still'; },
      'non-can SKU': function (c) { c.items[1].item_id = 'kit-fee-12'; }
    };

    Object.keys(invalidCarts).forEach(function (label) {
      test(label + ' WITHOUT a transaction id: 400 and the confirm lock is released', async function () {
        var cart = cartOf('beer-25 + 52 x can-473');
        invalidCarts[label](cart);
        var r = await send(CONFIRM, bodyOf(cart), { noTxn: true });
        expect(r.status).toBe(400);
        expect(r.body.error).toMatch(/canning bundle|cans/i);
        expect(cache.releaseLock).toHaveBeenCalledWith('test:idem:confirm:idem-confirm-1');
        expect(helcimLib.voidTransaction).not.toHaveBeenCalled();
      });

      test(label + ' WITH a transaction id: charge is voided, no bare 400', async function () {
        var cart = cartOf('beer-25 + 52 x can-473');
        invalidCarts[label](cart);
        var r = await send(CONFIRM, bodyOf(cart));
        expect(r.status).not.toBe(400);
        expect(helcimLib.voidTransaction).toHaveBeenCalledWith('txn-1');
        expect(r.body.payment_voided).toBe(true);
        expect(zohoApi.zohoPost).not.toHaveBeenCalled();
      });
    });

    function noStandardTaxCatalog() {
      return clone(fx.CATALOG).map(function (p) {
        if (p.sales_tax_rule_id === '109900000000033423') p.sales_tax_rule_id = 'rule-other';
        return p;
      });
    }

    test('unresolvable standard tax WITHOUT a transaction id: 400 + lock released', async function () {
      useCatalog(noStandardTaxCatalog());
      var r = await send(CONFIRM, bodyOf(cartOf('beer-25 + 52 x can-473')), { noTxn: true });
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/canning bundle/i);
      expect(cache.releaseLock).toHaveBeenCalledWith('test:idem:confirm:idem-confirm-1');
    });

    test('unresolvable standard tax WITH a transaction id: charge is voided, no bare 400', async function () {
      useCatalog(noStandardTaxCatalog());
      var r = await send(CONFIRM, bodyOf(cartOf('beer-25 + 52 x can-473')));
      expect(r.status).not.toBe(400);
      expect(helcimLib.voidTransaction).toHaveBeenCalledWith('txn-1');
      expect(zohoApi.zohoPost).not.toHaveBeenCalled();
    });

    test('no client_grand_total assertion on confirm: a mismatching client total is ignored', async function () {
      var r = await send(CONFIRM, bodyOf(cartOf('beer-25 + 52 x can-473'), { client_grand_total: 1.00 }), { captured: 44.80 });
      expect(r.status).toBe(201);
    });
  });
});
