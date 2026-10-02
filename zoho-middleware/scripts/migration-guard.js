'use strict';

/**
 * Additive-only migration guard (D-04, DB-02).
 *
 * Scans the `-- Up Migration` section of every node-pg-migrate SQL file
 * under `migrations/` for destructive statements (DROP, TRUNCATE, RENAME,
 * ALTER ... TYPE / SET DATA TYPE, DELETE, UPDATE, DO blocks, dynamic
 * EXECUTE, MERGE, ON CONFLICT ... DO UPDATE, sequence resets) and rejects
 * them. The `-- Down Migration` section is never scanned — it does not run
 * on deploy, so destructive rollback statements there are expected and
 * safe.
 *
 * This runs in two places (T-83-03-01):
 *   1. `npm test` (this file's __tests__/migration-guard.test.js and
 *      __tests__/migration-guard-hardening.test.js), so a PR catches a
 *      destructive migration before merge.
 *   2. The Railway pre-deploy container, as the first half of `npm run
 *      migrate` (see package.json + railway.toml) — even a push that
 *      skipped CI still gets rejected before node-pg-migrate ever runs.
 *
 * CommonJS, fs/path only — this script runs inside the pre-deploy container
 * AFTER `npm install --production`, so it must have ZERO devDependency
 * imports (no jest, no node-pg-migrate itself — see Pitfall 1 / T-83-03-04).
 *
 * CLI: `node scripts/migration-guard.js [dir]` (default: ../migrations)
 *   exit 0, stdout "migration-guard: N file(s) additive-only OK" — clean
 *   exit 1, one "file: rule: statement" line per violation on stderr
 *
 * --- Parsing design (83-10 hardening, CR-01/IN-01) ----------------------
 *
 * UP_MARKER_RE / DOWN_MARKER_RE are byte-identical in source and flags to
 * node-pg-migrate 9's createMigrationCommentRegex (dist/legacy/sqlMigration.js):
 *   new RegExp('^\\s*--[\\s-]*' + direction + '\\s+migration', 'im')
 * extractUpSection() mirrors that file's getActions(): both markers are
 * located with String#search() on the RAW (untokenized) text, and when the
 * Down marker is found before the Up marker (or not found at all), the Up
 * section runs to end-of-file — exactly as node-pg-migrate's own slicing
 * does. A guard scan can therefore never stop earlier than node-pg-migrate's
 * own execution does.
 *
 * tokenize() is a single left-to-right scan of the Up section (no chained
 * regex passes, which is what let a `'a--b'` string literal or an E''
 * escape desync the old comment/literal stripping). It recognises, in
 * priority order at each position: `--` line comments, `/* *\/` block
 * comments (Postgres-style nesting), E'' / e'' escape strings (backslash
 * and '' both escape, only when not preceded by an identifier char so a
 * column named fooE isn't misread), plain '' strings ('' escapes), "..."
 * quoted identifiers (replaced with the placeholder "q" so a destructive
 * keyword can never hide inside a quoted name), and $tag$ dollar-quoted
 * bodies (opaque at top level — replaced with '' — but the raw body text
 * is also collected so findDestructiveStatements can recurse into it; this
 * catches a destructive statement hidden inside a `LANGUAGE sql` function
 * body). Any construct still open at end-of-input is reported as an
 * `unterminated-token` violation: the guard fails closed rather than ever
 * guessing where an ambiguous Up section actually ends.
 *
 * Nested dollar-quoted bodies (e.g. a DO block's body, or a SQL function's
 * body) are tokenized and rule-matched recursively, but a syntax error
 * found while parsing a BODY in isolation (for example a dollar-quoted
 * *string literal* like $$'$$, whose payload is a lone apostrophe) is not
 * itself reported as unterminated-token — the outer scan already knows
 * exactly where that body starts and ends via its matching $tag$
 * delimiters, so an "unbalanced" quote inside the payload is expected,
 * safe data, not a parse-boundary risk. Only the top-level Up-section scan
 * uses unterminated constructs as a fail-closed signal.
 */

