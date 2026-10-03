'use strict';

/**
 * Atomic Postgres gift-card operations — Phase 84 Plan 01 (DB-03, ROADMAP SC1).
 *
 * This module never requires 'pg' and never creates a pool — every function receives the
 * transaction `client` from the caller (lib/db.js's withTransaction()). It is NOT the facade
 * (lib/gift-card-store.js, Plan 84-05) — this is the pure atomic layer the facade composes.
 *
 * All SQL uses $n placeholders only (ASVS V5) — never string-built queries. Money values are
 * validated (finite, at most 2 decimal places, within +-99999999.99) and passed to Postgres as
 * fixed 2dp strings; numeric columns read back are converted with Number().
 *
 * Write-op shape (redeem/reload/adjust) — see 84-01-PLAN.md <action>:
 *   1. `select ... for update` locks the gift_cards row. No row -> not_found.
 *   2. Replay check against gift_card_transactions by tx_ref. Same cert+kind -> idempotent
 *      (current balance/status). Different cert/kind -> tx_ref_conflict (Pitfall 1 guard).
 *   3. Business checks under the lock (status/balance) -> plain {ok:false,...} rejections,
 *      never a throw.
 *   4. Insert the ledger row with `on conflict (tx_ref) do nothing returning *`. Zero rows is
 *      an infrastructure race (another transaction landed the same tx_ref between step 2 and
 *      here) -> throw GC_TXREF_RACE so the whole transaction rolls back.
 *   5. Guarded balance update: `where current_balance + $delta >= 0`. rowCount !== 1 is a
 *      defence-in-depth invariant failure -> throw GC_GUARD_FAILED.
 *
 * Every write result carries `_card` (full post-op gift_cards row, numerics as Number) and
 * `_ledger` (the ledger row written or matched on replay, or null for updateInvoice) for
 * 84-05's copy-state mirror. The facade strips these underscore keys before responding.
 */

// ─── SQL (module-level constants only — never string-built) ────────────────

var LOOKUP_SQL =
  'select cert_number, face_value, current_balance, status, zoho_invoice_number, ' +
  'issued_date, issued_by, last_updated from gift_cards where cert_number = $1';

var LOCK_CARD_SQL =
  'select cert_number, face_value, current_balance, status, zoho_invoice_number, ' +
  'issued_date, issued_by, notes, void_reason, created_at, last_updated ' +
  'from gift_cards where cert_number = $1 for update';

var FIND_TX_BY_REF_SQL = 'select * from gift_card_transactions where tx_ref = $1';

var INSERT_LEDGER_SQL =
  'insert into gift_card_transactions ' +
  '(cert_number, tx_ref, kind, amount, balance_before, balance_after, actor, actor_name, device_label, reason, note) ' +
  'values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ' +
  'on conflict (tx_ref) do nothing returning *';

var UPDATE_BALANCE_SQL =
  'update gift_cards set current_balance = current_balance + $2, status = $3, last_updated = now() ' +
  'where cert_number = $1 and current_balance + $2 >= 0 returning *';

var INSERT_GIFT_CARD_SQL =
  "insert into gift_cards (cert_number, face_value, current_balance, status, issued_date, issued_by, notes) " +
  "values ($1, $2, $2, 'active', current_date, $3, $4) on conflict (cert_number) do nothing returning *";

var VOID_UPDATE_SQL =
  "update gift_cards set status = 'void', void_reason = $2, last_updated = now() " +
  'where cert_number = $1 returning *';

var UPDATE_INVOICE_SQL =
  'update gift_cards set zoho_invoice_number = $2, last_updated = now() ' +
  'where cert_number = $1 returning *';

var NEXTVAL_SQL = "select nextval('gift_card_cert_seq') as n";

var CERT_EXISTS_SQL = 'select 1 from gift_cards where cert_number = $1';

var BUMP_SEQ_SQL =
  "select setval('gift_card_cert_seq', $1) where $1 > (select last_value from gift_card_cert_seq)";

var MAX_NEXT_CERT_ATTEMPTS = 50;
var MAX_AMOUNT = 99999999.99;

// ─── Pure helpers ────────────────────────────────────────────────────────

function normalizeCert(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().toUpperCase();
}

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

function padCertSuffix(n) {
  var s = String(n);
  while (s.length < 6) s = '0' + s;
  return s;
}

