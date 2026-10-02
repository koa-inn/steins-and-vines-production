'use strict';

/**
 * Pins the deploy half of D-04 (83-14): the exact `npm run migrate` / `npm run
 * migrate:guard` script strings that Railway's preDeployCommand resolves to, and
 * the railway.toml comment/command wiring around them.
 *
 * 83-13 built scripts/migration-allowlist.js but did NOT wire it into the
 * pre-deploy chain — a guard that is not in the chain protects nothing. This
 * file is part of `npm test` (default jest.config.js), so an un-wiring of the
 * allowlist fails CI and the pre-commit gate, not just a deploy.
 */

var fs = require('fs');
var path = require('path');
var childProcess = require('child_process');

var pkg = require('../package.json');

var RAILWAY_TOML_PATH = path.join(__dirname, '..', '..', 'railway.toml');

describe('migration-allowlist wiring into the pre-deploy chain (D-04, 83-14)', function () {
  it('package.json scripts.migrate chains migration-guard.js, migration-allowlist.js, then node-pg-migrate up', function () {
    expect(pkg.scripts.migrate).toBe(
      'node scripts/migration-guard.js && node scripts/migration-allowlist.js && node-pg-migrate up'
    );
  });

  it("package.json scripts['migrate:guard'] chains both guards (no node-pg-migrate)", function () {
    expect(pkg.scripts['migrate:guard']).toBe(
      'node scripts/migration-guard.js && node scripts/migration-allowlist.js'
    );
  });

  it('railway.toml preDeployCommand is unchanged: "cd zoho-middleware && npm run migrate"', function () {
    var railwayToml = fs.readFileSync(RAILWAY_TOML_PATH, 'utf8');
    expect(railwayToml).toMatch(/^preDeployCommand = "cd zoho-middleware && npm run migrate"$/m);
  });

  it('railway.toml buildCommand runs npm install --production (installs the allowlist\'s libpg-query dependency)', function () {
    var railwayToml = fs.readFileSync(RAILWAY_TOML_PATH, 'utf8');
    expect(railwayToml).toContain('npm install --production');
  });

  it('libpg-query is pinned exactly in dependencies (production), not devDependencies', function () {
    expect(pkg.dependencies['libpg-query']).toBe('16.7.3');
    expect(pkg.devDependencies).not.toHaveProperty('libpg-query');
  });

  it('npm run migrate:guard runs both guards and exits 0 against the real migrations/ dir', function () {
    var result = childProcess.spawnSync('npm', ['run', '--silent', 'migrate:guard'], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8'
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('migration-guard: ');
    expect(result.stdout).toContain('migration-allowlist: ');
  });
});
