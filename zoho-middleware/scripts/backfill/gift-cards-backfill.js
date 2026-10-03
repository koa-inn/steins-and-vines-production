'use strict';

/**
 * GiftCards backfill — Phase 84 Plan 04 (DB-03, ROADMAP SC2 backfill half).
 *
 * Dedicated two-table orchestration for the GiftCards + GiftCardTransactions sheets
 * (84-RESEARCH.md Pitfall 3 — this does not fit backfill.js's single-sheet-to-single-table
 * spec shape: one sheet row becomes a gift_cards row AND a synthesized opening_balance
 * ledger row (D-12), and a second sheet's historical rows import into the SAME
 * gift_card_transactions table with their tx_refs reserved, not replayed).
 *
 * This file exports a PURE planner (buildGiftCardBackfillPlan, Task 1) with no I/O —
 * Task 2 adds the CLI (`require.main === module`) that reads the .xlsx, calls the planner,
 * writes the rejects report, and (gated) promotes both tables inside one transaction.
 *
 * Never hand-rolls money/date/boolean parsing beyond what the Phase 83 primitives already
 * do — normalizeRow (via specs/gift-cards.js) covers every gift_cards column except
 * issued_date (no 'date' normaliser type exists; handled locally below, since a date-only
 * value needs no instant/offset resolution — just format validation, D-12 "never coerce").
 * GiftCardTransactions has no spec file (deliberate, Pitfall 3) — its cells are validated
 * directly here with normalizeNumeric.
 *
 * D-13 (PII): reject reasons are names only, never raw cell values. `cert_number` is NOT
 * customer PII (a generated gift-card ID), so ledger rejects may carry it to help the owner
 * locate affected cards — this does not violate the rule.
 */

var normalizeLib = require('./normalize');
var normalizeRow = normalizeLib.normalizeRow;
var normalizeNumeric = normalizeLib.normalizeNumeric;
var cardSpec = require('./specs/gift-cards');

var DEFAULT_TIMEZONE = 'America/Vancouver';
var DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
var VALID_STATUSES = ['active', 'depleted', 'void'];
var VALID_KINDS = ['redeem', 'reload'];
var CERT_SUFFIX_RE = /^GC-([0-9]{6})$/;

// ─── Small pure helpers ──────────────────────────────────────────────────

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

// "cert_number starts with TEST-" (D-13) — checked on the RAW sheet value, before any
// normalisation, so a TEST-* cert is excluded rather than rejected as malformed.
function isTestCert(rawCert) {
  return typeof rawCert === 'string' && rawCert.trim().indexOf('TEST-') === 0;
}

// needs_manual_review's truthy set per 84-04-PLAN.md <behavior> is broader than
// normalizeBoolean's strict 'TRUE'/'FALSE' — Phase 51's sheet can carry 'yes'/1 from
// manual edits (51-03-SUMMARY.md probe data), so this is intentionally a separate helper.
function isTruthyFlag(raw) {
  return raw === true || raw === 'TRUE' || raw === 'yes' || raw === 1;
}

/**
 * issued_date has no normalize.js 'date' type (only 'timestamptz' exists). A JS Date from
 * exceljs carries its wall-clock in UTC-named fields (normalize.js's own Trap 2 convention,
 * confirmed in normalize.test.js) — for a DATE-ONLY value this needs no further timezone
 * shift, just reading those fields directly. A 'YYYY-MM-DD' string passes through as-is.
 * Anything else is rejected, never coerced (D-12).
 */
function normalizeIssuedDate(raw) {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw === 'string' && raw.trim() === '') return { ok: true, value: null };

  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) return { ok: false, reason: 'issued_date_unparseable' };
    return {
      ok: true,
      value: raw.getUTCFullYear() + '-' + pad2(raw.getUTCMonth() + 1) + '-' + pad2(raw.getUTCDate())
    };
  }

  if (typeof raw === 'string' && DATE_ONLY_RE.test(raw.trim())) {
    return { ok: true, value: raw.trim() };
  }

  return { ok: false, reason: 'issued_date_unparseable' };
}

// ─── Card-row validation (GiftCards sheet -> gift_cards) ──────────────────

/**
 * Validates one GiftCards row against the spec (normalizeRow) plus the two checks the spec
 * can't express: status must be in VALID_STATUSES, and cert_number must not repeat across
 * accepted rows (duplicate_cert). issued_date is folded in since the spec doesn't carry it.
 */
