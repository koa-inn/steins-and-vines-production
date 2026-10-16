'use strict';

// Regression (prod, 2026-10-16): reconcile() kept min(ledger, Zoho) and refreshed the key's 2h TTL
// on every sync, so a Zoho stock INCREASE (deleted invoice, return, restock, upward adjustment)
// never reached the kiosk or website while daytime traffic kept reconciling. A deleted test sale
// left an S-type airlock at 10 on the kiosk while Zoho had 11.
//
// The lower ledger value is only meant to cover a sale Zoho has not reflected yet:
//  - kiosk sales create a Zoho invoice at once, so the hold lasts a short window;
//  - website checkouts create a sales order, which does not lower Zoho's stock_on_hand, so their
//    hold keeps today's behaviour (refreshed while Zoho stays higher).
// With no hold, Zoho is trusted in both directions.

jest.mock('../lib/cache', function () { return { getClient: jest.fn() }; });
jest.mock('../lib/logger', function () { return { info: jest.fn(), warn: jest.fn(), error: jest.fn() }; });

var cache = require('../lib/cache');
var ledger = require('../lib/inventory-ledger');

// Minimal in-memory Redis: values plus TTLs (seconds), enough for the ledger's commands.
function makeRedis() {
  var store = {};
  var ttl = {};
  function run(cmd) { return cmd(); }
  function cmds() {
    return {
      get: function (k) { return store.hasOwnProperty(k) ? store[k] : null; },
      set: function (k, v, opts) {
        if (opts && opts.NX && store.hasOwnProperty(k)) return null;
        store[k] = String(v); if (opts && opts.EX) ttl[k] = opts.EX; return 'OK';
      },
      expire: function (k, s) { if (store.hasOwnProperty(k)) { ttl[k] = s; return 1; } return 0; },
      incr: function (k) { store[k] = String((parseFloat(store[k]) || 0) + 1); return store[k]; },
      incrByFloat: function (k, d) { store[k] = String((parseFloat(store[k]) || 0) + d); return store[k]; },
      lPush: function (k, v) { store[k] = store[k] || []; store[k].unshift(v); return store[k].length; },
      lTrim: function () { return 'OK'; }
    };
  }
  var client = {
    _store: store,
    _ttl: ttl,
    get: function (k) { return Promise.resolve(cmds().get(k)); },
    multi: function () {
      var queued = [];
      var c = cmds();
      var p = {};
      Object.keys(c).forEach(function (name) {
        p[name] = function () { var args = arguments; queued.push(function () { return c[name].apply(null, args); }); return p; };
      });
      p.exec = function () { return Promise.resolve(queued.map(run)); };
      return p;
    }
  };
  return client;
}

var ID = 'AIRLOCK';
var KEY = 'inv:stock:' + ID;

beforeEach(function () { process.env.INVENTORY_LEDGER_ENABLED = 'true'; });
afterEach(function () { delete process.env.INVENTORY_LEDGER_ENABLED; jest.clearAllMocks(); });

describe('inventory ledger accepts Zoho stock increases', function () {
  test('with no recent sale, a higher Zoho value replaces the ledger (restock / deleted invoice)', async function () {
    var r = makeRedis(); cache.getClient.mockResolvedValue(r);
    r._store[KEY] = '10';
    await ledger.reconcile([{ item_id: ID, stock_on_hand: 11 }]);
    expect(r._store[KEY]).toBe('11');
  });

  test('right after a kiosk sale, a stale higher Zoho value does not undo the decrement', async function () {
    var r = makeRedis(); cache.getClient.mockResolvedValue(r);
    await ledger.reconcile([{ item_id: ID, stock_on_hand: 11 }]);
    await ledger.decrementStock([{ item_id: ID, quantity: 1 }], 'kiosk:INV-000243');
    expect(r._store[KEY]).toBe('10');
    // A catalog fetch that started before the invoice landed still reports 11.
    await ledger.reconcile([{ item_id: ID, stock_on_hand: 11 }]);
    expect(r._store[KEY]).toBe('10');
  });

  test('the kiosk hold is short-lived (10 minutes) and is not extended by reconciles', async function () {
    var r = makeRedis(); cache.getClient.mockResolvedValue(r);
    await ledger.reconcile([{ item_id: ID, stock_on_hand: 11 }]);
    await ledger.decrementStock([{ item_id: ID, quantity: 1 }], 'kiosk:INV-000243');
    var holdKey = Object.keys(r._store).filter(function (k) { return k.indexOf('inv:hold:') === 0; })[0];
    expect(holdKey).toBeDefined();
    expect(r._ttl[holdKey]).toBe(600);
    await ledger.reconcile([{ item_id: ID, stock_on_hand: 11 }]);
    expect(r._ttl[holdKey]).toBe(600);
  });

  test('once the kiosk hold has expired, Zoho is trusted again (the deleted-invoice case)', async function () {
    var r = makeRedis(); cache.getClient.mockResolvedValue(r);
    await ledger.reconcile([{ item_id: ID, stock_on_hand: 11 }]);
    await ledger.decrementStock([{ item_id: ID, quantity: 1 }], 'kiosk:INV-000243');
    Object.keys(r._store).forEach(function (k) { if (k.indexOf('inv:hold:') === 0) delete r._store[k]; }); // TTL elapsed
    await ledger.reconcile([{ item_id: ID, stock_on_hand: 11 }]);
    expect(r._store[KEY]).toBe('11');
  });

  test('a website checkout (sales order) keeps its decrement while Zoho stays higher, as before', async function () {
    var r = makeRedis(); cache.getClient.mockResolvedValue(r);
    await ledger.reconcile([{ item_id: ID, stock_on_hand: 11 }]);
    await ledger.decrementStock([{ item_id: ID, quantity: 2 }], 'checkout:SO-00042');
    await ledger.reconcile([{ item_id: ID, stock_on_hand: 11 }]);
    expect(r._store[KEY]).toBe('9');
    var holdKey = Object.keys(r._store).filter(function (k) { return k.indexOf('inv:hold:') === 0; })[0];
    expect(r._ttl[holdKey]).toBe(7200);
  });

  test('a kiosk sale never shortens a pending website order\'s hold', async function () {
    var r = makeRedis(); cache.getClient.mockResolvedValue(r);
    await ledger.reconcile([{ item_id: ID, stock_on_hand: 11 }]);
    await ledger.decrementStock([{ item_id: ID, quantity: 2 }], 'checkout:SO-00042');
    await ledger.decrementStock([{ item_id: ID, quantity: 1 }], 'kiosk:INV-000300');
    expect(r._store['inv:hold:' + ID]).toBe('order');
    expect(r._ttl['inv:hold:' + ID]).toBe(7200);
  });

  test('a lower Zoho value always wins (sales elsewhere), hold or not', async function () {
    var r = makeRedis(); cache.getClient.mockResolvedValue(r);
    await ledger.reconcile([{ item_id: ID, stock_on_hand: 11 }]);
    await ledger.decrementStock([{ item_id: ID, quantity: 1 }], 'kiosk:INV-1');
    await ledger.reconcile([{ item_id: ID, stock_on_hand: 7 }]);
    expect(r._store[KEY]).toBe('7');
  });
});