var fs = require('fs');
var path = require('path');

// Identical source + flags to node-pg-migrate's createMigrationCommentRegex.
var UP_MARKER_RE = /^\s*--[\s-]*up\s+migration/im;
var DOWN_MARKER_RE = /^\s*--[\s-]*down\s+migration/im;

function isIdentChar(ch) {
  return ch !== undefined && ch !== '' && /[A-Za-z0-9_]/.test(ch);
}

/**
 * tokenize(sql) -> { statements: string[], bodies: string[], errors: string[] }
 *
 * Single left-to-right pass. `statements` is the comment/literal-stripped
 * text split on top-level `;` (trimmed, empties dropped). `bodies` is every
 * dollar-quoted payload encountered, raw, for recursive scanning. `errors`
 * is one entry per construct ('string', 'escape-string', 'identifier',
 * 'block-comment', 'dollar-quote') still open at end-of-input.
 */
function tokenize(sql) {
  var i = 0;
  var n = sql.length;
  var cleaned = '';
  var bodies = [];
  var errors = [];

  while (i < n) {
    var ch = sql[i];
    var next = sql[i + 1];
    var prev = i > 0 ? sql[i - 1] : '';

    // `--` line comment: dropped through end of line.
    if (ch === '-' && next === '-') {
      var nl = sql.indexOf('\n', i);
      if (nl === -1) {
        i = n;
      } else {
        cleaned += '\n';
        i = nl + 1;
      }
      continue;
    }

    // `/* */` block comment, with Postgres-style nesting.
    if (ch === '/' && next === '*') {
      var depth = 1;
      var j = i + 2;
      while (j < n && depth > 0) {
        if (sql[j] === '/' && sql[j + 1] === '*') {
          depth++;
          j += 2;
        } else if (sql[j] === '*' && sql[j + 1] === '/') {
          depth--;
          j += 2;
        } else {
          j++;
        }
      }
      if (depth > 0) {
        errors.push('block-comment');
        i = n;
        continue;
      }
      cleaned += ' ';
      i = j;
      continue;
    }

    // E'' / e'' escape string — only when E is not part of a longer identifier.
    if ((ch === 'E' || ch === 'e') && next === "'" && !isIdentChar(prev)) {
      var ej = i + 2;
      var eclosed = false;
      while (ej < n) {
        if (sql[ej] === '\\') {
          ej += 2;
          continue;
        }
        if (sql[ej] === "'") {
          if (sql[ej + 1] === "'") {
            ej += 2;
            continue;
          }
          eclosed = true;
          ej += 1;
          break;
        }
        ej++;
      }
      if (!eclosed) {
        errors.push('escape-string');
        i = n;
        continue;
      }
      cleaned += "''";
      i = ej;
      continue;
    }

    // Plain '...' string literal — '' is the escaped-quote form.
    if (ch === "'") {
      var sj = i + 1;
      var sclosed = false;
      while (sj < n) {
        if (sql[sj] === "'") {
          if (sql[sj + 1] === "'") {
            sj += 2;
            continue;
          }
          sclosed = true;
          sj += 1;
          break;
        }
        sj++;
      }
      if (!sclosed) {
        errors.push('string');
        i = n;
        continue;
      }
      cleaned += "''";
      i = sj;
      continue;
    }

    // "..." quoted identifier — "" is the escaped-quote form.
    if (ch === '"') {
      var qj = i + 1;
      var qclosed = false;
      while (qj < n) {
        if (sql[qj] === '"') {
          if (sql[qj + 1] === '"') {
            qj += 2;
            continue;
          }
          qclosed = true;
          qj += 1;
          break;
        }
        qj++;
      }
      if (!qclosed) {
        errors.push('identifier');
        i = n;
        continue;
      }
      cleaned += '"q"';
      i = qj;
      continue;
    }

    // $tag$ dollar quote — only when $ is not part of a longer identifier,
    // and the optional tag does not start with a digit (so `$1` params are
    // left untouched).
    if (ch === '$' && !isIdentChar(prev)) {
      var tagMatch = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (tagMatch) {
        var tag = tagMatch[0];
        var bodyStart = i + tag.length;
        var closeIdx = sql.indexOf(tag, bodyStart);
        if (closeIdx === -1) {
          errors.push('dollar-quote');
          i = n;
          continue;
        }
        bodies.push(sql.slice(bodyStart, closeIdx));
        cleaned += "''";
        i = closeIdx + tag.length;
        continue;
      }
    }

    cleaned += ch;
    i++;
  }

  var statements = cleaned.split(';')
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s.length > 0; });

  return { statements: statements, bodies: bodies, errors: errors };
}

