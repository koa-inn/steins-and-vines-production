/**
 * GiftCards sheet -> gift_cards column spec. Phase 84 Plan 04 (DB-03).
 *
 * Deliberately NOT registered in specs/index.js's SPECS array (84-RESEARCH.md Pitfall 3,
 * 84-04-PLAN.md Task 1 <action>): the generic `backfill.js --sheet GiftCards` single-table
 * path would promote `gift_cards` rows with no matching `opening_balance` ledger rows and
 * break the D-12 invariant (`current_balance = sum(ledger)`). The only route in is the
 * dedicated `gift-cards-backfill.js` CLI, which reuses this spec for the straightforward
 * card-row half of the job and reuses normalize.js's primitives directly (not normalizeRow)
 * for the GiftCardTransactions half.
 *
 * `issued_date` is intentionally NOT a column here — there is no 'date' normaliser type in
 * normalize.js (only 'timestamptz'), so gift-cards-backfill.js's planner normalises it
 * itself (a date-only value needs no instant/offset resolution, just format validation).
 * `last_tx_ref` (GiftCards sheet) is intentionally unmapped — it is a sheet-only derived
 * convenience column with no equivalent in the `gift_cards` table (the ledger is now the
 * source of truth for "last transaction").
 */
'use strict';

module.exports = {
  sheet: 'GiftCards',
  table: 'gift_cards',
  primaryKey: 'cert_number',
  columns: [
    { name: 'cert_number', header: 'cert_number', type: 'id', required: true, pgType: 'text', prefix: 'GC', pad: 6 },
    { name: 'face_value', header: 'face_value', type: 'numeric', required: true, pgType: 'numeric(10,2)', precision: 10, scale: 2 },
    { name: 'current_balance', header: 'current_balance', type: 'numeric', required: true, pgType: 'numeric(10,2)', precision: 10, scale: 2 },
    { name: 'status', header: 'status', type: 'text', required: true, pgType: 'text' },
    { name: 'issued_by', header: 'issued_by', type: 'text', required: false, pgType: 'text' },
    { name: 'zoho_invoice_number', header: 'zoho_invoice_number', type: 'text', required: false, pgType: 'text' },
    { name: 'notes', header: 'notes', type: 'text', required: false, pgType: 'text' },
    { name: 'last_updated', header: 'last_updated', type: 'timestamptz', required: false, pgType: 'timestamptz' }
  ]
};
