'use strict';

/**
 * Tests for scripts/backfill/gift-cards-verify.js — Phase 84 Plan 09 (DB-03, D-15).
 *
 * compareGiftCards is pure (no I/O) — every <behavior> line gets a direct unit test.
 * runVerify is exercised with a mocked pool/client (query router by SQL fragment) and a
 * real .xlsx fixture written via exceljs (matching backfill-gates.test.js's convention) so
 * the real readSheet()/buildGiftCardBackfillPlan() round trip is proven, not just mocked.
 */

var fs = require('fs');
var os = require('os');
var path = require('path');
var ExcelJS = require('exceljs');

var giftCardsVerify = require('../../scripts/backfill/gift-cards-verify');
var compareGiftCards = giftCardsVerify.compareGiftCards;
var runVerify = giftCardsVerify.runVerify;
var parseArgs = giftCardsVerify.parseArgs;
var EXIT = giftCardsVerify.EXIT;

function pgCard(overrides) {
  return Object.assign({ cert_number: 'GC-000001', current_balance: '40.00', status: 'active' }, overrides || {});
}

function sheetCard(overrides) {
  return Object.assign({ cert_number: 'GC-000001', current_balance: 40, status: 'active' }, overrides || {});
}

describe('compareGiftCards', function () {
  it('returns ok:true with identical sets', function () {
    var result = compareGiftCards([pgCard()], [sheetCard()], []);
    expect(result).toEqual({ ok: true, compared: 1, mismatches: [] });
  });

  it('reports a current_balance mismatch when balances differ by $0.01', function () {
    var result = compareGiftCards([pgCard({ current_balance: '40.01' })], [sheetCard({ current_balance: 40.0 })], []);
    expect(result.ok).toBe(false);
    expect(result.mismatches).toEqual([{ cert: 'GC-000001', field: 'current_balance' }]);
  });

  it('reports a status mismatch when status differs', function () {
    var result = compareGiftCards([pgCard({ status: 'depleted' })], [sheetCard({ status: 'active' })], []);
    expect(result.mismatches).toEqual([{ cert: 'GC-000001', field: 'status' }]);
  });

  it('reports missing_in_sheet for a cert only in Postgres', function () {
    var result = compareGiftCards([pgCard({ cert_number: 'GC-000002' })], [], []);
    expect(result.mismatches).toEqual([{ cert: 'GC-000002', field: 'missing_in_sheet' }]);
  });

  it('reports missing_in_postgres for a cert only in the sheet', function () {
    var result = compareGiftCards([], [sheetCard({ cert_number: 'GC-000003' })], []);
    expect(result.mismatches).toEqual([{ cert: 'GC-000003', field: 'missing_in_postgres' }]);
  });

  it('ignores TEST-* certs on both sides even if present in either input', function () {
    var result = compareGiftCards(
      [pgCard(), pgCard({ cert_number: 'TEST-0001' })],
      [sheetCard(), sheetCard({ cert_number: 'TEST-0002' })],
      ['TEST-0003']
    );
    expect(result).toEqual({ ok: true, compared: 1, mismatches: [] });
  });

  it('compares money as integer cents, not float equality — "10.10" vs 10.1 match', function () {
    var result = compareGiftCards(
      [pgCard({ current_balance: '10.10' })],
      [sheetCard({ current_balance: 10.1 })],
      []
    );
    expect(result.ok).toBe(true);
  });

  it('reports a ledger_invariant mismatch for every cert in pgInvariantViolations', function () {
    var result = compareGiftCards([pgCard()], [sheetCard()], ['GC-000001']);
    expect(result.ok).toBe(false);
    expect(result.mismatches).toContainEqual({ cert: 'GC-000001', field: 'ledger_invariant' });
  });

  it('never includes a balance or status value in a mismatch entry — field names and certs only', function () {
    var result = compareGiftCards(
      [pgCard({ current_balance: '999.99', status: 'void' })],
      [sheetCard({ current_balance: 1.0, status: 'active' })],
      []
    );
    var serialized = JSON.stringify(result.mismatches);
    expect(serialized).not.toMatch(/999\.99|void|active/);
  });
});

describe('parseArgs', function () {
  it('refuses an argv value that looks like a Postgres connection string', function () {
    expect(function () {
      parseArgs(['--file=snapshot.xlsx', 'postgres://user:pass@host/db']);
    }).toThrow(/BACKFILL_DATABASE_URL/);
  });

  it('parses --file and --timezone', function () {
    var opts = parseArgs(['--file=./snap.xlsx', '--timezone=America/Vancouver']);
    expect(opts).toEqual({ file: './snap.xlsx', timezone: 'America/Vancouver' });
  });
});

