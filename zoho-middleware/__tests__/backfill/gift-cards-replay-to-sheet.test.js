'use strict';

/**
 * Tests for scripts/backfill/gift-cards-replay-to-sheet.js — Phase 84 Plan 09 (DB-03, D-04).
 *
 * buildReplayBatches is pure (no I/O) — every <behavior> line gets a direct unit test using
 * the real lib/gift-card-store.js buildMirrorPayload (not mocked — proves the exact 84-02
 * contract shape, matching the plan's key_link). runReplay is exercised with a mocked
 * pool/client (query router) and a mocked axios so no real HTTP call or DB write ever runs.
 */

jest.mock('axios');

var axios = require('axios');
var giftCardsReplay = require('../../scripts/backfill/gift-cards-replay-to-sheet');
var buildReplayBatches = giftCardsReplay.buildReplayBatches;
var runReplay = giftCardsReplay.runReplay;
var parseArgs = giftCardsReplay.parseArgs;
var EXIT = giftCardsReplay.EXIT;

function card(overrides) {
  return Object.assign({
    cert_number: 'GC-000001',
    face_value: '50.00',
    current_balance: '35.00',
    status: 'active',
    issued_date: '2026-01-01',
    issued_by: 'staff',
    zoho_invoice_number: 'INV-1',
    notes: '',
    last_updated: '2026-01-05T00:00:00Z'
  }, overrides || {});
}

function ledgerRow(overrides) {
  return Object.assign({
    cert_number: 'GC-000001',
    tx_ref: 'SALE1:GC-000001:redeem',
    kind: 'redeem',
    amount: '-15.00',
    balance_before: '50.00',
    balance_after: '35.00',
    created_at: '2026-01-05T00:00:00Z',
    actor: 'kiosk',
    imported: false
  }, overrides || {});
}

describe('buildReplayBatches', function () {
  it('emits one payload per counted ledger row, in created_at order', function () {
    var rows = [
      ledgerRow({ tx_ref: 'SALE2:GC-000001:reload', kind: 'reload', amount: '20.00', created_at: '2026-01-06T00:00:00Z' }),
      ledgerRow({ tx_ref: 'SALE1:GC-000001:redeem', created_at: '2026-01-05T00:00:00Z' })
    ];
    var batches = buildReplayBatches([card()], rows, {});

    expect(batches.length).toBe(2);
    expect(batches[0].payload.ledger_entry.tx_ref).toBe('SALE1:GC-000001:redeem');
    expect(batches[1].payload.ledger_entry.tx_ref).toBe('SALE2:GC-000001:reload');
  });

  it('carries the card CURRENT state on every payload, not a historical snapshot', function () {
    var rows = [ledgerRow()];
    var batches = buildReplayBatches([card({ current_balance: '999.00' })], rows, {});
    expect(batches[0].payload.current_balance).toBe('999.00');
  });

  it('only replays ledger rows with created_at >= since', function () {
    var rows = [
      ledgerRow({ tx_ref: 'OLD:GC-000001:redeem', created_at: '2026-01-01T00:00:00Z' }),
      ledgerRow({ tx_ref: 'NEW:GC-000001:redeem', created_at: '2026-01-10T00:00:00Z' })
    ];
    var batches = buildReplayBatches([card()], rows, { since: '2026-01-05T00:00:00Z' });

    var txRefs = batches.map(function (b) { return b.payload.ledger_entry && b.payload.ledger_entry.tx_ref; });
    expect(txRefs).not.toContain('OLD:GC-000001:redeem');
    expect(txRefs).toContain('NEW:GC-000001:redeem');
  });

  it('never replays imported (historical backfill) rows', function () {
    var rows = [ledgerRow({ imported: true }), ledgerRow({ tx_ref: 'LIVE:GC-000001:redeem', imported: false })];
    var batches = buildReplayBatches([card()], rows, {});

    var txRefs = batches.map(function (b) { return b.payload.ledger_entry && b.payload.ledger_entry.tx_ref; });
    expect(txRefs).toEqual(['LIVE:GC-000001:redeem']);
  });

  it('emits exactly one ledger_entry:null payload for a card with no ledger rows in range', function () {
    var batches = buildReplayBatches([card({ cert_number: 'GC-000002' })], [], {});
    expect(batches.length).toBe(1);
    expect(batches[0]).toEqual({ cert_number: 'GC-000002', payload: expect.objectContaining({ ledger_entry: null }) });
  });

  it('builds payloads via the real buildMirrorPayload contract shape (84-02)', function () {
    var batches = buildReplayBatches([card()], [ledgerRow()], {});
    expect(batches[0].payload).toEqual({
      cert_number: 'GC-000001',
      face_value: '50.00',
      current_balance: '35.00',
      status: 'active',
      issued_date: '2026-01-01',
      issued_by: 'staff',
      zoho_invoice_number: 'INV-1',
      notes: '',
      last_updated: '2026-01-05T00:00:00Z',
      ledger_entry: {
        tx_ref: 'SALE1:GC-000001:redeem',
        kind: 'redeem',
        amount: '-15.00',
        balance_before: '50.00',
        balance_after: '35.00',
        created_at: '2026-01-05T00:00:00Z',
        actor: 'kiosk'
      }
    });
  });
});

