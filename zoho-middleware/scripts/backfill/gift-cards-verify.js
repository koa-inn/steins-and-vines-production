'use strict';

/**
 * GiftCards verify — Phase 84 Plan 09 (DB-03, D-15 to-the-cent cutover gate).
 *
 * A read-only owner-run comparison between Postgres (gift_cards) and a FRESH .xlsx download
 * of the live GiftCards/GiftCardTransactions sheets. Used before every store-mode flip
 * (sheets -> dual, dual -> postgres) and after any rollback replay, so the owner never flips
 * modes on an unverified balance.
 *
 * This file never mutates anything: it opens a single `read only` transaction, runs two
 * `select` queries, then releases the connection. Reuses gift-cards-backfill.js's
 * buildGiftCardBackfillPlan (84-04) for the sheet-side card normalisation + TEST-* exclusion
 * rule, so verify and the backfill planner can never silently drift apart on what counts as
 * a real (non-test) card or how a cell gets parsed.
 *
 * Terminal output is limited to cert numbers, field names and counts — never a balance or a
 * name (D-13/T-84-50). The target database comes ONLY from BACKFILL_DATABASE_URL, never argv
 * (T-84-51), matching every other script in this directory.
 */

var fs = require('fs');

var readXlsx = require('./read-xlsx');
var backfillCli = require('./backfill');
var giftCardsBackfill = require('./gift-cards-backfill');

var EXIT = backfillCli.EXIT;
var assertSnapshotSafePath = backfillCli.assertSnapshotSafePath;

var DEFAULT_TIMEZONE = 'America/Vancouver';
var POSTGRES_URL_RE = /postgres(ql)?:\/\//;

// Selects every card's current copy-state. No row is ever mutated by this file.
var PG_CARDS_SQL = 'select cert_number, current_balance, status from gift_cards order by cert_number';

// Per-card ledger-sum invariant (D-12): a card whose current_balance doesn't equal the sum of
// its own non-imported ledger rows is a broken invariant, reported as field 'ledger_invariant'.
var INVARIANT_SQL =
  'select cert_number from gift_cards gc ' +
  'where gc.current_balance <> coalesce(' +
  '(select sum(amount) from gift_card_transactions t ' +
  'where t.cert_number = gc.cert_number and t.imported = false), 0) ' +
  'order by cert_number';

// ─── Pure helpers ───────────────────────────────────────────────────────────

function isTestCert(cert) {
  return typeof cert === 'string' && cert.trim().indexOf('TEST-') === 0;
}

/**
 * Money is always compared as integer cents — never float equality (behavior: '10.10' vs
 * 10.1 match). Returns null for a value that doesn't parse to a finite number.
 */
function toCents(value) {
  if (value === null || value === undefined) return null;
  var n = Number(value);
  if (!isFinite(n) || isNaN(n)) return null;
  return Math.round(n * 100);
}

/**
 * compareGiftCards(pgCards, sheetCards, pgInvariantViolations) -> { ok, compared, mismatches }
 *
 * pgCards / sheetCards: [{ cert_number, current_balance, status }, ...]
 * pgInvariantViolations: [cert_number, ...] — certs failing the per-card ledger-sum check
 *
 * TEST-* certs are excluded from both sides before any comparison runs, even though every
 * known caller already excludes them upstream — this is the pure function's own guarantee,
 * not a second-hand assumption (D-13).
 *
 * mismatches entries are always { cert, field } — never a balance, a status string value or
 * a name (T-84-50); 'status' and 'current_balance' mismatches name only the field, not either
 * side's actual value.
 */
function compareGiftCards(pgCards, sheetCards, pgInvariantViolations) {
  var pgList = (pgCards || []).filter(function (c) { return !isTestCert(c.cert_number); });
  var sheetList = (sheetCards || []).filter(function (c) { return !isTestCert(c.cert_number); });
  var violations = (pgInvariantViolations || []).filter(function (cert) { return !isTestCert(cert); });

  var sheetByCert = {};
  sheetList.forEach(function (c) { sheetByCert[c.cert_number] = c; });

  var seenInPg = {};
  var mismatches = [];

  pgList.forEach(function (pgCard) {
    seenInPg[pgCard.cert_number] = true;
    var sheetCard = sheetByCert[pgCard.cert_number];

    if (!sheetCard) {
      mismatches.push({ cert: pgCard.cert_number, field: 'missing_in_sheet' });
      return;
    }

    if (toCents(pgCard.current_balance) !== toCents(sheetCard.current_balance)) {
      mismatches.push({ cert: pgCard.cert_number, field: 'current_balance' });
    }

    if (pgCard.status !== sheetCard.status) {
      mismatches.push({ cert: pgCard.cert_number, field: 'status' });
    }
  });

  sheetList.forEach(function (sheetCard) {
    if (!seenInPg[sheetCard.cert_number]) {
      mismatches.push({ cert: sheetCard.cert_number, field: 'missing_in_postgres' });
    }
  });

  violations.forEach(function (cert) {
    mismatches.push({ cert: cert, field: 'ledger_invariant' });
  });

  return { ok: mismatches.length === 0, compared: pgList.length, mismatches: mismatches };
}

// ─── CLI ────────────────────────────────────────────────────────────────────

var VALID_FLAGS = ['--file', '--timezone'];
var VALUE_FLAGS = { '--file': 'file', '--timezone': 'timezone' };

