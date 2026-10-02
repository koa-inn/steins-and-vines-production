'use strict';
// expect: R = must reject (destructive/unsafe), A = must accept (additive). src = where the payload came from.
// Ported from .planning/phases/83-postgres-infrastructure/83-13-allowlist-cases.reference.js (83-13 Task 1, Step 2).
//   (a) the original absolute developer-machine path to 0001_init.sql is replaced with a path.join relative to this file.
//   (b) `apply: true` is set on exactly 5 accept cases (the ones 83-14 applies to real Postgres, in dependency order).
//   (c) an `id` field is added to the cases the test file asserts on by rule.
//   (d)/(e) extra R/A cases are appended at the end to cover behaviour not in the original corpus.
var fs = require('fs');
var path = require('path');

function up(b) { return '-- Up Migration\n' + b + '\n-- Down Migration\nselect 1;\n'; }
var C = [];
function R(src, name, sql, raw) { C.push({ src: src, name: name, sql: raw ? sql : up(sql), expect: 'R' }); }
function A(src, name, sql, raw) { C.push({ src: src, name: name, sql: raw ? sql : up(sql), expect: 'A' }); }

// ---- migration-guard.test.js ----
['drop table x', 'DROP INDEX i', 'alter table x drop column y', 'truncate x', 'alter table x rename to y',
  'alter table x rename column a to b', 'alter table x alter column y type int', 'delete from x', 'update x set y = 1']
  .forEach(function (s) { R('mg.test destructive', s, s + ';'); });
['create table x (id serial primary key)', 'create index idx_x_id on x (id)', 'alter table x add column y text',
  "insert into x (y) values ('hello')"].forEach(function (s) { A('mg.test safe', s, s + ';'); });
A('mg.test down-only', 'destructive only in Down', '-- Up Migration\ncreate table x (id serial primary key);\n-- Down Migration\ndrop table x;\ntruncate x;\ndelete from x;\n', true);
A('mg.test comments', '-- comment with drop', '-- remember: never drop table x in production\ncreate table x (id serial primary key);');
A('mg.test comments', '/* */ comment with drop', '/* TODO: consider a drop table x migration later */\ncreate table x (id serial primary key);');
A('mg.test literals', "'do not drop table x' literal", "insert into app_meta (key, value) values ('note', 'do not drop table x');");
R('mg.test', 'missing Up marker', 'create table x (id serial primary key);\n', true);

// ---- migration-guard-hardening.test.js ----
R('hardening', "'a--b' then drop", "insert into app_meta values ('a--b','x'); drop table gift_cards;");
R('hardening', "E'it\\'s' then drop", "insert into app_meta values (E'it\\'s','v'); drop table gift_cards; insert into app_meta values ('k','v');");
R('hardening', 'mid-line "-- down migration notes"', '-- Up Migration\ncreate table x (a int); -- down migration notes\ndrop table gift_cards;\n-- Down Migration\nselect 1;\n', true);
R('hardening', '"a\'b" identifiers then drop', 'create table "a\'b" (id int); drop table gift_cards; create table "c\'d" (id int);');
R('hardening', "$$'$$ around drop", "select $$'$$; drop table gift_cards; select $$'$$;");
R('hardening', 'SQL fn body $body$ delete', 'create function f() returns void language sql as $body$ delete from gift_cards $body$;');
R('hardening', 'down-before-up then drop c', '-- Down Migration\ndrop table a;\n-- Up Migration\ncreate table b (id int);\ndrop table c;\n', true);
R('hardening', '---- Up marker then drop', '---- Up Migration\ndrop table x;\n', true);
["create table x (a int); 'oops", "create table x (a int); E'oops", 'create table x (a int); "oops',
  'create table x (a int); /* oops', 'create table x (a int); $$ oops'].forEach(function (b) { R('hardening unterminated', b, b); });
A('hardening', 'nested /* /* */ */ comment', '/* outer /* inner */ drop table x */ create table y (id int);');
['ALTER TABLE gift_cards ALTER balance TYPE integer', 'ALTER TABLE t ALTER c SET DATA TYPE int', 'alter table t alter type type int',
  'UPDATE gift_cards AS g SET balance = 0', 'UPDATE ONLY gift_cards SET balance = 0',
  'WITH d AS (DELETE FROM gift_cards RETURNING 1) SELECT count(*) FROM d', 'DO $$ BEGIN DELETE FROM gift_cards; END $$',
  "DO $$ BEGIN EXECUTE 'truncate gift_cards'; END $$", 'EXECUTE purge_stmt',
  'MERGE INTO gift_cards g USING src s ON g.code = s.code WHEN MATCHED THEN DELETE',
  "INSERT INTO gift_cards (code, balance) VALUES ('a', 1) ON CONFLICT (code) DO UPDATE SET balance = 0",
  'ALTER SEQUENCE gift_cards_id_seq RESTART WITH 1', 'ALTER TABLE t ALTER COLUMN id RESTART WITH 1',
  "SELECT setval('gift_cards_id_seq', 1)"].forEach(function (s) { R('hardening rejected', s, s + ';'); });
