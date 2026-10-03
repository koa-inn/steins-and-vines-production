'use strict';

/**
 * Pure planner tests for buildGiftCardBackfillPlan — Phase 84 Plan 04 Task 1 (DB-03).
 *
 * No I/O: builds readSheet()-shaped fixtures ({headers, rows: [{rowNumber, values}]})
 * directly in JS and asserts on the returned plan — read-xlsx.js's real round trip is
 * exercised later by Task 2's real-Postgres CLI test.
 */

var giftCardsBackfill = require('../../scripts/backfill/gift-cards-backfill');
var buildGiftCardBackfillPlan = giftCardsBackfill.buildGiftCardBackfillPlan;

var TZ = 'America/Vancouver';

function sheet(rows) {
  return { headers: [], rows: rows, skippedEmpty: 0 };
}

function cardRow(rowNumber, overrides) {
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
  return { rowNumber: rowNumber, values: base };
}

function ledgerRow(rowNumber, overrides) {
  var base = {
    tx_id: 'tx-' + rowNumber,
    cert_number: 'GC-000001',
    tx_ref: 'SALE' + rowNumber,
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
  return { rowNumber: rowNumber, values: base };
}

function emptyLedgerSheet() {
  return sheet([]);
}

function emptyCardSheet() {
  return sheet([]);
}

describe('buildGiftCardBackfillPlan', function () {
  describe('TEST-* exclusion (D-13)', function () {
    test('a cert exactly "TEST-LEDGER-01" is excluded, not rejected, and counted', function () {
      var cards = sheet([cardRow(2, { cert_number: 'TEST-LEDGER-01' }), cardRow(3, { cert_number: 'GC-000001' })]);
      var plan = buildGiftCardBackfillPlan(cards, emptyLedgerSheet(), { timezone: TZ });

      expect(plan.excluded.cards).toBe(1);
      expect(plan.cards.length).toBe(1);
      expect(plan.cards[0].cert_number).toBe('GC-000001');
      expect(plan.rejects.cards.length).toBe(0);
    });

    test('any cert starting "TEST-" is excluded', function () {
      var cards = sheet([cardRow(2, { cert_number: 'TEST-ANYTHING' })]);
      var plan = buildGiftCardBackfillPlan(cards, emptyLedgerSheet(), { timezone: TZ });
      expect(plan.excluded.cards).toBe(1);
      expect(plan.cards.length).toBe(0);
    });

    test('ledger rows for a TEST-* cert are excluded and counted, not rejected', function () {
      var cards = sheet([cardRow(2, { cert_number: 'GC-000001' })]);
      var ledger = sheet([ledgerRow(2, { cert_number: 'TEST-LEDGER-01' })]);
      var plan = buildGiftCardBackfillPlan(cards, ledger, { timezone: TZ });

      expect(plan.excluded.ledgerRows).toBe(1);
      expect(plan.rejects.ledger.length).toBe(0);
      // the opening_balance row for GC-000001 is the only ledger row
      expect(plan.ledger.length).toBe(1);
      expect(plan.ledger[0].kind).toBe('opening_balance');
    });
  });

  describe('valid card acceptance', function () {
    test('active/depleted/void statuses and a $0 balance are all accepted', function () {
      var cards = sheet([
        cardRow(2, { cert_number: 'GC-000001', status: 'active', current_balance: 50 }),
        cardRow(3, { cert_number: 'GC-000002', status: 'depleted', current_balance: 0 }),
        cardRow(4, { cert_number: 'GC-000003', status: 'void', current_balance: 0 })
      ]);
      var plan = buildGiftCardBackfillPlan(cards, emptyLedgerSheet(), { timezone: TZ });

      expect(plan.cards.length).toBe(3);
      expect(plan.rejects.cards.length).toBe(0);
      var byCert = {};
      plan.cards.forEach(function (c) { byCert[c.cert_number] = c; });
      expect(byCert['GC-000001'].current_balance).toBe('50.00');
      expect(byCert['GC-000001'].face_value).toBe('50.00');
      expect(byCert['GC-000002'].status).toBe('depleted');
      expect(byCert['GC-000003'].current_balance).toBe('0.00');
    });
  });

  describe('card rejects', function () {
    test('status outside active/depleted/void is rejected', function () {
      var cards = sheet([cardRow(2, { status: 'bogus' })]);
      var plan = buildGiftCardBackfillPlan(cards, emptyLedgerSheet(), { timezone: TZ });
      expect(plan.cards.length).toBe(0);
      expect(plan.rejects.cards.length).toBe(1);
      expect(plan.rejects.cards[0].reasons).toEqual(
        expect.arrayContaining([expect.objectContaining({ column: 'status' })])
      );
    });

    test('malformed cert number (not GC-NNNNNN) is rejected', function () {
      var cards = sheet([cardRow(2, { cert_number: 'GC-42' })]);
      var plan = buildGiftCardBackfillPlan(cards, emptyLedgerSheet(), { timezone: TZ });
      expect(plan.cards.length).toBe(0);
      expect(plan.rejects.cards.length).toBe(1);
      expect(plan.rejects.cards[0].reasons).toEqual(
        expect.arrayContaining([expect.objectContaining({ column: 'cert_number' })])
      );
    });

    test('non-numeric balance is rejected', function () {
      var cards = sheet([cardRow(2, { current_balance: 'not-a-number' })]);
      var plan = buildGiftCardBackfillPlan(cards, emptyLedgerSheet(), { timezone: TZ });
      expect(plan.cards.length).toBe(0);
      expect(plan.rejects.cards[0].reasons).toEqual(
        expect.arrayContaining([expect.objectContaining({ column: 'current_balance' })])
      );
    });

    test('duplicate cert number: first accepted, second rejected', function () {
      var cards = sheet([
        cardRow(2, { cert_number: 'GC-000001' }),
        cardRow(3, { cert_number: 'GC-000001' })
      ]);
      var plan = buildGiftCardBackfillPlan(cards, emptyLedgerSheet(), { timezone: TZ });
      expect(plan.cards.length).toBe(1);
      expect(plan.rejects.cards.length).toBe(1);
      expect(plan.rejects.cards[0].rowNumber).toBe(3);
      expect(plan.rejects.cards[0].reasons).toEqual(
        expect.arrayContaining([expect.objectContaining({ column: 'cert_number', reason: 'duplicate_cert' })])
      );
    });
  });

  describe('issued_date handling', function () {
    test('a JS Date is formatted as YYYY-MM-DD', function () {
      var cards = sheet([cardRow(2, { issued_date: new Date(Date.UTC(2026, 0, 15)) })]);
      var plan = buildGiftCardBackfillPlan(cards, emptyLedgerSheet(), { timezone: TZ });
      expect(plan.cards[0].issued_date).toBe('2026-01-15');
    });

    test('a YYYY-MM-DD string passes through unchanged', function () {
      var cards = sheet([cardRow(2, { issued_date: '2026-01-15' })]);
      var plan = buildGiftCardBackfillPlan(cards, emptyLedgerSheet(), { timezone: TZ });
      expect(plan.cards[0].issued_date).toBe('2026-01-15');
    });

    test('an unparseable issued_date is rejected', function () {
      var cards = sheet([cardRow(2, { issued_date: 'not-a-date' })]);
      var plan = buildGiftCardBackfillPlan(cards, emptyLedgerSheet(), { timezone: TZ });
      expect(plan.cards.length).toBe(0);
      expect(plan.rejects.cards[0].reasons).toEqual(
        expect.arrayContaining([expect.objectContaining({ column: 'issued_date', reason: 'issued_date_unparseable' })])
      );
    });

    test('an empty issued_date becomes null, not a reject', function () {
      var cards = sheet([cardRow(2, { issued_date: '' })]);
      var plan = buildGiftCardBackfillPlan(cards, emptyLedgerSheet(), { timezone: TZ });
      expect(plan.cards.length).toBe(1);
      expect(plan.cards[0].issued_date).toBeNull();
    });
  });

  describe('ledger needs_manual_review and unsettled claims (D-13)', function () {
    ['TRUE', true, 'yes', 1].forEach(function (truthyValue) {
      test('needs_manual_review=' + JSON.stringify(truthyValue) + ' rejects the row and names the cert', function () {
        var cards = sheet([cardRow(2, { cert_number: 'GC-000001' })]);
        var ledger = sheet([ledgerRow(2, { cert_number: 'GC-000001', needs_manual_review: truthyValue })]);
        var plan = buildGiftCardBackfillPlan(cards, ledger, { timezone: TZ });

        expect(plan.rejects.ledger.length).toBe(1);
        expect(plan.rejects.ledger[0].cert_number).toBe('GC-000001');
        expect(plan.rejects.ledger[0].reasons).toEqual(
          expect.arrayContaining([expect.objectContaining({ reason: 'needs_manual_review' })])
        );
      });
    });

    test('status other than settled (unsettled claim) is rejected', function () {
      var cards = sheet([cardRow(2, { cert_number: 'GC-000001' })]);
      var ledger = sheet([ledgerRow(2, { cert_number: 'GC-000001', status: 'claimed' })]);
      var plan = buildGiftCardBackfillPlan(cards, ledger, { timezone: TZ });

      expect(plan.rejects.ledger.length).toBe(1);
      expect(plan.rejects.ledger[0].reasons).toEqual(
        expect.arrayContaining([expect.objectContaining({ reason: 'unsettled_claim' })])
      );
    });
  });

  describe('ledger cert/amount validation', function () {
    test('a ledger row for a cert not in the card set is rejected', function () {
      var cards = sheet([cardRow(2, { cert_number: 'GC-000001' })]);
      var ledger = sheet([ledgerRow(2, { cert_number: 'GC-999999' })]);
      var plan = buildGiftCardBackfillPlan(cards, ledger, { timezone: TZ });

      expect(plan.rejects.ledger.length).toBe(1);
      expect(plan.rejects.ledger[0].reasons).toEqual(
        expect.arrayContaining([expect.objectContaining({ column: 'cert_number', reason: 'cert_not_found' })])
      );
    });

    test('a negative sheet amount is rejected ledger_amount_sign', function () {
      var cards = sheet([cardRow(2, { cert_number: 'GC-000001' })]);
      var ledger = sheet([ledgerRow(2, { cert_number: 'GC-000001', amount: -5 })]);
      var plan = buildGiftCardBackfillPlan(cards, ledger, { timezone: TZ });

      expect(plan.rejects.ledger.length).toBe(1);
      expect(plan.rejects.ledger[0].reasons).toEqual(
        expect.arrayContaining([expect.objectContaining({ column: 'amount', reason: 'ledger_amount_sign' })])
      );
    });
  });

  describe('opening_balance rows (D-12)', function () {
    test('each accepted card gets exactly one opening_balance row', function () {
      var cards = sheet([
        cardRow(2, { cert_number: 'GC-000001', current_balance: 42.5 }),
        cardRow(3, { cert_number: 'GC-000002', current_balance: 0 })
      ]);
      var plan = buildGiftCardBackfillPlan(cards, emptyLedgerSheet(), { timezone: TZ });

      var opening = plan.ledger.filter(function (l) { return l.kind === 'opening_balance'; });
      expect(opening.length).toBe(2);

      var byCert = {};
      opening.forEach(function (o) { byCert[o.cert_number] = o; });

      expect(byCert['GC-000001']).toMatchObject({
        tx_ref: 'opening:GC-000001',
        amount: '42.50',
        balance_before: '0.00',
        balance_after: '42.50',
        imported: false,
        actor: 'backfill:phase84'
      });
      expect(byCert['GC-000002']).toMatchObject({
        tx_ref: 'opening:GC-000002',
        amount: '0.00',
        balance_before: '0.00',
        balance_after: '0.00',
        imported: false,
        actor: 'backfill:phase84'
      });
    });
  });

  describe('historical imported ledger rows (D-12)', function () {
    test('redeem amount is signed negative, reload positive; imported/actor/source_tx_id set', function () {
      var cards = sheet([cardRow(2, { cert_number: 'GC-000001' })]);
      var ledger = sheet([
        ledgerRow(2, { tx_id: 'tx-a', cert_number: 'GC-000001', kind: 'redeem', amount: 10, tx_ref: 'SALE-A' }),
        ledgerRow(3, { tx_id: 'tx-b', cert_number: 'GC-000001', kind: 'reload', amount: 20, tx_ref: 'SALE-B' })
      ]);
      var plan = buildGiftCardBackfillPlan(cards, ledger, { timezone: TZ });

      var imported = plan.ledger.filter(function (l) { return l.imported === true; });
      expect(imported.length).toBe(2);

      var redeemRow = imported.filter(function (l) { return l.kind === 'redeem'; })[0];
      var reloadRow = imported.filter(function (l) { return l.kind === 'reload'; })[0];

      expect(redeemRow.amount).toBe('-10.00');
      expect(redeemRow.actor).toBe('import:phase51');
      expect(redeemRow.source_tx_id).toBe('tx-a');
      expect(redeemRow.tx_ref).toBe('SALE-A:GC-000001:redeem');

      expect(reloadRow.amount).toBe('20.00');
      expect(reloadRow.tx_ref).toBe('SALE-B:GC-000001:reload');
    });

    test('a raw tx_ref already ending in :cert:kind is used as-is (not double-appended)', function () {
      var cards = sheet([cardRow(2, { cert_number: 'GC-000001' })]);
      var ledger = sheet([
        ledgerRow(2, { cert_number: 'GC-000001', kind: 'redeem', tx_ref: 'SALE1:GC-000001:redeem' })
      ]);
      var plan = buildGiftCardBackfillPlan(cards, ledger, { timezone: TZ });

      var imported = plan.ledger.filter(function (l) { return l.imported === true; });
      expect(imported.length).toBe(1);
      expect(imported[0].tx_ref).toBe('SALE1:GC-000001:redeem');
    });

    test('two historical rows producing the same composite tx_ref are both rejected', function () {
      var cards = sheet([cardRow(2, { cert_number: 'GC-000001' })]);
      var ledger = sheet([
        ledgerRow(2, { tx_id: 'tx-a', cert_number: 'GC-000001', kind: 'redeem', tx_ref: 'DUPREF' }),
        ledgerRow(3, { tx_id: 'tx-b', cert_number: 'GC-000001', kind: 'redeem', tx_ref: 'DUPREF' })
      ]);
      var plan = buildGiftCardBackfillPlan(cards, ledger, { timezone: TZ });

      var imported = plan.ledger.filter(function (l) { return l.imported === true; });
      expect(imported.length).toBe(0);
      expect(plan.rejects.ledger.length).toBe(2);
      plan.rejects.ledger.forEach(function (r) {
        expect(r.reasons).toEqual(
          expect.arrayContaining([expect.objectContaining({ reason: 'duplicate_tx_ref' })])
        );
      });
    });
  });

  describe('seqSeed (D-14)', function () {
    test('is the max numeric suffix across accepted certs', function () {
      var cards = sheet([
        cardRow(2, { cert_number: 'GC-000005' }),
        cardRow(3, { cert_number: 'GC-000123' }),
        cardRow(4, { cert_number: 'GC-000042' })
      ]);
      var plan = buildGiftCardBackfillPlan(cards, emptyLedgerSheet(), { timezone: TZ });
      expect(plan.seqSeed).toBe(123);
    });

    test('is 0 when there are no accepted cards', function () {
      var plan = buildGiftCardBackfillPlan(emptyCardSheet(), emptyLedgerSheet(), { timezone: TZ });
      expect(plan.seqSeed).toBe(0);
    });
  });

  describe('totals', function () {
    test('balanceMinorUnits is the integer cent sum of accepted current_balance', function () {
      var cards = sheet([
        cardRow(2, { cert_number: 'GC-000001', current_balance: 42.5 }),
        cardRow(3, { cert_number: 'GC-000002', current_balance: 0.01 })
      ]);
      var plan = buildGiftCardBackfillPlan(cards, emptyLedgerSheet(), { timezone: TZ });
      expect(plan.totals.balanceMinorUnits).toBe(4251);
      expect(plan.totals.cards).toBe(2);
      expect(plan.totals.openingRows).toBe(2);
    });

    test('importedRows counts only accepted historical ledger rows', function () {
      var cards = sheet([cardRow(2, { cert_number: 'GC-000001' })]);
      var ledger = sheet([
        ledgerRow(2, { tx_id: 'tx-a', cert_number: 'GC-000001', kind: 'redeem', tx_ref: 'SALE-A' }),
        ledgerRow(3, { tx_id: 'tx-b', cert_number: 'GC-999999', kind: 'redeem', tx_ref: 'SALE-B' })
      ]);
      var plan = buildGiftCardBackfillPlan(cards, ledger, { timezone: TZ });
      expect(plan.totals.importedRows).toBe(1);
    });
  });
});
