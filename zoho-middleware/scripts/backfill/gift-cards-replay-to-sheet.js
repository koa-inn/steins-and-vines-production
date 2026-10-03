'use strict';

/**
 * GiftCards ledger replay — Phase 84 Plan 09 (DB-03, D-04 postgres -> sheets rollback).
 *
 * Once a store has flipped to 'dual' or 'postgres', the live sheet can fall behind (dual's
 * sheet leg is fire-and-forget; postgres mode stops running Phase 51 business logic
 * entirely). This script pushes Postgres's current state back onto the sheet via the 84-02
 * `mirror_gift_card_state` action so a rollback to 'sheets' loses nothing: every counted
 * (non-imported) ledger row since a given moment gets replayed, in order, each carrying the
 * card's CURRENT copy-state — the Apps Script action is idempotent per (cert_number, tx_ref),
 * so re-running this script after a partial failure is always safe.
 *
 * Dry run by default — `--apply` is required to send anything. Reads Postgres in a single
 * `read only` transaction; never writes to Postgres. Terminal output is counts and cert
 * numbers only (D-13/T-84-50). Env only, never argv (T-84-51): BACKFILL_DATABASE_URL,
 * APPS_SCRIPT_URL, APPS_SCRIPT_SERVER_TOKEN.
 */

var buildMirrorPayload = require('../../lib/gift-card-store').buildMirrorPayload;
var backfillCli = require('./backfill');

var EXIT = backfillCli.EXIT;
var POSTGRES_URL_RE = /postgres(ql)?:\/\//;

var PG_CARDS_SQL =
  'select cert_number, face_value, current_balance, status, issued_date, issued_by, ' +
  'zoho_invoice_number, notes, last_updated from gift_cards order by cert_number';

var PG_LEDGER_SQL =
  'select cert_number, tx_ref, kind, amount, balance_before, balance_after, created_at, ' +
  'actor, imported from gift_card_transactions order by created_at';

// ─── Pure planner ───────────────────────────────────────────────────────────

/**
 * buildReplayBatches(cards, ledgerRows, opts) -> [{ cert_number, payload }, ...]
 *
 * cards: [{ cert_number, face_value, current_balance, status, issued_date, issued_by,
 *           zoho_invoice_number, notes, last_updated }, ...] — the card's CURRENT Postgres
 *   state, used for every payload that card appears in (not a historical snapshot).
 * ledgerRows: [{ cert_number, tx_ref, kind, amount, balance_before, balance_after,
 *                created_at, actor, imported }, ...]
 * opts.since: optional ISO timestamp — only ledger rows with created_at >= since are
 *   replayed. Omitted/undefined replays every counted row.
 *
 * Imported (historical backfill) rows are never replayed — only rows written by the live
 * facade since the flip are "counted" ops worth re-mirroring. One payload is emitted per
 * counted row, globally ordered by created_at ascending. Any card with zero counted rows in
 * range still gets exactly one payload carrying its current copy-state with
 * `ledger_entry: null`, so a card that only ever had imported history still rolls back
 * correctly.
 */
function buildReplayBatches(cards, ledgerRows, opts) {
  opts = opts || {};
  var sinceMs = opts.since ? new Date(opts.since).getTime() : null;

  var cardsByCert = {};
  (cards || []).forEach(function (c) { cardsByCert[c.cert_number] = c; });

  var eligibleCountByCert = {};
  (cards || []).forEach(function (c) { eligibleCountByCert[c.cert_number] = 0; });

  var eligible = (ledgerRows || []).filter(function (row) {
    if (row.imported) return false;
    if (sinceMs === null) return true;
    return new Date(row.created_at).getTime() >= sinceMs;
  });

  eligible.forEach(function (row) {
    eligibleCountByCert[row.cert_number] = (eligibleCountByCert[row.cert_number] || 0) + 1;
  });

  eligible.sort(function (a, b) {
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  var batches = eligible.map(function (row) {
    return { cert_number: row.cert_number, payload: buildMirrorPayload(cardsByCert[row.cert_number], row) };
  });

  Object.keys(eligibleCountByCert)
    .filter(function (cert) { return eligibleCountByCert[cert] === 0; })
    .sort()
    .forEach(function (cert) {
      batches.push({ cert_number: cert, payload: buildMirrorPayload(cardsByCert[cert], null) });
    });

  return batches;
}

// ─── CLI ────────────────────────────────────────────────────────────────────

var VALID_FLAGS = ['--since', '--apply'];
var VALUE_FLAGS = { '--since': 'since' };

/**
 * parseArgs(argv) -> { since, apply }
 *
 * Any argv entry that looks like a Postgres connection string is a hard error (T-84-51) —
 * the database comes ONLY from BACKFILL_DATABASE_URL.
 */
function parseArgs(argv) {
  var opts = { since: undefined, apply: false };

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

    if (flag === '--apply') {
      opts.apply = true;
      return;
    }

    opts[VALUE_FLAGS[flag]] = value;
  });

  return opts;
}