['ALTER TABLE t ADD COLUMN type text', 'ALTER TABLE t ADD COLUMN "type" text', 'ALTER TABLE x ALTER COLUMN y SET DEFAULT 0',
  "ALTER TYPE mood ADD VALUE 'meh'",
  'CREATE TABLE c (id int primary key, p int references p(id) on update set null on delete set null)',
  "INSERT INTO app_meta (key, value) VALUES ('k','v') ON CONFLICT (key) DO NOTHING"].forEach(function (s) { A('hardening accepted', s, s + ';'); });
// Old guard accepts these; the allowlist deliberately routes them to migrations-manual (policy change, see report):
C.push({ id: 'policy-trigger', src: 'hardening accepted (POLICY)', name: 'CREATE TRIGGER ... EXECUTE FUNCTION set_updated_at()', sql: up('CREATE TRIGGER trg BEFORE UPDATE ON x FOR EACH ROW EXECUTE FUNCTION set_updated_at();'), expect: 'R' });
C.push({ id: 'policy-plpgsql', src: 'hardening (POLICY)', name: 'benign plpgsql trigger function', sql: up('create function set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;'), expect: 'R' });

// ---- 83-REVIEW.md critical bypasses ----
C.push({ id: 'CR-01a', src: 'REVIEW CR-01a', name: 'a$$t$ fake dollar quote', sql: up('select 1 as a$$t$;\nselect 1 as b$$$;\ndrop table gift_cards;\n-- $t$'), expect: 'R' });
C.push({ id: 'CR-01b', src: 'REVIEW CR-01b', name: "a$e'...' fake E-string", sql: up("CREATE DOMAIN a$e AS text;\nselect a$e'\\';drop table gift_cards;--';"), expect: 'R' });
C.push({ id: 'CR-02a', src: 'REVIEW CR-02a', name: "fn body as '...' + SELECT", sql: up("CREATE FUNCTION wipe() RETURNS void LANGUAGE sql AS 'DELETE FROM gift_cards';\nSELECT wipe();"), expect: 'R' });
C.push({ id: 'CR-02b', src: 'REVIEW CR-02b', name: "proc body as '...' + CALL", sql: up("CREATE PROCEDURE p() LANGUAGE sql AS 'TRUNCATE gift_cards';\nCALL p();"), expect: 'R' });
C.push({ id: 'CR-03', src: 'REVIEW CR-03', name: 'body tokenizer error swallowed', sql: up('CREATE FUNCTION wipe() RETURNS void LANGUAGE sql AS $f$ select 1 as b$$$; delete from gift_cards; $f$;\nSELECT wipe();'), expect: 'R' });
C.push({ id: 'CR-04', src: 'REVIEW CR-04', name: 'U&"balance" TYPE integer', sql: up('ALTER TABLE gift_cards ALTER COLUMN U&"balance" TYPE integer;'), expect: 'R' });
C.push({ id: 'WR-01-scs-set', src: 'REVIEW WR-01 file 1', name: 'SET standard_conforming_strings = off', sql: up('SET standard_conforming_strings = off;'), expect: 'R' });
C.push({ id: 'WR-01-backslash', src: 'REVIEW WR-01 file 2', name: "select '\\'' then drop", sql: up("select '\\'';\ndrop table gift_cards;\n-- '"), expect: 'R' });
R('REVIEW WR-01 variant', 'ALTER DATABASE SET scs off', 'ALTER DATABASE railway SET standard_conforming_strings = off;');
['ALTER TABLE gift_cards DETACH PARTITION gc_2026', 'ALTER TABLE gift_cards SET SCHEMA archive',
  'CREATE OR REPLACE FUNCTION existing_trigger_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$',
  'CREATE OR REPLACE VIEW v AS SELECT 1', 'CREATE RULE r AS ON INSERT TO gift_cards DO INSTEAD NOTHING',
  'ALTER TABLE gift_cards DISABLE TRIGGER ALL', 'CREATE POLICY p ON gift_cards USING (false)',
  'ALTER TABLE gift_cards ENABLE ROW LEVEL SECURITY', "SELECT dblink_exec('dbname=x', 'delete from gift_cards')",
  'CALL some_existing_proc()'].forEach(function (s) { R('REVIEW WR-02', s, s + ';'); });

