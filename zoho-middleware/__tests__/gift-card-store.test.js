'use strict';

// ---------------------------------------------------------------------------
// Tests for lib/gift-card-store.js — Phase 84 Plan 05 (DB-03).
//
// This is the single facade every gift-card call site (routes, pos.js, the
// reconcile replay sweep) goes through. It resolves GIFT_CARDS_STORE per
// call and dispatches to sheets (byte-for-byte Apps Script parity) / dual
// (Postgres authoritative + fire-and-forget sheet re-run + compare) /
// postgres (Postgres authoritative + fire-and-forget copy-state mirror).
//
// Every dependency below is mocked per the plan's <action> instructions:
//   axios               - never actually calls Apps Script
//   ../lib/db           - withTransaction invokes fn with a fake client
//   ../lib/gift-card-pg - the atomic Postgres op layer (84-01)
//   ../lib/sheet-mirror - mirrorFireAndForget runs fn() synchronously here
//                         (real production gating is covered by 83-04's own
//                         sheet-mirror.test.js, not re-tested here)
//   ../lib/dual-write-compare
//   ../lib/reconcile    - recordGiftCardReconcileFailure (D-11 hook, 84-06)
//   ../lib/logger
// ---------------------------------------------------------------------------

jest.mock('axios');

jest.mock('../lib/db', function () {
  return {
    withTransaction: jest.fn(function (fn) { return fn({}); }),
    isConfigured: jest.fn(function () { return true; })
  };
});

jest.mock('../lib/gift-card-pg', function () {
  return {
    lookup: jest.fn(),
    issue: jest.fn(),
    redeem: jest.fn(),
    reload: jest.fn(),
    adjust: jest.fn(),
    voidCard: jest.fn(),
    updateInvoice: jest.fn(),
    nextCertNumber: jest.fn()
  };
});

jest.mock('../lib/sheet-mirror', function () {
  return {
    mirrorFireAndForget: jest.fn(function (label, fn) { return fn(); })
  };
});

jest.mock('../lib/dual-write-compare', function () {
  return { compareAndReport: jest.fn() };
});

jest.mock('../lib/reconcile', function () {
  return { recordGiftCardReconcileFailure: jest.fn().mockResolvedValue() };
});

jest.mock('../lib/logger', function () {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
});

var axios, db, giftCardPg, sheetMirror, dualWriteCompare, reconcile, store;
var SAVED_ENV;

function flushPromises() {
  return new Promise(function (resolve) { setImmediate(resolve); });
}

function bodyOf(call) {
  return JSON.parse(call[1]);
}

function actionCalls(action) {
  return axios.post.mock.calls.filter(function (c) { return bodyOf(c).action === action; });
}

function fakeCard(overrides) {
  return Object.assign({
    cert_number: 'GC-000001',
    face_value: 50,
    current_balance: 40,
    status: 'active',
    issued_date: '2026-10-01',
    issued_by: 'kiosk',
    zoho_invoice_number: null,
    notes: null,
    created_at: '2026-10-01T00:00:00.000Z',
    last_updated: '2026-10-03T00:00:00.000Z'
  }, overrides || {});
}

function fakeLedger(overrides) {
  return Object.assign({
    id: 1,
    cert_number: 'GC-000001',
    tx_ref: 'SALE-1:GC-000001:redeem',
    kind: 'redeem',
    amount: -10,
    balance_before: 50,
    balance_after: 40,
    imported: false,
    actor: 'kiosk:device',
    actor_name: null,
    device_label: null,
    reason: null,
    note: null,
    source_tx_id: null,
    created_at: '2026-10-03T00:00:00.000Z'
  }, overrides || {});
}

beforeEach(function () {
  SAVED_ENV = Object.assign({}, process.env);
  jest.resetModules();

  axios = require('axios');
  axios.post = jest.fn();

  db = require('../lib/db');
  giftCardPg = require('../lib/gift-card-pg');
  sheetMirror = require('../lib/sheet-mirror');
  dualWriteCompare = require('../lib/dual-write-compare');
  reconcile = require('../lib/reconcile');
  store = require('../lib/gift-card-store');

  delete process.env.GIFT_CARDS_STORE;
  delete process.env.APPS_SCRIPT_URL;
  delete process.env.APPS_SCRIPT_SERVER_TOKEN;
  process.env.APPS_SCRIPT_URL = 'https://script.google.com/macros/exec';
  process.env.APPS_SCRIPT_SERVER_TOKEN = 'test-server-token';
});

