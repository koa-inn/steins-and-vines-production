/**
 * Rehearsal spec: PlatoReadings sheet -> plato_readings table.
 * Column order matches the sheet column order exactly (conversion note §3.2), including
 * the odd trailing temperature/ph columns appended after the fact — preserved for
 * positional backfill mapping, not reordered.
 *
 * `header` is the sheet's real row-1 text (verified 2026-10-02, pinned by
 * __tests__/backfill/spec-headers.test.js); `name` is the scratch/Postgres column
 * (degrees_plato -> plato).
 */
'use strict';

module.exports = {
  sheet: 'PlatoReadings',
  table: 'plato_readings',
  primaryKey: 'reading_id',
  columns: [
    { name: 'reading_id', header: 'reading_id', type: 'id', required: true, pgType: 'text', prefix: 'PR', pad: 6 },
    { name: 'batch_id', header: 'batch_id', type: 'id', required: true, pgType: 'text', prefix: 'SV-B', pad: 6 },
    { name: 'timestamp', header: 'timestamp', type: 'timestamptz', required: true, pgType: 'timestamptz' },
    { name: 'plato', header: 'degrees_plato', type: 'numeric', required: true, pgType: 'numeric(5,2)', precision: 5, scale: 2 },
    { name: 'notes', header: 'notes', type: 'text', required: false, pgType: 'text' },
    { name: 'recorded_by', header: 'recorded_by', type: 'text', required: false, pgType: 'text' },
    // Do NOT default to now() if missing — fabricating a created_at is coercion (D-12).
    { name: 'created_at', header: 'created_at', type: 'timestamptz', required: true, pgType: 'timestamptz' },
    { name: 'temperature', header: 'temperature', type: 'numeric', required: false, pgType: 'numeric(5,2)', precision: 5, scale: 2 },
    { name: 'ph', header: 'ph', type: 'numeric', required: false, pgType: 'numeric(4,2)', precision: 4, scale: 2 }
  ]
};
