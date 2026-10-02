'use strict';

/**
 * Fail-closed, parser-backed additive-only migration guard (D-04, DB-02).
 *
 * 83-GUARD-RESEARCH.md found that scripts/migration-guard.js's hand-written
 * tokenizer + regex denylist keeps losing the parser-differential game (4
 * open 83-REVIEW criticals, 5 more bypass classes found in research). This
 * module replaces that approach with a fail-closed ALLOWLIST built on the
 * real Postgres 16 grammar (`libpg-query@16.7.3`, the libpg_query C parser
 * compiled to WASM, exact-pinned in `dependencies`): a statement, ALTER
 * TABLE subcommand, expression node type or function this module does not
 * explicitly name is rejected, and so is a parse error.
 *
 * Owner decisions (83-GUARD-RESEARCH.md "Owner Decisions (2026-10-02)"):
 *   1. The old guard (scripts/migration-guard.js) stays as a first pass,
 *      unedited. This module runs AFTER it in the migrate / Railway
 *      pre-deploy chain (`npm run migrate` wiring belongs to 83-14, which
 *      depends on this plan). `__tests__/migration-guard*.test.js` are
 *      untouched (CLAUDE.md rule 10).
 *   2. CREATE FUNCTION / PROCEDURE / TRIGGER, DO and CALL are ALWAYS
 *      rejected. There is no hash-allowlist or other exception mechanism —
 *      a trigger fired by an allowed INSERT in the same migration can run
 *      an arbitrary destructive body, which a statement-level allowlist
 *      alone cannot see.
 *   3. Any backslash anywhere in the raw Up section is rejected before
 *      parsing. Backslash lexing inside a string literal depends on the
 *      server's `standard_conforming_strings` setting, which this module
 *      has no way to observe — the only safe move is to ban the character
 *      outright. Write regex character classes as `[0-9]` instead of
 *      `\d`; `E'...'` escape strings are unnecessary.
 *
 * This module is CommonJS and requires only `fs`, `path` and `libpg-query`
 * (all three are production `dependencies`) — it runs in the Railway
 * pre-deploy container AFTER `npm install --production`, so it must have
 * ZERO devDependency imports (no jest, no node-pg-migrate itself).
 *
 * Fail-closed by construction: every lookup table below is a fixed,
 * explicit allowlist. Anything not named — an unrecognised statement node,
 * ALTER TABLE subcommand, expression/aux node type, or function — is a
 * violation. A parse error is a violation. A WASM load failure in ready()
 * propagates to the CLI's catch block, which exits 1 (see bottom).
 *
 * Review follow-up (83-REVIEW WR-01, not an owner decision): any NUL byte
 * anywhere in the raw Up section is rejected before parsing, same as the
 * backslash gate — libpg_query's C parser is NUL-terminated and would
 * otherwise silently stop scanning there.
 *
 * Version pinning: the parser's major grammar version must track Railway's
 * Postgres major version. `libpg-query@16.7.3` reports AST `version:
 * 160001` (PG16), while Railway already runs PostgreSQL 18.x (checked
 * 2026-10-02): PG17/18-only syntax fails to parse and is rejected (fails
 * closed) until this package is bumped to the `pg18` dist-tag — see
 * __tests__/migration-allowlist.test.js's parser version assertion.
 *
 * CLI: `node scripts/migration-allowlist.js [dir]` (default: ../migrations)
 *   success: exit 0, stdout "migration-allowlist: N file(s) additive-only OK"
 *   failure: exit 1, one "file: rule: statement" line per violation on
 *            stderr, then a summary line
 *   internal error (WASM load failure, unreadable dir): exit 1,
 *            "migration-allowlist: " + message on stderr
 */

var fs = require('fs');
var path = require('path');
var pg = require('libpg-query');

// Byte-identical source + flags to node-pg-migrate 9's createMigrationCommentRegex
// (same as scripts/migration-guard.js lines 73-74).
var UP_MARKER_RE = /^\s*--[\s-]*up\s+migration/im;
var DOWN_MARKER_RE = /^\s*--[\s-]*down\s+migration/im;

