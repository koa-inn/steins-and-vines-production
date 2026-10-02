'use strict';

/**
 * Tests for scripts/migration-allowlist.js — fail-closed, parser-backed
 * allowlist migration guard (D-04, DB-02, gap closure 83-13).
 *
 * Covers every <behavior> bullet in 83-13-PLAN.md Task 1:
 *   1. Parser version is a real PG16 grammar (160000 <= version < 170000)
 *   2. Every corpus case with expect 'R' is rejected; every 'A' case is accepted
 *   3. Corpus size guard (>= 90 R, >= 20 A — catches an accidentally truncated port)
 *   4. Rule-category assertions by case `id`
 *   5. Owner decision 2: functions/triggers/procedures/DO/CALL always rejected
 *   6. Up/Down section handling mirrors node-pg-migrate exactly
 *   7. Trailing-semicolon mirror
 *   8. Comment-only Up section accepted
 *   9. checkSql throws before ready()
 *   10. CLI exit codes, stdout/stderr contract, IN-02 directory handling
 */

var fs = require('fs');
var os = require('os');
var path = require('path');
var childProcess = require('child_process');

var allowlist = require('../scripts/migration-allowlist');
var cases = require('./fixtures/migration-allowlist-cases');

var SCRIPT = path.join(__dirname, '..', 'scripts', 'migration-allowlist.js');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'migration-allowlist-test-'));
}

function writeFile(dir, name, contents) {
  var fullPath = path.join(dir, name);
  fs.writeFileSync(fullPath, contents, 'utf8');
  return fullPath;
}

function rulesOf(violations) {
  return violations.map(function (v) { return v.rule; });
}

function caseById(id) {
  var found = cases.filter(function (c) { return c.id === id; });
  if (found.length !== 1) throw new Error('expected exactly one case with id ' + id + ', found ' + found.length);
  return found[0];
}