afterEach(function () {
  Object.keys(process.env).forEach(function (k) {
    if (!(k in SAVED_ENV)) delete process.env[k];
  });
  Object.keys(SAVED_ENV).forEach(function (k) { process.env[k] = SAVED_ENV[k]; });
});

// ─── mode / config / helpers ────────────────────────────────────────────

describe('getMode / isConfigured', function () {
  test('unset GIFT_CARDS_STORE -> sheets; isConfigured reflects Apps Script env vars', function () {
    expect(store.getMode()).toBe('sheets');
    expect(store.isConfigured()).toBe(true);
    delete process.env.APPS_SCRIPT_SERVER_TOKEN;
    expect(store.isConfigured()).toBe(false);
  });

  test('dual/postgres isConfigured defers to db.isConfigured()', function () {
    process.env.GIFT_CARDS_STORE = 'postgres';
    db.isConfigured.mockReturnValue(false);
    expect(store.isConfigured()).toBe(false);
    db.isConfigured.mockReturnValue(true);
    expect(store.isConfigured()).toBe(true);
  });
});

describe('mintTxRef', function () {
  test('composes saleRef:certNumber:kind', function () {
    expect(store.mintTxRef('SALE-1', 'GC-000001', 'redeem')).toBe('SALE-1:GC-000001:redeem');
  });

  test('truncates saleRef so the composite result stays <= 200 chars', function () {
    var longRef = new Array(300).join('x');
    var txRef = store.mintTxRef(longRef, 'GC-000001', 'redeem');
    expect(txRef.length).toBeLessThanOrEqual(200);
    expect(txRef.indexOf(':GC-000001:redeem')).toBeGreaterThan(-1);
  });
});

describe('actorFromRequest', function () {
  test('session identity when staffEmail present', function () {
    expect(store.actorFromRequest({ staffEmail: 'staff@example.com' }, 'kiosk')).toBe('kiosk:session:staff@example.com');
  });

  test('authTier identity when no staffEmail', function () {
    expect(store.actorFromRequest({ authTier: 'device' }, 'kiosk')).toBe('kiosk:device');
  });

  test('unknown fallback when neither present', function () {
    expect(store.actorFromRequest({}, 'kiosk')).toBe('kiosk:unknown');
  });
});

// ─── redeem ──────────────────────────────────────────────────────────────

