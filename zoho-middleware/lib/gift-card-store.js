'use strict';

/**
 * Gift-card store facade — Phase 84 Plan 05 (DB-03).
 *
 * The single abstraction every gift-card call site (routes/gift-cards.js,
 * routes/pos.js's kiosk confirm chain, the reconcile replay sweep, the
 * backfill/replay CLI) goes through. Resolves GIFT_CARDS_STORE per call
 * (never cached — store-flag.js reads process.env fresh every time) and
 * dispatches to exactly one of three modes:
 *
 *   'sheets'   - byte-for-byte identical Apps Script calls to today's
 *                pos.js confirm chain / routes/gift-cards.js. Postgres is
 *                never touched.
 *   'dual'     - Postgres is authoritative for both reads and writes.
 *                After each successful write the SAME Apps Script op is
 *                re-run fire-and-forget with the composite tx_ref, and the
 *                two results are compared via dual-write-compare (D-01).
 *   'postgres' - Postgres is authoritative. After each successful write
 *                the facade fires mirror_gift_card_state (row + ledger
 *                copy) fire-and-forget; no Phase 51 Apps Script op is
 *                ever re-run (D-04).
 *
 * Every Postgres tx_ref is minted here as saleRef + ':' + certNumber +
 * ':' + kind (Pitfall 1) — this is the ONLY place that mints one; the
 * atomic layer (lib/gift-card-pg.js, 84-01) only enforces replay/conflict
 * semantics against whatever tx_ref it is given.
 *
 * D-11: a Postgres infrastructure failure on a post-charge redeem/issue/
 * reload write (params.postCharge === true) is recorded via
 * lib/reconcile.js's recordGiftCardReconcileFailure() BEFORE this facade
 * rejects — the sale is already charged, so the failure must never be
 * silently lost. A resolved {ok:false} business rejection never triggers
 * this hook, and neither does voidCard/adjust (never post-charge paths).
 *
 * No Zoho Books write of any kind lives in this module (D-08) — the only
 * outbound HTTP calls here are the Apps Script server_token actions this
 * file's sheets/dual/postgres legs already describe.
 */

var axios = require('axios');
var storeFlag = require('./store-flag');
var db = require('./db');
var giftCardPg = require('./gift-card-pg');
var sheetMirror = require('./sheet-mirror');
var dualWriteCompare = require('./dual-write-compare');

var MAX_TX_REF_LENGTH = 200;

// Per-cert tail-promise chain so two sheet-leg calls for the same cert
// (e.g. issue then updateInvoice) always run in order — a fire-and-forget
// race between them could otherwise produce a false not_found/mismatch
// discrepancy report.
var certTails = {};

// ─── mode / config ───────────────────────────────────────────────────────

function getMode() {
  return storeFlag.resolveStoreMode('GIFT_CARDS_STORE');
}

function isConfigured() {
  var mode = getMode();
  if (mode === 'sheets') {
    return !!(process.env.APPS_SCRIPT_URL && process.env.APPS_SCRIPT_SERVER_TOKEN);
  }
  return db.isConfigured();
}

// ─── tx_ref / actor ───────────────────────────────────────────────────────

function mintTxRef(saleRef, certNumber, kind) {
  var suffix = ':' + certNumber + ':' + kind;
  var maxSaleRefLen = Math.max(0, MAX_TX_REF_LENGTH - suffix.length);
  var truncatedSaleRef = String(saleRef).slice(0, maxSaleRefLen);
  return truncatedSaleRef + suffix;
}

function actorFromRequest(req, prefix) {
  req = req || {};
  var identity = req.staffEmail ? 'session:' + req.staffEmail : (req.authTier || 'unknown');
  return prefix + ':' + identity;
}

// ─── Apps Script transport (sheets mode + dual/postgres sheet legs) ─────

function callAppsScript(action, fields) {
  var url = process.env.APPS_SCRIPT_URL;
  var token = process.env.APPS_SCRIPT_SERVER_TOKEN;
  var body = Object.assign({ action: action, server_token: token }, fields);

  // D-12 (45-07) parity: wrap in Promise.resolve() so a falsy/non-thenable
  // return from axios.post (e.g. an un-mocked jest.fn() in a caller's test)
  // rejects/resolves through the promise chain instead of throwing
  // synchronously — matches the defensive pattern the pre-84-05 pos.js
  // gift-card lookups relied on.
  return Promise.resolve(
    axios.post(url, JSON.stringify(body), {
      headers: { 'Content-Type': 'application/json' },
      timeout: 12000,
      maxRedirects: 5
    })
  ).then(function (resp) {
    return (resp && resp.data) || {};
  });
}

