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

var fs = require('fs');
var readline = require('readline');

var db = require('../../lib/db');
var readXlsx = require('./read-xlsx');
var normalizeLib = require('./normalize');
var normalizeRow = normalizeLib.normalizeRow;
var normalizeNumeric = normalizeLib.normalizeNumeric;
var rejectsLib = require('./rejects');
var cardSpec = require('./specs/gift-cards');
var backfillCli = require('./backfill');

var EXIT = backfillCli.EXIT;
var assertSnapshotSafePath = backfillCli.assertSnapshotSafePath;
var checkHeaders = backfillCli.checkHeaders;

var DEFAULT_TIMEZONE = 'America/Vancouver';
var DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
var VALID_STATUSES = ['active', 'depleted', 'void'];
var VALID_KINDS = ['redeem', 'reload'];
var CERT_SUFFIX_RE = /^GC-([0-9]{6})$/;
var POSTGRES_URL_RE = /postgres(ql)?:\/\//;

// GiftCardTransactions has no spec file (Pitfall 3 — a bespoke two-table job, not a
// single-sheet-to-single-table one) — its exact header order is pinned by 51-03-SUMMARY.md's
// live-verified sheet (Phase 51 setupGiftCardLedger): tx_id | cert_number | tx_ref | kind |
// amount | balance_before | balance_after | status | needs_manual_review | created_at |
// settled_at | notes.
var LEDGER_SHEET_HEADERS = [
  'tx_id', 'cert_number', 'tx_ref', 'kind', 'amount', 'balance_before', 'balance_after',
  'status', 'needs_manual_review', 'created_at', 'settled_at', 'notes'
];

var CARD_INSERT_COLUMNS = [
  'cert_number', 'face_value', 'current_balance', 'status', 'issued_date', 'issued_by',
  'zoho_invoice_number', 'notes'
];
var LEDGER_INSERT_COLUMNS = [
  'cert_number', 'tx_ref', 'kind', 'amount', 'balance_before', 'balance_after', 'imported',
  'actor', 'source_tx_id'
];
var INSERT_BATCH_SIZE = 500;

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

// ─── GiftCardTransactions header check (no spec file — Pitfall 3) ─────────

function checkLedgerHeaders(sheetHeaders) {
  var sheetSet = {};
  sheetHeaders.forEach(function (h) { sheetSet[h] = true; });
  var specSet = {};
  LEDGER_SHEET_HEADERS.forEach(function (h) { specSet[h] = true; });

  return {
    missing: LEDGER_SHEET_HEADERS.filter(function (h) { return !sheetSet[h]; }),
    unmapped: sheetHeaders.filter(function (h) { return !specSet[h]; })
  };
}

// ─── Promote: batched parameterised inserts, in one transaction ──────────

/**
 * Table/column names below are fixed string literals owned by this module (never derived
 * from sheet data or argv) — safe to inline, matching lib/gift-card-pg.js's module-level SQL
 * constant convention. Only VALUES ever go through $n placeholders (ASVS V5).
 */
function buildInsertSql(table, columns, batch) {
  var params = [];
  var valueGroups = batch.map(function (row) {
    var placeholders = columns.map(function (col) {
      var v = row[col];
      if (v === undefined) v = null;
      params.push(v);
      return '$' + params.length;
    });
    return '(' + placeholders.join(', ') + ')';
  });
  var sql = 'insert into ' + table + ' (' + columns.join(', ') + ') values ' + valueGroups.join(', ');
  return { sql: sql, params: params };
}

function insertBatched(client, table, columns, rows) {
  if (rows.length === 0) return Promise.resolve();
  var batches = [];
  for (var i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
    batches.push(rows.slice(i, i + INSERT_BATCH_SIZE));
  }
  return batches.reduce(function (chain, batch) {
    return chain.then(function () {
      var built = buildInsertSql(table, columns, batch);
      return client.query(built.sql, built.params);
    });
  }, Promise.resolve());
}

/**
 * In-transaction invariant checks (84-04-PLAN.md Task 2 step 5), run AFTER every insert and
 * the sequence setval, BEFORE commit. Names the failed check only — never row contents (D-13).
 */
