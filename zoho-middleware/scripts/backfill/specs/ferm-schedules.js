/**
 * Rehearsal spec: FermSchedules sheet -> ferm_schedules table.
 * Column order matches the sheet column order exactly (conversion note §3.4).
 * Note padLength is 4 here (FS-0000), unlike the 6-digit pad used elsewhere.
 *
 * `header` is the sheet's real row-1 text (verified 2026-10-02, pinned by
 * __tests__/backfill/spec-headers.test.js); `name` is the scratch/Postgres column
 * (is_active -> active, last_updated -> updated_at).
 */
'use strict';

module.exports = {
  sheet: 'FermSchedules',
  table: 'ferm_schedules',
  primaryKey: 'schedule_id',
  columns: [
    { name: 'schedule_id', header: 'schedule_id', type: 'id', required: true, pgType: 'text', prefix: 'FS', pad: 4 },
    { name: 'name', header: 'name', type: 'text', required: true, pgType: 'text' },
    { name: 'description', header: 'description', type: 'text', required: false, pgType: 'text' },
    { name: 'category', header: 'category', type: 'text', required: false, pgType: 'text' },
    // Was JSON.stringify(steps) in the sheet — must be a JSON string on read, parsed here.
    { name: 'steps', header: 'steps', type: 'jsonb', required: true, pgType: 'jsonb' },
    // Was the literal string 'TRUE'/'FALSE' in the sheet — cast to real boolean here.
    { name: 'active', header: 'is_active', type: 'boolean', required: true, pgType: 'boolean' },
    { name: 'created_at', header: 'created_at', type: 'timestamptz', required: true, pgType: 'timestamptz' },
    { name: 'created_by', header: 'created_by', type: 'text', required: false, pgType: 'text' },
    { name: 'updated_at', header: 'last_updated', type: 'timestamptz', required: true, pgType: 'timestamptz' }
  ]
};
