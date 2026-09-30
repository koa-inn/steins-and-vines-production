/**
 * Rehearsal spec: VesselHistory sheet -> vessel_history table.
 * Column order matches the sheet column order exactly (conversion note §3.3) so a
 * backfill can map positionally. See specs/index.js for the header comment on why
 * these three sheets (VesselHistory, PlatoReadings, FermSchedules) are the rehearsal
 * targets for Plan 83-06/83-07.
 */
'use strict';

module.exports = {
  sheet: 'VesselHistory',
  table: 'vessel_history',
  primaryKey: 'vh_id',
  columns: [
    // No known prefix/pad for vh_id — just required non-empty text, reject numbers.
    { name: 'vh_id', header: 'vh_id', type: 'id', required: true, pgType: 'text' },
    { name: 'batch_id', header: 'batch_id', type: 'id', required: true, pgType: 'text', prefix: 'SV-B', pad: 6 },
    { name: 'vessel_id', header: 'vessel_id', type: 'text', required: false, pgType: 'text' },
    { name: 'shelf_id', header: 'shelf_id', type: 'text', required: false, pgType: 'text' },
    { name: 'bin_id', header: 'bin_id', type: 'text', required: false, pgType: 'text' },
    { name: 'moved_at', header: 'moved_at', type: 'timestamptz', required: true, pgType: 'timestamptz' },
    { name: 'moved_by', header: 'moved_by', type: 'text', required: false, pgType: 'text' },
    { name: 'note', header: 'note', type: 'text', required: false, pgType: 'text' }
  ]
};