/**
 * Finite, at most 2 decimal places (tolerant of float drift), within the numeric(10,2) range.
 */
function isValidAmountShape(x) {
  if (typeof x !== 'number' || !isFinite(x)) return false;
  if (Math.abs(x) > MAX_AMOUNT) return false;
  return Math.abs(Math.round(x * 100) - x * 100) < 1e-9;
}

function isValidPositiveAmount(x) {
  return isValidAmountShape(x) && x > 0;
}

function isValidDelta(x) {
  return isValidAmountShape(x) && x !== 0;
}

/**
 * Distinguishes issue's missing_fields (absent/NaN) from invalid_amount (bad precision,
 * zero, negative, or out of range) per the interface contract.
 */
function validateFaceValue(faceValue) {
  if (faceValue === undefined || faceValue === null || typeof faceValue !== 'number' || isNaN(faceValue)) {
    return 'missing_fields';
  }
  if (!isValidAmountShape(faceValue) || faceValue <= 0) {
    return 'invalid_amount';
  }
  return null;
}

function money(x) {
  return x.toFixed(2);
}

function orNull(value) {
  return value === undefined || value === null ? null : value;
}

/**
 * pg's date parser builds a `date` column via `new Date(year, month, day)` in LOCAL time
 * (postgres-date's getDate()) — read back the SAME local components. Using .toISOString()
 * here would convert to UTC and can shift the calendar day depending on the server's
 * timezone offset (see .planning/notes/sheets-to-postgres-data-conversion.md Trap 2).
 */
function formatDateOnly(value) {
  if (!value) return null;
  return value.getFullYear() + '-' + pad2(value.getMonth() + 1) + '-' + pad2(value.getDate());
}

function isoOrNull(value) {
  return value ? value.toISOString() : null;
}

function numOrNull(value) {
  return value === null || value === undefined ? null : Number(value);
}

function cardToObject(row) {
  if (!row) return null;
  return {
    cert_number: row.cert_number,
    face_value: Number(row.face_value),
    current_balance: Number(row.current_balance),
    status: row.status,
    issued_date: formatDateOnly(row.issued_date),
    issued_by: row.issued_by,
    zoho_invoice_number: row.zoho_invoice_number,
    notes: row.notes !== undefined ? row.notes : null,
    void_reason: row.void_reason !== undefined ? row.void_reason : null,
    created_at: isoOrNull(row.created_at),
    last_updated: isoOrNull(row.last_updated)
  };
}

function ledgerRowToObject(row) {
  if (!row) return null;
  return {
    id: row.id,
    cert_number: row.cert_number,
    tx_ref: row.tx_ref,
    kind: row.kind,
    amount: Number(row.amount),
    balance_before: numOrNull(row.balance_before),
    balance_after: numOrNull(row.balance_after),
    imported: row.imported,
    actor: row.actor,
    actor_name: row.actor_name,
    device_label: row.device_label,
    reason: row.reason,
    note: row.note,
    source_tx_id: row.source_tx_id,
    created_at: isoOrNull(row.created_at)
  };
}

function txRefRaceError() {
  var err = new Error(
    'gift-card-pg: tx_ref insert raced — ON CONFLICT DO NOTHING returned 0 rows after the ' +
    'replay check found none; another transaction landed the same tx_ref concurrently'
  );
  err.code = 'GC_TXREF_RACE';
  return err;
}

function guardFailedError() {
  var err = new Error(
    'gift-card-pg: guarded balance update affected 0 rows — balance/lock invariant violated'
  );
  err.code = 'GC_GUARD_FAILED';
  return err;
}

// ─── Replay check (shared by issue/redeem/reload/adjust) ───────────────────

/**
 * Looks up an existing ledger row by tx_ref. Returns:
 *   - null                               no row exists yet, proceed
 *   - { replay: true, row }              same cert + kind — idempotent replay
 *   - { conflict: true, row }            different cert or kind — tx_ref_conflict (Pitfall 1)
 */
function checkReplay(client, certNumber, txRef, kind) {
  return client.query(FIND_TX_BY_REF_SQL, [txRef]).then(function (result) {
    if (result.rowCount === 0) return null;
    var row = result.rows[0];
    if (row.cert_number === certNumber && row.kind === kind) {
      return { replay: true, row: row };
    }
    return { conflict: true, row: row };
  });
}