// ─── Allowlists ────────────────────────────────────────────────────────

// Statement node types allowed, keyed by the sole top-level key of a
// libpg-query `stmt` object. A value of `1` means "always allowed"; a
// function means "allowed only when it returns true for this body".
// Everything else (CreateFunctionStmt, CreateTrigStmt, DoStmt, CallStmt,
// SelectStmt, DropStmt, TruncateStmt, DeleteStmt, UpdateStmt, MergeStmt,
// RenameStmt, RuleStmt, ViewStmt, CreatePolicyStmt, VariableSetStmt,
// AlterDatabaseSetStmt, TransactionStmt, CreateSchemaStmt,
// CreateExtensionStmt, GrantStmt, CopyStmt, LockStmt, CreateTableAsStmt,
// AlterSeqStmt, ExecuteStmt, AlterObjectSchemaStmt, ...) falls through to
// 'statement-not-allowed'. No exception or hash mechanism (owner decision 2).
var STMTS = {
  CreateStmt: 1,
  IndexStmt: 1,
  CreateSeqStmt: 1,
  CommentStmt: 1,
  CreateEnumStmt: 1,
  AlterEnumStmt: function (body) {
    return body.newVal && !body.oldVal ? true : 'enum-rename';
  },
  AlterTableStmt: function (body) {
    return body.objtype === 'OBJECT_TABLE' ? true : 'alter-not-allowed';
  },
  InsertStmt: function (body) {
    var allowedKeys = { relation: 1, cols: 1, selectStmt: 1, onConflictClause: 1, override: 1 };
    var extra = Object.keys(body).filter(function (k) {
      return !Object.prototype.hasOwnProperty.call(allowedKeys, k);
    });
    if (extra.length) return 'insert-shape';
    if (body.onConflictClause && body.onConflictClause.action !== 'ONCONFLICT_NOTHING') return 'insert-shape';
    var sel = body.selectStmt && body.selectStmt.SelectStmt;
    if (!sel || !sel.valuesLists) return 'insert-shape';
    var selAllowedKeys = { valuesLists: 1, limitOption: 1, op: 1 };
    var selExtra = Object.keys(sel).filter(function (k) {
      return !Object.prototype.hasOwnProperty.call(selAllowedKeys, k);
    });
    if (selExtra.length) return 'insert-shape';
    return true;
  }
};

// ALTER TABLE subcommands allowed. AT_ColumnDefault is allowed only when
// SETTING a default (the `def` field is present) — DROP DEFAULT has no
// `def` and is rejected. Everything else (every AT_Drop*, AT_AlterColumnType,
// AT_DetachPartition, ENABLE/DISABLE TRIGGER, RLS, ...) is 'alter-not-allowed'.
var ALTER_CMDS = {
  AT_AddColumn: 1,
  AT_AddConstraint: 1,
  AT_ValidateConstraint: 1,
  AT_SetNotNull: 1,
  AT_ColumnDefault: function (cmd) {
    return !!cmd.def;
  }
};

// Expression/auxiliary node types allowed anywhere inside an allowed
// statement's body. Checked by key name (capitalised keys are node-type
// tags in libpg-query's AST). Anything else (SubLink, SelectStmt outside
// INSERT VALUES, CommonTableExpr, RangeFunction, ...) is 'node-not-allowed'.
var NODES = {
  RangeVar: 1, ColumnDef: 1, TypeName: 1, String: 1, Integer: 1, Float: 1, Boolean: 1,
  BitString: 1, A_Const: 1, Constraint: 1, TypeCast: 1, A_Expr: 1, BoolExpr: 1, NullTest: 1,
  ColumnRef: 1, IndexElem: 1, List: 1, ResTarget: 1, CollateClause: 1, A_ArrayExpr: 1,
  CoalesceExpr: 1, SQLValueFunction: 1, DefElem: 1, FuncCall: 1, AlterTableCmd: 1,
  PartitionBoundSpec: 1, PartitionSpec: 1, PartitionElem: 1, TableLikeClause: 1,
  ObjectWithArgs: 1, CaseExpr: 1, CaseWhen: 1, MinMaxExpr: 1, SetToDefault: 1
};

