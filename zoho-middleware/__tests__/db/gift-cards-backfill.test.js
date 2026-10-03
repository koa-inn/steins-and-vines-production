'use strict';

/**
 * Real-Postgres end-to-end tests for the GiftCards backfill CLI — Phase 84 Plan 04 Task 2
 * (DB-03, ROADMAP SC2). Runs ONLY via `npm run test:db` (jest.db.config.js), gated by
 * describeDb()'s D-14 rule.
 *
 * Builds a throwaway .xlsx (ExcelJS, os.tmpdir(), no Sheets API — matching D-09) with both
 * GiftCards and GiftCardTransactions sheets, then drives runGiftCardBackfill() against a
 * real postgres:18-alpine container with migrations/0002_gift_cards.sql applied.
 */

var fs = require('fs');
var os = require('os');
var path = require('path');
var ExcelJS = require('exceljs');

var pgHarness = require('./helpers/pg-harness');
var describeDb = pgHarness.describeDb;
var startPostgres = pgHarness.startPostgres;
var applyMigrations = pgHarness.applyMigrations;

var giftCardsBackfill = require('../../scripts/backfill/gift-cards-backfill');
var cardSpec = require('../../scripts/backfill/specs/gift-cards');

var TIMEZONE = 'America/Vancouver';

var LEDGER_HEADERS = [
  'tx_id', 'cert_number', 'tx_ref', 'kind', 'amount', 'balance_before', 'balance_after',
  'status', 'needs_manual_review', 'created_at', 'settled_at', 'notes'
];

function buildFixtureXlsx(cardRows, ledgerRows) {
  var workbook = new ExcelJS.Workbook();

  var cardHeaders = cardSpec.columns.map(function (c) { return c.header; }).concat(['issued_date']);
  var cardSheet = workbook.addWorksheet('GiftCards');
  cardSheet.addRow(cardHeaders);
  cardRows.forEach(function (row) {
    cardSheet.addRow(cardHeaders.map(function (h) { return row[h] !== undefined ? row[h] : ''; }));
  });

  var ledgerSheet = workbook.addWorksheet('GiftCardTransactions');
  ledgerSheet.addRow(LEDGER_HEADERS);
  ledgerRows.forEach(function (row) {
    ledgerSheet.addRow(LEDGER_HEADERS.map(function (h) { return row[h] !== undefined ? row[h] : ''; }));
  });

  var filePath = path.join(
    os.tmpdir(),
    'gift-cards-backfill-fixture-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.xlsx'
  );
  return workbook.xlsx.writeFile(filePath).then(function () {
    return filePath;
  });
}

function captureLog() {
  var lines = [];
  var log = function (msg) { lines.push(String(msg)); };
  log.lines = lines;
  return log;
}

function cardRow(overrides) {
  var base = {
    cert_number: 'GC-000001',
    face_value: 50,
    current_balance: 50,
    status: 'active',
    issued_date: '2026-01-15',
    issued_by: 'staff',
    zoho_invoice_number: '',
    notes: '',
    last_updated: '2026-01-15T08:00:00Z'
  };
  Object.assign(base, overrides || {});
  return base;
}

function ledgerRow(overrides) {
  var base = {
    tx_id: 'tx-1',
    cert_number: 'GC-000001',
    tx_ref: 'SALE1',
    kind: 'redeem',
    amount: 10,
    balance_before: 50,
    balance_after: 40,
    status: 'settled',
    needs_manual_review: 'FALSE',
    created_at: '2026-01-16T08:00:00Z',
    settled_at: '2026-01-16T08:00:01Z',
    notes: ''
  };
  Object.assign(base, overrides || {});
  return base;
}

function cleanFixtureCards() {
  return [
    cardRow({ cert_number: 'GC-000001', status: 'active', current_balance: 40, face_value: 50 }),
    cardRow({ cert_number: 'GC-000002', status: 'depleted', current_balance: 0, face_value: 25 }),
    cardRow({ cert_number: 'GC-000003', status: 'void', current_balance: 10, face_value: 10 }),
    cardRow({ cert_number: 'GC-000004', status: 'active', current_balance: 0, face_value: 15 }),
    cardRow({ cert_number: 'TEST-LEDGER-01', status: 'active', current_balance: 5, face_value: 5 })
  ];
}

