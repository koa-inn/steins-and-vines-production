'use strict';

/**
 * Tests for scripts/migration-guard.js — D-04 (additive-only deploy-time migrations)
 *
 * Covers every <behavior> bullet in 83-03-PLAN.md Task 1:
 *   1. Safe Up statements produce no violations
 *   2. Each destructive statement produces exactly one violation, with a rule name
 *   3. Destructive statements placed ONLY in `-- Down Migration` produce no violations
 *   4. Destructive words inside comments / string literals produce no violations
 *   5. A file with no `-- Up Migration` marker is itself a violation (missing-up-marker)
 *   6. checkMigrationsDir() wraps findDestructiveStatements() across a directory of .sql files
 *   7. The CLI exits 1 on a destructive migrations dir (exercised via child_process)
 */

var fs = require('fs');
var os = require('os');
var path = require('path');
var childProcess = require('child_process');

var migrationGuard = require('../scripts/migration-guard');
var findDestructiveStatements = migrationGuard.findDestructiveStatements;
var checkMigrationsDir = migrationGuard.checkMigrationsDir;

var GUARD_SCRIPT = path.join(__dirname, '..', 'scripts', 'migration-guard.js');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'migration-guard-test-'));
}

function writeFile(dir, name, contents) {
  var fullPath = path.join(dir, name);
  fs.writeFileSync(fullPath, contents, 'utf8');
  return fullPath;
}