// ─── Shared write-op core (redeem / reload / adjust) ────────────────────────

/**
 * opts: {
 *   certNumber, txRef, kind, actor, actorName, deviceLabel, reason, note,
 *   checkBusinessRules: function(cardRow, currentBalance, currentStatus) -> errorResult|null,
 *   signedAmount: function(currentBalance) -> number,
 *   computeStatus: function(newBalance, currentStatus) -> string
 * }
 */
function applyLedgeredChange(client, opts) {
  var certNum = opts.certNumber;
  var txRef = opts.txRef;
  var kind = opts.kind;

  return client.query(LOCK_CARD_SQL, [certNum]).then(function (lockResult) {
    if (lockResult.rowCount === 0) {
      return { ok: false, error: 'not_found' };
    }
    var cardRow = lockResult.rows[0];
    var currentBalance = Number(cardRow.current_balance);
    var currentStatus = cardRow.status;

    return checkReplay(client, certNum, txRef, kind).then(function (replayResult) {
      if (replayResult && replayResult.conflict) {
        return { ok: false, error: 'tx_ref_conflict' };
      }
      if (replayResult && replayResult.replay) {
        return {
          ok: true,
          idempotent: true,
          new_balance: currentBalance,
          status: currentStatus,
          tx_ref: txRef,
          _card: cardToObject(cardRow),
          _ledger: ledgerRowToObject(replayResult.row)
        };
      }

      var businessError = opts.checkBusinessRules(cardRow, currentBalance, currentStatus);
      if (businessError) {
        return businessError;
      }

      var signedAmount = opts.signedAmount(currentBalance);
      var newBalanceComputed = Math.round((currentBalance + signedAmount) * 100) / 100;
      var newStatus = opts.computeStatus(newBalanceComputed, currentStatus);

      var ledgerParams = [
        certNum,
        txRef,
        kind,
        money(signedAmount),
        money(currentBalance),
        money(newBalanceComputed),
        orNull(opts.actor),
        orNull(opts.actorName),
        orNull(opts.deviceLabel),
        orNull(opts.reason),
        orNull(opts.note)
      ];

      return client.query(INSERT_LEDGER_SQL, ledgerParams).then(function (insertResult) {
        if (insertResult.rowCount === 0) {
          throw txRefRaceError();
        }
        var ledgerRow = insertResult.rows[0];

        return client.query(UPDATE_BALANCE_SQL, [certNum, money(signedAmount), newStatus]).then(
          function (updateResult) {
            if (updateResult.rowCount !== 1) {
              throw guardFailedError();
            }
            var updatedCard = updateResult.rows[0];
            return {
              ok: true,
              new_balance: Number(updatedCard.current_balance),
              status: updatedCard.status,
              tx_ref: txRef,
              _card: cardToObject(updatedCard),
              _ledger: ledgerRowToObject(ledgerRow)
            };
          }
        );
      });
    });
  });
}

// ─── Public operations ───────────────────────────────────────────────────

function lookup(client, certNumber) {
  var certNum = normalizeCert(certNumber);
  return client.query(LOOKUP_SQL, [certNum]).then(function (result) {
    if (result.rowCount === 0) {
      return { ok: false, error: 'not_found' };
    }
    var row = result.rows[0];
    return {
      ok: true,
      data: {
        cert_number: row.cert_number,
        current_balance: Number(row.current_balance),
        face_value: Number(row.face_value),
        status: row.status,
        zoho_invoice_number: row.zoho_invoice_number,
        issued_date: formatDateOnly(row.issued_date),
        issued_by: row.issued_by,
        last_updated: isoOrNull(row.last_updated)
      }
    };
  });
}