function runPromoteChecks(client, plan) {
  return client.query('select count(*)::int as count from gift_cards').then(function (r) {
    if (r.rows[0].count !== plan.totals.cards) {
      return { ok: false, failedCheck: 'card_count' };
    }

    return client.query('select coalesce(sum(current_balance), 0) as total from gift_cards').then(function (r2) {
      var totalMinor = Math.round(Number(r2.rows[0].total) * 100);
      if (totalMinor !== plan.totals.balanceMinorUnits) {
        return { ok: false, failedCheck: 'balance_sum' };
      }

      return client
        .query(
          'select count(*)::int as bad from gift_cards gc where gc.current_balance <> coalesce(' +
            '(select sum(amount) from gift_card_transactions t ' +
            'where t.cert_number = gc.cert_number and t.imported = false), 0)'
        )
        .then(function (r3) {
          if (r3.rows[0].bad !== 0) {
            return { ok: false, failedCheck: 'balance_invariant' };
          }

          return client
            .query('select count(*)::int as count from gift_card_transactions where imported = true')
            .then(function (r4) {
              if (r4.rows[0].count !== plan.totals.importedRows) {
                return { ok: false, failedCheck: 'imported_row_count' };
              }
              return { ok: true };
            });
        });
    });
  });
}

function defaultPromptTypeDatabaseName(expectedName) {
  return new Promise(function (resolve, reject) {
    var rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('Type the database name (' + expectedName + ') to continue: ', function (answer) {
      rl.close();
      if (answer.trim() === expectedName) {
        resolve();
      } else {
        reject(new Error('database name confirmation did not match — aborting, nothing written'));
      }
    });
  });
}

/**
 * runPromote(client, plan, opts, deps, log) -> { exitCode, counts }
 *
 * Preconditions (both tables exist AND are empty) are checked OUTSIDE the transaction, like
 * load.js's promote() — a precondition failure never issues a ROLLBACK-without-BEGIN and
 * never touches either table. Inside the one transaction: cards, then opening rows, then
 * imported rows (both batched/parameterised), then the sequence setval (only when
 * plan.seqSeed > 0 — D-14 never regresses the sequence for an empty backfill), then the
 * in-transaction invariant checks. Any check failure rolls back and returns CHECKS_FAILED;
 * any precondition/SQL failure (table missing/non-empty, a genuine constraint violation)
 * returns ERROR. The client is always released exactly once.
 */
function runPromote(client, plan, opts, deps, log) {
  var promptFn = (deps && deps.promptTypeDatabaseName) || defaultPromptTypeDatabaseName;

  return client
    .query('select current_database() as database')
    .then(function (r) {
      var databaseName = r.rows[0].database;
      log(
        'Target: ' +
          db.redactConnectionString(process.env.BACKFILL_DATABASE_URL || '') +
          ' database=' +
          databaseName
      );
      return promptFn(databaseName);
    })
    .then(function () {
      return Promise.all([
        client.query("select to_regclass('public.gift_cards') as reg"),
        client.query("select to_regclass('public.gift_card_transactions') as reg")
      ]);
    })
    .then(function (regResults) {
      if (!regResults[0].rows[0].reg) throw new Error('target table public.gift_cards does not exist');
      if (!regResults[1].rows[0].reg) throw new Error('target table public.gift_card_transactions does not exist');

      return Promise.all([
        client.query('select count(*)::int as count from gift_cards'),
        client.query('select count(*)::int as count from gift_card_transactions')
      ]);
    })
    .then(function (countResults) {
      if (countResults[0].rows[0].count > 0) throw new Error('target table public.gift_cards is not empty');
      if (countResults[1].rows[0].count > 0) {
        throw new Error('target table public.gift_card_transactions is not empty');
      }

      return client.query('BEGIN');
    })
    .then(function () {
      return insertBatched(client, 'gift_cards', CARD_INSERT_COLUMNS, plan.cards);
    })
    .then(function () {
      return insertBatched(client, 'gift_card_transactions', LEDGER_INSERT_COLUMNS, plan.ledger);
    })
    .then(function () {
      if (plan.seqSeed > 0) {
        return client.query("select setval('gift_card_cert_seq', $1)", [plan.seqSeed]);
      }
    })
    .then(function () {
      return runPromoteChecks(client, plan);
    })
    .then(function (checkResult) {
      if (!checkResult.ok) {
        log('Checks: FAIL — ' + checkResult.failedCheck);
        return client.query('ROLLBACK').then(function () {
          client.release();
          return { exitCode: EXIT.CHECKS_FAILED };
        });
      }

      return client.query('COMMIT').then(function () {
        log('Promoted ' + plan.totals.cards + ' cards, ' + plan.ledger.length + ' ledger rows; sequence at ' + plan.seqSeed);
        client.release();
        return { exitCode: EXIT.OK };
      });
    })
    .catch(function (err) {
      log('Error: ' + err.message);
      return client.query('ROLLBACK').then(
        function () {
          client.release();
          return { exitCode: EXIT.ERROR };
        },
        function () {
          client.release();
          return { exitCode: EXIT.ERROR };
        }
      );
    });
}