// Policy (83-10, CR-01 rule gaps): DO blocks and dynamic EXECUTE are
// rejected outright, with no attempt to look inside a dynamically-built
// string — the guard cannot reason about SQL assembled at runtime, and
// that kind of change belongs in migrations-manual/ with a human present.
// MERGE, upsert (ON CONFLICT ... DO UPDATE) and sequence resets are also
// rejected outright: all three can silently discard or renumber existing
// rows, and node-pg-migrate would execute any of them on deploy exactly
// like a DROP or DELETE.
//
// Order matters: first matching rule wins, so a statement that happens to
// contain more than one destructive keyword (e.g. "ALTER TABLE x DROP
// COLUMN y" — both "alter" and "drop") is reported once, under its
// most-specific applicable rule. `drop` stays ahead of `alter-type`/
// `update` so "alter table x drop column y" still reports `drop`.
var ALTER_TABLE_RE = /\balter\s+table\b/i;
var ALTER_TYPE_CLAUSE_RE = /\balter\s+(?:column\s+)?(?:"q"|[A-Za-z_]\w*)\s+(?:set\s+data\s+)?type\b/i;
var FK_REFERENTIAL_ACTION_RE = /\bon\s+(?:update|delete)\s+(?:set\s+null|set\s+default|cascade|restrict|no\s+action)\b/gi;