// Side-effect-free built-in functions allowed (unqualified or pg_catalog.).
// `nextval` is the one exception that is not side-effect-free (it advances
// a sequence), which is accepted — it is how additive DDL mints IDs
// (e.g. `default ('GC-' || lpad(nextval('seq')::text, 6, '0'))`).
var FUNCS = {
  now: 1, nextval: 1, lpad: 1, gen_random_uuid: 1, lower: 1, upper: 1,
  btrim: 1, length: 1, char_length: 1, jsonb_typeof: 1
};

// ─── Ready / init ──────────────────────────────────────────────────────

var initialised = false;
var readyPromise = null;

function ready() {
  if (!readyPromise) {
    readyPromise = pg.loadModule().then(function () {
      initialised = true;
    });
  }
  return readyPromise;
}

// ─── AST walk ──────────────────────────────────────────────────────────

/**
 * Walks the WHOLE node (array or object), applying every allowlist rule to
 * every field — never a hand-picked subset (research lesson 1: the two
 * first-prototype misses both came from partial walks). Pushes one
 * { rule, detail } entry per violation found; the caller attaches the
 * statement index/text.
 */
function walk(node, violations) {
  if (Array.isArray(node)) {
    node.forEach(function (child) { walk(child, violations); });
    return;
  }
  if (!node || typeof node !== 'object') return;

  // Shape-based check (research lesson 2): libpg-query emits `relation`,
  // `typeName`, `pktable` etc. unwrapped, so a RangeVar-shaped object must
  // be recognised by its `relname` field, not by the key that points to it.
  if (Object.prototype.hasOwnProperty.call(node, 'relname') &&
    ((node.schemaname && node.schemaname !== 'public') || node.catalogname)) {
    violations.push({ rule: 'schema-not-public', detail: 'relation outside public schema' });
  }

  Object.keys(node).forEach(function (key) {
    var value = node[key];

    if (/^[A-Z]/.test(key)) {
      // This key is a node-type tag (e.g. { FuncCall: {...} }).
      if (!Object.prototype.hasOwnProperty.call(NODES, key)) {
        violations.push({ rule: 'node-not-allowed', detail: 'node ' + key + ' not allowed' });
        // Do not descend further into a rejected node's own payload — it
        // is already rejected; still walk sibling keys via the outer loop.
      } else {
        if (key === 'FuncCall') {
          var parts = (value.funcname || []).map(function (p) {
            return p.String && p.String.sval;
          });
          var fname = parts[parts.length - 1];
          var qualifier = parts.length > 1 ? parts[0] : null;
          if (!Object.prototype.hasOwnProperty.call(FUNCS, fname) || (qualifier && qualifier !== 'pg_catalog')) {
            violations.push({ rule: 'function-not-allowed', detail: 'function ' + parts.join('.') + ' not allowed' });
          }
        }
        if (key === 'AlterTableCmd') {
          var cmdCheck = ALTER_CMDS[value.subtype];
          var cmdOk = typeof cmdCheck === 'function' ? cmdCheck(value) : !!cmdCheck;
          if (!cmdOk) {
            violations.push({ rule: 'alter-not-allowed', detail: 'ALTER TABLE ' + value.subtype + ' not allowed' });
          }
        }
        walk(value, violations);
      }
    } else {
      if (key === 'withClause' || key === 'returningList') {
        violations.push({ rule: 'insert-shape', detail: key + ' not allowed on INSERT' });
      }
      walk(value, violations);
    }
  });
}

/**
 * checkStmt(stmt) -> Array<{ rule: string, detail: string }>
 * Judges a single libpg-query `{ stmt: { <NodeType>: body } }` entry from
 * its AST node (research lesson 4: never re-slice/re-detect from text).
 */
