'use strict';

/**
 * Regression tests for the migration-guard hardening work (83-10, gap closure
 * for 83-REVIEW.md CR-01, CR-02, IN-01).
 *
 * __tests__/migration-guard.test.js is the pre-existing contract and MUST
 * keep passing unmodified (CLAUDE.md rule 10) — this file only adds new
 * cases, it never edits the old ones.
 */

var fs = require('fs');
var os = require('os');
var path = require('path');
var childProcess = require('child_process');

var migrationGuard = require('../scripts/migration-guard');
var findDestructiveStatements = migrationGuard.findDestructiveStatements;
var findUnguardedFiles = migrationGuard.findUnguardedFiles;

var GUARD_SCRIPT = path.join(__dirname, '..', 'scripts', 'migration-guard.js');

/**
 * Wraps a statement body in a standard Up/Down migration file, matching
 * __tests__/migration-guard.test.js's existing convention, unless a case
 * needs to construct the raw file itself (down-before-up, missing marker
 * variants, unterminated tokens that must stop before the Down marker).
 */
function wrapUp(body) {
  return '-- Up Migration\n' + body + '\n-- Down Migration\nselect 1;\n';
}

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'migration-guard-hardening-test-'));
}

function writeFile(dir, name, contents) {
  var fullPath = path.join(dir, name);
  fs.writeFileSync(fullPath, contents, 'utf8');
  return fullPath;
}

describe('migration-guard hardening — parse bypasses (CR-01)', () => {
  it('still flags drop when a -- line comment-looking substring is inside a string literal ("a--b")', () => {
    var sql = wrapUp("insert into app_meta values ('a--b','x'); drop table gift_cards;");
    var violations = findDestructiveStatements(sql);
    expect(violations.length).toBe(1);
    expect(violations[0].rule).toBe('drop');
  });

  it('still flags drop across an E\'\' escape string with a backslash-escaped inner quote', () => {
    var sql = wrapUp("insert into app_meta values (E'it\\'s','v'); drop table gift_cards; insert into app_meta values ('k','v');");
    var violations = findDestructiveStatements(sql);
    expect(violations.length).toBe(1);
    expect(violations[0].rule).toBe('drop');
  });

  it('does not let a mid-line "-- down migration notes" comment desync the real Down marker', () => {
    var sql = '-- Up Migration\n' +
      'create table x (a int); -- down migration notes\n' +
      'drop table gift_cards;\n' +
      '-- Down Migration\n' +
      'select 1;\n';
    var violations = findDestructiveStatements(sql);
    expect(violations.some(function (v) { return v.rule === 'drop'; })).toBe(true);
  });

  it('still flags drop across double-quoted identifiers containing an apostrophe', () => {
    var sql = wrapUp('create table "a\'b" (id int); drop table gift_cards; create table "c\'d" (id int);');
    var violations = findDestructiveStatements(sql);
    expect(violations.length).toBe(1);
    expect(violations[0].rule).toBe('drop');
  });

  it('still flags drop around an empty dollar-quoted string literal ($$\'$$)', () => {
    var sql = wrapUp("select $$'$$; drop table gift_cards; select $$'$$;");
    var violations = findDestructiveStatements(sql);
    expect(violations.length).toBe(1);
    expect(violations[0].rule).toBe('drop');
  });

  it('recursively scans a dollar-quoted SQL function body for a hidden delete', () => {
    var sql = wrapUp('create function f() returns void language sql as $body$ delete from gift_cards $body$;');
    var violations = findDestructiveStatements(sql);
    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(violations.some(function (v) { return v.rule === 'delete'; })).toBe(true);
  });

  it('passes a benign plpgsql trigger function body with no destructive statements', () => {
    var sql = wrapUp('create function set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;');
    expect(findDestructiveStatements(sql)).toEqual([]);
  });

  it('runs the Up section to EOF when the Down marker appears before the Up marker', () => {
    var sql = '-- Down Migration\ndrop table a;\n-- Up Migration\ncreate table b (id int);\ndrop table c;\n';
    var violations = findDestructiveStatements(sql);
    expect(violations.length).toBe(1);
    expect(violations[0].statement).toMatch(/drop table c/);
  });

  it('recognises node-pg-migrate\'s "----" marker variant, not missing-up-marker', () => {
    var sql = '---- Up Migration\ndrop table x;\n';
    var violations = findDestructiveStatements(sql);
    expect(violations.some(function (v) { return v.rule === 'drop'; })).toBe(true);
    expect(violations.some(function (v) { return v.rule === 'missing-up-marker'; })).toBe(false);
  });

  describe('unterminated tokens fail closed', () => {
    var UNTERMINATED_CASES = [
      { name: 'single-quoted string', body: "create table x (a int); 'oops" },
      { name: 'E\'\' escape string', body: "create table x (a int); E'oops" },
      { name: 'double-quoted identifier', body: 'create table x (a int); "oops' },
      { name: 'block comment', body: 'create table x (a int); /* oops' },
      { name: 'dollar-quoted string', body: 'create table x (a int); $$ oops' }
    ];

    UNTERMINATED_CASES.forEach(function (c) {
      it('reports unterminated-token for an unterminated ' + c.name, () => {
        var sql = wrapUp(c.body);
        var violations = findDestructiveStatements(sql);
        expect(violations.some(function (v) { return v.rule === 'unterminated-token'; })).toBe(true);
      });
    });
  });

  it('treats nested /* */ block comments as Postgres does', () => {
    var sql = wrapUp('/* outer /* inner */ drop table x */ create table y (id int);');
    expect(findDestructiveStatements(sql)).toEqual([]);
  });
});

