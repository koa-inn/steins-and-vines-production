# Project Retrospective

Living retrospective — one section per milestone, newest first.

## Milestone: v4.2 — Payment Path Hardening & Deploy Safety

**Shipped:** 2026-06-19
**Phases:** 3 (31, 32, 33) | **Plans:** 11

### What Was Built
Honest money-path test coverage (route-level `POST /api/checkout` supertests, Helcim client + webhook HMAC tests, `routes/**` coverage floors); fail-closed hardening (reCAPTCHA, webhook secrets, Redis replay/idempotency 409, `validateEnv.js` fix); access control (API-key enforcement on PII GET routes, body-shape validation on item/tax mutations); deploy safety (test-gated `gated-deploy.yml`, `prod-YYYYMMDD-N` tags + rollback runbook); and monitoring (`/health` uptime monitor + fail-closed prod secrets).

### What Worked
- **Tests-before-hardening sequencing** (Phase 31 → 32): the safety net existed before behavior-changing fail-closed work landed, so hardening regressions would have been caught.
- **The milestone audit earned its keep.** Every phase passed in isolation, but `gsd-audit-milestone`'s cross-phase integration check caught the one real production-breaking seam (Phase 32's `/api/snapshot` API-key vs Phase 33's nightly snapshot job) that no single-phase verification could see.

### What Was Inefficient
- **The cross-phase break shipped to prod before it was caught.** Phase 32 and 33 each verified green, and the break only manifested on the next scheduled snapshot run after both were live. The DEPLOY-03 UAT validated a snapshot generated *before* the P32 hardening deploy, so the seam was invisible at UAT time.
- **Fixing the 403 unmasked a second latent failure** (prod cross-push divergence) that had been hidden behind the earlier `exit 1`. One fix surfaced the next — worth budgeting for "fix reveals adjacent breakage" during integration close-out.
- **`milestone.complete` accomplishment extraction is noisy** — it scraped one-liners across all phases (including prior milestones) and reported whole-project stats (19 phases/58 plans) instead of the milestone's 3 phases/11 plans. MILESTONES.md required a manual rewrite.

### Patterns Established
- **CNAME-safe cross-repo pushes:** never `--force` staging→production from a secondary job; build a file-scoped commit on production's own `main` so it fast-forwards and never clobbers CNAME/deploy history.
- **Workflow-file regression guards:** static Jest tests that assert a workflow sends required headers / never force-pushes to prod (`tests/frontend/snapshot-workflow-auth.test.js`).
- **Fail-closed by default** across the money path (auth, webhooks, replay guard, env validation).

### Key Lessons
- Single-phase verification is necessary but not sufficient — cross-phase integration must be audited before a milestone is declared done, especially when phases touch the same route/workflow from opposite sides (one adds a guard, another calls it unauthenticated).
- A green CI job can still hide a downstream failure if an early guard short-circuits before the failing step runs.

### Cost Observations
- Model: Opus 4.8 (single interactive session).
- Notable: most elapsed time across the milestone was deploy-pipeline archaeology (CNAME, `[skip ci]`, force-push divergence), not the code changes themselves.

---

## Cross-Milestone Trends

| Milestone | Phases | Plans | Shipped | Notable |
|-----------|--------|-------|---------|---------|
| v4.2 Payment Path Hardening & Deploy Safety | 3 | 11 | 2026-06-19 | Audit caught a cross-phase prod-breaking seam single-phase checks missed |

_Recurring theme: deploy-topology (CNAME / dual-repo / force-push / `[skip ci]`) is the project's highest-friction surface — invest in regression guards and runbooks there._