// ---- New attacks against an allowlist (my own) ----
C.push({ id: 'fn-default', src: 'new', name: 'ADD COLUMN default calls user fn', sql: up('ALTER TABLE gift_cards ADD COLUMN x int DEFAULT wipe();'), expect: 'R' });
R('new', 'ADD COLUMN GENERATED calls user fn', 'ALTER TABLE gift_cards ADD COLUMN x int GENERATED ALWAYS AS (wipe()) STORED;');
R('new', 'ADD CONSTRAINT CHECK calls user fn', 'ALTER TABLE gift_cards ADD CONSTRAINT c CHECK (wipe() IS NULL);');
R('new', 'index expression calls user fn', 'CREATE INDEX i ON gift_cards ((wipe()));');
R('new', 'partial index WHERE calls fn', 'CREATE INDEX i ON gift_cards (code) WHERE wipe() IS NULL;');
R('new', 'schema-qualified allowlisted name', 'ALTER TABLE g ADD COLUMN x timestamptz DEFAULT public.now();');
R('new', 'CREATE TABLE AS SELECT fn()', 'CREATE TABLE t AS SELECT wipe();');
C.push({ id: 'insert-select', src: 'new', name: 'INSERT ... SELECT', sql: up('INSERT INTO app_meta SELECT key, value FROM gift_cards;'), expect: 'R' });
R('new', 'INSERT VALUES (fn())', "INSERT INTO app_meta (key, value) VALUES ('k', wipe());");
R('new', 'INSERT VALUES ((SELECT ...))', "INSERT INTO app_meta (key, value) VALUES ('k', (SELECT 'x'));");
R('new', 'INSERT WITH (DELETE) CTE', "WITH d AS (DELETE FROM gift_cards RETURNING 1) INSERT INTO app_meta VALUES ('k','v');");
C.push({ id: 'insert-returning', src: 'new', name: 'INSERT ... RETURNING', sql: up("INSERT INTO app_meta VALUES ('k','v') RETURNING *;"), expect: 'R' });
R('new', 'COMMIT then drop', 'COMMIT; DROP TABLE gift_cards;');
R('new', 'mixed ALTER: ADD + DROP COLUMN', 'ALTER TABLE gift_cards ADD COLUMN x int, DROP COLUMN balance;');
R('new', 'ALTER INDEX (non-table objtype)', 'ALTER INDEX i SET TABLESPACE pg_default;');
R('new', 'ALTER COLUMN DROP DEFAULT', 'ALTER TABLE g ALTER COLUMN x DROP DEFAULT;');
R('new', 'ALTER COLUMN DROP NOT NULL', 'ALTER TABLE g ALTER COLUMN x DROP NOT NULL;');
C.push({ id: 'enum-rename', src: 'new', name: 'ALTER TYPE RENAME VALUE', sql: up("ALTER TYPE mood RENAME VALUE 'a' TO 'b';"), expect: 'R' });
R('new', 'COPY FROM PROGRAM', "COPY gift_cards FROM PROGRAM 'true';");
R('new', 'scs-dependent backslash literal', "INSERT INTO app_meta (key, value) VALUES ('\\', '); drop table gift_cards; --');");
R('new', 'CREATE SCHEMA with embedded elements', 'CREATE SCHEMA s CREATE VIEW v AS SELECT 1;');
R('new', 'GRANT / REVOKE (routed to manual)', 'REVOKE ALL ON gift_cards FROM app;');
R('new', 'CREATE EXTENSION (routed to manual)', 'CREATE EXTENSION IF NOT EXISTS dblink;');
R('new', 'non-ASCII ident TYPE change', 'ALTER TABLE g ALTER COLUMN café TYPE int;');
R('new', 'SELECT pg_terminate_backend', 'SELECT pg_terminate_backend(pid) FROM pg_stat_activity;');
R('new', 'empty file between markers is fine? (see A)', 'LOCK TABLE gift_cards;');