describe('migration-guard hardening — rule coverage (CR-01, IN-01)', () => {
  describe('rejected statements', () => {
    var REJECTED_CASES = [
      { stmt: 'ALTER TABLE gift_cards ALTER balance TYPE integer', rule: 'alter-type' },
      { stmt: 'ALTER TABLE t ALTER c SET DATA TYPE int', rule: 'alter-type' },
      { stmt: 'alter table t alter type type int', rule: 'alter-type' },
      { stmt: 'UPDATE gift_cards AS g SET balance = 0', rule: 'update' },
      { stmt: 'UPDATE ONLY gift_cards SET balance = 0', rule: 'update' },
      { stmt: 'WITH d AS (DELETE FROM gift_cards RETURNING 1) SELECT count(*) FROM d', rule: 'delete' },
      { stmt: 'DO $$ BEGIN DELETE FROM gift_cards; END $$', rule: 'do-block' },
      { stmt: "DO $$ BEGIN EXECUTE 'truncate gift_cards'; END $$", rule: 'do-block' },
      { stmt: 'EXECUTE purge_stmt', rule: 'execute' },
      { stmt: 'MERGE INTO gift_cards g USING src s ON g.code = s.code WHEN MATCHED THEN DELETE', rule: 'merge' },
      { stmt: "INSERT INTO gift_cards (code, balance) VALUES ('a', 1) ON CONFLICT (code) DO UPDATE SET balance = 0", rule: 'upsert' },
      { stmt: 'ALTER SEQUENCE gift_cards_id_seq RESTART WITH 1', rule: 'sequence-reset' },
      { stmt: 'ALTER TABLE t ALTER COLUMN id RESTART WITH 1', rule: 'sequence-reset' },
      { stmt: "SELECT setval('gift_cards_id_seq', 1)", rule: 'sequence-reset' }
    ];

    REJECTED_CASES.forEach(function (c) {
      it('includes a "' + c.rule + '" violation for: ' + c.stmt, () => {
        var sql = wrapUp(c.stmt + ';');
        var violations = findDestructiveStatements(sql);
        expect(violations.some(function (v) { return v.rule === c.rule; })).toBe(true);
      });
    });
  });

  describe('accepted statements', () => {
    var ACCEPTED_CASES = [
      'ALTER TABLE t ADD COLUMN type text',
      'ALTER TABLE t ADD COLUMN "type" text',
      'ALTER TABLE x ALTER COLUMN y SET DEFAULT 0',
      "ALTER TYPE mood ADD VALUE 'meh'",
      'CREATE TABLE c (id int primary key, p int references p(id) on update set null on delete set null)',
      "INSERT INTO app_meta (key, value) VALUES ('k','v') ON CONFLICT (key) DO NOTHING",
      'CREATE TRIGGER trg BEFORE UPDATE ON x FOR EACH ROW EXECUTE FUNCTION set_updated_at()'
    ];

    ACCEPTED_CASES.forEach(function (stmt) {
      it('reports no violations for: ' + stmt, () => {
        var sql = wrapUp(stmt + ';');
        expect(findDestructiveStatements(sql)).toEqual([]);
      });
    });
  });
});