describe('redeem', function () {
  test('sheets: exactly one axios.post with the exact Apps Script body + options; withTransaction never called', function () {
    process.env.GIFT_CARDS_STORE = 'sheets';
    axios.post.mockResolvedValue({ data: { ok: true, new_balance: 40, status: 'active', tx_id: 'tx-1' } });

    return store.redeem({ certNumber: 'GC-000001', amount: 10, saleRef: 'KIOSK-1', actor: 'kiosk:device' }).then(function (result) {
      expect(axios.post).toHaveBeenCalledTimes(1);
      var call = axios.post.mock.calls[0];
      var body = bodyOf(call);
      expect(body).toEqual({
        action: 'redeem_gift_card',
        server_token: 'test-server-token',
        cert_number: 'GC-000001',
        amount: 10,
        transaction_ref: 'KIOSK-1'
      });
      expect(call[2]).toEqual({ headers: { 'Content-Type': 'application/json' }, timeout: 12000, maxRedirects: 5 });
      expect(db.withTransaction).not.toHaveBeenCalled();
      expect(result).toEqual({ ok: true, new_balance: 40, status: 'active', tx_id: 'tx-1' });
    });
  });

  test('postgres: calls gift-card-pg.redeem inside withTransaction with the composite txRef; result has no underscore keys', function () {
    process.env.GIFT_CARDS_STORE = 'postgres';
    giftCardPg.redeem.mockResolvedValue({
      ok: true, new_balance: 40, status: 'active', tx_ref: 'KIOSK-1:GC-000001:redeem',
      _card: fakeCard(), _ledger: fakeLedger()
    });

    return store.redeem({ certNumber: 'GC-000001', amount: 10, saleRef: 'KIOSK-1', actor: 'kiosk:device' }).then(function (result) {
      expect(db.withTransaction).toHaveBeenCalledTimes(1);
      expect(giftCardPg.redeem).toHaveBeenCalledTimes(1);
      expect(giftCardPg.redeem.mock.calls[0][1].txRef).toBe('KIOSK-1:GC-000001:redeem');
      Object.keys(result).forEach(function (key) {
        expect(key.charAt(0)).not.toBe('_');
      });
      expect(result.new_balance).toBe(40);
    });
  });

  test('Pitfall 1: redeem GC-A and issue GC-B sharing the same saleRef mint two distinct txRefs', function () {
    process.env.GIFT_CARDS_STORE = 'postgres';
    giftCardPg.redeem.mockResolvedValue({ ok: true, new_balance: 0, status: 'depleted', _card: fakeCard(), _ledger: fakeLedger() });
    giftCardPg.issue.mockResolvedValue({ ok: true, cert_number: 'GC-000002', face_value: 20, current_balance: 20, _card: fakeCard({ cert_number: 'GC-000002' }), _ledger: fakeLedger({ cert_number: 'GC-000002', kind: 'issue' }) });

    return Promise.all([
      store.redeem({ certNumber: 'GC-000001', amount: 10, saleRef: 'SALE-SHARED', actor: 'x' }),
      store.issue({ certNumber: 'GC-000002', faceValue: 20, issuedBy: 'kiosk', notes: null, saleRef: 'SALE-SHARED', actor: 'x' })
    ]).then(function () {
      var redeemTxRef = giftCardPg.redeem.mock.calls[0][1].txRef;
      var issueTxRef = giftCardPg.issue.mock.calls[0][1].txRef;
      expect(redeemTxRef).toBe('SALE-SHARED:GC-000001:redeem');
      expect(issueTxRef).toBe('SALE-SHARED:GC-000002:issue');
      expect(redeemTxRef).not.toBe(issueTxRef);
    });
  });

  test('dual: after pg ok, sheet leg fires with the composite txRef and compareAndReport runs with projected values', function () {
    process.env.GIFT_CARDS_STORE = 'dual';
    giftCardPg.redeem.mockResolvedValue({ ok: true, new_balance: 40, status: 'active', _card: fakeCard(), _ledger: fakeLedger() });
    axios.post.mockResolvedValue({ data: { ok: true, new_balance: 40, status: 'active', tx_id: 'sheet-tx-1' } });

    return store.redeem({ certNumber: 'GC-000001', amount: 10, saleRef: 'KIOSK-1', actor: 'kiosk:device' }).then(function () {
      return flushPromises();
    }).then(function () {
      expect(axios.post).toHaveBeenCalledTimes(1);
      var body = bodyOf(axios.post.mock.calls[0]);
      expect(body.action).toBe('redeem_gift_card');
      expect(body.transaction_ref).toBe('KIOSK-1:GC-000001:redeem');

      expect(dualWriteCompare.compareAndReport).toHaveBeenCalledTimes(1);
      var compareArgs = dualWriteCompare.compareAndReport.mock.calls[0][0];
      expect(compareArgs.store).toBe('giftcards');
      expect(compareArgs.operation).toBe('redeem');
      expect(compareArgs.reportValuesFor).toEqual(['balance']);
      expect(compareArgs.sheets).toEqual({ ok: true, balance: 40, status: 'active', error: null });
      expect(compareArgs.postgres).toEqual({ ok: true, balance: 40, status: 'active', error: null });
    });
  });

  test('dual: pg result {ok:false} -> no sheet leg, no compare', function () {
    process.env.GIFT_CARDS_STORE = 'dual';
    giftCardPg.redeem.mockResolvedValue({ ok: false, error: 'insufficient_balance', balance: 5 });

    return store.redeem({ certNumber: 'GC-000001', amount: 10, saleRef: 'KIOSK-1', actor: 'x' }).then(function (result) {
      expect(result).toEqual({ ok: false, error: 'insufficient_balance', balance: 5 });
      return flushPromises();
    }).then(function () {
      expect(axios.post).not.toHaveBeenCalled();
      expect(dualWriteCompare.compareAndReport).not.toHaveBeenCalled();
    });
  });

  test('postgres: successful write fires mirror_gift_card_state built from _card/_ledger; redeem_gift_card never re-runs', function () {
    process.env.GIFT_CARDS_STORE = 'postgres';
    var card = fakeCard();
    var ledger = fakeLedger();
    giftCardPg.redeem.mockResolvedValue({ ok: true, new_balance: 40, status: 'active', _card: card, _ledger: ledger });
    axios.post.mockResolvedValue({ data: { ok: true } });

    return store.redeem({ certNumber: 'GC-000001', amount: 10, saleRef: 'KIOSK-1', actor: 'kiosk:device' }).then(function () {
      return flushPromises();
    }).then(function () {
      expect(actionCalls('redeem_gift_card').length).toBe(0);
      expect(actionCalls('mirror_gift_card_state').length).toBe(1);
      var body = bodyOf(actionCalls('mirror_gift_card_state')[0]);
      expect(body.cert_number).toBe(card.cert_number);
      expect(body.current_balance).toBe(card.current_balance);
      expect(body.ledger_entry.tx_ref).toBe(ledger.tx_ref);
      expect(body.ledger_entry.kind).toBe(ledger.kind);
    });
  });
});

