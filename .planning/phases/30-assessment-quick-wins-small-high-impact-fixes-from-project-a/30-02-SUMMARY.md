---
phase: 30-assessment-quick-wins-small-high-impact-fixes-from-project-a
plan: "02"
subsystem: repo-hygiene
tags: [github-pages, deploy, gitignore, security, planning]
dependency_graph:
  requires: []
  provides: [.planning-not-served-publicly, CNAME-untracked]
  affects: [.github/workflows/deploy-production.yml, _config.yml, .gitignore]
tech_stack:
  added: []
  patterns: [build-time-artifact-strip, jekyll-exclude, git-rm-cached]
key_files:
  created:
    - _config.yml
  modified:
    - .github/workflows/deploy-production.yml
decisions:
  - "[30-02]: Build-time rm -rf .planning is the authoritative prod mechanism — Jekyll exclude is bypassed by auto-injected .nojekyll on prod artifact"
  - "[30-02]: CNAME-swap deploy dance retired — prod deploy is now plain git push production main --force; enforce-cname.yml auto-pins domain"
  - "[30-02]: CNAME was already in .gitignore (line 44) — no .gitignore edit required for Task 2"
metrics:
  duration: ~5min
  completed_date: "2026-06-15"
  tasks_completed: 2
  tasks_total: 3
  files_changed: 3
---

# Phase 30 Plan 02: Repo Hygiene (.planning/ exclusion + CNAME untrack) Summary

Build-time artifact strip in deploy-production.yml removes `.planning/` from the prod Pages artifact; `_config.yml` Jekyll exclude covers the staging path; CNAME untracked from git while local file preserved and enforce-cname.yml continues auto-pinning both domains.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Exclude .planning/ from published artifact (D-01, #15) | ba58c47 | .github/workflows/deploy-production.yml, _config.yml |
| 2 | Untrack CNAME from git (#16) | 2e5856e | CNAME (deleted from index) |

## What Was Built

### Task 1: .planning/ excluded from published site

- **deploy-production.yml**: Added `rm -rf .planning` step after `actions/checkout@v4` and before `actions/upload-pages-artifact@v3`. This strips `.planning/` from the Pages artifact at build time. This is the REQUIRED mechanism for prod — `actions/upload-pages-artifact` auto-injects `.nojekyll` into the artifact which bypasses Jekyll entirely on prod, meaning a `_config.yml exclude:` would have no effect on the prod artifact.
- **_config.yml**: Created at repo root with `exclude: [.planning/, PROJECT_ASSESSMENT.md, ...]`. This covers the staging path where classic-Jekyll runs without `.nojekyll`. Defense-in-depth; not the sole/primary mechanism.
- **D-01 satisfied**: `.planning/` remains fully tracked in git (`git ls-files .planning/STATE.md` returns the path). Only the published artifact loses the directory — version-controlled planning history is intact.

### Task 2: CNAME untracked

- `git rm --cached CNAME` removed CNAME from git index while preserving the local file on disk.
- `.gitignore` already contained `CNAME` on line 44 — no edit required.
- `enforce-cname.yml` self-heals the domain after every push to either repo (staging → `staging.steinsandvines.ca`, production → `steinsandvines.ca`).
- CNAME-swap deploy dance is **retired**. The old dance (set CNAME to steinsandvines.ca → push production → restore) is no longer needed. Prod deploy is now simply `git push production main --force`.

## Deployment Status

**Staging push: DEFERRED to human checkpoint**

Per `<staging_deploy_checkpoints>`, staging and prod pushes are collected into a single human checkpoint at phase end. The orchestrator will coordinate the consolidated deploy gate.

Verification steps for the human checkpoint (Task 3):
1. Run full test gate: `npm test` AND `cd zoho-middleware && npm test` AND `npm run lint` (all green — confirmed locally)
2. CNAME on disk reads `staging.steinsandvines.ca` — confirmed locally
3. `git push origin main`
4. Wait for Pages build, then confirm `https://staging.steinsandvines.ca/.planning/STATE.md` returns 404
5. Confirm staging site loads (home, a product page) and custom domain intact
6. `git push production main --force`
7. Confirm `https://steinsandvines.ca/.planning/STATE.md` returns 404 (build-time strip path)
8. Confirm `.planning/` still git-tracked: `git ls-files .planning | head`

## Deviations from Plan

None — plan executed exactly as written.

The `.gitignore` already contained `CNAME` (CLAUDE.md memory was accurate). Task 2 only required `git rm --cached CNAME`.

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes introduced. T-30-02-I (information disclosure) mitigated by build-time artifact strip. T-30-02-D (domain pinning) mitigated by staging-first sequencing with enforce-cname.yml.

## Self-Check: PASSED

- `ba58c47` exists: confirmed
- `2e5856e` exists: confirmed
- `.github/workflows/deploy-production.yml` contains `rm -rf .planning`: confirmed
- `_config.yml` exists at repo root: confirmed
- `git ls-files CNAME` returns nothing (untracked): confirmed
- `CNAME` file exists on disk with content `staging.steinsandvines.ca`: confirmed
- `.gitignore` contains `CNAME`: confirmed (line 44)
- `.planning/STATE.md` still tracked: confirmed