// ─── Postgres transport ───────────────────────────────────────────────────

function runPg(opName, params) {
  return db.withTransaction(function (client) {
    return giftCardPg[opName](client, params);
  });
}

/**
 * Strips the underscore-prefixed _card/_ledger keys gift-card-pg.js attaches
 * to every write result (for this module's own copy-state mirror) before
 * the result goes back to the caller.
 */
function strip(result) {
  if (!result || typeof result !== 'object') return result;
  var out = {};
  Object.keys(result).forEach(function (key) {
    if (key.charAt(0) !== '_') out[key] = result[key];
  });
  return out;
}

// ─── per-cert sheet-leg serialization ──────────────────────────────────────

function chainForCert(cert, fn) {
  var prevTail = certTails[cert] || Promise.resolve();
  var tail = prevTail.then(fn, fn);
  certTails[cert] = tail;
  tail.then(
    function () { if (certTails[cert] === tail) delete certTails[cert]; },
    function () { if (certTails[cert] === tail) delete certTails[cert]; }
  );
  return tail;
}

// ─── result projection for dual-write comparison ──────────────────────────

/**
 * Normalizes a sheets-side or postgres-side result down to {ok, balance,
 * status, error} so Apps-Script-only fields (tx_id, claim_tx_id,
 * needs_manual_review) and idempotent-replay-only fields never produce a
 * false discrepancy — comparison is intentionally narrow (D-01).
 */
function project(op, r) {
  r = r || {};
  var ok = !!r.ok;
  var balance;
  var status;

  if (op === 'lookup') {
    var data = r.data || {};
    balance = data.current_balance;
    status = data.status;
  } else if (op === 'issue') {
    balance = r.new_balance !== undefined ? r.new_balance : r.current_balance;
    status = ok ? 'active' : r.status;
  } else {
    balance = r.new_balance !== undefined ? r.new_balance : r.current_balance;
    status = r.status;
  }

  return { ok: ok, balance: balance, status: status, error: ok ? null : (r.error || null) };
}

// ─── post-write mirror / dual re-run dispatch ──────────────────────────────

/**
 * mode 'dual'     -> fire-and-forget: re-run sheetCallFn() through the
 *                    per-cert chain, then compare its projection against
 *                    the Postgres result's projection.
 * mode 'postgres' -> fire-and-forget: send the copy-state mirror action
 *                    through the per-cert chain. No Phase 51 op re-runs.
 * mode 'sheets'    -> never called (write ops short-circuit before this).
 */
function afterWrite(mode, op, cert, pgRaw, sheetCallFn) {
  if (mode === 'dual') {
    sheetMirror.mirrorFireAndForget('giftcards.' + op, function () {
      return chainForCert(cert, function () {
        return sheetCallFn().then(function (sheetsResult) {
          dualWriteCompare.compareAndReport({
            store: 'giftcards',
            operation: op,
            sheets: project(op, sheetsResult),
            postgres: project(op, strip(pgRaw)),
            reportValuesFor: ['balance']
          });
        });
      });
    });
  } else if (mode === 'postgres') {
    sheetMirror.mirrorFireAndForget('giftcards.' + op + '.mirror', function () {
      return chainForCert(cert, function () {
        return callAppsScript('mirror_gift_card_state', buildMirrorPayload(pgRaw._card, pgRaw._ledger));
      });
    });
  }
}

// ─── D-11: durable pending-record hook on post-charge infra failure ───────

function handleInfraFailure(op, params, txRef, cert, amount, postCharge, err) {
  if (postCharge !== true) {
    return Promise.reject(err);
  }
  var reconcile = require('./reconcile'); // lazy require avoids a load-time cycle with 84-06's sweep
  return reconcile.recordGiftCardReconcileFailure({
    op: op,
    params: Object.assign({}, params, { txRef: txRef, postCharge: false }),
    tx_ref: txRef,
    cert_number: cert,
    amount: amount,
    error: err.message
  }).then(function () {
    throw err;
  });
}

// ─── write ops ──────────────────────────────────────────────────────────

