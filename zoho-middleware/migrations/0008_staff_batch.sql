-- 0008_staff_batch.sql — Phase 95 (D-08): explicit staff / family / R&D flag on batches.
-- Additive only (83 D-04). Plain boolean, PG-only like unit_seq and batch_type: the column is NOT in
-- lib/batch-rules.js BATCH_COLUMNS, so it is never mirrored to the sheet and needs no Apps Script change.
-- No CHECK constraint: a boolean needs none. Existing rows default to false.
-- Ships to production only after 0007 is applied there (node-pg-migrate order check).
-- Never edit this file once applied — add a new migration instead.

-- Up Migration
alter table batches add column staff_batch boolean not null default false;
comment on column batches.staff_batch is 'staff/family/R&D batch; hidden from mix views (Phase 95)';

-- Down Migration
alter table batches drop column staff_batch;