function buildCardResult(rawValues, opts, acceptedCertSet) {
  var normResult = normalizeRow(cardSpec, rawValues, { timezone: opts.timezone });
  var reasons = normResult.ok ? [] : normResult.reasons.slice();

  var issuedDateResult = normalizeIssuedDate(rawValues.issued_date);
  if (!issuedDateResult.ok) {
    reasons.push({ column: 'issued_date', reason: issuedDateResult.reason });
  }

  if (normResult.ok && VALID_STATUSES.indexOf(normResult.values.status) === -1) {
    reasons.push({ column: 'status', reason: 'invalid_status' });
  }

  if (reasons.length > 0) {
    return { ok: false, reasons: reasons };
  }

  if (acceptedCertSet[normResult.values.cert_number]) {
    return { ok: false, reasons: [{ column: 'cert_number', reason: 'duplicate_cert' }] };
  }

  var values = Object.assign({}, normResult.values, { issued_date: issuedDateResult.value });
  return { ok: true, values: values };
}

function processCardSheet(cardSheet, opts) {
  var cards = [];
  var rejects = [];
  var excludedCount = 0;
  var acceptedCertSet = {};

  cardSheet.rows.forEach(function (row) {
    var rawCert = row.values.cert_number;

    if (isTestCert(rawCert)) {
      excludedCount++;
      return;
    }

    var result = buildCardResult(row.values, opts, acceptedCertSet);
    if (!result.ok) {
      rejects.push({ rowNumber: row.rowNumber, reasons: result.reasons });
      return;
    }

    acceptedCertSet[result.values.cert_number] = true;
    cards.push(result.values);
  });

  return { cards: cards, rejects: rejects, excludedCount: excludedCount, acceptedCertSet: acceptedCertSet };
}

// ─── Ledger-row validation (GiftCardTransactions sheet -> gift_card_transactions) ─────

/**
 * Validates one GiftCardTransactions row and, if accepted, computes its composite tx_ref
 * (Pitfall 1: Phase 51 refs are unique only per cert, so the facade's own minting scheme —
 * rawRef + ':' + cert + ':' + kind — must be reproduced here for historical rows too, or an
 * old ref could collide with a future Postgres-minted one). Returns either a rejected
 * {rowNumber, cert_number, reasons} or an accepted candidate for the duplicate-tx_ref pass.
 */
function buildLedgerCandidate(row, acceptedCertSet) {
  var v = row.values;
  var rawCert = v.cert_number;
  var cert = typeof rawCert === 'string' ? rawCert.trim() : rawCert;
  var reasons = [];

  if (isTruthyFlag(v.needs_manual_review)) {
    reasons.push({ column: 'needs_manual_review', reason: 'needs_manual_review' });
  }

  var statusOk = typeof v.status === 'string' && v.status.trim() === 'settled';
  if (!statusOk) {
    reasons.push({ column: 'status', reason: 'unsettled_claim' });
  }

  var kindRaw = typeof v.kind === 'string' ? v.kind.trim() : v.kind;
  var kindOk = VALID_KINDS.indexOf(kindRaw) !== -1;
  if (!kindOk) {
    reasons.push({ column: 'kind', reason: 'invalid_kind' });
  }

  var certFound = typeof cert === 'string' && cert !== '' && !!acceptedCertSet[cert];
  if (!certFound) {
    reasons.push({ column: 'cert_number', reason: 'cert_not_found' });
  }

  var amountResult = normalizeNumeric(v.amount, { precision: 10, scale: 2 });
  if (!amountResult.ok) {
    reasons.push({ column: 'amount', reason: 'ledger_amount_invalid' });
  } else if (Number(amountResult.value) < 0) {
    reasons.push({ column: 'amount', reason: 'ledger_amount_sign' });
  }

  if (reasons.length > 0) {
    return {
      ok: false,
      reject: { rowNumber: row.rowNumber, cert_number: typeof cert === 'string' ? cert : null, reasons: reasons }
    };
  }

  var rawRef = typeof v.tx_ref === 'string' ? v.tx_ref.trim() : String(v.tx_ref);
  var suffix = ':' + cert + ':' + kindRaw;
  var alreadySuffixed = rawRef.length >= suffix.length && rawRef.slice(rawRef.length - suffix.length) === suffix;
  var compositeRef = alreadySuffixed ? rawRef : rawRef + suffix;

  var absAmount = Number(amountResult.value);
  var signed = kindRaw === 'redeem' ? -absAmount : absAmount;

  return {
    ok: true,
    candidate: {
      rowNumber: row.rowNumber,
      cert_number: cert,
      tx_ref: compositeRef,
      kind: kindRaw,
      amount: signed.toFixed(2),
      source_tx_id: v.tx_id !== undefined && v.tx_id !== null ? String(v.tx_id) : null
    }
  };
}