describe('migration-allowlist', function () {
  var tmpDirs = [];

  beforeAll(function () {
    return allowlist.ready();
  });

  afterEach(function () {
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

  // ─── Parser version ───────────────────────────────────────────────────

  describe('parser version', function () {
    it('reports a PG16 grammar version (>= 160000, < 170000)', function () {
      var pg = require('libpg-query');
      var version = pg.parseSync('select 1').version;
      expect(version).toBeGreaterThanOrEqual(160000);
      expect(version).toBeLessThan(170000);
    });
  });

  // ─── Corpus size guard ────────────────────────────────────────────────

  describe('corpus size guard', function () {
    it('has at least 90 R cases and at least 20 A cases', function () {
      var rCount = cases.filter(function (c) { return c.expect === 'R'; }).length;
      var aCount = cases.filter(function (c) { return c.expect === 'A'; }).length;
      expect(rCount).toBeGreaterThanOrEqual(90);
      expect(aCount).toBeGreaterThanOrEqual(20);
    });
  });

  // ─── Full corpus, driven by it.each ──────────────────────────────────

  describe('checkSql — corpus', function () {
    cases.forEach(function (c) {
      var label = c.expect + ' | ' + c.src + ' | ' + c.name;
      it(label, function () {
        var violations = allowlist.checkSql(c.sql);
        if (c.expect === 'R') {
          expect(violations.length).toBeGreaterThan(0);
        } else {
          expect(violations).toEqual([]);
        }
      });
    });
  });

  // ─── Rule-category assertions by case id ─────────────────────────────

  describe('checkSql — rule categories', function () {
    it('CR-01b and WR-01-backslash (both contain a backslash) -> rule backslash', function () {
      expect(rulesOf(allowlist.checkSql(caseById('CR-01b').sql))).toContain('backslash');
      expect(rulesOf(allowlist.checkSql(caseById('WR-01-backslash').sql))).toContain('backslash');
    });

    it('CR-01a (no backslash; Postgres reads it as one identifier) -> statement-not-allowed (SelectStmt, DropStmt)', function () {
      var rules = rulesOf(allowlist.checkSql(caseById('CR-01a').sql));
      expect(rules).toContain('statement-not-allowed');
      expect(rules.length).toBeGreaterThanOrEqual(2);
    });

    it('WR-01-scs-set (SET standard_conforming_strings) -> statement-not-allowed (VariableSetStmt)', function () {
      expect(rulesOf(allowlist.checkSql(caseById('WR-01-scs-set').sql))).toContain('statement-not-allowed');
    });

    it('CR-02a (function body as string + SELECT) -> statement-not-allowed (CreateFunctionStmt)', function () {
      expect(rulesOf(allowlist.checkSql(caseById('CR-02a').sql))).toContain('statement-not-allowed');
    });

    it('CR-02b (procedure body as string + CALL) -> statement-not-allowed (CreateFunctionStmt, CallStmt)', function () {
      var rules = rulesOf(allowlist.checkSql(caseById('CR-02b').sql));
      expect(rules).toContain('statement-not-allowed');
      expect(rules.length).toBeGreaterThanOrEqual(2);
    });

    it('CR-03 (body tokenizer error swallowed) -> statement-not-allowed', function () {
      expect(rulesOf(allowlist.checkSql(caseById('CR-03').sql))).toContain('statement-not-allowed');
    });

    it('CR-04 (U&"balance" TYPE change) -> alter-not-allowed', function () {
      expect(rulesOf(allowlist.checkSql(caseById('CR-04').sql))).toContain('alter-not-allowed');
    });

    it('CREATE TABLE postgres.gift_cards -> schema-not-public', function () {
      expect(rulesOf(allowlist.checkSql(caseById('schema-shadow').sql))).toContain('schema-not-public');
    });

    it('ALTER TABLE g ADD COLUMN x int DEFAULT wipe() -> function-not-allowed', function () {
      expect(rulesOf(allowlist.checkSql(caseById('fn-default').sql))).toContain('function-not-allowed');
    });

    it('INSERT ... RETURNING * -> insert-shape', function () {
      expect(rulesOf(allowlist.checkSql(caseById('insert-returning').sql))).toContain('insert-shape');
    });

    it('INSERT ... SELECT -> insert-shape', function () {
      expect(rulesOf(allowlist.checkSql(caseById('insert-select').sql))).toContain('insert-shape');
    });

    it('ALTER TYPE mood RENAME VALUE -> enum-rename', function () {
      expect(rulesOf(allowlist.checkSql(caseById('enum-rename').sql))).toContain('enum-rename');
    });

    it('select ( -> parse-error', function () {
      var parseErrorCase = cases.filter(function (c) { return c.name === 'parse error: select ('; })[0];
      expect(rulesOf(allowlist.checkSql(parseErrorCase.sql))).toContain('parse-error');
    });

    it('no Up marker -> missing-up-marker', function () {
      var noMarkerCase = cases.filter(function (c) { return c.name === 'missing Up marker'; })[0];
      expect(rulesOf(allowlist.checkSql(noMarkerCase.sql))).toContain('missing-up-marker');
    });

    it('owner decision 2: CREATE TRIGGER ... EXECUTE FUNCTION -> statement-not-allowed', function () {
      expect(rulesOf(allowlist.checkSql(caseById('policy-trigger').sql))).toContain('statement-not-allowed');
    });

    it('owner decision 2: benign plpgsql CREATE FUNCTION -> statement-not-allowed', function () {
      expect(rulesOf(allowlist.checkSql(caseById('policy-plpgsql').sql))).toContain('statement-not-allowed');
    });

    it('owner decision 2: CREATE PROCEDURE -> statement-not-allowed', function () {
      var c = cases.filter(function (x) { return x.name === 'CREATE PROCEDURE ... LANGUAGE sql'; })[0];
      expect(rulesOf(allowlist.checkSql(c.sql))).toContain('statement-not-allowed');
    });

    it('owner decision 2: DO block -> statement-not-allowed', function () {
      var c = cases.filter(function (x) { return x.name === 'DO block'; })[0];
      expect(rulesOf(allowlist.checkSql(c.sql))).toContain('statement-not-allowed');
    });

    it('owner decision 2: CALL -> statement-not-allowed', function () {
      var c = cases.filter(function (x) { return x.name === 'CALL'; })[0];
      expect(rulesOf(allowlist.checkSql(c.sql))).toContain('statement-not-allowed');
    });
  });

  // ─── Up/Down section handling ─────────────────────────────────────────

  describe('checkSql — Up/Down section handling', function () {
    it('destructive SQL only in the Down section -> []', function () {
      var sql = '-- Up Migration\ncreate table x (id serial primary key);\n-- Down Migration\ndrop table x;\n';
      expect(allowlist.checkSql(sql)).toEqual([]);
    });

    it('down-before-up: Up runs to EOF (the drop after Up is rejected)', function () {
      var c = cases.filter(function (x) { return x.name === 'down-before-up then drop c'; })[0];
      expect(allowlist.checkSql(c.sql).length).toBeGreaterThan(0);
    });

    it('a mid-line "-- down migration notes" comment does not end the Up section', function () {
      var c = cases.filter(function (x) { return x.name === 'mid-line "-- down migration notes"'; })[0];
      expect(allowlist.checkSql(c.sql).length).toBeGreaterThan(0);
    });
  });

  // ─── Trailing-semicolon mirror ─────────────────────────────────────────

  describe('checkSql — trailing-semicolon mirror (node-pg-migrate parity)', function () {
    it('Up-only, no semicolon, destructive statement is rejected', function () {
      var c = cases.filter(function (x) { return x.name === 'raw Up-only file, no trailing semicolon, drop table x'; })[0];
      expect(allowlist.checkSql(c.sql).length).toBeGreaterThan(0);
    });

    it('Up-only, no semicolon, additive statement is accepted', function () {
      var c = cases.filter(function (x) { return x.name === 'raw Up-only file, no trailing semicolon, create table x'; })[0];
      expect(allowlist.checkSql(c.sql)).toEqual([]);
    });
  });

  // ─── Comment-only Up section ───────────────────────────────────────────

  describe('checkSql — comment-only Up section', function () {
    it('accepts an Up section with markers but no statements', function () {
      var c = cases.filter(function (x) { return x.name === 'comment-only Up section'; })[0];
      expect(allowlist.checkSql(c.sql)).toEqual([]);
    });
  });

  // ─── Not initialised ────────────────────────────────────────────────────

  describe('checkSql — not initialised', function () {
    it('throws an error containing "call ready() first" when ready() has not resolved', function () {
      var script = "var a = require(" + JSON.stringify(path.join(__dirname, '..', 'scripts', 'migration-allowlist.js')) + ");" +
        "try { a.checkSql('-- Up Migration\\ncreate table x (id int);'); } " +
        "catch (e) { process.stdout.write(e.message); }";
      var result = childProcess.spawnSync('node', ['-e', script], { encoding: 'utf8' });
      expect(result.stdout).toMatch(/call ready\(\) first/);
    });
  });

  // ─── CLI ────────────────────────────────────────────────────────────────

  describe('CLI', function () {
    it('exits 0 and prints "additive-only OK" for a clean migrations dir', function () {
      var dir = tmpDir();
      writeFile(dir, '0001_init.sql', fs.readFileSync(path.join(__dirname, '..', 'migrations', '0001_init.sql'), 'utf8'));

      var result = childProcess.spawnSync('node', [SCRIPT, dir], { encoding: 'utf8' });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('migration-allowlist: 1 file(s) additive-only OK');
    });

    it('exits 1 with a statement-not-allowed line for a dir with a destructive Up statement', function () {
      var dir = tmpDir();
      writeFile(dir, '0001_bad.sql', '-- Up Migration\ndrop table x;\n-- Down Migration\nselect 1;\n');

      var result = childProcess.spawnSync('node', [SCRIPT, dir], { encoding: 'utf8' });
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/0001_bad\.sql: statement-not-allowed:/);
    });

    it('exits 1 with a non-sql-file line for a non-.sql migration file', function () {
      var dir = tmpDir();
      writeFile(dir, '0001_init.sql', fs.readFileSync(path.join(__dirname, '..', 'migrations', '0001_init.sql'), 'utf8'));
      writeFile(dir, '0002_x.js', 'module.exports = {};');

      var result = childProcess.spawnSync('node', [SCRIPT, dir], { encoding: 'utf8' });
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/0002_x\.js: non-sql-file:/);
    });

    it('ignores a subdirectory (IN-02) alongside a clean .sql file', function () {
      var dir = tmpDir();
      writeFile(dir, '0001_init.sql', fs.readFileSync(path.join(__dirname, '..', 'migrations', '0001_init.sql'), 'utf8'));
      fs.mkdirSync(path.join(dir, 'archive'));

      var result = childProcess.spawnSync('node', [SCRIPT, dir], { encoding: 'utf8' });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('additive-only OK');
    });

    it('ignores a subdirectory even when its name matches *.sql, with no stack trace', function () {
      var dir = tmpDir();
      writeFile(dir, '0001_init.sql', fs.readFileSync(path.join(__dirname, '..', 'migrations', '0001_init.sql'), 'utf8'));
      fs.mkdirSync(path.join(dir, 'x.sql'));

      var result = childProcess.spawnSync('node', [SCRIPT, dir], { encoding: 'utf8' });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('additive-only OK');
      expect(result.stderr).not.toMatch(/at Object|at Module|\.js:\d+:\d+/);
    });

    it('exits 1 with a leading "migration-allowlist: " line for a non-existent dir', function () {
      var dir = path.join(os.tmpdir(), 'migration-allowlist-does-not-exist-' + Date.now());
      var result = childProcess.spawnSync('node', [SCRIPT, dir], { encoding: 'utf8' });
      expect(result.status).toBe(1);
      expect(result.stderr.indexOf('migration-allowlist: ')).toBe(0);
    });
  });
});