describe('migration-guard hardening — non-SQL migration files (CR-02)', () => {
  var tmpDirs = [];

  afterEach(() => {
    tmpDirs.forEach(function (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    });
    tmpDirs = [];
  });

  function tmpDir() {
    var dir = makeTmpDir();
    tmpDirs.push(dir);
    return dir;
  }

  describe('findUnguardedFiles', () => {
    it('flags a .js migration file that node-pg-migrate would execute without the guard', () => {
      var dir = tmpDir();
      writeFile(dir, '0001_init.sql', '-- Up Migration\ncreate table x (id int);\n-- Down Migration\ndrop table x;\n');
      writeFile(dir, '0002_x.js', "exports.up = (pgm) => pgm.dropTable('gift_cards');\n");

      var violations = findUnguardedFiles(dir);
      expect(violations.length).toBe(1);
      expect(violations[0].file).toBe('0002_x.js');
      expect(violations[0].rule).toBe('non-sql-file');
      expect(typeof violations[0].statement).toBe('string');
    });

    it('ignores dotfiles, matching node-pg-migrate\'s default ignore pattern', () => {
      var dir = tmpDir();
      writeFile(dir, '0001_init.sql', '-- Up Migration\ncreate table x (id int);\n-- Down Migration\ndrop table x;\n');
      writeFile(dir, '.gitkeep', '');

      expect(findUnguardedFiles(dir)).toEqual([]);
    });

    it('flags a non-.sql README left in the migrations directory', () => {
      var dir = tmpDir();
      writeFile(dir, 'README.md', 'notes');

      var violations = findUnguardedFiles(dir);
      expect(violations.length).toBe(1);
      expect(violations[0].rule).toBe('non-sql-file');
    });

    it('flags a subdirectory entry', () => {
      var dir = tmpDir();
      fs.mkdirSync(path.join(dir, 'subdir'));

      var violations = findUnguardedFiles(dir);
      expect(violations.length).toBe(1);
      expect(violations[0].file).toBe('subdir');
      expect(violations[0].rule).toBe('non-sql-file');
    });

    it('returns [] for the real migrations/ directory', () => {
      var realMigrationsDir = path.join(__dirname, '..', 'migrations');
      expect(findUnguardedFiles(realMigrationsDir)).toEqual([]);
    });
  });

  describe('CLI', () => {
    it('exits 1 with a non-sql-file stderr line for a .js migration', () => {
      var dir = tmpDir();
      writeFile(dir, '0002_x.js', "exports.up = (pgm) => pgm.dropTable('gift_cards');\n");

      var result = childProcess.spawnSync('node', [GUARD_SCRIPT, dir], { encoding: 'utf8' });
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/0002_x\.js: non-sql-file/);
    });

    it('exits 0 and prints "1 file(s) additive-only OK" for a dir with one .sql file and a dotfile', () => {
      var dir = tmpDir();
      writeFile(dir, '0001_init.sql', '-- Up Migration\ncreate table x (id int);\n-- Down Migration\ndrop table x;\n');
      writeFile(dir, '.gitkeep', '');

      var result = childProcess.spawnSync('node', [GUARD_SCRIPT, dir], { encoding: 'utf8' });
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/migration-guard: 1 file\(s\) additive-only OK/);
    });
  });
});