R('new', 'search_path shadow: CREATE SCHEMA postgres + table', 'CREATE SCHEMA postgres; CREATE TABLE postgres.gift_cards (code text);');
C.push({ id: 'schema-shadow', src: 'new', name: 'shadow via existing schema', sql: up('CREATE TABLE postgres.gift_cards (code text);'), expect: 'R' });
R('new', 'trigger-fired body (fn + trigger + insert)', "create function stamp() returns trigger language plpgsql as $$ begin delete from gift_cards; return new; end $$; create trigger trg before insert on app_meta for each row execute function stamp(); insert into app_meta values ('k','v');");
R('new', 'scs: COMMENT IS adjacent-literal payload', "COMMENT ON TABLE notes_t IS '\\'\n'; drop table victim1; --';");
R('new', 'scs: enum label adjacent-literal payload', "CREATE TYPE e1 AS ENUM ('\\'\n'); drop table victim2; --');");
R('new (false-reject, documented)', 'regex CHECK using \\d', "ALTER TABLE gift_cards ADD CONSTRAINT gc_cert_fmt CHECK (cert_number ~ '^GC-\\d{6}$') NOT VALID;");
// ---- Real + realistic additive migrations ----
C.push({ apply: true, src: 'repo', name: 'migrations/0001_init.sql', sql: fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', '0001_init.sql'), 'utf8'), expect: 'A' });
C.push({ apply: true, src: 'phase84', name: '0002 gift cards (notes §3.1 DDL + seq-backed text id)', expect: 'A', sql: up([
  "create sequence gift_card_cert_seq start with 1;",
  "create table gift_cards (",
  "  cert_number         text primary key default ('GC-' || lpad(nextval('gift_card_cert_seq')::text, 6, '0')),",
  "  face_value          numeric(10,2) not null check (face_value > 0),",
  "  current_balance     numeric(10,2) not null check (current_balance >= 0),",
  "  status              text          not null check (status in ('active','depleted','void')),",
  "  issued_date         timestamptz   not null,",
  "  issued_by           text, zoho_invoice_number text, notes text,",
  "  last_updated        timestamptz   not null default now()",
  ");",
  "create table gift_card_transactions (",
  "  id            bigserial     primary key,",
  "  cert_number   text          not null references gift_cards(cert_number),",
  "  tx_ref        text          not null unique,",
  "  kind          text          not null check (kind in ('issue','redeem','reload','void')),",
  "  amount        numeric(10,2) not null,",
  "  balance_after numeric(10,2) not null,",
  "  created_at    timestamptz   not null default now()",
  ");",
  "create index on gift_card_transactions (cert_number, created_at desc);",
  "comment on table gift_card_transactions is $c$Append-only ledger; tx_ref is the idempotency key. Don't UPDATE/DELETE.$c$;",
  "comment on column gift_cards.current_balance is 'Balance of record (numeric(10,2), never float)';"
].join('\n')) });
C.push({ apply: true, src: 'phase84', name: 'later additive: ADD COLUMN w/ default, FK, NOT VALID check, enum, schema', expect: 'A', sql: up([
  "create type gc_channel as enum ('kiosk','web','admin');",
  "alter table gift_cards add column channel gc_channel not null default 'kiosk';",
  "alter table gift_cards add column if not exists voided_at timestamptz;",
  "alter table gift_card_transactions add column created_by text default 'system', add column note text;",
  "alter table gift_card_transactions add constraint gct_amount_nonzero check (amount <> 0) not valid;",
  "alter table gift_card_transactions validate constraint gct_amount_nonzero;",
  "create table gc_adjustments (id bigint generated always as identity primary key, tx_id bigint not null references gift_card_transactions(id) on delete restrict, reason text not null, at timestamptz not null default current_timestamp);",
  "create unique index gc_adjustments_tx_uq on gc_adjustments (tx_id) where reason is not null;",
  "create index gc_lower_notes on gift_cards (lower(notes));",
  "alter table gift_cards alter column notes set default '';",
  "alter table gc_adjustments alter column reason set not null;",
  "alter type gc_channel add value if not exists 'phone';",
  "insert into app_meta (key, value) values ('gift_cards_store', 'sheets') on conflict (key) do nothing;",
  "create table ferm_schedules (schedule_id text primary key, steps jsonb not null check (jsonb_typeof(steps) = 'array'), active boolean not null default true, uid uuid default gen_random_uuid());"
].join('\n')) });
// These two run after the above three in 83-14's real-Postgres apply order (each needs gift_cards
// to already exist / is independent of it), so `apply: true` is set here, in that order.
C.push({ apply: true, src: 'new', name: 'explicit public. qualification', sql: up('CREATE TABLE public.vessel_history (vh_id text primary key);'), expect: 'A' });
C.push({ apply: true, src: 'new', name: 'regex CHECK written without backslash', sql: up("ALTER TABLE gift_cards ADD CONSTRAINT gc_cert_fmt CHECK (cert_number ~ '^GC-[0-9]{6}$') NOT VALID;"), expect: 'A' });

// ---- Step 2(d)/(e): extra cases not in the original research corpus, needed by <behavior> ----
R('83-13 extra', 'raw file, no Up and no Down marker, drop table x', 'drop table x;', true);
R('83-13 extra', 'raw Up-only file, no trailing semicolon, drop table x', '-- Up Migration\ndrop table x', true);
R('83-13 extra', 'CREATE PROCEDURE ... LANGUAGE sql', 'CREATE PROCEDURE p() LANGUAGE sql AS $$ select 1 $$;');
R('83-13 extra', 'DO block', 'DO $$ BEGIN NULL; END $$;');
R('83-13 extra', 'CALL', 'CALL p();');
R('83-13 extra', 'parse error: select (', 'select (');
A('83-13 extra', 'raw Up-only file, no trailing semicolon, create table x', '-- Up Migration\ncreate table x (a int)', true);
A('83-13 extra', 'comment-only Up section', '-- nothing to do here, this migration intentionally has no statements\n');

module.exports = C;