// ─── issue ───────────────────────────────────────────────────────────────

describe('issue', function () {
  test('sheets: issue_gift_card fields with no transaction_ref', function () {
    process.env.GIFT_CARDS_STORE = 'sheets';
    axios.post.mockResolvedValue({ data: { ok: true, cert_number: 'GC-000001', face_value: 50, current_balance: 50 } });

    return store.issue({ certNumber: 'GC-000001', faceValue: 50, issuedBy: 'kiosk', notes: 'n', saleRef: 'KIOSK-1', actor: 'x' }).then(function () {
      var body = bodyOf(axios.post.mock.calls[0]);
      expect(body).toEqual({
        action: 'issue_gift_card',
        server_token: 'test-server-token',
        cert_number: 'GC-000001',
        face_value: 50,
        issued_by: 'kiosk',
        notes: 'n'
      });
      expect(body.transaction_ref).toBeUndefined();
    });
  });

  test('dual: sheet leg includes transaction_ref = composite txRef', function () {
    process.env.GIFT_CARDS_STORE = 'dual';
    giftCardPg.issue.mockResolvedValue({ ok: true, cert_number: 'GC-000001', face_value: 50, current_balance: 50, _card: fakeCard(), _ledger: fakeLedger({ kind: 'issue' }) });
    axios.post.mockResolvedValue({ data: { ok: true, cert_number: 'GC-000001', face_value: 50, current_balance: 50 } });

    return store.issue({ certNumber: 'GC-000001', faceValue: 50, issuedBy: 'kiosk', notes: null, saleRef: 'KIOSK-1', actor: 'x' }).then(function () {
      return flushPromises();
    }).then(function () {
      var body = bodyOf(actionCalls('issue_gift_card')[0]);
      expect(body.transaction_ref).toBe('KIOSK-1:GC-000001:issue');
    });
  });
});

// ─── reload ──────────────────────────────────────────────────────────────

describe('reload', function () {
  test('sheets: reload_gift_card with transaction_ref = raw saleRef', function () {
    process.env.GIFT_CARDS_STORE = 'sheets';
    axios.post.mockResolvedValue({ data: { ok: true, new_balance: 60, status: 'active' } });

    return store.reload({ certNumber: 'GC-000001', amount: 20, saleRef: 'KIOSK-2', actor: 'x' }).then(function () {
      var body = bodyOf(axios.post.mock.calls[0]);
      expect(body).toEqual({
        action: 'reload_gift_card',
        server_token: 'test-server-token',
        cert_number: 'GC-000001',
        amount: 20,
        transaction_ref: 'KIOSK-2'
      });
    });
  });

  test('postgres: calls gift-card-pg.reload with the composite txRef', function () {
    process.env.GIFT_CARDS_STORE = 'postgres';
    giftCardPg.reload.mockResolvedValue({ ok: true, new_balance: 60, status: 'active', _card: fakeCard(), _ledger: fakeLedger({ kind: 'reload' }) });

    return store.reload({ certNumber: 'GC-000001', amount: 20, saleRef: 'KIOSK-2', actor: 'x' }).then(function (result) {
      expect(giftCardPg.reload.mock.calls[0][1].txRef).toBe('KIOSK-2:GC-000001:reload');
      expect(result.new_balance).toBe(60);
    });
  });
});

// ─── adjust ──────────────────────────────────────────────────────────────