function checkStmt(stmt) {
  var type = Object.keys(stmt)[0];
  var body = stmt[type];
  var rule = STMTS[type];

  if (rule === undefined) {
    return [{ rule: 'statement-not-allowed', detail: 'statement ' + type + ' not allowed' }];
  }

  var ok = typeof rule === 'function' ? rule(body) : !!rule;
  if (ok !== true) {
    return [{ rule: ok, detail: (typeof ok === 'string' ? ok : 'statement ' + type) + ' not allowed' }];
  }

  // Walk the WHOLE statement body (research lesson 1) — including
  // InsertStmt, whose key-shape has already been validated above; walking
  // everything (rather than only the hand-picked VALUES fields) is the
  // robust form per the research prototype's own "must-do" list.
  var toWalk = body;
  if (type === 'InsertStmt' && body.selectStmt && body.selectStmt.SelectStmt) {
    // The SelectStmt wrapper is not itself a real top-level statement here
    // (INSERT's key-shape check above already proved it is VALUES-only) —
    // walk its own fields (valuesLists, etc.) directly instead of treating
    // the 'SelectStmt' wrapper key as a node-type tag, which would
    // otherwise be falsely rejected as an unknown node.
    toWalk = {};
    Object.keys(body).forEach(function (k) {
      toWalk[k] = k === 'selectStmt' ? body.selectStmt.SelectStmt : body[k];
    });
  }
  var violations = [];
  walk(toWalk, violations);
  return violations;
}

// ─── Up-section extraction (mirrors migration-guard.js / node-pg-migrate) ─

/**
 * Mirrors scripts/migration-guard.js's extractUpSection exactly: both
 * markers are located with search() on the RAW text, and when the Down
 * marker is at or before the Up marker (or absent), the Up section runs to
 * EOF. Returns null when no `-- Up Migration` marker is present at all.
 */
function extractUpSection(sql) {
  var upStart = sql.search(UP_MARKER_RE);
  if (upStart < 0) return null;
  var downStart = sql.search(DOWN_MARKER_RE);
  return sql.slice(upStart, downStart < upStart ? undefined : downStart);
}

/**
 * checkSql(fileText) -> Array<{ statement: string, rule: string }>
 *
 * Synchronous. Throws if ready() has not resolved — a missing init can
 * never be silently mistaken for a parse error.
 */
function checkSql(fileText) {
  if (!initialised) {
    throw new Error('migration-allowlist: call ready() first');
  }

  var upSection = extractUpSection(fileText);
  if (upSection === null) {
    return [{ statement: '(no -- Up Migration marker found)', rule: 'missing-up-marker' }];
  }

  // Pre-parse gate (83-REVIEW WR-01 follow-up): any NUL byte anywhere in the
  // raw Up section. libpg-query's C parser is NUL-terminated, so
  // `CREATE TABLE ok (a int);\0DROP TABLE gift_cards;` would otherwise parse
  // as a lone CreateStmt and everything after the NUL would go unscanned —
  // this runs before the backslash gate and before pg.parseSync.
  if (upSection.indexOf('\0') >= 0) {
    return [{
      statement: 'a NUL (\\0) byte was found in the Up section — the parser is NUL-terminated and ' +
        'stops reading there, so any statement after it would be invisible to this guard.',
      rule: 'nul-byte'
    }];
  }

  // Pre-parse gate: any backslash anywhere in the raw Up section (owner
  // decision 3). Lexing of a backslash inside a string literal depends on
  // the server's standard_conforming_strings, which this module cannot
  // observe — ban the character outright rather than guess.
  if (upSection.indexOf('\\') >= 0) {
    return [{
      statement: 'a backslash was found in the Up section — string-literal backslash lexing depends ' +
        "on the server's standard_conforming_strings setting, which this guard cannot observe. " +
        "Write regex character classes as [0-9] instead of \\d; E'...' escape strings are unnecessary.",
      rule: 'backslash'
    }];
  }

  // Mirror node-pg-migrate's pgm.sql(): append ';' when the text doesn't
  // already end with one (no trim — an Up section ending in "\n" still
  // gets ";" appended after the newline). Parse exactly this text; never
  // re-slice or re-run marker detection on it afterward.
  var textToParse = upSection;
  if (textToParse.lastIndexOf(';') !== textToParse.length - 1) {
    textToParse += ';';
  }

  var tree;
  try {
    tree = pg.parseSync(textToParse);
  } catch (e) {
    return [{ statement: 'parse error: ' + e.message, rule: 'parse-error' }];
  }

  var violations = [];
  (tree.stmts || []).forEach(function (entry, index) {
    var stmtViolations = checkStmt(entry.stmt);
    if (!stmtViolations.length) return;

    var location = entry.stmt_location || 0;
    var length = typeof entry.stmt_len === 'number' ? entry.stmt_len : textToParse.length - location;
    var rawText = textToParse.slice(location, location + length).replace(/\s+/g, ' ').trim().slice(0, 120);

    stmtViolations.forEach(function (v) {
      violations.push({
        statement: '#' + (index + 1) + ' ' + v.detail + (rawText ? ' — ' + rawText : ''),
        rule: v.rule
      });
    });
  });

  return violations;
}