// ─── CLI ───────────────────────────────────────────────────────────────────

var VALID_FLAGS = ['--file', '--out-dir', '--timezone', '--dry-run', '--promote'];
var BOOLEAN_FLAGS = { '--dry-run': 'dryRun', '--promote': 'promote' };
var VALUE_FLAGS = { '--file': 'file', '--out-dir': 'outDir', '--timezone': 'timezone' };

/**
 * parseArgs(argv) -> { file, outDir, timezone, dryRun, promote }
 *
 * No --accept-rejects flag exists here (unlike the generic backfill.js CLI) — D-13 for
 * GiftCards is unconditional: any reject blocks promotion, full stop; the owner resolves it
 * in the sheet and re-runs. No --sheet/--schema flags either (fixed to GiftCards +
 * GiftCardTransactions -> public, no scratch-schema rehearsal step for this phase).
 */
function parseArgs(argv) {
  var opts = {
    file: undefined,
    outDir: rejectsLib.DEFAULT_OUT_DIR,
    timezone: DEFAULT_TIMEZONE,
    dryRun: false,
    promote: false
  };

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

    if (BOOLEAN_FLAGS[flag]) {
      opts[BOOLEAN_FLAGS[flag]] = true;
      return;
    }

    opts[VALUE_FLAGS[flag]] = value;
  });

  return opts;
}

/**
 * runGiftCardBackfill(opts, deps) -> Promise<{ exitCode, rejectsPath, counts }>
 *
 * deps: { pool, log, promptTypeDatabaseName? }. Steps print as [1/5]..[5/5]; terminal output
 * is counts/paths/check-names only (D-13). dryRun and a no-promote run both skip step 5
 * without ever calling pool.connect() for dryRun specifically (opts.promote without dryRun
 * still only reaches pool.connect() inside step 5's own branch).
 */
