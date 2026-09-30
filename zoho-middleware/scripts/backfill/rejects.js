/**
 * Rejects report writer. Rejects contain customer PII (names, notes) — NEVER commit,
 * NEVER paste into chat. The backfill CLI prints only counts and the returned file
 * path (D-13). DEFAULT_OUT_DIR lives outside the repo entirely; the only in-repo
 * location ever allowed is the git-ignored zoho-middleware/backfill-output/ dir.
 */
'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');

var DEFAULT_OUT_DIR = path.join(os.homedir(), 'sv-backfill');

// scripts/backfill/rejects.js -> scripts -> zoho-middleware -> repo root (3 levels up).
var REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
var ALLOWED_IN_REPO_RELATIVE = path.join('zoho-middleware', 'backfill-output');

function isInside(parent, candidate) {
  var rel = path.relative(parent, candidate);
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
}

// Throws unless `p` resolves to somewhere OUTSIDE repoRoot entirely, or inside
// <repoRoot>/zoho-middleware/backfill-output/ (the one git-ignored, allowed exception).
function assertSafePath(p, opts) {
  opts = opts || {};
  var repoRoot = path.resolve(opts.repoRoot || REPO_ROOT);
  var resolved = path.resolve(p);

  if (!isInside(repoRoot, resolved)) {
    return; // outside the repo entirely — always safe (D-13)
  }

  var allowedDir = path.join(repoRoot, ALLOWED_IN_REPO_RELATIVE);
  if (!isInside(allowedDir, resolved)) {
    throw new Error(
      'refusing to write a PII-bearing backfill file inside the repo at "' + resolved +
      '" — must be outside the repo, or under ' + allowedDir + ' (D-13)'
    );
  }
}

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

function timestampSuffix(date) {
  return (
    date.getUTCFullYear() +
    pad2(date.getUTCMonth() + 1) +
    pad2(date.getUTCDate()) +
    'T' +
    pad2(date.getUTCHours()) +
    pad2(date.getUTCMinutes()) +
    pad2(date.getUTCSeconds()) +
    'Z'
  );
}

// Writes { sheet, sourceFile (basename only), generatedAt, count, rejects } to
// <outDir>/rejects-<sheet>-<YYYYMMDDTHHMMSSZ>.json, mode 0600, creating outDir if
// missing. Rejects (the Promise) with no write performed if the path is unsafe.
function writeRejectsReport(opts) {
  opts = opts || {};
  var sheet = opts.sheet;
  var sourceFile = opts.sourceFile;
  var rejects = opts.rejects || [];
  var outDir = opts.outDir || DEFAULT_OUT_DIR;

  return new Promise(function (resolve, reject) {
    try {
      var fileName = 'rejects-' + sheet + '-' + timestampSuffix(new Date()) + '.json';
      var outPath = path.join(outDir, fileName);

      assertSafePath(outPath);

      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }

      var report = {
        sheet: sheet,
        sourceFile: path.basename(sourceFile || ''),
        generatedAt: new Date().toISOString(),
        count: rejects.length,
        rejects: rejects
      };

      fs.writeFileSync(outPath, JSON.stringify(report, null, 2), { mode: 0o600 });
      resolve(path.resolve(outPath));
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  DEFAULT_OUT_DIR: DEFAULT_OUT_DIR,
  assertSafePath: assertSafePath,
  writeRejectsReport: writeRejectsReport
};