function issue(client, params) {
  params = params || {};
  var certNum = normalizeCert(params.certNumber);
  var faceValueError = validateFaceValue(params.faceValue);
  if (faceValueError) {
    return Promise.resolve({ ok: false, error: faceValueError });
  }

  var faceValue = params.faceValue;
  var issuedBy = orNull(params.issuedBy);
  var notes = orNull(params.notes);
  var txRef = params.txRef;
  var actor = orNull(params.actor);

  return checkReplay(client, certNum, txRef, 'issue').then(function (replayResult) {
    if (replayResult && replayResult.conflict) {
      return { ok: false, error: 'tx_ref_conflict' };
    }

    if (replayResult && replayResult.replay) {
      return client.query(LOOKUP_SQL, [certNum]).then(function (lookupResult) {
        var row = lookupResult.rows[0];
        return {
          ok: true,
          idempotent: true,
          cert_number: row ? row.cert_number : certNum,
          face_value: row ? Number(row.face_value) : faceValue,
          current_balance: row ? Number(row.current_balance) : faceValue,
          _card: row ? cardToObject(row) : null,
          _ledger: ledgerRowToObject(replayResult.row)
        };
      });
    }

    return client.query(INSERT_GIFT_CARD_SQL, [certNum, money(faceValue), issuedBy, notes]).then(
      function (insertResult) {
        if (insertResult.rowCount === 0) {
          return { ok: false, error: 'duplicate' };
        }
        var cardRow = insertResult.rows[0];

        var ledgerParams = [
          certNum, txRef, 'issue', money(faceValue), money(0), money(faceValue),
          actor, null, null, null, null
        ];

        return client.query(INSERT_LEDGER_SQL, ledgerParams).then(function (ledgerResult) {
          if (ledgerResult.rowCount === 0) {
            throw txRefRaceError();
          }
          var ledgerRow = ledgerResult.rows[0];

          return bumpSequenceIfNeeded(client, certNum).then(function () {
            return {
              ok: true,
              cert_number: cardRow.cert_number,
              face_value: Number(cardRow.face_value),
              current_balance: Number(cardRow.current_balance),
              _card: cardToObject(cardRow),
              _ledger: ledgerRowToObject(ledgerRow)
            };
          });
        });
      }
    );
  });
}

function redeem(client, params) {
  params = params || {};
  var certNum = normalizeCert(params.certNumber);
  if (!isValidPositiveAmount(params.amount)) {
    return Promise.resolve({ ok: false, error: 'invalid_amount' });
  }
  var amount = params.amount;

  return applyLedgeredChange(client, {
    certNumber: certNum,
    txRef: params.txRef,
    kind: 'redeem',
    actor: params.actor,
    checkBusinessRules: function (cardRow, currentBalance, currentStatus) {
      if (currentStatus !== 'active') {
        return { ok: false, error: 'invalid_status', status: currentStatus };
      }
      if (amount > currentBalance + 0.001) {
        return { ok: false, error: 'insufficient_balance', balance: currentBalance };
      }
      return null;
    },
    signedAmount: function () {
      return -amount;
    },
    computeStatus: function (newBalance) {
      return newBalance <= 0 ? 'depleted' : 'active';
    }
  });
}

function reload(client, params) {
  params = params || {};
  var certNum = normalizeCert(params.certNumber);
  if (!isValidPositiveAmount(params.amount)) {
    return Promise.resolve({ ok: false, error: 'invalid_amount' });
  }
  var amount = params.amount;

  return applyLedgeredChange(client, {
    certNumber: certNum,
    txRef: params.txRef,
    kind: 'reload',
    actor: params.actor,
    checkBusinessRules: function (cardRow, currentBalance, currentStatus) {
      if (currentStatus === 'void') {
        return { ok: false, error: 'invalid_status', status: currentStatus };
      }
      return null;
    },
    signedAmount: function () {
      return amount;
    },
    computeStatus: function () {
      return 'active';
    }
  });
}

function adjust(client, params) {
  params = params || {};
  var certNum = normalizeCert(params.certNumber);
  if (!isValidDelta(params.delta)) {
    return Promise.resolve({ ok: false, error: 'invalid_amount' });
  }
  var delta = params.delta;

  return applyLedgeredChange(client, {
    certNumber: certNum,
    txRef: params.txRef,
    kind: 'adjust',
    actor: params.actor,
    actorName: params.actorName,
    deviceLabel: params.deviceLabel,
    reason: params.reason,
    note: params.note,
    checkBusinessRules: function (cardRow, currentBalance, currentStatus) {
      if (currentStatus !== 'active') {
        return { ok: false, error: 'invalid_status', status: currentStatus };
      }
      var projected = Math.round((currentBalance + delta) * 100) / 100;
      if (projected < 0) {
        return { ok: false, error: 'negative_balance', balance: currentBalance };
      }
      return null;
    },
    signedAmount: function () {
      return delta;
    },
    computeStatus: function (newBalance) {
      return newBalance <= 0 ? 'depleted' : 'active';
    }
  });
}

