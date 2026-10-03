-- 0002_gift_cards.sql — Phase 84 (DB-03): gift-card balance-of-record schema.
-- Additive only (D-04, Phase 83): nothing here drops, renames, or rewrites 0001's
-- app_meta table. Never edit this file once it has been applied to any environment —
-- add a new migration instead.
--
-- gift_card_cert_seq seeds at 1 here; the real seed value (above the highest backfilled
-- GC-NNNNNN) is set at backfill/runtime time via setval (D-14) — AlterSeqStmt and bare
-- SELECT are both rejected by the migration-allowlist guard, so seeding can never live here.
--
-- gift_card_transactions is append-only (D-12): nothing in application code ever updates
-- or deletes a row. tx_ref is a composite synthetic value minted by the facade
-- (saleRef + cert_number + kind, see 84-RESEARCH.md Pitfall 1) — the UNIQUE constraint
-- itself is what is locked, not the raw value inserted into it.

-- Up Migration
create sequence gift_card_cert_seq start 1 minvalue 1;

create table gift_cards (
  cert_number text primary key check (cert_number ~ '^GC-[0-9]{6}$'),
  face_value numeric(10,2) not null check (face_value >= 0),
  current_balance numeric(10,2) not null check (current_balance >= 0),
  status text not null check (status in ('active', 'depleted', 'void')),
  issued_date date,
  issued_by text,
  zoho_invoice_number text,
  notes text,
  void_reason text,
  created_at timestamptz not null default now(),
  last_updated timestamptz not null default now()
);

create table gift_card_transactions (
  id bigserial primary key,
  cert_number text not null references gift_cards (cert_number),
  tx_ref text not null unique,
  kind text not null check (kind in ('opening_balance', 'issue', 'redeem', 'reload', 'adjust', 'void')),
  amount numeric(10,2) not null,
  balance_before numeric(10,2),
  balance_after numeric(10,2),
  imported boolean not null default false,
  actor text not null,
  actor_name text,
  device_label text,
  reason text check (reason is null or reason in ('correction', 'goodwill', 'refund-to-card', 'other')),
  note text,
  source_tx_id text,
  created_at timestamptz not null default now(),
  check (kind <> 'redeem' or amount < 0),
  check (kind not in ('issue', 'reload') or amount > 0),
  check (kind <> 'void' or amount = 0),
  check (kind <> 'opening_balance' or amount >= 0),
  check (kind <> 'adjust' or (amount <> 0 and reason is not null and actor_name is not null)),
  check (kind <> 'adjust' or reason <> 'other' or (note is not null and length(btrim(note)) > 0))
);

create index gift_card_transactions_cert_created_idx on gift_card_transactions (cert_number, created_at);

-- Down Migration
drop table gift_card_transactions;
drop table gift_cards;
drop sequence gift_card_cert_seq;