describe('migration-guard', () => {
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

  // ─── 1. Safe Up statements ──────────────────────────────────────────────

  describe('findDestructiveStatements — safe statements', () => {
    var SAFE_STATEMENTS = [
      'create table x (id serial primary key)',
      'create index idx_x_id on x (id)',
      'alter table x add column y text',
      "insert into x (y) values ('hello')"
    ];

    SAFE_STATEMENTS.forEach(function (stmt) {
      it('reports no violations for: ' + stmt, () => {
        var sql = '-- Up Migration\n' + stmt + ';\n-- Down Migration\nselect 1;\n';
        expect(findDestructiveStatements(sql)).toEqual([]);
      });
    });
  });

  // ─── 2. Each destructive statement -> exactly one violation ────────────

  describe('findDestructiveStatements — destructive statements', () => {
    var DESTRUCTIVE_CASES = [
      { stmt: 'drop table x', rule: 'drop' },
      { stmt: 'DROP INDEX i', rule: 'drop' },
      { stmt: 'alter table x drop column y', rule: 'drop' },
      { stmt: 'truncate x', rule: 'truncate' },
      { stmt: 'alter table x rename to y', rule: 'rename' },
      { stmt: 'alter table x rename column a to b', rule: 'rename' },
      { stmt: 'alter table x alter column y type int', rule: 'alter-type' },
      { stmt: 'delete from x', rule: 'delete' },
      { stmt: 'update x set y = 1', rule: 'update' }
    ];

    DESTRUCTIVE_CASES.forEach(function (c) {
      it('reports exactly one "' + c.rule + '" violation for: ' + c.stmt, () => {
        var sql = '-- Up Migration\n' + c.stmt + ';\n-- Down Migration\nselect 1;\n';
        var violations = findDestructiveStatements(sql);
        expect(violations.length).toBe(1);
        expect(violations[0].rule).toBe(c.rule);
        expect(typeof violations[0].statement).toBe('string');
      });
    });
  });

  // ─── 3. Destructive statements ONLY in Down section -> no violations ───

  describe('findDestructiveStatements — Down-only destructive statements', () => {
    it('does not flag destructive statements confined to -- Down Migration', () => {
      var sql = '-- Up Migration\n' +
        'create table x (id serial primary key);\n' +
        '-- Down Migration\n' +
        'drop table x;\n' +
        'truncate x;\n' +
        'delete from x;\n';
      expect(findDestructiveStatements(sql)).toEqual([]);
    });
  });

  // ─── 4. Destructive words in comments / literals -> no violations ──────

  describe('findDestructiveStatements — comments and string literals', () => {
    it('ignores destructive words inside -- line comments', () => {
      var sql = '-- Up Migration\n' +
        '-- remember: never drop table x in production\n' +
        'create table x (id serial primary key);\n' +
        '-- Down Migration\nselect 1;\n';
      expect(findDestructiveStatements(sql)).toEqual([]);
    });

    it('ignores destructive words inside /* */ block comments', () => {
      var sql = '-- Up Migration\n' +
        '/* TODO: consider a drop table x migration later */\n' +
        'create table x (id serial primary key);\n' +
        '-- Down Migration\nselect 1;\n';
      expect(findDestructiveStatements(sql)).toEqual([]);
    });

    it('ignores destructive words inside single-quoted string literals', () => {
      var sql = '-- Up Migration\n' +
        "insert into app_meta (key, value) values ('note', 'do not drop table x');\n" +
        '-- Down Migration\nselect 1;\n';
      expect(findDestructiveStatements(sql)).toEqual([]);
    });
  });

  // ─── 5. Missing -- Up Migration marker -> violation ─────────────────────

  describe('findDestructiveStatements — missing Up marker', () => {
    it('reports a missing-up-marker violation when the file has no -- Up Migration marker', () => {
      var sql = 'create table x (id serial primary key);\n';
      var violations = findDestructiveStatements(sql);
      expect(violations.length).toBe(1);
      expect(violations[0].rule).toBe('missing-up-marker');
    });
  });

  // ─── 6. checkMigrationsDir wraps findDestructiveStatements per file ────

  describe('checkMigrationsDir', () => {
    it('returns [] for a directory of clean migration files', () => {
      var dir = tmpDir();
      writeFile(dir, '0001_init.sql',
        '-- Up Migration\ncreate table x (id serial primary key);\n-- Down Migration\ndrop table x;\n');
      writeFile(dir, '0002_add_column.sql',
        '-- Up Migration\nalter table x add column y text;\n-- Down Migration\nalter table x drop column y;\n');
      expect(checkMigrationsDir(dir)).toEqual([]);
    });

    it('attaches the file name to each violation and covers multiple files', () => {
      var dir = tmpDir();
      writeFile(dir, '0001_init.sql',
        '-- Up Migration\ncreate table x (id serial primary key);\n-- Down Migration\ndrop table x;\n');
      writeFile(dir, '0002_bad.sql',
        '-- Up Migration\ndrop table x;\n-- Down Migration\nselect 1;\n');

      var violations = checkMigrationsDir(dir);
      expect(violations.length).toBe(1);
      expect(violations[0].file).toBe('0002_bad.sql');
      expect(violations[0].rule).toBe('drop');
    });

    it('ignores non-.sql files in the directory', () => {
      var dir = tmpDir();
      writeFile(dir, '0001_init.sql',
        '-- Up Migration\ncreate table x (id serial primary key);\n-- Down Migration\ndrop table x;\n');
      writeFile(dir, 'README.md', 'drop table x — not a migration file, must be ignored');
      expect(checkMigrationsDir(dir)).toEqual([]);
    });

    it('returns [] for the real migrations/ directory (0001_init.sql)', () => {
      var realMigrationsDir = path.join(__dirname, '..', 'migrations');
      expect(checkMigrationsDir(realMigrationsDir)).toEqual([]);
    });
  });

  // ─── 7. CLI exit code contract ──────────────────────────────────────────

  describe('CLI', () => {
    it('exits 0 and prints "additive-only OK" for a clean migrations dir', () => {
      var dir = tmpDir();
      writeFile(dir, '0001_init.sql',
        '-- Up Migration\ncreate table x (id serial primary key);\n-- Down Migration\ndrop table x;\n');

      var result = childProcess.spawnSync('node', [GUARD_SCRIPT, dir], { encoding: 'utf8' });
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/additive-only OK/);
    });

    it('exits 1 and prints violation lines to stderr for a dir with a destructive Up statement', () => {
      var dir = tmpDir();
      writeFile(dir, '0001_bad.sql',
        '-- Up Migration\ndrop table x;\n-- Down Migration\nselect 1;\n');

      var result = childProcess.spawnSync('node', [GUARD_SCRIPT, dir], { encoding: 'utf8' });
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/0001_bad\.sql: drop:/);
    });
  });
});
