'use strict';

/**
 * Regression tests for the NUL-byte pre-parse gate in
 * scripts/migration-allowlist.js (83-REVIEW WR-01).
 *
 * libpg-query's C parser (compiled to WASM) treats input as NUL-terminated,
 * so `CREATE TABLE ok (a int);\0DROP TABLE gift_cards;` parses as a lone
 * CreateStmt and checkSql() would otherwise return [] (accept) — silently
 * hiding everything after the NUL from the allowlist. This file is NEW
 * (owner constraint): the existing allowlist test files and fixtures
 * (__tests__/migration-allowlist.test.js, migration-allowlist-wiring.test.js,
 * fixtures/migration-allowlist-cases.js) are untouched.
 */

var fs = require('fs');
var os = require('os');
var path = require('path');
var childProcess = require('child_process');

var allowlist = require('../scripts/migration-allowlist');

var SCRIPT = path.join(__dirname, '..', 'scripts', 'migration-allowlist.js');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'migration-allowlist-nul-test-'));
}

function rulesOf(violations) {
  return violations.map(function (v) { return v.rule; });
}

describe('migration-allowlist — NUL-byte pre-parse gate (83-REVIEW WR-01)', function () {
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

  it('rejects a NUL byte hiding a DROP after an accepted CREATE TABLE', function () {
    var sql = '-- Up Migration\nCREATE TABLE ok (a int);\0DROP TABLE gift_cards;\n';
    var violations = allowlist.checkSql(sql);
    expect(violations.length).toBe(1);
    expect(violations[0].rule).toBe('nul-byte');
  });

  it('rejects the 83-REVIEW payload (CREATE TABLE + NUL + CREATE OR REPLACE FUNCTION)', function () {
    var sql = '-- Up Migration\n' +
      'CREATE TABLE ok (a int);' +
      '\0' +
      "CREATE OR REPLACE FUNCTION existing_trigger_fn() RETURNS trigger LANGUAGE plpgsql AS 'begin return null; end';\n";
    expect(rulesOf(allowlist.checkSql(sql))).toContain('nul-byte');
  });

  it('rejects a NUL as the very first character of the Up section', function () {
    var sql = '-- Up Migration\n\0CREATE TABLE ok (a int);\n';
    expect(rulesOf(allowlist.checkSql(sql))).toContain('nul-byte');
  });

  it('rejects a NUL as the very last character of the Up section', function () {
    var sql = '-- Up Migration\nCREATE TABLE ok (a int);\n\0';
    expect(rulesOf(allowlist.checkSql(sql))).toContain('nul-byte');
  });

  it('rejects with nul-byte (not backslash) when the Up section has both a NUL and a backslash', function () {
    var sql = '-- Up Migration\nCREATE TABLE ok (a int);\0\\drop table x;\n';
    var rules = rulesOf(allowlist.checkSql(sql));
    expect(rules).toContain('nul-byte');
    expect(rules).not.toContain('backslash');
  });

  it('does not trigger on a NUL that appears only in the Down section', function () {
    var sql = '-- Up Migration\ncreate table x (id serial primary key);\n-- Down Migration\ndrop table x;\0\n';
    expect(allowlist.checkSql(sql)).toEqual([]);
  });

  it('accepts a NUL-free control (clean Up section)', function () {
    var sql = '-- Up Migration\nCREATE TABLE ok (a int);\n';
    expect(allowlist.checkSql(sql)).toEqual([]);
  });

  describe('CLI', function () {
    it('exits 1 with a nul-byte line for a migrations dir containing a NUL-bearing .sql file', function () {
      var dir = tmpDir();
      var sql = '-- Up Migration\nCREATE TABLE ok (a int);\0DROP TABLE gift_cards;\n-- Down Migration\nselect 1;\n';
      fs.writeFileSync(path.join(dir, '0001_nul.sql'), sql);

      var result = childProcess.spawnSync('node', [SCRIPT, dir], { encoding: 'utf8' });
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/0001_nul\.sql: nul-byte:/);
    });
  });
});
