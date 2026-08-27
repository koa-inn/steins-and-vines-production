# Phase 76: BrewPad session-expiry hardening - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-27
**Phase:** 76-brewpad-session-expiry-hardening-decouple-the-durable-7-day-
**Areas discussed:** Scope of fix #4, Degraded/reconnect UX, Apps-Script redeploy signal, How #1-3 relate to #4, Readiness

---

## Scope of fix #4 (single-credential unification)

| Option | Description | Selected |
|--------|-------------|----------|
| Defer #4 — ship #1-3 now | Frontend-only credential-clearing fixes; capture #4 as its own follow-up phase | |
| Fold #4 in — do the full cure | Migrate Apps-Script admin reads behind the middleware; run on ONE credential; touches middleware + Apps-Script | ✓ |

**User's choice:** Fold #4 in — do the full cure.
**Notes:** Owner wants the root-cause fix, accepting the larger full-stack scope.

---

## Degraded / reconnect UX (Google token dies, sv_session valid)

| Option | Description | Selected |
|--------|-------------|----------|
| Silent auto-refresh, banner only on failure | Background GIS refresh; non-blocking reconnect banner only if it fails; recipes keep working | ✓ |
| Always show a reconnect affordance | Banner on any Apps-Script 401, no silent-refresh attempt first | |
| Keep full-screen modal, just don't wipe sv_session | Blocking overlay but one-click reconnect | |

**User's choice:** Silent auto-refresh, banner only on failure.
**Notes:** Later superseded — see "How #1-3 relate to #4": largely MOOT under the full migration.

---

## Apps-Script redeploy signal (tightening isUnauthorizedError)

| Option | Description | Selected |
|--------|-------------|----------|
| Have the researcher determine this | Research inspects adminApi.gs response shapes to decide if a frontend-only signal exists or a redeploy is needed | ✓ |
| Assume frontend-only — no redeploy | Constrain to existing distinguishable responses | |
| I'll redeploy Apps-Script if needed | Owner adds a structured auth-failure flag + redeploys | |

**User's choice:** Have the researcher determine this.

---

## How #1-3 relate to #4

| Option | Description | Selected |
|--------|-------------|----------|
| Migrate fully, then delete the dual-token machinery | One credential end-to-end; Google only at login; remove silent-refresh/Apps-Script-401 paths | ✓ |
| Migrate data reads, but keep #1-3 as a safety net | Keep hardened credential logic as defense-in-depth | |
| Phase it: ship #1-3 first, migrate incrementally | Land frontend hardening first, migrate endpoint-by-endpoint | |

**User's choice:** Migrate fully, then delete the dual-token machinery.
**Notes:** This makes the reconnect UX (D-04) and isUnauthorizedError tightening (D-05) largely unnecessary — kept only if research finds a residual runtime Google-token dependency.

---

## Readiness

**User's choice:** Write CONTEXT.md — hand migration mechanics + the authz-model verification to the research step.

## Claude's Discretion

- Middleware shape: per-action endpoints vs a single authenticated Apps-Script proxy — deferred to researcher/planner.
- Whether any Apps-Script redeploy is needed — deferred to researcher.

## Deferred Ideas

- Reconnect-banner UX / isUnauthorizedError tightening — only if a residual runtime Google-token dependency survives migration.
- Cloudflare Access session-duration policy for staging — owner non-code action.