// ─── Directory helpers ─────────────────────────────────────────────────

function listEntries(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).filter(function (entry) {
    return (entry.isFile() || entry.isSymbolicLink()) && !/^\./.test(entry.name);
  });
}

/**
 * checkMigrationsDir(dir) -> Array<{ file: string, statement: string, rule: string }>
 * Runs checkSql() over every non-dotfile regular file / symlink whose name
 * matches /\.sql$/i, sorted by file name. Directories are ignored (IN-02).
 */
function checkMigrationsDir(dir) {
  var files = listEntries(dir)
    .map(function (entry) { return entry.name; })
    .filter(function (name) { return /\.sql$/i.test(name); })
    .sort();

  var violations = [];
  files.forEach(function (file) {
    var fullPath = path.join(dir, file);
    var sql;
    try {
      sql = fs.readFileSync(fullPath, 'utf8');
    } catch (e) {
      violations.push({ file: file, statement: 'could not read file: ' + e.message, rule: 'unreadable-file' });
      return;
    }
    checkSql(sql).forEach(function (v) {
      violations.push({ file: file, statement: v.statement, rule: v.rule });
    });
  });

  return violations;
}

/**
 * findUnguardedFiles(dir) -> Array<{ file: string, statement: string, rule: 'non-sql-file' }>
 * Same dirent filter as checkMigrationsDir; every non-dotfile file/symlink
 * entry that does NOT match /\.sql$/i is a violation — node-pg-migrate
 * would load it (a .js migration can run arbitrary pgm.* calls) with no
 * allowlist at all. Directories are ignored (IN-02).
 */
function findUnguardedFiles(dir) {
  return listEntries(dir)
    .map(function (entry) { return entry.name; })
    .filter(function (name) { return !/\.sql$/i.test(name); })
    .sort()
    .map(function (name) {
      return {
        file: name,
        rule: 'non-sql-file',
        statement: '(non-SQL migration file — node-pg-migrate would execute it without this guard; use .sql or migrations-manual/)'
      };
    });
}

module.exports = {
  ready: ready,
  checkSql: checkSql,
  checkMigrationsDir: checkMigrationsDir,
  findUnguardedFiles: findUnguardedFiles
};

if (require.main === module) {
  var targetDir = process.argv[2] || path.join(__dirname, '..', 'migrations');

  ready()
    .then(function () {
      var entries = listEntries(targetDir);
      var violations = findUnguardedFiles(targetDir).concat(checkMigrationsDir(targetDir));

      if (violations.length) {
        violations.forEach(function (v) {
          console.error(v.file + ': ' + v.rule + ': ' + v.statement);
        });
        console.error('migration-allowlist: ' + violations.length +
          ' violation(s) found — deploy-time migrations must be additive only (D-04). Use migrations-manual/.');
        process.exit(1);
        return;
      }

      console.log('migration-allowlist: ' + entries.length + ' file(s) additive-only OK');
      process.exit(0);
    })
    .catch(function (e) {
      console.error('migration-allowlist: ' + e.message);
      process.exit(1);
    });
}