function runGiftCardBackfill(opts, deps) {
  deps = deps || {};
  var log = deps.log || console.log;
  var pool = deps.pool;

  try {
    assertSnapshotSafePath(opts.file);
  } catch (err) {
    log('Error: ' + err.message);
    return Promise.resolve({ exitCode: EXIT.ERROR, rejectsPath: null, counts: null });
  }

  if (!opts.file || !fs.existsSync(opts.file)) {
    log('Error: snapshot not found: ' + opts.file);
    return Promise.resolve({ exitCode: EXIT.ERROR, rejectsPath: null, counts: null });
  }

  var effectiveTimezone = opts.timezone || DEFAULT_TIMEZONE;

  log('[1/5] Read snapshot');
  return Promise.all([
    readXlsx.readSheet(opts.file, 'GiftCards'),
    readXlsx.readSheet(opts.file, 'GiftCardTransactions')
  ])
    .then(function (sheets) {
      var cardSheet = sheets[0];
      var ledgerSheet = sheets[1];

      var cardHeaderCheck = checkHeaders(cardSpec, cardSheet.headers);
      if (cardHeaderCheck.unmapped.length) {
        log('Unmapped GiftCards header(s): ' + cardHeaderCheck.unmapped.join(', '));
      }
      if (cardHeaderCheck.missing.length) {
        log('Error: sheet "GiftCards" is missing spec header(s): ' + cardHeaderCheck.missing.join(', '));
        return { exitCode: EXIT.ERROR, rejectsPath: null, counts: null };
      }

      var ledgerHeaderCheck = checkLedgerHeaders(ledgerSheet.headers);
      if (ledgerHeaderCheck.unmapped.length) {
        log('Unmapped GiftCardTransactions header(s): ' + ledgerHeaderCheck.unmapped.join(', '));
      }
      if (ledgerHeaderCheck.missing.length) {
        log(
          'Error: sheet "GiftCardTransactions" is missing header(s): ' + ledgerHeaderCheck.missing.join(', ')
        );
        return { exitCode: EXIT.ERROR, rejectsPath: null, counts: null };
      }

      log('[2/5] Build plan');
      var plan = buildGiftCardBackfillPlan(cardSheet, ledgerSheet, { timezone: effectiveTimezone });

      log('[3/5] Rejects report');
      return Promise.all([
        rejectsLib.writeRejectsReport({
          sheet: 'GiftCards',
          sourceFile: opts.file,
          rejects: plan.rejects.cards,
          outDir: opts.outDir
        }),
        rejectsLib.writeRejectsReport({
          sheet: 'GiftCardTransactions',
          sourceFile: opts.file,
          rejects: plan.rejects.ledger,
          outDir: opts.outDir
        })
      ]).then(function (paths) {
        var cardsRejectsPath = paths[0];
        var ledgerRejectsPath = paths[1];
        var totalRejects = plan.rejects.cards.length + plan.rejects.ledger.length;

        var counts = {
          cardsRead: cardSheet.rows.length,
          cardsAccepted: plan.totals.cards,
          cardsRejected: plan.rejects.cards.length,
          cardsExcluded: plan.excluded.cards,
          ledgerRead: ledgerSheet.rows.length,
          ledgerAccepted: plan.totals.importedRows,
          ledgerRejected: plan.rejects.ledger.length,
          ledgerExcluded: plan.excluded.ledgerRows,
          openingRows: plan.totals.openingRows,
          balanceMinorUnits: plan.totals.balanceMinorUnits,
          seqSeed: plan.seqSeed
        };

        log('Read: ' + counts.cardsRead + ' cards, ' + counts.ledgerRead + ' ledger rows');
        log(
          'Excluded TEST-* (cert_number starts with TEST-): ' +
            counts.cardsExcluded +
            ' cards, ' +
            counts.ledgerExcluded +
            ' ledger rows'
        );
        log('Cards — accepted: ' + counts.cardsAccepted + ', rejected: ' + counts.cardsRejected);
        log('Ledger — accepted (imported): ' + counts.ledgerAccepted + ', rejected: ' + counts.ledgerRejected);
        log('Opening rows: ' + counts.openingRows);
        log('Total balance: $' + (counts.balanceMinorUnits / 100).toFixed(2));
        log('Seq seed: ' + counts.seqSeed);
        log('Rejects: ' + cardsRejectsPath + ', ' + ledgerRejectsPath);

        var rejectsPaths = { cards: cardsRejectsPath, ledger: ledgerRejectsPath };

        if (totalRejects > 0) {
          log('[4/5] Rejects present — promotion blocked (D-13). Resolve in the sheet and re-run.');
          return { exitCode: EXIT.REJECTS_BLOCK, rejectsPath: rejectsPaths, counts: counts };
        }

        if (opts.dryRun) {
          log('[4/5] Promote — skipped (--dry-run)');
          log('[5/5] Promote — skipped (--dry-run)');
          return { exitCode: EXIT.OK, rejectsPath: rejectsPaths, counts: counts };
        }

        if (!opts.promote) {
          log('[4/5] Promote — skipped — pass --promote');
          return { exitCode: EXIT.OK, rejectsPath: rejectsPaths, counts: counts };
        }

        log('[5/5] Promote');
        return pool.connect().then(function (client) {
          return runPromote(client, plan, opts, deps, log).then(function (promoteResult) {
            return { exitCode: promoteResult.exitCode, rejectsPath: rejectsPaths, counts: counts };
          });
        });
      });
    })
    .catch(function (err) {
      log('Error: ' + err.message);
      return { exitCode: EXIT.ERROR, rejectsPath: null, counts: null };
    });
}

function main() {
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

  var pool = null;
  if (!opts.dryRun) {
    if (!process.env.BACKFILL_DATABASE_URL) {
      console.error('Error: BACKFILL_DATABASE_URL must be set (unless --dry-run)');
      process.exit(EXIT.ERROR);
      return;
    }
    pool = db.createPool(process.env.BACKFILL_DATABASE_URL, { max: 2 });
  }

  runGiftCardBackfill(opts, { pool: pool, log: console.log })
    .then(function (result) {
      var finish = pool ? pool.end() : Promise.resolve();
      return finish.then(function () {
        return result;
      });
    })
    .then(function (result) {
      process.exit(result.exitCode);
    })
    .catch(function (err) {
      console.error('Fatal: ' + err.message);
      var finish = pool ? pool.end().catch(function () {}) : Promise.resolve();
      finish.then(function () {
        process.exit(EXIT.ERROR);
      });
    });
}

if (require.main === module) {
  main();
}

module.exports = {
  buildGiftCardBackfillPlan: buildGiftCardBackfillPlan,
  runGiftCardBackfill: runGiftCardBackfill,
  parseArgs: parseArgs,
  EXIT: EXIT
};