describe('parseArgs', function () {
  it('refuses an argv value that looks like a Postgres connection string', function () {
    expect(function () {
      parseArgs(['--since=2026-01-01', 'postgres://user:pass@host/db']);
    }).toThrow(/BACKFILL_DATABASE_URL/);
  });

  it('parses --since and --apply; dry run is the default', function () {
    expect(parseArgs([])).toEqual({ since: undefined, apply: false });
    expect(parseArgs(['--since=2026-01-01', '--apply'])).toEqual({ since: '2026-01-01', apply: true });
  });
});

describe('runReplay', function () {
  function captureLog() {
    var lines = [];
    var log = function (msg) { lines.push(String(msg)); };
    log.lines = lines;
    return log;
  }

  function fakePool(cardsRows, ledgerRows) {
    var queries = [];
    var client = {
      query: jest.fn(function (sql) {
        queries.push(sql);
        if (/^begin transaction read only$/.test(sql)) return Promise.resolve({ rows: [] });
        if (/^commit$/.test(sql) || /^rollback$/.test(sql)) return Promise.resolve({ rows: [] });
        if (/from gift_card_transactions order by created_at/.test(sql)) {
          return Promise.resolve({ rows: ledgerRows });
        }
        if (/from gift_cards order by cert_number/.test(sql)) {
          return Promise.resolve({ rows: cardsRows });
        }
        return Promise.reject(new Error('unexpected query in test: ' + sql));
      }),
      release: jest.fn()
    };
    return {
      queries: queries,
      client: client,
      connect: jest.fn(function () { return Promise.resolve(client); })
    };
  }

  beforeEach(function () {
    axios.post.mockReset();
  });

  it('without --apply: prints counts and makes zero HTTP calls', async function () {
    var pool = fakePool([card()], [ledgerRow()]);
    var log = captureLog();

    var result = await runReplay({ apply: false }, { pool: pool, axios: axios, log: log });

    expect(result.exitCode).toBe(EXIT.OK);
    expect(axios.post).not.toHaveBeenCalled();
    expect(log.lines.some(function (l) { return /^Built 1 replay payload/.test(l); })).toBe(true);
    expect(log.lines).toContain('Dry run — no HTTP calls made. Pass --apply to send.');
  });

  it('with --apply: posts each payload sequentially with action + server_token', async function () {
    var oldUrl = process.env.APPS_SCRIPT_URL;
    var oldToken = process.env.APPS_SCRIPT_SERVER_TOKEN;
    process.env.APPS_SCRIPT_URL = 'https://script.google.com/exec';
    process.env.APPS_SCRIPT_SERVER_TOKEN = 'secret-token';

    axios.post.mockResolvedValue({ data: { ok: true, row_action: 'updated', ledger_action: 'appended' } });

    var rows = [
      ledgerRow({ tx_ref: 'A:GC-000001:redeem', created_at: '2026-01-01T00:00:00Z' }),
      ledgerRow({ tx_ref: 'B:GC-000001:redeem', created_at: '2026-01-02T00:00:00Z' })
    ];
    var pool = fakePool([card()], rows);

    var result = await runReplay({ apply: true }, { pool: pool, axios: axios, log: captureLog() });

    expect(result.exitCode).toBe(EXIT.OK);
    expect(result.sent).toBe(2);
    expect(axios.post).toHaveBeenCalledTimes(2);
    var firstCallBody = axios.post.mock.calls[0][1];
    expect(firstCallBody.action).toBe('mirror_gift_card_state');
    expect(firstCallBody.server_token).toBe('secret-token');

    process.env.APPS_SCRIPT_URL = oldUrl;
    process.env.APPS_SCRIPT_SERVER_TOKEN = oldToken;
  });

  it('stops on the first {ok:false} response and reports cert + error, never sending the rest', async function () {
    var oldUrl = process.env.APPS_SCRIPT_URL;
    var oldToken = process.env.APPS_SCRIPT_SERVER_TOKEN;
    process.env.APPS_SCRIPT_URL = 'https://script.google.com/exec';
    process.env.APPS_SCRIPT_SERVER_TOKEN = 'secret-token';

    axios.post
      .mockResolvedValueOnce({ data: { ok: false, error: 'invalid_status' } })
      .mockResolvedValueOnce({ data: { ok: true } });

    var rows = [
      ledgerRow({ tx_ref: 'A:GC-000001:redeem', created_at: '2026-01-01T00:00:00Z' }),
      ledgerRow({ tx_ref: 'B:GC-000001:redeem', created_at: '2026-01-02T00:00:00Z' })
    ];
    var pool = fakePool([card()], rows);
    var log = captureLog();

    var result = await runReplay({ apply: true }, { pool: pool, axios: axios, log: log });

    expect(result.exitCode).toBe(EXIT.CHECKS_FAILED);
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(log.lines).toContain('Replay stopped — cert=GC-000001 error=invalid_status');

    process.env.APPS_SCRIPT_URL = oldUrl;
    process.env.APPS_SCRIPT_SERVER_TOKEN = oldToken;
  });

  it('reads Postgres in a read only transaction and never issues a write statement', async function () {
    var pool = fakePool([card()], [ledgerRow()]);
    await runReplay({ apply: false }, { pool: pool, axios: axios, log: captureLog() });

    expect(pool.queries[0]).toBe('begin transaction read only');
    pool.queries.forEach(function (sql) {
      expect(sql).not.toMatch(/insert |update |delete /i);
    });
  });
});