function cleanFixtureLedger() {
  return [
    // Two historical rows sharing a raw tx_ref across two different certs (Pitfall 1 — the
    // composite key must keep both, not collide).
    ledgerRow({ tx_id: 'tx-a', cert_number: 'GC-000001', tx_ref: 'SHARED-REF', kind: 'redeem', amount: 10 }),
    ledgerRow({ tx_id: 'tx-b', cert_number: 'GC-000002', tx_ref: 'SHARED-REF', kind: 'reload', amount: 25 }),
    ledgerRow({ tx_id: 'tx-c', cert_number: 'GC-000004', tx_ref: 'SALE-C', kind: 'reload', amount: 15 }),
    // TEST-LEDGER-01 + its 4 probe rows (51-03-SUMMARY.md) — excluded, not rejected.
    ledgerRow({ tx_id: 'tx-t1', cert_number: 'TEST-LEDGER-01', tx_ref: 'PROBE-51-A', kind: 'redeem', amount: 1 }),
    ledgerRow({ tx_id: 'tx-t2', cert_number: 'TEST-LEDGER-01', tx_ref: 'PROBE-51-C', kind: 'redeem', amount: 1 }),
    ledgerRow({ tx_id: 'tx-t3', cert_number: 'TEST-LEDGER-01', tx_ref: 'PROBE-51-D', kind: 'redeem', amount: 1 }),
    ledgerRow({ tx_id: 'tx-t4', cert_number: 'TEST-LEDGER-01', tx_ref: 'PROBE-51-E', kind: 'reload', amount: 2 })
  ];
}

function stubPrompt() {
  return function () { return Promise.resolve(); };
}

