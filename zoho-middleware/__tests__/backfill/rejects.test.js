'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var rejects = require('../../scripts/backfill/rejects');

var REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
var TMP_DIR;

beforeEach(function () {
  TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-rejects-test-'));
});

afterEach(function () {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

describe('DEFAULT_OUT_DIR', function () {
  test('is outside the repo, under the home directory', function () {
    expect(rejects.DEFAULT_OUT_DIR).toBe(path.join(os.homedir(), 'sv-backfill'));
  });
});

describe('assertSafePath', function () {
  test('throws for a path inside a tracked repo directory (zoho-middleware/scripts)', function () {
    var p = path.join(REPO_ROOT, 'zoho-middleware', 'scripts', 'x.json');
    expect(function () { rejects.assertSafePath(p); }).toThrow();
  });

  test('does not throw for a path inside zoho-middleware/backfill-output/', function () {
    var p = path.join(REPO_ROOT, 'zoho-middleware', 'backfill-output', 'x.json');
    expect(function () { rejects.assertSafePath(p); }).not.toThrow();
  });

  test('does not throw for a path under os.tmpdir()', function () {
    var p = path.join(os.tmpdir(), 'x.json');
    expect(function () { rejects.assertSafePath(p); }).not.toThrow();
  });
});

describe('writeRejectsReport', function () {
  test('writes the documented JSON shape at mode 0600 and returns the absolute path', function () {
    var rejectRows = [{ rowNumber: 5, reasons: [{ column: 'plato', reason: 'not a finite number' }], raw: { plato: 'abc' } }];
    return rejects.writeRejectsReport({
      sheet: 'PlatoReadings',
      sourceFile: '/Users/owner/Downloads/snapshot.xlsx',
      rejects: rejectRows,
      outDir: TMP_DIR
    }).then(function (outPath) {
      expect(path.isAbsolute(outPath)).toBe(true);
      expect(fs.existsSync(outPath)).toBe(true);

      var stat = fs.statSync(outPath);
      expect(stat.mode & 0o777).toBe(0o600);

      var parsed = JSON.parse(fs.readFileSync(outPath, 'utf8'));
      expect(parsed.sheet).toBe('PlatoReadings');
      expect(parsed.sourceFile).toBe('snapshot.xlsx'); // basename only, no PII path
      expect(typeof parsed.generatedAt).toBe('string');
      expect(parsed.count).toBe(1);
      expect(parsed.rejects).toEqual(rejectRows);
    });
  });

  test('creates outDir if it does not exist', function () {
    var freshDir = path.join(TMP_DIR, 'does', 'not', 'exist', 'yet');
    return rejects.writeRejectsReport({
      sheet: 'FermSchedules',
      sourceFile: 'snap.xlsx',
      rejects: [],
      outDir: freshDir
    }).then(function (outPath) {
      expect(fs.existsSync(outPath)).toBe(true);
    });
  });

  test('rejects with no write performed when outDir is inside a tracked repo path', function () {
    var insideRepo = path.join(REPO_ROOT, 'zoho-middleware', 'scripts', 'backfill-test-output');
    return rejects.writeRejectsReport({
      sheet: 'VesselHistory',
      sourceFile: 'snap.xlsx',
      rejects: [],
      outDir: insideRepo
    }).then(
      function () { throw new Error('expected writeRejectsReport to reject'); },
      function (err) {
        expect(err).toBeTruthy();
        expect(fs.existsSync(insideRepo)).toBe(false);
      }
    );
  });
});