describe('adjust', function () {
  test('sheets: resolves adjust_unavailable with zero axios calls (D-07)', function () {
    process.env.GIFT_CARDS_STORE = 'sheets';
    return store.adjust({ certNumber: 'GC-000001', delta: 5, reason: 'r', note: 'n', actorName: 'Staff', deviceLabel: 'kiosk-1', adjustKey: 'K1', actor: 'x' }).then(function (result) {
      expect(result).toEqual({ ok: false, error: 'adjust_unavailable' });
      expect(axios.post).not.toHaveBeenCalled();
    });
  });

  test('dual adjust +5 -> sheet leg reload_gift_card amount 5 with the adjust txRef', function () {
    process.env.GIFT_CARDS_STORE = 'dual';
    giftCardPg.adjust.mockResolvedValue({ ok: true, new_balance: 15, status: 'active', _card: fakeCard({ current_balance: 15 }), _ledger: fakeLedger({ kind: 'adjust', amount: 5 }) });
    axios.post.mockResolvedValue({ data: { ok: true, new_balance: 15, status: 'active' } });

    return store.adjust({ certNumber: 'GC-000001', delta: 5, reason: 'r', note: 'n', actorName: 'Staff', deviceLabel: 'kiosk-1', adjustKey: 'K1', actor: 'x' }).then(function () {
      return flushPromises();
    }).then(function () {
      var reloadCalls = actionCalls('reload_gift_card');
      expect(reloadCalls.length).toBe(1);
      var body = bodyOf(reloadCalls[0]);
      expect(body.amount).toBe(5);
      expect(body.transaction_ref).toBe('ADJ-K1:GC-000001:adjust');
      expect(actionCalls('redeem_gift_card').length).toBe(0);
    });
  });

  test('dual adjust -5 -> sheet leg redeem_gift_card amount 5 (absolute value) with the adjust txRef', function () {
    process.env.GIFT_CARDS_STORE = 'dual';
    giftCardPg.adjust.mockResolvedValue({ ok: true, new_balance: 5, status: 'active', _card: fakeCard({ current_balance: 5 }), _ledger: fakeLedger({ kind: 'adjust', amount: -5 }) });
    axios.post.mockResolvedValue({ data: { ok: true, new_balance: 5, status: 'active' } });

    return store.adjust({ certNumber: 'GC-000001', delta: -5, reason: 'r', note: 'n', actorName: 'Staff', deviceLabel: 'kiosk-1', adjustKey: 'K2', actor: 'x' }).then(function () {
      return flushPromises();
    }).then(function () {
      var redeemCalls = actionCalls('redeem_gift_card');
      expect(redeemCalls.length).toBe(1);
      var body = bodyOf(redeemCalls[0]);
      expect(body.amount).toBe(5);
      expect(body.transaction_ref).toBe('ADJ-K2:GC-000001:adjust');
      expect(actionCalls('reload_gift_card').length).toBe(0);
    });
  });

  test('no literal adjust Apps Script action is ever sent (D-07)', function () {
    process.env.GIFT_CARDS_STORE = 'dual';
    giftCardPg.adjust.mockResolvedValue({ ok: true, new_balance: 15, status: 'active', _card: fakeCard(), _ledger: fakeLedger({ kind: 'adjust' }) });
    axios.post.mockResolvedValue({ data: { ok: true } });

    return store.adjust({ certNumber: 'GC-000001', delta: 5, reason: 'r', note: 'n', actorName: 'Staff', deviceLabel: 'kiosk-1', adjustKey: 'K3', actor: 'x' }).then(function () {
      return flushPromises();
    }).then(function () {
      var actions = axios.post.mock.calls.map(function (c) { return bodyOf(c).action; });
      actions.forEach(function (a) {
        expect(a === 'reload_gift_card' || a === 'redeem_gift_card').toBe(true);
      });
    });
  });
});

// ─── voidCard / updateInvoice ────────────────────────────────────────────