describeDb('GiftCards backfill CLI (real Postgres, ROADMAP SC2)', function () {
  var container;
  var connectionString;
  var db;
  var pool;

  beforeAll(async function () {
    var started = await startPostgres();
    container = started.container;
    connectionString = started.connectionString;

    var migrateResult = applyMigrations(connectionString);
    if (migrateResult.code !== 0) {
      throw new Error('applyMigrations failed (code ' + migrateResult.code + '): ' + migrateResult.stderr);
    }

    jest.resetModules();
    db = require('../../lib/db');
    pool = db.createPool(connectionString);
    process.env.BACKFILL_DATABASE_URL = connectionString;
  }, 120000);

  afterAll(async function () {
    delete process.env.BACKFILL_DATABASE_URL;
    if (pool) await pool.end();
    if (container) await container.stop();
  }, 60000);

  afterEach(async function () {
    var client = await pool.connect();
    try {
      await client.query('delete from gift_card_transactions');
      await client.query('delete from gift_cards');
      await client.query("select setval('gift_card_cert_seq', 1, false)");
    } finally {
      client.release();
    }
  });

  it('(a) promotes a clean fixture: invariant holds, balances exact, TEST-* absent, seq seeded', async function () {
    var filePath = await buildFixtureXlsx(cleanFixtureCards(), cleanFixtureLedger());
    var outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-gc-backfill-out-'));
    var log = captureLog();

    try {
      var result = await giftCardsBackfill.runGiftCardBackfill(
        { file: filePath, outDir: outDir, timezone: TIMEZONE, dryRun: false, promote: true },
        { pool: pool, log: log, promptTypeDatabaseName: stubPrompt() }
      );

      expect(result.exitCode).toBe(giftCardsBackfill.EXIT.OK);

      var checkClient = await pool.connect();
      try {
        var cardCount = await checkClient.query('select count(*)::int as count from gift_cards');
        expect(cardCount.rows[0].count).toBe(4); // TEST-LEDGER-01 excluded

        var testCert = await checkClient.query("select 1 from gift_cards where cert_number = 'TEST-LEDGER-01'");
        expect(testCert.rowCount).toBe(0);

        // Balances equal the fixture to the cent.
        var balances = await checkClient.query(
          'select cert_number, current_balance from gift_cards order by cert_number'
        );
        var byCert = {};
        balances.rows.forEach(function (r) { byCert[r.cert_number] = Number(r.current_balance); });
        expect(byCert['GC-000001']).toBe(40);
        expect(byCert['GC-000002']).toBe(0);
        expect(byCert['GC-000003']).toBe(10);
        expect(byCert['GC-000004']).toBe(0);

        // Invariant: current_balance === sum(non-imported ledger amounts) for every card.
        var invariant = await checkClient.query(
          'select count(*)::int as bad from gift_cards gc where gc.current_balance <> coalesce(' +
          '(select sum(amount) from gift_card_transactions t where t.cert_number = gc.cert_number and t.imported = false), 0)'
        );
        expect(invariant.rows[0].bad).toBe(0);

        // Imported rows excluded from the sum but present, with source_tx_id preserved.
        var imported = await checkClient.query(
          "select cert_number, tx_ref, kind, amount, source_tx_id from gift_card_transactions where imported = true order by tx_ref"
        );
        expect(imported.rowCount).toBe(3);
        var importedByRef = {};
        imported.rows.forEach(function (r) { importedByRef[r.tx_ref] = r; });
        expect(importedByRef['SHARED-REF:GC-000001:redeem'].amount).toBe('-10.00');
        expect(importedByRef['SHARED-REF:GC-000001:redeem'].source_tx_id).toBe('tx-a');
        expect(importedByRef['SHARED-REF:GC-000002:reload'].amount).toBe('25.00');
        expect(importedByRef['SALE-C:GC-000004:reload'].amount).toBe('15.00');

        // Opening rows: one per accepted card.
        var opening = await checkClient.query(
          "select count(*)::int as count from gift_card_transactions where kind = 'opening_balance'"
        );
        expect(opening.rows[0].count).toBe(4);

        // Sequence seeded above the highest backfilled GC-NNNNNN (GC-000004 here).
        var seq = await checkClient.query('select last_value from gift_card_cert_seq');
        expect(Number(seq.rows[0].last_value)).toBe(4);
      } finally {
        checkClient.release();
      }
    } finally {
      fs.unlinkSync(filePath);
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('(b) a needs_manual_review row blocks promotion; both tables stay empty', async function () {
    var cards = [cardRow({ cert_number: 'GC-000001', current_balance: 40 })];
    var ledger = [
      ledgerRow({ cert_number: 'GC-000001', tx_ref: 'SALE1', kind: 'redeem', amount: 10, needs_manual_review: 'TRUE' })
    ];
    var filePath = await buildFixtureXlsx(cards, ledger);
    var outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-gc-backfill-out-'));
    var log = captureLog();

    try {
      var result = await giftCardsBackfill.runGiftCardBackfill(
        { file: filePath, outDir: outDir, timezone: TIMEZONE, dryRun: false, promote: true },
        { pool: pool, log: log, promptTypeDatabaseName: stubPrompt() }
      );

      expect(result.exitCode).toBe(giftCardsBackfill.EXIT.REJECTS_BLOCK);

      var checkClient = await pool.connect();
      try {
        var cardCount = await checkClient.query('select count(*)::int as count from gift_cards');
        var ledgerCount = await checkClient.query('select count(*)::int as count from gift_card_transactions');
        expect(cardCount.rows[0].count).toBe(0);
        expect(ledgerCount.rows[0].count).toBe(0);
      } finally {
        checkClient.release();
      }
    } finally {
      fs.unlinkSync(filePath);
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('(c) running promote twice aborts the second run on non-empty targets', async function () {
    var filePath = await buildFixtureXlsx(cleanFixtureCards(), cleanFixtureLedger());
    var outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-gc-backfill-out-'));

    try {
      var first = await giftCardsBackfill.runGiftCardBackfill(
        { file: filePath, outDir: outDir, timezone: TIMEZONE, dryRun: false, promote: true },
        { pool: pool, log: captureLog(), promptTypeDatabaseName: stubPrompt() }
      );
      expect(first.exitCode).toBe(giftCardsBackfill.EXIT.OK);

      var second = await giftCardsBackfill.runGiftCardBackfill(
        { file: filePath, outDir: outDir, timezone: TIMEZONE, dryRun: false, promote: true },
        { pool: pool, log: captureLog(), promptTypeDatabaseName: stubPrompt() }
      );
      expect(second.exitCode).toBe(giftCardsBackfill.EXIT.ERROR);

      var checkClient = await pool.connect();
      try {
        var cardCount = await checkClient.query('select count(*)::int as count from gift_cards');
        expect(cardCount.rows[0].count).toBe(4); // unchanged from the first run
      } finally {
        checkClient.release();
      }
    } finally {
      fs.unlinkSync(filePath);
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('dry-run with zero rejects exits OK and never touches the database', async function () {
    var filePath = await buildFixtureXlsx(cleanFixtureCards(), cleanFixtureLedger());
    var outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-gc-backfill-out-'));
    var log = captureLog();
    var throwingPool = { connect: function () { throw new Error('pool.connect() must never be called in --dry-run'); } };

    try {
      var result = await giftCardsBackfill.runGiftCardBackfill(
        { file: filePath, outDir: outDir, timezone: TIMEZONE, dryRun: true, promote: false },
        { pool: throwingPool, log: log }
      );
      expect(result.exitCode).toBe(giftCardsBackfill.EXIT.OK);
    } finally {
      fs.unlinkSync(filePath);
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });
});