/**
 * parseArgs(argv) -> { file, timezone }
 *
 * Any argv entry that looks like a Postgres connection string is a hard error regardless of
 * which flag carried it (T-84-51) — the database comes ONLY from BACKFILL_DATABASE_URL.
 */
function parseArgs(argv) {
  var opts = { file: undefined, timezone: DEFAULT_TIMEZONE };

  argv.forEach(function (arg) {
    if (POSTGRES_URL_RE.test(arg)) {
      throw new Error(
        'pass the database via BACKFILL_DATABASE_URL, never on the command line (got "' + arg + '")'
      );
    }

    var eqIdx = arg.indexOf('=');
    var flag = eqIdx === -1 ? arg : arg.slice(0, eqIdx);
    var value = eqIdx === -1 ? undefined : arg.slice(eqIdx + 1);

    if (VALID_FLAGS.indexOf(flag) === -1) {
      throw new Error('unknown flag "' + flag + '" — valid flags: ' + VALID_FLAGS.join(', '));
    }

    opts[VALUE_FLAGS[flag]] = value;
  });

  return opts;
}

/**
 * runVerify(opts, deps) -> Promise<{ exitCode, result }>
 *
 * deps: { pool, log }. Reads the fresh .xlsx GiftCards + GiftCardTransactions sheets, builds
 * the sheet-side card list via the 84-04 planner (same normalisation + TEST-* rule), opens a
 * single `read only` transaction against BACKFILL_DATABASE_URL, fetches the Postgres-side
 * card list and ledger-invariant violations, compares, and prints either a clean summary or
 * one line per mismatch (cert + field only).
 */
function runVerify(opts, deps) {
  deps = deps || {};
  var log = deps.log || console.log;
  var pool = deps.pool;

  try {
    assertSnapshotSafePath(opts.file);
  } catch (err) {
    log('Error: ' + err.message);
    return Promise.resolve({ exitCode: EXIT.ERROR, result: null });
  }

  if (!opts.file || !fs.existsSync(opts.file)) {
    log('Error: snapshot not found: ' + opts.file);
    return Promise.resolve({ exitCode: EXIT.ERROR, result: null });
  }

  var effectiveTimezone = opts.timezone || DEFAULT_TIMEZONE;

  return Promise.all([
    readXlsx.readSheet(opts.file, 'GiftCards'),
    readXlsx.readSheet(opts.file, 'GiftCardTransactions')
  ])
    .then(function (sheets) {
      var plan = giftCardsBackfill.buildGiftCardBackfillPlan(sheets[0], sheets[1], {
        timezone: effectiveTimezone
      });
      var sheetCards = plan.cards;

      var rejectCount = plan.rejects.cards.length + plan.rejects.ledger.length;
      if (rejectCount > 0) {
        log(
          'Warning: ' + rejectCount + ' sheet row(s) failed normalisation and were excluded ' +
            'from this comparison — resolve in the sheet and re-run for a complete verify'
        );
      }

      return pool.connect().then(function (client) {
        return client
          .query('begin transaction read only')
          .then(function () { return client.query(PG_CARDS_SQL); })
          .then(function (cardsResult) {
            return client.query(INVARIANT_SQL).then(function (violationsResult) {
              return client.query('commit').then(function () {
                client.release();
                return {
                  pgCards: cardsResult.rows,
                  violations: violationsResult.rows.map(function (row) { return row.cert_number; })
                };
              });
            });
          })
          .catch(function (err) {
            var releaseAndRethrow = function () {
              client.release();
              throw err;
            };
            return client.query('rollback').then(releaseAndRethrow, releaseAndRethrow);
          });
      }).then(function (fetched) {
        var result = compareGiftCards(fetched.pgCards, sheetCards, fetched.violations);

        if (result.ok) {
          log('Verified ' + result.compared + ' cards: 0 mismatches');
          return { exitCode: EXIT.OK, result: result };
        }

        result.mismatches.forEach(function (m) {
          log('MISMATCH cert=' + m.cert + ' field=' + m.field);
        });
        log('Verified ' + result.compared + ' cards: ' + result.mismatches.length + ' mismatch(es)');
        return { exitCode: EXIT.CHECKS_FAILED, result: result };
      });
    })
    .catch(function (err) {
      log('Error: ' + err.message);
      return { exitCode: EXIT.ERROR, result: null };
    });
}

function main() {
  var db = require('../../lib/db');
  var opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error('Error: ' + err.message);
    process.exit(EXIT.ERROR);
    return;
  }

  if (!opts.file) {
    console.error('Error: --file is required');
    process.exit(EXIT.ERROR);
    return;
  }

  if (!process.env.BACKFILL_DATABASE_URL) {
    console.error('Error: BACKFILL_DATABASE_URL must be set');
    process.exit(EXIT.ERROR);
    return;
  }

  var pool = db.createPool(process.env.BACKFILL_DATABASE_URL, { max: 2 });

  runVerify(opts, { pool: pool, log: console.log })
    .then(function (result) {
      return pool.end().then(function () { return result; });
    })
    .then(function (result) {
      process.exit(result.exitCode);
    })
    .catch(function (err) {
      console.error('Fatal: ' + err.message);
      pool.end().catch(function () {}).then(function () {
        process.exit(EXIT.ERROR);
      });
    });
}

if (require.main === module) {
  main();
}

module.exports = {
  compareGiftCards: compareGiftCards,
  runVerify: runVerify,
  parseArgs: parseArgs,
  EXIT: EXIT
};