function voidCard(client, params) {
  params = params || {};
  var certNum = normalizeCert(params.certNumber);
  var actor = orNull(params.actor);
  var reasonText = params.reason ? String(params.reason).slice(0, 512) : null;
  var txRef = 'void:' + certNum;

  return client.query(LOCK_CARD_SQL, [certNum]).then(function (lockResult) {
    if (lockResult.rowCount === 0) {
      return { ok: false, error: 'not_found' };
    }
    var cardRow = lockResult.rows[0];
    var currentStatus = cardRow.status;

    // Status check happens BEFORE any replay logic so a double void matches Apps Script
    // (parity: voidGiftCard rejects from an already-'void' status, not an idempotent replay).
    if (currentStatus !== 'active' && currentStatus !== 'depleted') {
      return { ok: false, error: 'invalid_status', status: currentStatus };
    }

    return client.query(VOID_UPDATE_SQL, [certNum, reasonText]).then(function (updateResult) {
      if (updateResult.rowCount !== 1) {
        throw guardFailedError();
      }
      var updatedCard = updateResult.rows[0];
      var currentBalance = Number(cardRow.current_balance);

      var ledgerParams = [
        certNum, txRef, 'void', money(0), money(currentBalance), money(currentBalance),
        actor, null, null, null, reasonText
      ];

      return client.query(INSERT_LEDGER_SQL, ledgerParams).then(function (ledgerResult) {
        if (ledgerResult.rowCount === 0) {
          throw txRefRaceError();
        }
        var ledgerRow = ledgerResult.rows[0];
        return {
          ok: true,
          status: 'void',
          _card: cardToObject(updatedCard),
          _ledger: ledgerRowToObject(ledgerRow)
        };
      });
    });
  });
}

function updateInvoice(client, params) {
  params = params || {};
  var certNum = normalizeCert(params.certNumber);
  var invoiceNumber = params.invoiceNumber;

  if (!certNum || !invoiceNumber) {
    return Promise.resolve({ ok: false, error: 'missing_fields' });
  }

  return client.query(UPDATE_INVOICE_SQL, [certNum, invoiceNumber]).then(function (result) {
    if (result.rowCount === 0) {
      return { ok: false, error: 'not_found' };
    }
    return { ok: true, _card: cardToObject(result.rows[0]), _ledger: null };
  });
}

/**
 * Advances the sequence past `certNumber`'s numeric suffix when it exceeds the current
 * last_value (D-14: staff-overridden/pre-printed cert numbers must not later collide with
 * a sequence-generated one). AlterSeqStmt/bare SELECT are migration-time-only restrictions
 * (migration-allowlist.js) — this is runtime application SQL and is not subject to them.
 */
function bumpSequenceIfNeeded(client, certNumber) {
  var match = /^GC-([0-9]{6})$/.exec(certNumber);
  if (!match) return Promise.resolve();
  var n = parseInt(match[1], 10);
  return client.query(BUMP_SEQ_SQL, [n]).then(function () {
    return undefined;
  });
}

function nextCertNumber(client) {
  function attempt(remaining) {
    if (remaining <= 0) {
      return Promise.reject(
        new Error('nextCertNumber: exceeded ' + MAX_NEXT_CERT_ATTEMPTS + ' attempts to find an unused cert number')
      );
    }
    return client.query(NEXTVAL_SQL).then(function (result) {
      var n = Number(result.rows[0].n);
      var candidate = 'GC-' + padCertSuffix(n);
      return client.query(CERT_EXISTS_SQL, [candidate]).then(function (existsResult) {
        if (existsResult.rowCount === 0) {
          return candidate;
        }
        return attempt(remaining - 1);
      });
    });
  }
  return attempt(MAX_NEXT_CERT_ATTEMPTS);
}

module.exports = {
  lookup: lookup,
  issue: issue,
  redeem: redeem,
  reload: reload,
  adjust: adjust,
  voidCard: voidCard,
  updateInvoice: updateInvoice,
  nextCertNumber: nextCertNumber
};