function fetchPgState(pool) {
  return pool.connect().then(function (client) {
    return client
      .query('begin transaction read only')
      .then(function () { return client.query(PG_CARDS_SQL); })
      .then(function (cardsResult) {
        return client.query(PG_LEDGER_SQL).then(function (ledgerResult) {
          return client.query('commit').then(function () {
            client.release();
            return { cards: cardsResult.rows, ledgerRows: ledgerResult.rows };
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
  });
}

/**
 * postBatchesSequentially(batches, deps) -> Promise<{ sent, failure }>
 *
 * Posts each payload one at a time (never in parallel — the Apps Script lock already
 * serialises per-cert writes, but sequential posting keeps this script's own retry/stop
 * semantics simple and predictable). Stops at the first `{ok:false}` response or HTTP
 * rejection and reports that cert + error without sending the rest.
 */
function postBatchesSequentially(batches, appsScriptUrl, serverToken, axios) {
  var sent = 0;
  var failure = null;

  var chain = Promise.resolve();
  batches.forEach(function (batch) {
    chain = chain.then(function () {
      if (failure) return;

      var body = Object.assign({ action: 'mirror_gift_card_state', server_token: serverToken }, batch.payload);
      return axios
        .post(appsScriptUrl, body, { timeout: 12000 })
        .then(function (res) {
          var data = res && res.data;
          if (!data || data.ok !== true) {
            failure = { cert: batch.cert_number, error: (data && data.error) || 'unknown_error' };
            return;
          }
          sent++;
        })
        .catch(function (err) {
          failure = { cert: batch.cert_number, error: err.message };
        });
    });
  });

  return chain.then(function () {
    return { sent: sent, failure: failure };
  });
}

/**
 * runReplay(opts, deps) -> Promise<{ exitCode, sent, total }>
 *
 * deps: { pool, axios, log }. Always reads Postgres read-only first. Without --apply: builds
 * the batches, prints counts, makes zero HTTP calls. With --apply: posts each payload
 * sequentially to APPS_SCRIPT_URL, stopping at the first business/infra failure and naming
 * only the cert + error (never a balance).
 */
function runReplay(opts, deps) {
  deps = deps || {};
  var log = deps.log || console.log;
  var pool = deps.pool;
  var axios = deps.axios;

  return fetchPgState(pool)
    .then(function (state) {
      var batches = buildReplayBatches(state.cards, state.ledgerRows, { since: opts.since });

      log(
        'Built ' + batches.length + ' replay payload(s)' +
          (opts.since ? ' since ' + opts.since : ' (no --since, full replay)')
      );

      if (!opts.apply) {
        log('Dry run — no HTTP calls made. Pass --apply to send.');
        return { exitCode: EXIT.OK, sent: 0, total: batches.length };
      }

      var appsScriptUrl = process.env.APPS_SCRIPT_URL;
      var serverToken = process.env.APPS_SCRIPT_SERVER_TOKEN;
      if (!appsScriptUrl || !serverToken) {
        log('Error: APPS_SCRIPT_URL and APPS_SCRIPT_SERVER_TOKEN must be set to --apply');
        return { exitCode: EXIT.ERROR, sent: 0, total: batches.length };
      }

      return postBatchesSequentially(batches, appsScriptUrl, serverToken, axios).then(function (result) {
        if (result.failure) {
          log('Replay stopped — cert=' + result.failure.cert + ' error=' + result.failure.error);
          return { exitCode: EXIT.CHECKS_FAILED, sent: result.sent, total: batches.length };
        }
        log('Replayed ' + result.sent + '/' + batches.length + ' payload(s)');
        return { exitCode: EXIT.OK, sent: result.sent, total: batches.length };
      });
    })
    .catch(function (err) {
      log('Error: ' + err.message);
      return { exitCode: EXIT.ERROR, sent: 0, total: 0 };
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

  if (!process.env.BACKFILL_DATABASE_URL) {
    console.error('Error: BACKFILL_DATABASE_URL must be set');
    process.exit(EXIT.ERROR);
    return;
  }

  var pool = db.createPool(process.env.BACKFILL_DATABASE_URL, { max: 2 });
  var axios = require('axios');

  runReplay(opts, { pool: pool, axios: axios, log: console.log })
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
  buildReplayBatches: buildReplayBatches,
  runReplay: runReplay,
  parseArgs: parseArgs,
  EXIT: EXIT
};
