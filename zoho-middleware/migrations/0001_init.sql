-- 0001_init.sql — Phase 83 (DB-02): first additive migration, proving the pipeline
-- on an empty schema. D-04: deploy-time migrations are additive only — nothing here
-- drops, renames, or rewrites existing data (there is none yet). Real per-store DDL
-- (gift_cards, recipes, vessels, batches, etc.) arrives in Phases 84-88 as new
-- numbered files. Never edit this file once it has been applied to any environment —
-- add a new migration instead.

-- Up Migration
create table app_meta (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

insert into app_meta (key, value) values ('schema_initialized_by', '0001_init (Phase 83)');

-- Down Migration
drop table app_meta;