describe('voidCard', function () {
  test('sheets: void_gift_card {cert_number, reason}', function () {
    process.env.GIFT_CARDS_STORE = 'sheets';
    axios.post.mockResolvedValue({ data: { ok: true, status: 'void' } });

    return store.voidCard({ certNumber: 'GC-000001', reason: 'lost', actor: 'x' }).then(function () {
      var body = bodyOf(axios.post.mock.calls[0]);
      expect(body).toEqual({
        action: 'void_gift_card',
        server_token: 'test-server-token',
        cert_number: 'GC-000001',
        reason: 'lost'
      });
    });
  });

  test('postgres: calls gift-card-pg.voidCard', function () {
    process.env.GIFT_CARDS_STORE = 'postgres';
    giftCardPg.voidCard.mockResolvedValue({ ok: true, status: 'void', _card: fakeCard({ status: 'void' }), _ledger: fakeLedger({ kind: 'void' }) });

    return store.voidCard({ certNumber: 'GC-000001', reason: 'lost', actor: 'x' }).then(function (result) {
      expect(giftCardPg.voidCard).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('void');
    });
  });
});

describe('updateInvoice', function () {
  test('sheets: update_gift_card_invoice {cert_number, zoho_invoice_number}', function () {
    process.env.GIFT_CARDS_STORE = 'sheets';
    axios.post.mockResolvedValue({ data: { ok: true } });

    return store.updateInvoice({ certNumber: 'GC-000001', invoiceNumber: 'INV-123' }).then(function () {
      var body = bodyOf(axios.post.mock.calls[0]);
      expect(body).toEqual({
        action: 'update_gift_card_invoice',
        server_token: 'test-server-token',
        cert_number: 'GC-000001',
        zoho_invoice_number: 'INV-123'
      });
    });
  });

  test('dual: issue then updateInvoice on the same cert — the update sheet call starts only after the issue sheet call settles', function () {
    process.env.GIFT_CARDS_STORE = 'dual';

    giftCardPg.issue.mockResolvedValue({
      ok: true, cert_number: 'GC-000050', face_value: 20, current_balance: 20,
      _card: fakeCard({ cert_number: 'GC-000050' }), _ledger: fakeLedger({ cert_number: 'GC-000050', kind: 'issue' })
    });
    giftCardPg.updateInvoice.mockResolvedValue({ ok: true, _card: fakeCard({ cert_number: 'GC-000050' }), _ledger: null });

    var resolveIssueSheet;
    var issueSheetGate = new Promise(function (resolve) { resolveIssueSheet = resolve; });

    axios.post.mockImplementation(function (url, bodyStr) {
      var body = JSON.parse(bodyStr);
      if (body.action === 'issue_gift_card') {
        return issueSheetGate.then(function () { return { data: { ok: true } }; });
      }
      return Promise.resolve({ data: { ok: true } });
    });

    store.issue({ certNumber: 'GC-000050', faceValue: 20, issuedBy: 'kiosk', notes: null, saleRef: 'SALE-9', actor: 'x' });
    store.updateInvoice({ certNumber: 'GC-000050', invoiceNumber: 'INV-1' });

    return flushPromises().then(function () {
      expect(actionCalls('update_gift_card_invoice').length).toBe(0);
      resolveIssueSheet();
      return flushPromises();
    }).then(flushPromises).then(function () {
      expect(actionCalls('update_gift_card_invoice').length).toBe(1);
    });
  });
});

// ─── D-11: post-charge infra-failure recording ──────────────────────────

