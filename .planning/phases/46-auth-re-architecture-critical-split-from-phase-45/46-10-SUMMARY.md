---
phase: 46-auth-re-architecture-critical-split-from-phase-45
plan: 10
status: pending_execution
type: execute
autonomous: false
requirements: [AUDIT-CRITICAL-AUTH, D-46-01, D-46-04, D-46-05, D-46-07, D-46-11, D-46-12, D-46-13]
started: pending
completed: pending
---

# 46-10 SUMMARY — Auth Cutover (SCAFFOLD — fill during execution)

> **This is a scaffold.** The cutover is an owner-gated, off-hours production
> procedure. Fill each section as the corresponding runbook task completes. The
> authoritative checklist lives in `docs/RUNBOOK.md` → "Phase 46 Auth Cutover";
> the sequencing/scope context lives in `.planning/PROD-CUTOVER-v4.5-PLAN.md`.

## Context at execution time

- Prior production HEAD (rollback target): `495630177bbe60b36cffaf6f2bcf6a69425e826e`
- Deploy SHA (Stage 1 payload — `origin/main` at cutover, phases 46/47/49/52/53, **48 excluded**): `pending`
- `STAFF_EMAILS` set to: `hello@steinsandvines.ca`
- Middleware host: `svmiddleware-production.up.railway.app`

## Task 1 — Env vars + coupled prod deploy (dual-accept live)

- Go-live date/time: `pending`
- Env vars confirmed set (STAFF_EMAILS / KIOSK_DEVICE_TOKEN / SHEETS_CLIENT_ID; API_SECRET_KEY unchanged): `pending`
- `/health` result: `pending`
- Dual-accept confirmed (old key still 200 on PII-GET probe): `pending`
- Notes / deviations: `pending`

## Task 2 — Provision iPad + verify all three surfaces

- Kiosk device token provisioned + real test sale booked: `pending`
- Admin allowlisted sign-in OK / non-allowlisted denied: `pending`
- BrewPad session-auth load OK: `pending`
- Negative device-scope (kiosk token → gift-card void → 403): `pending`
- Notes / deviations: `pending`

## Task 3 — Rotate API_SECRET_KEY + confirm old key dead

- Rotation date: `pending`
- Old key now 403 (leaked key neutralized): `pending`
- No lockout (kiosk sale + admin action + BrewPad + public checkout all OK): `pending`
- `API_SECRET_KEY_PREVIOUS` canary set? / stragglers observed?: `pending`
- Retired-key disposition: `pending`

## Rollback events (if any)

- `none / pending`

## Outcome

- CRITICAL closed (leaked key dead, no lockout, public checkout intact): `pending`
- `docs/RUNBOOK.md` Outcome record filled: `pending`
- D-46-13 (interim IP allowlist): SKIPPED per decision.

## Self-Check

- [ ] Runbook Outcome record filled with real dates
- [ ] Phase 46 marked complete + SEC-02 closed in ROADMAP/REQUIREMENTS after rotation
- [ ] `.planning/PROD-CUTOVER-v4.5-PLAN.md` Stage 1 marked done; Stage 2 (Phase 48) unblocked
