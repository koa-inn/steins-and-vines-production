'use strict';

/**
 * Additive-only migration guard (D-04, DB-02).
 *
 * Scans the `-- Up Migration` section of every node-pg-migrate SQL file
 * under `migrations/` for destructive statements (DROP, TRUNCATE, RENAME,
 * ALTER COLUMN ... TYPE / SET DATA TYPE, DELETE, UPDATE) and rejects them.
 * The `-- Down Migration` section is never scanned — it does not run on
 * deploy, so destructive rollback statements there are expected and safe.
 *
 * This runs in two places (T-83-03-01):
 *   1. `npm test` (this file's __tests__/migration-guard.test.js), so a PR
 *      catches a destructive migration before merge.
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
 */

var fs = require('fs');
var path = require('path');

var UP_MARKER_RE = /--\s*up\s+migration/i;
var DOWN_MARKER_RE = /--\s*down\s+migration/i;

// Order matters: first matching rule wins, so a statement that happens to
// contain more than one destructive keyword (e.g. "ALTER TABLE x DROP
// COLUMN y" — both "alter" and "drop") is reported once, under its
// most-specific applicable rule.
var RULES = [
  { name: 'drop', test: /\bdrop\b/i },
  { name: 'truncate', test: /\btruncate\b/i },
  { name: 'rename', test: /\brename\b/i },
  { name: 'alter-type', test: /\balter\b[\s\S]*\bcolumn\b[\s\S]*\btype\b/i },
  { name: 'delete', test: /^\s*delete\s+from\b/i },
  { name: 'update', test: /^\s*update\s+\S+\s+set\b/i }
];

/**
 * Strip `--` line comments, block comments (slash-star ... star-slash) and
 * single-quoted string literals so destructive keywords appearing only in
 * prose or data are never mistaken for a real SQL statement.
 */
function stripCommentsAndLiterals(sql) {
  var noBlockComments = sql.replace(/\/\*[\s\S]*?\*\//g, '');
  var noLineComments = noBlockComments.replace(/--.*$/gm, '');
  // SQL standard: '' inside a literal is an escaped single quote.
  var noLiterals = noLineComments.replace(/'(?:''|[^'])*'/g, "''");
  return noLiterals;
}

/**
 * Extract the raw `-- Up Migration` section: everything after that marker,
 * up to the `-- Down Migration` marker (or end of file if there is none).
 * Markers are matched on the RAW text, before comment-stripping, since the
 * markers are themselves `--` line comments.
 *
 * Returns null when no `-- Up Migration` marker is present at all.
 */
function extractUpSection(sql) {
  var upMatch = UP_MARKER_RE.exec(sql);
  if (!upMatch) return null;
  var afterUp = sql.slice(upMatch.index + upMatch[0].length);
  var downMatch = DOWN_MARKER_RE.exec(afterUp);
  return downMatch ? afterUp.slice(0, downMatch.index) : afterUp;
}

/**
 * findDestructiveStatements(sql) -> Array<{ statement: string, rule: string }>
 *
 * Scans only the Up section (comments/literals stripped) for destructive
 * statements. A file with no `-- Up Migration` marker is itself reported
 * as a single violation (rule `missing-up-marker`) — node-pg-migrate would
 * otherwise silently treat the whole file as a no-op Up with an unbounded
 * Down, which is a worse failure mode than refusing it outright.
 */
function findDestructiveStatements(sql) {
  var upRaw = extractUpSection(sql);
  if (upRaw === null) {
    return [{ statement: '(no -- Up Migration marker found)', rule: 'missing-up-marker' }];
  }

  var cleaned = stripCommentsAndLiterals(upRaw);
  var statements = cleaned.split(';');
  var violations = [];

  statements.forEach(function (rawStatement) {
    var statement = rawStatement.trim();
    if (!statement) return;
    for (var i = 0; i < RULES.length; i++) {
      if (RULES[i].test.test(statement)) {
        violations.push({ statement: statement, rule: RULES[i].name });
        return; // one rule per statement
      }
    }
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
