'use strict';

// Regression guard for the v4.2 cross-phase BLOCKER (DEPLOY-03 / PII-01).
//
// Phase 32 added /api/snapshot to PII_GET_ROUTES and mounted requirePiiApiKey on it
// (zoho-middleware/server.js). Phase 33's nightly update-snapshot.yml fetched that
// route with NO x-api-key header, so once P32 went live the nightly run started
// returning HTTP 403 -> the production snapshot silently went stale.
//
// This test asserts the workflow authenticates the snapshot fetch. It must keep
// passing: if anyone removes the x-api-key header again, the prod snapshot breaks.

var fs = require('fs');
var path = require('path');

var WORKFLOW = path.join(__dirname, '..', '..', '.github', 'workflows', 'update-snapshot.yml');

describe('update-snapshot.yml authenticates the /api/snapshot fetch', function () {
  var yml = fs.readFileSync(WORKFLOW, 'utf8');

  test('fetches /api/snapshot from the production middleware', function () {
    expect(yml).toContain('/api/snapshot');
  });

  test('sends an x-api-key header on the snapshot curl (or the fetch 403s)', function () {
    // The middleware guard (server.js requirePiiApiKey) reads req.headers['x-api-key'].
    expect(yml).toMatch(/x-api-key:\s*\$\{\{\s*secrets\.MW_API_KEY\s*\}\}/);
  });

  test('the x-api-key header is on the same curl that fetches the snapshot', function () {
    // Isolate the "Fetch snapshot from middleware" step and assert both the header
    // and the snapshot URL live inside it — guards against the header drifting onto
    // an unrelated request.
    var fetchStep = yml.split(/- name:\s/).find(function (block) {
      return /Fetch snapshot from middleware/.test(block);
    });
    expect(fetchStep).toBeDefined();
    expect(fetchStep).toMatch(/x-api-key/);
    expect(fetchStep).toContain('/api/snapshot');
  });

  describe('production cross-push is CNAME-safe', function () {
    // gated-deploy.yml force-pushes production main (CNAME = steinsandvines.ca).
    // The snapshot job must build a snapshot-only commit on top of production's own
    // main, never push staging's tree, and never --force — otherwise it overwrites
    // production's CNAME and 404s the live site.
    var pushStep = yml.split(/- name:\s/).find(function (block) {
      return /Commit and push to both repos/.test(block);
    });

    test('the push step exists', function () {
      expect(pushStep).toBeDefined();
    });

    test('never force-pushes to the production repo', function () {
      // Any --force aimed at production would clobber its CNAME/deploy history.
      expect(pushStep).not.toMatch(/production\.git[^\n]*--force/);
      expect(pushStep).not.toMatch(/--force[^\n]*production\.git/);
    });

    test('fetches production main and builds on it (no staging-tree cross-push)', function () {
      // Must fetch prod main and push a branch built from it, not push staging HEAD.
      expect(pushStep).toMatch(/git fetch .*main/);
      expect(pushStep).toMatch(/prod-snapshot:main/);
      expect(pushStep).not.toMatch(/production\.git\s+HEAD:main/);
    });
  });
});
