---
phase: 46-auth-re-architecture-critical-split-from-phase-45
plan: 10
status: complete
type: execute
autonomous: false
requirements: [AUDIT-CRITICAL-AUTH, D-46-01, D-46-04, D-46-05, D-46-07, D-46-11, D-46-12, D-46-13]
started: 2026-07-08
completed: 2026-07-08
---

# 46-10 SUMMARY — Auth Cutover (COMPLETE 2026-07-08)

Owner-executed, off-hours production cutover. The new 3-tier auth (device-token
kiosk / Google-session admin+BrewPad / legacy key) shipped to production, all three
surfaces were verified, and `API_SECRET_KEY` was rotated — neutralizing the leaked
key. Authoritative checklist: `docs/RUNBOOK.md` → "Phase 46 Auth Cutover".

## Context

- Deploy mechanism: **Gated Production Deploy** workflow (run 28964582252), shipping
  `origin/main` → production repo `caafb19`. Excluded Phase 48 (local-only).
- Rollback target (unused): prior prod HEAD `495630177bbe60b36cffaf6f2bcf6a69425e826e`.
- `STAFF_EMAILS` = `hello@steinsandvines.ca`. Middleware host: `svmiddleware-production.up.railway.app`.

## Task 1 — Env vars + coupled deploy (dual-accept)

- Go-live: 2026-07-08. `/health` → `authenticated:true, redis:true`.
- Dual-accept confirmed: old key still 200 on PII-GET during the window.
- New middleware verified via new-only route `POST /auth/google` → 400 (exists).
- Leaked `MW_API_KEY` gone from the served `sheets-config.js` (edge).
- **Process note:** initial verification produced two false readings — a false-positive
  ("verified" on old routes) and a false-negative (probed `/api/auth/google` instead of
  the correct `/auth/google`). Corrected; the reliable markers are: served
  `sheets-config.js` has no `MW_API_KEY`, and `POST /auth/google` → 400.
- **Deploy-lag note:** setting Railway vars alone does NOT ship code — the Gated Deploy
  workflow does. A first "deployed" was only the pre-set vars; the workflow was then run.
  Pages (frontend) propagated in ~2 min; the middleware was actually live quickly (the
  "still old" reading was the wrong-path probe above).

## Task 2 — Provision iPad + verify all three surfaces

- Kiosk: cleared iPad site data → device-token prompt → pasted `KIOSK_DEVICE_TOKEN`
  (pre-set in Railway) → PIN pad → **real terminal sale booked** (after waking the
  physical Helcim terminal — an initial "Terminal error" was a sleeping terminal, not
  the cutover; `terminalPurchase` is byte-identical old→new). Customer search OK.
- Admin: Google sign-in with `hello@steinsandvines.ca` → dashboard OK.
- BrewPad: Google session → batch list OK.

## Task 3 — Rotate API_SECRET_KEY + confirm old key dead

- Rotation: 2026-07-08. Old leaked key now returns **403** (dead).
- No lockout: public checkout keyless route 200; `/health` OK; middleware still new.
- **Process note:** the new key was first pasted into `MW_API_KEY` while `API_SECRET_KEY`
  (which `getKey()` prefers) kept the old value, so the old key survived. Corrected by
  setting `API_SECRET_KEY` = new value and **deleting** `MW_API_KEY`.
- `API_SECRET_KEY_PREVIOUS` canary (46-RESEARCH Finding #6) was never implemented in
  `apiKey.js`, so rotation was a hard cutover (no grace). Safe because no served
  frontend still sends `x-api-key`.

## Outcome

- ✅ Leaked key neutralized (403), no surface locked out, public checkout intact.
- ✅ `docs/RUNBOOK.md` Outcome record filled.
- D-46-13 (interim IP allowlist): SKIPPED per decision.

## Follow-ups

- Mark Phase 46 complete + close SEC-02 in ROADMAP/REQUIREMENTS.
- `PROD-CUTOVER-v4.5-PLAN.md` Stage 1 done → Stage 2 (Phase 48 to staging + iPad UAT)
  is now UNBLOCKED (prod middleware speaks device-token).
- Consider implementing the `API_SECRET_KEY_PREVIOUS` canary for future rotations.
