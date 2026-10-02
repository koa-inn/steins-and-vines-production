/**
 * Rehearsal spec: VesselHistory sheet -> vessel_history table.
 * Column order matches the sheet column order exactly (conversion note §3.3) so a
 * backfill can map positionally. See specs/index.js for the header comment on why
 * these three sheets (VesselHistory, PlatoReadings, FermSchedules) are the rehearsal
 * targets for Plan 83-06/83-07.
 *
 * `header` is the sheet's real row-1 text (verified 2026-10-02, pinned by
 * __tests__/backfill/spec-headers.test.js); `name` is the scratch/Postgres column. They
 * differ for history_id->vh_id, transferred_at->moved_at, transferred_by->moved_by and
 * notes->note — the rehearsal rejected every row while `header` held the column names.
 */
'use strict';

module.exports = {
  sheet: 'VesselHistory',
  table: 'vessel_history',
  primaryKey: 'vh_id',
  columns: [
    // Sheet ids look like VH-000002, but the pad isn't pinned yet — just required non-empty text, reject numbers.
    { name: 'vh_id', header: 'history_id', type: 'id', required: true, pgType: 'text' },
    { name: 'batch_id', header: 'batch_id', type: 'id', required: true, pgType: 'text', prefix: 'SV-B', pad: 6 },
    { name: 'vessel_id', header: 'vessel_id', type: 'text', required: false, pgType: 'text' },
    { name: 'shelf_id', header: 'shelf_id', type: 'text', required: false, pgType: 'text' },
    // bin_id cells look numeric (e.g. 24) but are labels like shelf_id — kept as text.
    { name: 'bin_id', header: 'bin_id', type: 'text', required: false, pgType: 'text' },
    { name: 'moved_at', header: 'transferred_at', type: 'timestamptz', required: true, pgType: 'timestamptz' },
    { name: 'moved_by', header: 'transferred_by', type: 'text', required: false, pgType: 'text' },
    { name: 'note', header: 'notes', type: 'text', required: false, pgType: 'text' }
  ]
};