describe('runVerify', function () {
  var tmpDir;

  beforeEach(function () {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-gc-verify-'));
  });

  afterEach(function () {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeSnapshot(cardRows, ledgerRows) {
    var filePath = path.join(tmpDir, 'live-' + Math.random().toString(36).slice(2) + '.xlsx');
    var workbook = new ExcelJS.Workbook();

    var cardsSheet = workbook.addWorksheet('GiftCards');
    cardsSheet.addRow([
      'cert_number', 'face_value', 'current_balance', 'status', 'issued_date', 'issued_by',
      'zoho_invoice_number', 'notes', 'last_updated'
    ]);
    cardRows.forEach(function (r) { cardsSheet.addRow(r); });

    var ledgerSheet = workbook.addWorksheet('GiftCardTransactions');
    ledgerSheet.addRow([
      'tx_id', 'cert_number', 'tx_ref', 'kind', 'amount', 'balance_before', 'balance_after',
      'status', 'needs_manual_review', 'created_at', 'settled_at', 'notes'
    ]);
    ledgerRows.forEach(function (r) { ledgerSheet.addRow(r); });

    return workbook.xlsx.writeFile(filePath).then(function () { return filePath; });
  }

  function captureLog() {
    var lines = [];
    var log = function (msg) { lines.push(String(msg)); };
    log.lines = lines;
    return log;
  }

  function fakePool(pgCardsRows, violationCerts) {
    var queries = [];
    var client = {
      query: jest.fn(function (sql) {
        queries.push(sql);
        if (/^begin transaction read only$/.test(sql)) return Promise.resolve({ rows: [] });
        if (/^commit$/.test(sql) || /^rollback$/.test(sql)) return Promise.resolve({ rows: [] });
        if (/where gc\.current_balance/.test(sql)) {
          return Promise.resolve({ rows: violationCerts.map(function (c) { return { cert_number: c }; }) });
        }
        if (/from gift_cards order by cert_number/.test(sql)) {
          return Promise.resolve({ rows: pgCardsRows });
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

  it('reports a clean verify (0 mismatches) and exits EXIT.OK', async function () {
    var filePath = await writeSnapshot(
      [['GC-000001', 50, 40, 'active', '2026-01-01', 'staff', '', '', '2026-01-02T00:00:00Z']],
      []
    );
    var log = captureLog();
    var pool = fakePool([{ cert_number: 'GC-000001', current_balance: '40.00', status: 'active' }], []);

    var result = await runVerify({ file: filePath }, { pool: pool, log: log });

    expect(result.exitCode).toBe(EXIT.OK);
    expect(log.lines.some(function (l) { return l === 'Verified 1 cards: 0 mismatches'; })).toBe(true);
    expect(pool.client.release).toHaveBeenCalled();
  });

  it('exits EXIT.CHECKS_FAILED and prints only cert + field on a mismatch', async function () {
    var filePath = await writeSnapshot(
      [['GC-000001', 50, 40, 'active', '2026-01-01', 'staff', '', '', '2026-01-02T00:00:00Z']],
      []
    );
    var log = captureLog();
    // Postgres balance diverges from the sheet's 40.00.
    var pool = fakePool([{ cert_number: 'GC-000001', current_balance: '99.00', status: 'active' }], []);

    var result = await runVerify({ file: filePath }, { pool: pool, log: log });

    expect(result.exitCode).toBe(EXIT.CHECKS_FAILED);
    expect(log.lines).toContain('MISMATCH cert=GC-000001 field=current_balance');
    expect(log.lines.join('\n')).not.toMatch(/99\.00|40\.00/);
  });

  it('opens the transaction as read only and never issues a write statement', async function () {
    var filePath = await writeSnapshot(
      [['GC-000001', 50, 40, 'active', '2026-01-01', 'staff', '', '', '2026-01-02T00:00:00Z']],
      []
    );
    var pool = fakePool([{ cert_number: 'GC-000001', current_balance: '40.00', status: 'active' }], []);

    await runVerify({ file: filePath }, { pool: pool, log: captureLog() });

    expect(pool.queries[0]).toBe('begin transaction read only');
    pool.queries.forEach(function (sql) {
      expect(sql).not.toMatch(/insert |update |delete /i);
    });
  });

  it('returns EXIT.ERROR when the snapshot file does not exist', async function () {
    var result = await runVerify({ file: path.join(tmpDir, 'does-not-exist.xlsx') }, { pool: fakePool([], []), log: captureLog() });
    expect(result.exitCode).toBe(EXIT.ERROR);
  });
});