function processLedgerSheet(ledgerSheet, acceptedCertSet) {
  var candidates = [];
  var rejects = [];
  var excludedCount = 0;

  ledgerSheet.rows.forEach(function (row) {
    if (isTestCert(row.values.cert_number)) {
      excludedCount++;
      return;
    }

    var result = buildLedgerCandidate(row, acceptedCertSet);
    if (!result.ok) {
      rejects.push(result.reject);
      return;
    }
    candidates.push(result.candidate);
  });

  // Duplicate composite tx_ref (Pitfall 1 collision case): group, reject every row in any
  // group with more than one member — neither can be safely imported.
  var byRef = {};
  candidates.forEach(function (c) {
    if (!byRef[c.tx_ref]) byRef[c.tx_ref] = [];
    byRef[c.tx_ref].push(c);
  });

  var accepted = [];
  Object.keys(byRef).forEach(function (ref) {
    var group = byRef[ref];
    if (group.length > 1) {
      group.forEach(function (c) {
        rejects.push({
          rowNumber: c.rowNumber,
          cert_number: c.cert_number,
          reasons: [{ column: 'tx_ref', reason: 'duplicate_tx_ref' }]
        });
      });
    } else {
      accepted.push(group[0]);
    }
  });

  return { accepted: accepted, rejects: rejects, excludedCount: excludedCount };
}

// ─── Plan assembly ─────────────────────────────────────────────────────────

/**
 * buildGiftCardBackfillPlan(cardSheet, ledgerSheet, opts) -> plan
 *
 * cardSheet/ledgerSheet are read-xlsx.js's readSheet() shape: { headers, rows: [{rowNumber,
 * values}] }. Pure — no I/O, no DB, no filesystem. opts.timezone defaults to
 * America/Vancouver (the recorded workbook timezone, docs/RUNBOOK.md).
 */
function buildGiftCardBackfillPlan(cardSheet, ledgerSheet, opts) {
  opts = opts || {};
  var effectiveOpts = { timezone: opts.timezone || DEFAULT_TIMEZONE };

  var cardResult = processCardSheet(cardSheet, effectiveOpts);
  var ledgerResult = processLedgerSheet(ledgerSheet, cardResult.acceptedCertSet);

  var openingRows = cardResult.cards.map(function (card) {
    return {
      cert_number: card.cert_number,
      tx_ref: 'opening:' + card.cert_number,
      kind: 'opening_balance',
      amount: card.current_balance,
      balance_before: '0.00',
      balance_after: card.current_balance,
      imported: false,
      actor: 'backfill:phase84'
    };
  });

  var importedRows = ledgerResult.accepted.map(function (c) {
    return {
      cert_number: c.cert_number,
      tx_ref: c.tx_ref,
      kind: c.kind,
      amount: c.amount,
      imported: true,
      actor: 'import:phase51',
      source_tx_id: c.source_tx_id
    };
  });

  var seqSeed = 0;
  cardResult.cards.forEach(function (card) {
    var match = CERT_SUFFIX_RE.exec(card.cert_number);
    if (match) {
      var n = parseInt(match[1], 10);
      if (n > seqSeed) seqSeed = n;
    }
  });

  var balanceMinorUnits = 0;
  cardResult.cards.forEach(function (card) {
    balanceMinorUnits += Math.round(Number(card.current_balance) * 100);
  });

  return {
    cards: cardResult.cards,
    ledger: openingRows.concat(importedRows),
    rejects: { cards: cardResult.rejects, ledger: ledgerResult.rejects },
    excluded: { cards: cardResult.excludedCount, ledgerRows: ledgerResult.excludedCount },
    seqSeed: seqSeed,
    totals: {
      cards: cardResult.cards.length,
      balanceMinorUnits: balanceMinorUnits,
      openingRows: openingRows.length,
      importedRows: importedRows.length
    }
  };
}

module.exports = {
  buildGiftCardBackfillPlan: buildGiftCardBackfillPlan
};
