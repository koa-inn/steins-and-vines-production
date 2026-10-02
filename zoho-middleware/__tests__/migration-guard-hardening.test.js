'use strict';

/**
 * Regression tests for the migration-guard hardening work (83-10, gap closure
 * for 83-REVIEW.md CR-01, CR-02, IN-01).
 *
 * __tests__/migration-guard.test.js is the pre-existing contract and MUST
 * keep passing unmodified (CLAUDE.md rule 10) — this file only adds new
 * cases, it never edits the old ones.
 */

var migrationGuard = require('../scripts/migration-guard');
var findDestructiveStatements = migrationGuard.findDestructiveStatements;

/**
 * Wraps a statement body in a standard Up/Down migration file, matching
 * __tests__/migration-guard.test.js's existing convention, unless a case
 * needs to construct the raw file itself (down-before-up, missing marker
 * variants, unterminated tokens that must stop before the Down marker).
 */
function wrapUp(body) {
  return '-- Up Migration\n' + body + '\n-- Down Migration\nselect 1;\n';
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