function redeem(params) {
  params = params || {};
  var mode = getMode();
  var cert = params.certNumber;

  if (mode === 'sheets') {
    return callAppsScript('redeem_gift_card', {
      cert_number: cert,
      amount: params.amount,
      transaction_ref: params.saleRef
    });
  }

  var txRef = params.txRef || mintTxRef(params.saleRef, cert, 'redeem');
  var pgParams = { certNumber: cert, amount: params.amount, txRef: txRef, actor: params.actor };

  return runPg('redeem', pgParams).then(function (raw) {
    if (raw.ok) {
      afterWrite(mode, 'redeem', cert, raw, function () {
        return callAppsScript('redeem_gift_card', { cert_number: cert, amount: params.amount, transaction_ref: txRef });
      });
    }
    return strip(raw);
  }).catch(function (err) {
    return handleInfraFailure('redeem', params, txRef, cert, params.amount, params.postCharge, err);
  });
}

function reload(params) {
  params = params || {};
  var mode = getMode();
  var cert = params.certNumber;

  if (mode === 'sheets') {
    return callAppsScript('reload_gift_card', {
      cert_number: cert,
      amount: params.amount,
      transaction_ref: params.saleRef
    });
  }

  var txRef = params.txRef || mintTxRef(params.saleRef, cert, 'reload');
  var pgParams = { certNumber: cert, amount: params.amount, txRef: txRef, actor: params.actor };

  return runPg('reload', pgParams).then(function (raw) {
    if (raw.ok) {
      afterWrite(mode, 'reload', cert, raw, function () {
        return callAppsScript('reload_gift_card', { cert_number: cert, amount: params.amount, transaction_ref: txRef });
      });
    }
    return strip(raw);
  }).catch(function (err) {
    return handleInfraFailure('reload', params, txRef, cert, params.amount, params.postCharge, err);
  });
}

function issue(params) {
  params = params || {};
  var mode = getMode();
  var cert = params.certNumber;

  if (mode === 'sheets') {
    return callAppsScript('issue_gift_card', {
      cert_number: cert,
      face_value: params.faceValue,
      issued_by: params.issuedBy,
      notes: params.notes
    });
  }

  var txRef = params.txRef || mintTxRef(params.saleRef, cert, 'issue');
  var pgParams = {
    certNumber: cert, faceValue: params.faceValue, issuedBy: params.issuedBy,
    notes: params.notes, txRef: txRef, actor: params.actor
  };

  return runPg('issue', pgParams).then(function (raw) {
    if (raw.ok) {
      afterWrite(mode, 'issue', cert, raw, function () {
        return callAppsScript('issue_gift_card', {
          cert_number: cert, face_value: params.faceValue, issued_by: params.issuedBy,
          notes: params.notes, transaction_ref: txRef
        });
      });
    }
    return strip(raw);
  }).catch(function (err) {
    return handleInfraFailure('issue', params, txRef, cert, params.faceValue, params.postCharge, err);
  });
}

function voidCard(params) {
  params = params || {};
  var mode = getMode();
  var cert = params.certNumber;

  if (mode === 'sheets') {
    return callAppsScript('void_gift_card', { cert_number: cert, reason: params.reason });
  }

  var pgParams = { certNumber: cert, reason: params.reason, actor: params.actor };

  return runPg('voidCard', pgParams).then(function (raw) {
    if (raw.ok) {
      afterWrite(mode, 'void', cert, raw, function () {
        return callAppsScript('void_gift_card', { cert_number: cert, reason: params.reason });
      });
    }
    return strip(raw);
  });
}

function updateInvoice(params) {
  params = params || {};
  var mode = getMode();
  var cert = params.certNumber;

  if (mode === 'sheets') {
    return callAppsScript('update_gift_card_invoice', { cert_number: cert, zoho_invoice_number: params.invoiceNumber });
  }

  var pgParams = { certNumber: cert, invoiceNumber: params.invoiceNumber };

  return runPg('updateInvoice', pgParams).then(function (raw) {
    if (raw.ok) {
      afterWrite(mode, 'updateInvoice', cert, raw, function () {
        return callAppsScript('update_gift_card_invoice', { cert_number: cert, zoho_invoice_number: params.invoiceNumber });
      });
    }
    return strip(raw);
  });
}

/**
 * D-07: there is no dedicated balance-adjust Apps Script action, so sheets
 * mode can never honour this op — it resolves adjust_unavailable with zero
 * HTTP calls. In dual/postgres the sheet leg (if any) maps the signed
 * delta onto the two actions that DO exist: a positive delta re-runs the
 * reload action, a negative delta re-runs the redeem action — both with
 * the adjust tx_ref.
 */
