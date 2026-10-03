'use strict';

/**
 * Real-Postgres atomicity proofs for lib/gift-card-pg.js — Phase 84 Plan 01 (DB-03, ROADMAP SC1).
 *
 * Runs ONLY via `npm run test:db` (jest.db.config.js), gated by describeDb()'s D-14 rule:
 * skipped locally without Docker, never skipped on CI.
 *
 * Most tests use the shared per-test BEGIN'd/ROLLBACK'd client from pgHarness.rollbackEachTest()
 * (harness.client()). Crash-then-retry and concurrency tests need their OWN dedicated pool
 * clients with real BEGIN/COMMIT/ROLLBACK — a rolled-back transaction's writes are invisible to
 * any other connection, so proving a "crash" (rollback) actually left no trace, or that two
 * concurrent transactions truly serialize on the row lock, requires separate connections.
 */

var pgHarness = require('./helpers/pg-harness');
var describeDb = pgHarness.describeDb;
var startPostgres = pgHarness.startPostgres;
var applyMigrations = pgHarness.applyMigrations;

describeDb('gift-card-pg atomic operations (ROADMAP SC1)', function () {
  var container;
  var connectionString;
  var db;
  var pool;
  var giftCardPg;
  var harness;

  var certCounter = 1000;
  var txRefCounter = 1;

  function nextTestCert() {
    var n = certCounter++;
    var s = String(n);
    while (s.length < 6) s = '0' + s;
    return 'GC-' + s;
  }

  function nextTxRef() {
    return 'TXR-' + (txRefCounter++) + '-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  }

  function insertCard(client, cert, opts) {
    opts = opts || {};
    var faceValue = opts.faceValue !== undefined ? opts.faceValue : 50;
    var balance = opts.balance !== undefined ? opts.balance : faceValue;
    var status = opts.status || 'active';
    return client.query(
      "insert into gift_cards (cert_number, face_value, current_balance, status, issued_date, issued_by) " +
      "values ($1, $2, $3, $4, current_date, 'test')",
      [cert, faceValue.toFixed(2), balance.toFixed(2), status]
    );
  }

  async function commitFixtureCard(cert, opts) {
    var client = await pool.connect();
    try {
      await client.query('begin');
      await insertCard(client, cert, opts);
      await client.query('commit');
    } finally {
      client.release();
    }
  }

  beforeAll(async function () {
    var started = await startPostgres();
    container = started.container;
    connectionString = started.connectionString;

    var migrateResult = applyMigrations(connectionString);
    if (migrateResult.code !== 0) {
      throw new Error(
        'applyMigrations failed (code ' + migrateResult.code + '): ' + migrateResult.stderr
      );
    }

    jest.resetModules();
    db = require('../../lib/db');
    giftCardPg = require('../../lib/gift-card-pg');
    pool = db.createPool(connectionString);
  }, 120000);

  afterAll(async function () {
    if (pool) await pool.end();
    if (container) await container.stop();
  }, 60000);

  harness = pgHarness.rollbackEachTest(function () {
    return pool;
  });

  describe('lookup', function () {
    it('returns not_found for a missing cert and the right shape for an existing one', async function () {
      var client = harness.client();
      var missing = await giftCardPg.lookup(client, 'GC-999999');
      expect(missing.ok).toBe(false);
      expect(missing.error).toBe('not_found');

      var cert = nextTestCert();
      await insertCard(client, cert, { faceValue: 50, balance: 42.5, status: 'active' });
      var found = await giftCardPg.lookup(client, cert);
      expect(found.ok).toBe(true);
      expect(found.data.cert_number).toBe(cert);
      expect(found.data.current_balance).toBe(42.5);
      expect(found.data.face_value).toBe(50);
      expect(found.data.status).toBe('active');
    });
  });

  describe('redeem replay', function () {
    it('redeem replay: resubmitting the same tx_ref leaves the balance unchanged with exactly one ledger row', async function () {
      var client = harness.client();
      var cert = nextTestCert();
      await insertCard(client, cert, { faceValue: 50, balance: 50, status: 'active' });
      var txRef = nextTxRef();

      var first = await giftCardPg.redeem(client, { certNumber: cert, amount: 10, txRef: txRef, actor: 'test' });
      expect(first.ok).toBe(true);
      expect(first.new_balance).toBe(40);
      expect(first.idempotent).toBeFalsy();

      var second = await giftCardPg.redeem(client, { certNumber: cert, amount: 10, txRef: txRef, actor: 'test' });
      expect(second.ok).toBe(true);
      expect(second.idempotent).toBe(true);
      expect(second.new_balance).toBe(40);

      var ledgerCount = await client.query(
        'select count(*)::int as count from gift_card_transactions where tx_ref = $1',
        [txRef]
      );
      expect(ledgerCount.rows[0].count).toBe(1);

      var balanceCheck = await client.query('select current_balance from gift_cards where cert_number = $1', [cert]);
      expect(Number(balanceCheck.rows[0].current_balance)).toBe(40);
    });
  });

  describe('crash-then-retry', function () {
    it('crash-then-retry: a rollback before commit leaves the balance unchanged; the retry with the same tx_ref applies exactly once', async function () {
      var cert = nextTestCert();
      await commitFixtureCard(cert, { faceValue: 50, balance: 50, status: 'active' });
      var txRef = nextTxRef();

      // Simulated crash: BEGIN, redeem, ROLLBACK before COMMIT.
      var crashClient = await pool.connect();
      try {
        await crashClient.query('begin');
        var crashResult = await giftCardPg.redeem(crashClient, { certNumber: cert, amount: 10, txRef: txRef, actor: 'test' });
        expect(crashResult.ok).toBe(true);
        await crashClient.query('rollback');
      } finally {
        crashClient.release();
      }

      var afterCrash = await pool.query('select current_balance from gift_cards where cert_number = $1', [cert]);
      expect(Number(afterCrash.rows[0].current_balance)).toBe(50);
      var afterCrashLedger = await pool.query(
        'select count(*)::int as count from gift_card_transactions where tx_ref = $1',
        [txRef]
      );
      expect(afterCrashLedger.rows[0].count).toBe(0);

      // Retry with the SAME tx_ref, this time committing for real.
      var retryClient = await pool.connect();
      try {
        await retryClient.query('begin');
        var retryResult = await giftCardPg.redeem(retryClient, { certNumber: cert, amount: 10, txRef: txRef, actor: 'test' });
        expect(retryResult.ok).toBe(true);
        expect(retryResult.idempotent).toBeFalsy();
        expect(retryResult.new_balance).toBe(40);
        await retryClient.query('commit');
      } finally {
        retryClient.release();
      }

      var afterRetry = await pool.query('select current_balance from gift_cards where cert_number = $1', [cert]);
      expect(Number(afterRetry.rows[0].current_balance)).toBe(40);

      // A further replay of the SAME tx_ref must be idempotent, balance unchanged.
      var replayClient = await pool.connect();
      try {
        await replayClient.query('begin');
        var replayResult = await giftCardPg.redeem(replayClient, { certNumber: cert, amount: 10, txRef: txRef, actor: 'test' });
        expect(replayResult.ok).toBe(true);
        expect(replayResult.idempotent).toBe(true);
        expect(replayResult.new_balance).toBe(40);
        await replayClient.query('commit');
      } finally {
        replayClient.release();
      }

      var finalCheck = await pool.query('select current_balance from gift_cards where cert_number = $1', [cert]);
      expect(Number(finalCheck.rows[0].current_balance)).toBe(40);
    });
  });

  describe('Pitfall 1 — shared sale ref across certs', function () {
    it('one shared sale ref across two certs (redeem + issue) produces two ledger rows, both certs correct', async function () {
      var client = harness.client();
      var certA = nextTestCert();
      var certB = nextTestCert();
      await insertCard(client, certA, { faceValue: 50, balance: 50, status: 'active' });

      var redeemResult = await giftCardPg.redeem(client, {
        certNumber: certA, amount: 10, txRef: 'S1:' + certA + ':redeem', actor: 'test'
      });
      expect(redeemResult.ok).toBe(true);

      var issueResult = await giftCardPg.issue(client, {
        certNumber: certB, faceValue: 25, issuedBy: 'staff', notes: '', txRef: 'S1:' + certB + ':issue', actor: 'test'
      });
      expect(issueResult.ok).toBe(true);

      var countCheck = await client.query(
        'select count(*)::int as count from gift_card_transactions where tx_ref in ($1, $2)',
        ['S1:' + certA + ':redeem', 'S1:' + certB + ':issue']
      );
      expect(countCheck.rows[0].count).toBe(2);

      var certACheck = await client.query('select current_balance from gift_cards where cert_number = $1', [certA]);
      expect(Number(certACheck.rows[0].current_balance)).toBe(40);
      var certBCheck = await client.query('select current_balance, status from gift_cards where cert_number = $1', [certB]);
      expect(Number(certBCheck.rows[0].current_balance)).toBe(25);
      expect(certBCheck.rows[0].status).toBe('active');
    });
  });

  describe('tx_ref_conflict', function () {
    it('a raw tx_ref reused on a different cert returns tx_ref_conflict, never a silent no-op', async function () {
      var client = harness.client();
      var certA = nextTestCert();
      var certC = nextTestCert();
      await insertCard(client, certA, { faceValue: 50, balance: 50, status: 'active' });
      await insertCard(client, certC, { faceValue: 30, balance: 30, status: 'active' });

      var txRef = 'S2-' + Date.now();
      var redeemResult = await giftCardPg.redeem(client, { certNumber: certA, amount: 10, txRef: txRef, actor: 'test' });
      expect(redeemResult.ok).toBe(true);

      var reloadResult = await giftCardPg.reload(client, { certNumber: certC, amount: 10, txRef: txRef, actor: 'test' });
      expect(reloadResult.ok).toBe(false);
      expect(reloadResult.error).toBe('tx_ref_conflict');

      var certCCheck = await client.query('select current_balance from gift_cards where cert_number = $1', [certC]);
      expect(Number(certCCheck.rows[0].current_balance)).toBe(30);
    });
  });

  describe('insufficient balance', function () {
    it('redeem more than the balance returns insufficient_balance with no ledger row written', async function () {
      var client = harness.client();
      var cert = nextTestCert();
      await insertCard(client, cert, { faceValue: 50, balance: 50, status: 'active' });
      var txRef = nextTxRef();

      var result = await giftCardPg.redeem(client, { certNumber: cert, amount: 60, txRef: txRef, actor: 'test' });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('insufficient_balance');
      expect(result.balance).toBe(50);

      var ledgerCheck = await client.query(
        'select count(*)::int as count from gift_card_transactions where tx_ref = $1',
        [txRef]
      );
      expect(ledgerCheck.rows[0].count).toBe(0);
    });
  });

  describe('status rules', function () {
    it('redeem on a depleted or void card returns invalid_status', async function () {
      var client = harness.client();
      var depletedCert = nextTestCert();
      await insertCard(client, depletedCert, { faceValue: 50, balance: 0, status: 'depleted' });
      var depletedResult = await giftCardPg.redeem(client, { certNumber: depletedCert, amount: 5, txRef: nextTxRef(), actor: 'test' });
      expect(depletedResult.ok).toBe(false);
      expect(depletedResult.error).toBe('invalid_status');

      var voidCert = nextTestCert();
      await insertCard(client, voidCert, { faceValue: 50, balance: 50, status: 'void' });
      var voidResult = await giftCardPg.redeem(client, { certNumber: voidCert, amount: 5, txRef: nextTxRef(), actor: 'test' });
      expect(voidResult.ok).toBe(false);
      expect(voidResult.error).toBe('invalid_status');
    });

    it('reload on a void card returns invalid_status; reload on a depleted card restores active status', async function () {
      var client = harness.client();
      var voidCert = nextTestCert();
      await insertCard(client, voidCert, { faceValue: 50, balance: 50, status: 'void' });
      var voidResult = await giftCardPg.reload(client, { certNumber: voidCert, amount: 5, txRef: nextTxRef(), actor: 'test' });
      expect(voidResult.ok).toBe(false);
      expect(voidResult.error).toBe('invalid_status');

      var depletedCert = nextTestCert();
      await insertCard(client, depletedCert, { faceValue: 50, balance: 0, status: 'depleted' });
      var depletedResult = await giftCardPg.reload(client, { certNumber: depletedCert, amount: 20, txRef: nextTxRef(), actor: 'test' });
      expect(depletedResult.ok).toBe(true);
      expect(depletedResult.status).toBe('active');
      expect(depletedResult.new_balance).toBe(20);
    });
  });

  describe('concurrency', function () {
    it('two concurrent transactions redeeming $30 from a $50 card: exactly one succeeds, final balance 20', async function () {
      var cert = nextTestCert();
      await commitFixtureCard(cert, { faceValue: 50, balance: 50, status: 'active' });

      var clientA = await pool.connect();
      var clientB = await pool.connect();
      try {
        await clientA.query('begin');
        await clientB.query('begin');

        var resultAPromise = giftCardPg.redeem(clientA, { certNumber: cert, amount: 30, txRef: nextTxRef(), actor: 'test' });
        // Give A a moment to acquire the row lock before B's SELECT FOR UPDATE attempts it too —
        // avoids a flaky race where both issue the lock query near-simultaneously.
        await new Promise(function (resolve) { setTimeout(resolve, 50); });
        var resultBPromise = giftCardPg.redeem(clientB, { certNumber: cert, amount: 30, txRef: nextTxRef(), actor: 'test' });

        var resultA = await resultAPromise;
        await clientA.query('commit');
        var resultB = await resultBPromise;
        await clientB.query('commit');

        var outcomes = [resultA, resultB];
        var oks = outcomes.filter(function (r) { return r.ok; });
        var fails = outcomes.filter(function (r) { return !r.ok; });
        expect(oks.length).toBe(1);
        expect(fails.length).toBe(1);
        expect(fails[0].error).toBe('insufficient_balance');
      } finally {
        clientA.release();
        clientB.release();
      }

      var finalCheck = await pool.query('select current_balance from gift_cards where cert_number = $1', [cert]);
      expect(Number(finalCheck.rows[0].current_balance)).toBe(20);
    });
  });

  describe('adjust', function () {
    it('negative_balance: an adjust that would go below zero is rejected, balance unchanged, no row written', async function () {
      var client = harness.client();
      var cert = nextTestCert();
      await insertCard(client, cert, { faceValue: 50, balance: 50, status: 'active' });
      var txRef = nextTxRef();

      var result = await giftCardPg.adjust(client, {
        certNumber: cert, delta: -60, txRef: txRef, reason: 'correction', actorName: 'Jo', actor: 'test'
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('negative_balance');

      var balanceCheck = await client.query('select current_balance from gift_cards where cert_number = $1', [cert]);
      expect(Number(balanceCheck.rows[0].current_balance)).toBe(50);

      var ledgerCheck = await client.query(
        'select count(*)::int as count from gift_card_transactions where tx_ref = $1',
        [txRef]
      );
      expect(ledgerCheck.rows[0].count).toBe(0);
    });

    it('adjust +5 with reason goodwill credits the balance', async function () {
      var client = harness.client();
      var cert = nextTestCert();
      await insertCard(client, cert, { faceValue: 50, balance: 50, status: 'active' });

      var result = await giftCardPg.adjust(client, {
        certNumber: cert, delta: 5, txRef: nextTxRef(), reason: 'goodwill', actorName: 'Jo', actor: 'test'
      });
      expect(result.ok).toBe(true);
      expect(result.new_balance).toBe(55);
      expect(result.status).toBe('active');
    });

    it('adjust on a void or depleted card returns invalid_status', async function () {
      var client = harness.client();
      var voidCert = nextTestCert();
      await insertCard(client, voidCert, { faceValue: 50, balance: 50, status: 'void' });
      var voidResult = await giftCardPg.adjust(client, {
        certNumber: voidCert, delta: 5, txRef: nextTxRef(), reason: 'correction', actorName: 'Jo', actor: 'test'
      });
      expect(voidResult.ok).toBe(false);
      expect(voidResult.error).toBe('invalid_status');

      var depletedCert = nextTestCert();
      await insertCard(client, depletedCert, { faceValue: 50, balance: 0, status: 'depleted' });
      var depletedResult = await giftCardPg.adjust(client, {
        certNumber: depletedCert, delta: 5, txRef: nextTxRef(), reason: 'correction', actorName: 'Jo', actor: 'test'
      });
      expect(depletedResult.ok).toBe(false);
      expect(depletedResult.error).toBe('invalid_status');
    });

    it('adjust replay with the same tx_ref is idempotent', async function () {
      var client = harness.client();
      var cert = nextTestCert();
      await insertCard(client, cert, { faceValue: 50, balance: 50, status: 'active' });
      var txRef = nextTxRef();

      var first = await giftCardPg.adjust(client, {
        certNumber: cert, delta: 5, txRef: txRef, reason: 'goodwill', actorName: 'Jo', actor: 'test'
      });
      expect(first.ok).toBe(true);
      expect(first.new_balance).toBe(55);

      var second = await giftCardPg.adjust(client, {
        certNumber: cert, delta: 5, txRef: txRef, reason: 'goodwill', actorName: 'Jo', actor: 'test'
      });
      expect(second.ok).toBe(true);
      expect(second.idempotent).toBe(true);
      expect(second.new_balance).toBe(55);
    });
  });

  describe('void', function () {
    it('void an active card succeeds with a void ledger row of amount 0; voiding again returns invalid_status', async function () {
      var client = harness.client();
      var cert = nextTestCert();
      await insertCard(client, cert, { faceValue: 50, balance: 50, status: 'active' });

      var first = await giftCardPg.voidCard(client, { certNumber: cert, reason: 'customer request', actor: 'test' });
      expect(first.ok).toBe(true);
      expect(first.status).toBe('void');

      var ledgerCheck = await client.query(
        'select kind, amount from gift_card_transactions where tx_ref = $1',
        ['void:' + cert]
      );
      expect(ledgerCheck.rows[0].kind).toBe('void');
      expect(Number(ledgerCheck.rows[0].amount)).toBe(0);

      var second = await giftCardPg.voidCard(client, { certNumber: cert, reason: 'customer request', actor: 'test' });
      expect(second.ok).toBe(false);
      expect(second.error).toBe('invalid_status');
    });
  });

  describe('issue', function () {
    it('issue a new cert creates an active card at face value with an issue ledger row', async function () {
      var client = harness.client();
      var cert = nextTestCert();
      var result = await giftCardPg.issue(client, {
        certNumber: cert, faceValue: 25, issuedBy: 'staff', notes: 'note', txRef: nextTxRef(), actor: 'test'
      });
      expect(result.ok).toBe(true);
      expect(result.cert_number).toBe(cert);
      expect(result.face_value).toBe(25);
      expect(result.current_balance).toBe(25);

      var cardCheck = await client.query('select status from gift_cards where cert_number = $1', [cert]);
      expect(cardCheck.rows[0].status).toBe('active');

      var ledgerCheck = await client.query('select kind, amount from gift_card_transactions where cert_number = $1', [cert]);
      expect(ledgerCheck.rows[0].kind).toBe('issue');
      expect(Number(ledgerCheck.rows[0].amount)).toBe(25);
    });

    it('issuing the same cert with a different tx_ref returns duplicate', async function () {
      var client = harness.client();
      var cert = nextTestCert();
      await giftCardPg.issue(client, { certNumber: cert, faceValue: 25, issuedBy: 'staff', notes: '', txRef: nextTxRef(), actor: 'test' });

      var result = await giftCardPg.issue(client, { certNumber: cert, faceValue: 25, issuedBy: 'staff', notes: '', txRef: nextTxRef(), actor: 'test' });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('duplicate');
    });

    it('issuing the same cert with the same tx_ref is idempotent', async function () {
      var client = harness.client();
      var cert = nextTestCert();
      var txRef = nextTxRef();
      var first = await giftCardPg.issue(client, { certNumber: cert, faceValue: 25, issuedBy: 'staff', notes: '', txRef: txRef, actor: 'test' });
      expect(first.ok).toBe(true);

      var second = await giftCardPg.issue(client, { certNumber: cert, faceValue: 25, issuedBy: 'staff', notes: '', txRef: txRef, actor: 'test' });
      expect(second.ok).toBe(true);
      expect(second.idempotent).toBe(true);
      expect(second.cert_number).toBe(cert);
    });

    it('issuing GC-000500 while the sequence is lower bumps it so nextCertNumber returns GC-000501 or higher', async function () {
      var client = harness.client();
      var result = await giftCardPg.issue(client, {
        certNumber: 'GC-000500', faceValue: 25, issuedBy: 'staff', notes: '', txRef: nextTxRef(), actor: 'test'
      });
      expect(result.ok).toBe(true);

      var next = await giftCardPg.nextCertNumber(client);
      var n = parseInt(next.replace('GC-', ''), 10);
      expect(n).toBeGreaterThanOrEqual(501);
    });
  });

  describe('nextCertNumber', function () {
    it('skips a number already present in gift_cards', async function () {
      var client = harness.client();
      var seqPeek = await client.query("select nextval('gift_card_cert_seq') as n");
      var n = Number(seqPeek.rows[0].n);
      var blockedSuffix = String(n + 1);
      while (blockedSuffix.length < 6) blockedSuffix = '0' + blockedSuffix;
      var blocked = 'GC-' + blockedSuffix;
      await insertCard(client, blocked, { faceValue: 10, balance: 10, status: 'active' });

      var next = await giftCardPg.nextCertNumber(client);
      expect(next).not.toBe(blocked);
    });
  });

  describe('updateInvoice', function () {
    it('sets the invoice number; missing_fields/not_found are reported correctly', async function () {
      var client = harness.client();
      var missingFields = await giftCardPg.updateInvoice(client, { certNumber: '', invoiceNumber: '' });
      expect(missingFields.ok).toBe(false);
      expect(missingFields.error).toBe('missing_fields');

      var notFound = await giftCardPg.updateInvoice(client, { certNumber: 'GC-999998', invoiceNumber: 'INV-1' });
      expect(notFound.ok).toBe(false);
      expect(notFound.error).toBe('not_found');

      var cert = nextTestCert();
      await insertCard(client, cert, { faceValue: 50, balance: 50, status: 'active' });
      var result = await giftCardPg.updateInvoice(client, { certNumber: cert, invoiceNumber: 'INV-42' });
      expect(result.ok).toBe(true);

      var check = await client.query('select zoho_invoice_number from gift_cards where cert_number = $1', [cert]);
      expect(check.rows[0].zoho_invoice_number).toBe('INV-42');
    });
  });

  describe('amount validation', function () {
    it('amounts with more than 2 decimals, NaN, zero or negative return invalid_amount for redeem/reload; issue distinguishes missing_fields', async function () {
      var client = harness.client();
      var cert = nextTestCert();
      await insertCard(client, cert, { faceValue: 50, balance: 50, status: 'active' });

      var badAmounts = [10.123, NaN, 0, -5];
      for (var i = 0; i < badAmounts.length; i++) {
        var redeemResult = await giftCardPg.redeem(client, { certNumber: cert, amount: badAmounts[i], txRef: nextTxRef(), actor: 'test' });
        expect(redeemResult.ok).toBe(false);
        expect(redeemResult.error).toBe('invalid_amount');

        var reloadResult = await giftCardPg.reload(client, { certNumber: cert, amount: badAmounts[i], txRef: nextTxRef(), actor: 'test' });
        expect(reloadResult.ok).toBe(false);
        expect(reloadResult.error).toBe('invalid_amount');
      }

      var issueBad = await giftCardPg.issue(client, {
        certNumber: nextTestCert(), faceValue: 10.123, issuedBy: 'staff', notes: '', txRef: nextTxRef(), actor: 'test'
      });
      expect(issueBad.ok).toBe(false);
      expect(issueBad.error).toBe('invalid_amount');

      var issueZero = await giftCardPg.issue(client, {
        certNumber: nextTestCert(), faceValue: 0, issuedBy: 'staff', notes: '', txRef: nextTxRef(), actor: 'test'
      });
      expect(issueZero.ok).toBe(false);
      expect(issueZero.error).toBe('invalid_amount');

      var issueNaN = await giftCardPg.issue(client, {
        certNumber: nextTestCert(), faceValue: NaN, issuedBy: 'staff', notes: '', txRef: nextTxRef(), actor: 'test'
      });
      expect(issueNaN.ok).toBe(false);
      expect(issueNaN.error).toBe('missing_fields');
    });
  });

  describe('invariant', function () {
    it('invariant: current_balance equals the sum of non-imported ledger amounts after a mixed sequence', async function () {
      var client = harness.client();
      var cert = nextTestCert();
      await giftCardPg.issue(client, { certNumber: cert, faceValue: 50, issuedBy: 'staff', notes: '', txRef: nextTxRef(), actor: 'test' });
      await giftCardPg.redeem(client, { certNumber: cert, amount: 10, txRef: nextTxRef(), actor: 'test' });
      await giftCardPg.reload(client, { certNumber: cert, amount: 20, txRef: nextTxRef(), actor: 'test' });
      await giftCardPg.adjust(client, { certNumber: cert, delta: -5, txRef: nextTxRef(), reason: 'correction', actorName: 'Jo', actor: 'test' });

      var cardResult = await client.query('select current_balance from gift_cards where cert_number = $1', [cert]);
      var sumResult = await client.query(
        'select coalesce(sum(amount), 0) as total from gift_card_transactions where cert_number = $1 and imported = false',
        [cert]
      );
      expect(Number(cardResult.rows[0].current_balance)).toBeCloseTo(Number(sumResult.rows[0].total), 2);
    });
  });
});
