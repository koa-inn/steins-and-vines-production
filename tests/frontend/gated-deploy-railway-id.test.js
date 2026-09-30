'use strict';

// Regression guard for the gated-deploy.yml deploy-ID capture race (found in the Phase 82
// production cutover, 2026-09-30 — see 82-10-SUMMARY.md "Notes for later phases").
//
// The "Capture Railway deploy ID" step ran `railway deployment list --limit 1` and took
// `.[0].id` immediately after the force-push — before Railway had created the new
// deployment — so RUNBOOK recorded the PREVIOUS deployment id (run 36753725754 recorded
// 1d502419…, the rollback target). The /health smoke-check shared the hazard: it could pass
// against the old instance. The fix pins the deployment to the exact production commit
// (the CNAME-swap commit Railway builds), waits for it to finish, and gates health on it.
//
// Source-shape assertions on the YAML text (same technique as snapshot-workflow-auth.test.js).

var fs = require('fs');
var path = require('path');

var WORKFLOW = path.join(__dirname, '..', '..', '.github', 'workflows', 'gated-deploy.yml');

function step(yml, nameRe) {
  return yml.split(/- name:\s/).find(function (block) { return nameRe.test(block); });
}

describe('gated-deploy.yml records the Railway deployment of THIS deploy', function () {
  var yml = fs.readFileSync(WORKFLOW, 'utf8');
  var pushStep = step(yml, /^Force-push to production repo/);
  var captureStep = step(yml, /^Capture Railway deploy ID/);
  var healthStep = step(yml, /^Smoke-check \/health/);
  var runbookStep = step(yml, /^Append deploy history to RUNBOOK\.md/);

  test('the push, capture, runbook and health steps exist', function () {
    expect(pushStep).toBeDefined();
    expect(captureStep).toBeDefined();
    expect(runbookStep).toBeDefined();
    expect(healthStep).toBeDefined();
  });

  test('the push step exposes the production commit SHA Railway builds (the CNAME commit)', function () {
    expect(pushStep).toMatch(/id:\s*push/);
    expect(pushStep).toMatch(/PROD_SHA=\$\(git rev-parse HEAD\)/);
    expect(pushStep).toMatch(/prod_sha=\$\{PROD_SHA\}.*GITHUB_OUTPUT/);
    // captured after the CNAME commit, before the local reset
    expect(pushStep.indexOf('PROD_SHA=$(git rev-parse HEAD)'))
      .toBeGreaterThan(pushStep.indexOf('git commit -m "chore: set CNAME'));
    expect(pushStep.indexOf('PROD_SHA=$(git rev-parse HEAD)'))
      .toBeLessThan(pushStep.indexOf('git reset --hard'));
  });

  test('the push step reports whether the middleware changed (no change -> no Railway deploy)', function () {
    expect(pushStep).toMatch(/middleware_changed=/);
    expect(pushStep).toMatch(/zoho-middleware/);
    expect(pushStep).toMatch(/railway\.toml/);
  });

  test('capture no longer takes whatever deployment is newest', function () {
    expect(captureStep).not.toMatch(/--limit 1\b/);
    expect(captureStep).not.toMatch(/\.\[0\]\.id/);
  });

  test('capture selects the deployment whose meta.commitHash is the production SHA', function () {
    expect(captureStep).toMatch(/steps\.push\.outputs\.prod_sha/);
    expect(captureStep).toMatch(/meta\.commitHash/);
  });

  test('capture waits for a terminal status and exposes it', function () {
    expect(captureStep).toMatch(/SUCCESS/);
    expect(captureStep).toMatch(/FAILED/);
    expect(captureStep).toMatch(/deploy_status=/);
    expect(captureStep).toMatch(/sleep\s+\d+/);
  });

  test('the health smoke-check refuses to pass unless the new deployment reached SUCCESS', function () {
    expect(healthStep).toMatch(/steps\.railway\.outputs\.deploy_status/);
    expect(healthStep).toMatch(/steps\.push\.outputs\.middleware_changed/);
  });

  test('the RUNBOOK row carries the deployment status', function () {
    expect(runbookStep).toMatch(/steps\.railway\.outputs\.deploy_status/);
  });
});