describe('D-11 reconcile hook', function () {
  test('withTransaction rejects on redeem with postCharge true -> records failure BEFORE rejecting', function () {
    process.env.GIFT_CARDS_STORE = 'postgres';
    var infraErr = new Error('connection terminated');
    db.withTransaction.mockImplementationOnce(function () { return Promise.reject(infraErr); });

    var promise = store.redeem({
      certNumber: 'GC-000001', amount: 10, saleRef: 'SALE-1', actor: 'x',
      postCharge: true, txRef: 'SALE-1:GC-000001:redeem'
    });

    return promise.then(function () {
      throw new Error('expected rejection');
    }, function (err) {
      expect(err).toBe(infraErr);
      expect(reconcile.recordGiftCardReconcileFailure).toHaveBeenCalledTimes(1);
      var record = reconcile.recordGiftCardReconcileFailure.mock.calls[0][0];
      expect(record.op).toBe('redeem');
      expect(record.tx_ref).toBe('SALE-1:GC-000001:redeem');
      expect(record.cert_number).toBe('GC-000001');
      expect(record.amount).toBe(10);
      expect(record.params.txRef).toBe('SALE-1:GC-000001:redeem');
      expect(record.error).toBe('connection terminated');
    });
  });

  test('postCharge false -> infra failure rejects without recording (void/adjust-style no-record path)', function () {
    process.env.GIFT_CARDS_STORE = 'postgres';
    var infraErr = new Error('boom');
    db.withTransaction.mockImplementationOnce(function () { return Promise.reject(infraErr); });

    return store.redeem({ certNumber: 'GC-000001', amount: 10, saleRef: 'SALE-1', actor: 'x', postCharge: false }).then(function () {
      throw new Error('expected rejection');
    }, function (err) {
      expect(err).toBe(infraErr);
      expect(reconcile.recordGiftCardReconcileFailure).not.toHaveBeenCalled();
    });
  });

  test('a resolved {ok:false} business rejection never records (only a true rejection does)', function () {
    process.env.GIFT_CARDS_STORE = 'postgres';
    giftCardPg.redeem.mockResolvedValue({ ok: false, error: 'insufficient_balance', balance: 0 });

    return store.redeem({ certNumber: 'GC-000001', amount: 10, saleRef: 'SALE-1', actor: 'x', postCharge: true }).then(function (result) {
      expect(result.ok).toBe(false);
      expect(reconcile.recordGiftCardReconcileFailure).not.toHaveBeenCalled();
    });
  });
});

// ─── replayPending ───────────────────────────────────────────────────────

describe('replayPending', function () {
  test('postgres mode calls the underlying op with the record tx_ref verbatim (no re-minting)', function () {
    process.env.GIFT_CARDS_STORE = 'postgres';
    giftCardPg.redeem.mockResolvedValue({ ok: true, new_balance: 10, status: 'active', _card: fakeCard(), _ledger: fakeLedger() });

    var record = {
      op: 'redeem',
      tx_ref: 'SALE-1:GC-000001:redeem',
      cert_number: 'GC-000001',
      amount: 10,
      params: { certNumber: 'GC-000001', amount: 10, saleRef: 'SALE-1', actor: 'x' }
    };

    return store.replayPending(record).then(function (result) {
      expect(result.ok).toBe(true);
      expect(giftCardPg.redeem.mock.calls[0][1].txRef).toBe('SALE-1:GC-000001:redeem');
    });
  });

  test('sheets mode -> store_mode_sheets', function () {
    process.env.GIFT_CARDS_STORE = 'sheets';
    return store.replayPending({ op: 'redeem', tx_ref: 'x', cert_number: 'GC-000001', amount: 1, params: {} }).then(function (result) {
      expect(result).toEqual({ ok: false, error: 'store_mode_sheets' });
    });
  });

  test('unknown op -> unknown_op', function () {
    process.env.GIFT_CARDS_STORE = 'postgres';
    return store.replayPending({ op: 'bogus', tx_ref: 'x', cert_number: 'GC-000001', amount: 1, params: {} }).then(function (result) {
      expect(result).toEqual({ ok: false, error: 'unknown_op' });
    });
  });
});

// ─── lookup ──────────────────────────────────────────────────────────────