var RULES = [
  { name: 'do-block', test: /^do\b/i },
  { name: 'execute', test: /\bexecute\b(?!\s+(?:function|procedure)\b)/i },
  { name: 'drop', test: /\bdrop\b/i },
  { name: 'truncate', test: /\btruncate\b/i },
  { name: 'rename', test: /\brename\b/i },
  {
    name: 'alter-type',
    test: {
      test: function (statement) {
        return ALTER_TABLE_RE.test(statement) && ALTER_TYPE_CLAUSE_RE.test(statement);
      }
    }
  },
  { name: 'sequence-reset', test: /\brestart\b|\bsetval\s*\(/i },
  { name: 'merge', test: /\bmerge\s+into\b/i },
  { name: 'upsert', test: /\bon\s+conflict\b[\s\S]*\bdo\s+update\b/i },
  { name: 'delete', test: /\bdelete\s+from\b/i },
  {
    name: 'update',
    test: {
      test: function (statement) {
        // Ignore FK referential actions (ON UPDATE/DELETE SET NULL, etc.)
        // for this rule only — they are additive constraint clauses, not
        // a DML UPDATE, but they do contain the words "update" and "set".
        var withoutFkActions = statement.replace(FK_REFERENTIAL_ACTION_RE, '');
        return /\bupdate\b[\s\S]*\bset\b/i.test(withoutFkActions);
      }
    }
  }
];

/**
 * Extract the raw `-- Up Migration` section. Mirrors node-pg-migrate's
 * getActions(): both markers are located with search() on the RAW text
 * (markers are themselves `--` line comments, so they must be found before
 * any comment-stripping). When the Down marker is at or after the Up
 * marker, the Up section stops there; otherwise (no Down marker, or a Down
 * marker that appears BEFORE the Up marker) the Up section runs to EOF.
 *
 * Returns null when no `-- Up Migration` marker is present at all.
 */
function extractUpSection(sql) {
  var upStart = sql.search(UP_MARKER_RE);
  if (upStart < 0) return null;
  var downStart = sql.search(DOWN_MARKER_RE);
  return sql.slice(upStart, downStart < upStart ? undefined : downStart);
}

function matchRule(statement) {
  for (var i = 0; i < RULES.length; i++) {
    if (RULES[i].test.test(statement)) return RULES[i].name;
  }
  return null;
}

/**
 * Recursively scans a dollar-quoted body (a DO block, a SQL function body,
 * etc.) for destructive statements. Tokenizer errors found WITHIN a body
 * are intentionally not surfaced as unterminated-token violations — see
 * the header comment for why (a dollar-quoted string literal's payload is
 * expected to contain "unbalanced" quote characters as plain data).
 */
function scanBody(body) {
  var tokenized = tokenize(body);
  var violations = [];

  tokenized.statements.forEach(function (statement) {
    var rule = matchRule(statement);
    if (rule) violations.push({ statement: statement, rule: rule });
  });

  tokenized.bodies.forEach(function (nestedBody) {
    violations = violations.concat(scanBody(nestedBody));
  });

  return violations;
}

/**
 * findDestructiveStatements(sql) -> Array<{ statement: string, rule: string }>
 *
 * Scans only the Up section for destructive statements. A file with no
 * `-- Up Migration` marker is itself reported as a single violation (rule
 * `missing-up-marker`) — node-pg-migrate would otherwise silently treat the
 * whole file as a no-op Up with an unbounded Down, which is a worse failure
 * mode than refusing it outright.
 */
function findDestructiveStatements(sql) {
  var upRaw = extractUpSection(sql);
  if (upRaw === null) {
    return [{ statement: '(no -- Up Migration marker found)', rule: 'missing-up-marker' }];
  }

  var tokenized = tokenize(upRaw);
  var violations = [];

  tokenized.errors.forEach(function (kind) {
    violations.push({ statement: '(unterminated ' + kind + ')', rule: 'unterminated-token' });
  });

  tokenized.statements.forEach(function (statement) {
    var rule = matchRule(statement);
    if (rule) violations.push({ statement: statement, rule: rule });
  });

  tokenized.bodies.forEach(function (body) {
    violations = violations.concat(scanBody(body));
  });

  return violations;
}

/**
 * checkMigrationsDir(dir) -> Array<{ file: string, statement: string, rule: string }>
 * Runs findDestructiveStatements() over every `.sql` file in `dir`, sorted
 * for deterministic output.
 */
function checkMigrationsDir(dir) {
  var files = fs.readdirSync(dir)
    .filter(function (f) { return /\.sql$/i.test(f); })
    .sort();

  var violations = [];

  files.forEach(function (file) {
    var fullPath = path.join(dir, file);
    var sql = fs.readFileSync(fullPath, 'utf8');
    findDestructiveStatements(sql).forEach(function (v) {
      violations.push({ file: file, statement: v.statement, rule: v.rule });
    });
  });

  return violations;
}

module.exports = {
  findDestructiveStatements: findDestructiveStatements,
  checkMigrationsDir: checkMigrationsDir
};

if (require.main === module) {
  var targetDir = process.argv[2] || path.join(__dirname, '..', 'migrations');
  var fileCount;

  try {
    fileCount = fs.readdirSync(targetDir).filter(function (f) { return /\.sql$/i.test(f); }).length;
  } catch (e) {
    console.error('migration-guard: could not read migrations dir ' + targetDir + ': ' + e.message);
    process.exit(1);
  }

  var violations = checkMigrationsDir(targetDir);

  if (violations.length) {
    violations.forEach(function (v) {
      console.error(v.file + ': ' + v.rule + ': ' + v.statement);
    });
    console.error('migration-guard: ' + violations.length + ' violation(s) found — deploy-time migrations must be additive only (D-04).');
    process.exit(1);
  }

  console.log('migration-guard: ' + fileCount + ' file(s) additive-only OK');
  process.exit(0);
}