function adjust(params) {
  params = params || {};
  var mode = getMode();
  var cert = params.certNumber;

  if (mode === 'sheets') {
    return Promise.resolve({ ok: false, error: 'adjust_unavailable' });
  }

  var txRef = mintTxRef('ADJ-' + params.adjustKey, cert, 'adjust');
  var delta = params.delta;
  var pgParams = {
    certNumber: cert, delta: delta, txRef: txRef, reason: params.reason, note: params.note,
    actorName: params.actorName, deviceLabel: params.deviceLabel, actor: params.actor
  };

  return runPg('adjust', pgParams).then(function (raw) {
    if (raw.ok) {
      afterWrite(mode, 'adjust', cert, raw, function () {
        if (delta > 0) {
          return callAppsScript('reload_gift_card', { cert_number: cert, amount: delta, transaction_ref: txRef });
        }
        return callAppsScript('redeem_gift_card', { cert_number: cert, amount: -delta, transaction_ref: txRef });
      });
    }
    return strip(raw);
  });
}

// ─── read ops ─────────────────────────────────────────────────────────────

/**
 * Never falls back to a sheet read when Postgres fails (D-09) — a DB
 * outage rejects the promise so callers can map it to a 503 instead of
 * silently serving a stale sheet balance into a redemption decision.
 */
function lookup(certNumber, opts) {
  opts = opts || {};
  var mode = getMode();

  if (mode === 'sheets') {
    return callAppsScript('lookup_gift_card', { cert_number: certNumber });
  }

  return runPg('lookup', certNumber).then(function (raw) {
    if (mode === 'dual' && opts.compare) {
      sheetMirror.mirrorFireAndForget('giftcards.lookup', function () {
        return chainForCert(certNumber, function () {
          return callAppsScript('lookup_gift_card', { cert_number: certNumber }).then(function (sheetsResult) {
            dualWriteCompare.compareAndReport({
              store: 'giftcards',
              operation: 'lookup',
              sheets: project('lookup', sheetsResult),
              postgres: project('lookup', raw),
              reportValuesFor: ['balance']
            });
          });
        });
      });
    }
    return strip(raw);
  });
}

function nextCertNumber() {
  var mode = getMode();

  if (mode === 'sheets') {
    return callAppsScript('get_next_cert_number', {});
  }

  return runPg('nextCertNumber').then(function (suggested) {
    return { ok: true, suggested: suggested };
  });
}

// ─── replay (84-06 pending-record sweep consumes this) ────────────────────

/**
 * record = {op, params, tx_ref, cert_number, amount, error}. Re-invokes
 * record.op with record.params, forcing params.txRef to record.tx_ref
 * verbatim (no re-minting) and postCharge:false (so a second infra
 * failure during a replay does not re-trigger the D-11 hook recursively —
 * the record already IS the durable trail for this tx_ref).
 */
function replayPending(record) {
  record = record || {};
  var mode = getMode();

  if (mode === 'sheets') {
    return Promise.resolve({ ok: false, error: 'store_mode_sheets' });
  }

  var op = record.op;
  var params = Object.assign({}, record.params, { txRef: record.tx_ref, postCharge: false });

  if (op === 'redeem') return redeem(params);
  if (op === 'issue') return issue(params);
  if (op === 'reload') return reload(params);
  return Promise.resolve({ ok: false, error: 'unknown_op' });
}

// ─── mirror_gift_card_state payload builder (D-04) ─────────────────────────

/**
 * Builds the payload for the Apps Script mirror_gift_card_state action
 * from a write result's raw _card/_ledger (see lib/gift-card-pg.js's
 * cardToObject/ledgerRowToObject — numbers are already Number, dates are
 * already ISO strings or date-only strings).
 */
function buildMirrorPayload(card, ledger) {
  card = card || {};
  return {
    cert_number: card.cert_number,
    face_value: card.face_value,
    current_balance: card.current_balance,
    status: card.status,
    issued_date: card.issued_date,
    issued_by: card.issued_by,
    zoho_invoice_number: card.zoho_invoice_number,
    notes: card.notes,
    last_updated: card.last_updated,
    ledger_entry: ledger ? {
      tx_ref: ledger.tx_ref,
      kind: ledger.kind,
      amount: ledger.amount,
      balance_before: ledger.balance_before,
      balance_after: ledger.balance_after,
      created_at: ledger.created_at,
      actor: ledger.actor
    } : null
  };
}

module.exports = {
  getMode: getMode,
  isConfigured: isConfigured,
  mintTxRef: mintTxRef,
  actorFromRequest: actorFromRequest,
  lookup: lookup,
  nextCertNumber: nextCertNumber,
  issue: issue,
  redeem: redeem,
  reload: reload,
  voidCard: voidCard,
  updateInvoice: updateInvoice,
  adjust: adjust,
  replayPending: replayPending,
  buildMirrorPayload: buildMirrorPayload
};
