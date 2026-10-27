-- 0007_batch_type.sql — Phase 94 (B3): explicit batch type + completion-source columns on batches.
-- Additive only (83 D-04). Plain nullable text columns, PG-only like unit_seq: they are NOT in
-- lib/batch-rules.js BATCH_COLUMNS, are not mirrored to the sheet, and need no Apps Script change.
-- No CHECK constraint (89 D-03 precedent): the deploy allowlist forbids DROP CONSTRAINT, so the enum
-- is enforced in lib/batch-rules.js (BATCH_TYPES). NULL batch_type = not yet classified.
-- Ships to production only after 0006 is applied there (node-pg-migrate order check).
-- Never edit this file once applied — add a new migration instead.

-- Up Migration
alter table batches add column batch_type text;
comment on column batches.batch_type is 'wine|beer|cider|seltzer|other; NULL = not yet classified (Phase 94)';
alter table batches add column batch_type_source text;
comment on column batches.batch_type_source is 'recipe|zoho|schedule|name|other|manual (Phase 94)';
alter table batches add column completed_at_source text;
comment on column batches.completed_at_source is 'task|status|manual|backfill-task (Phase 94)';

-- Down Migration
alter table batches drop column completed_at_source;
alter table batches drop column batch_type_source;
alter table batches drop column batch_type;