describe('lookup', function () {
  test('sheets: one axios.post lookup_gift_card, resolves resp.data unchanged', function () {
    process.env.GIFT_CARDS_STORE = 'sheets';
    var data = { ok: true, data: { cert_number: 'GC-000001', current_balance: 10, status: 'active' } };
    axios.post.mockResolvedValue({ data: data });

    return store.lookup('GC-000001').then(function (result) {
      expect(axios.post).toHaveBeenCalledTimes(1);
      var body = bodyOf(axios.post.mock.calls[0]);
      expect(body).toEqual({ action: 'lookup_gift_card', server_token: 'test-server-token', cert_number: 'GC-000001' });
      expect(result).toEqual(data);
    });
  });

  test('postgres: gift-card-pg.lookup via withTransaction; current_balance is a Number', function () {
    process.env.GIFT_CARDS_STORE = 'postgres';
    giftCardPg.lookup.mockResolvedValue({ ok: true, data: { cert_number: 'GC-000001', current_balance: 42, face_value: 50, status: 'active' } });

    return store.lookup('GC-000001').then(function (result) {
      expect(db.withTransaction).toHaveBeenCalledTimes(1);
      expect(typeof result.data.current_balance).toBe('number');
      expect(result.data.current_balance).toBe(42);
    });
  });

  test('dual with {compare:true} returns the Postgres result and fires + compares the sheet leg; compare absent -> no sheet call', function () {
    process.env.GIFT_CARDS_STORE = 'dual';
    giftCardPg.lookup.mockResolvedValue({ ok: true, data: { cert_number: 'GC-000001', current_balance: 10, status: 'active' } });
    axios.post.mockResolvedValue({ data: { ok: true, data: { cert_number: 'GC-000001', current_balance: 10, status: 'active' } } });

    return store.lookup('GC-000001', { compare: true }).then(function (result) {
      expect(result.data.current_balance).toBe(10);
      return flushPromises();
    }).then(function () {
      expect(axios.post).toHaveBeenCalledTimes(1);
      expect(dualWriteCompare.compareAndReport).toHaveBeenCalledTimes(1);
      var args = dualWriteCompare.compareAndReport.mock.calls[0][0];
      expect(args.store).toBe('giftcards');
      expect(args.operation).toBe('lookup');

      axios.post.mockClear();
      dualWriteCompare.compareAndReport.mockClear();
      return store.lookup('GC-000001');
    }).then(function () {
      return flushPromises();
    }).then(function () {
      expect(axios.post).not.toHaveBeenCalled();
      expect(dualWriteCompare.compareAndReport).not.toHaveBeenCalled();
    });
  });

  test('DB failure in dual/postgres rejects with NO sheet fallback read (D-09)', function () {
    process.env.GIFT_CARDS_STORE = 'postgres';
    var dbErr = new Error('db down');
    giftCardPg.lookup.mockRejectedValue(dbErr);

    return store.lookup('GC-000001').then(function () {
      throw new Error('expected rejection');
    }, function (err) {
      expect(err).toBe(dbErr);
      expect(axios.post).not.toHaveBeenCalled();
    });
  });
});

// ─── nextCertNumber ──────────────────────────────────────────────────────

describe('nextCertNumber', function () {
  test('sheets: get_next_cert_number via Apps Script, resolves {ok, suggested}', function () {
    process.env.GIFT_CARDS_STORE = 'sheets';
    axios.post.mockResolvedValue({ data: { ok: true, suggested: 'GC-000099' } });

    return store.nextCertNumber().then(function (result) {
      var body = bodyOf(axios.post.mock.calls[0]);
      expect(body).toEqual({ action: 'get_next_cert_number', server_token: 'test-server-token' });
      expect(result).toEqual({ ok: true, suggested: 'GC-000099' });
    });
  });

  test('postgres: {ok:true, suggested} from gift-card-pg.nextCertNumber', function () {
    process.env.GIFT_CARDS_STORE = 'postgres';
    giftCardPg.nextCertNumber.mockResolvedValue('GC-000043');

    return store.nextCertNumber().then(function (result) {
      expect(result).toEqual({ ok: true, suggested: 'GC-000043' });
    });
  });
});

// ─── module shape ────────────────────────────────────────────────────────

describe('module shape', function () {
  test('exports the full facade API', function () {
    [
      'getMode', 'isConfigured', 'mintTxRef', 'actorFromRequest', 'lookup', 'nextCertNumber',
      'issue', 'redeem', 'reload', 'voidCard', 'updateInvoice', 'adjust', 'replayPending', 'buildMirrorPayload'
    ].forEach(function (name) {
      expect(typeof store[name]).toBe('function');
    });
  });

  test('buildMirrorPayload maps card/ledger into the mirror_gift_card_state contract', function () {
    var card = fakeCard();
    var ledger = fakeLedger();
    var payload = store.buildMirrorPayload(card, ledger);
    expect(payload.cert_number).toBe(card.cert_number);
    expect(payload.face_value).toBe(card.face_value);
    expect(payload.current_balance).toBe(card.current_balance);
    expect(payload.status).toBe(card.status);
    expect(payload.ledger_entry).toEqual({
      tx_ref: ledger.tx_ref, kind: ledger.kind, amount: ledger.amount,
      balance_before: ledger.balance_before, balance_after: ledger.balance_after,
      created_at: ledger.created_at, actor: ledger.actor
    });
  });

  test('buildMirrorPayload sets ledger_entry null when ledger is null', function () {
    var payload = store.buildMirrorPayload(fakeCard(), null);
    expect(payload.ledger_entry).toBeNull();
  });
});
