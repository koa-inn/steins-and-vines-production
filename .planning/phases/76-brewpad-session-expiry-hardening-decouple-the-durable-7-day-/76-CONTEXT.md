# Phase 76: BrewPad session-expiry hardening — Context

**Gathered:** 2026-08-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Stop BrewPad from spuriously showing "Session expired" and forcing a full Google re-login while the durable 7-day server session (`sv_session`) is still valid.

**Chosen approach (locked): the full single-credential cure**, not a patch. BrewPad today runs TWO credentials:
1. Durable 7-day `sv_session` — `localStorage['sv_session_token']`, sent as the `x-session-token` header, authorizes the **Railway middleware** (recipes/ingredients).
2. Ephemeral ~1 hr **Google OAuth access token** — kept alive by GIS silent refresh (`_tokenRefreshTimer`, `js/brewpad.js:1312`), posted in-body to the **Apps-Script "admin API"** (`adminApiGet`/`adminApiPost`, `js/brewpad.js:1443`/`1471`) for batches/dashboard/readings.

The root cause: when the Google token dies (silent-refresh failure from third-party-cookie/embedded contexts) OR an Apps-Script response merely contains the substring "unauthorized" (`isUnauthorizedError`, loose match), `handleUnauthorized()` calls `clearSession()` which **deletes the still-valid `sv_session_token`** → full re-login + cascading middleware 401s.

This phase migrates BrewPad onto **one credential**: Google OAuth is used **only at login** (to mint `sv_session` via `POST /auth/google`); **all** batch/dashboard/reading data reads/writes move **behind the Railway middleware** authenticated by `x-session-token`; the middleware calls Apps-Script server-side with its existing `APPS_SCRIPT_SERVER_TOKEN`. Once migration is complete, the dual-token machinery that causes the bug is **deleted, not patched**.

**In scope:** migrate the Apps-Script admin reads/writes behind the middleware; delete the ~1hr Google-token silent-refresh timers + the Apps-Script-401 `handleUnauthorized` paths + `isUnauthorizedError`; ensure a full re-login is triggered ONLY by a middleware `x-session-token` rejection; `sv_session` renewal so the 7-day credential is sustainable as the sole token; regression tests first (per CLAUDE.md #3).

**Out of scope (new capabilities / other phases):** BrewPad batch-view UX (Phase 69 — bottled-status staleness, Ready-to-Bottle filter); any non-BrewPad surface's auth.

**Non-code owner sibling:** review the **Cloudflare Access** session-duration policy for `staging.steinsandvines.ca` (dashboard setting) if staff also re-hit the CF login often — independent of the code fix.

</domain>

<decisions>
## Implementation Decisions

### Scope of the fix (#4 fold-in)
- **D-01:** Fold roadmap fix #4 IN — do the full single-credential migration, not the frontend-only patch (#1–3 alone). Target end state: BrewPad runs on `x-session-token` end-to-end; the Google token is used only at login to mint `sv_session`.
- **D-02:** Once the migration is total, **DELETE** the dual-token machinery rather than hardening it: the ~1hr Google-token silent-refresh timers (`_tokenRefreshTimer`, `_silentRefreshTimer`), the `handleUnauthorized()`-on-Apps-Script-401 code paths, and `isUnauthorizedError`. Keep only what the login-time Google exchange (`/auth/google`) genuinely needs.

### Credential-clearing policy
- **D-03:** A full re-login (wipe `sv_session` + show the login modal) must be triggered **ONLY** by a **middleware `x-session-token` rejection** (a 401 from Railway). No Google/Apps-Script failure may ever clear `sv_session`.

### Degraded / reconnect UX
- **D-04:** Preferred behavior was "silent auto-refresh, non-blocking reconnect banner only on failure" — BUT this is expected to be **largely MOOT** under the full migration (D-01), since the browser no longer holds a runtime Google token to expire. Keep a reconnect affordance ONLY if research finds a residual runtime Google-token dependency; otherwise it is not needed.

### isUnauthorizedError tightening
- **D-05:** Expected to be **MOOT** under D-02 (the Apps-Script-401 path is deleted). If research finds any path still keys on it, replace the loose substring match with an explicit status/flag. Do NOT preserve the loose match.

### Claude's Discretion / deferred to research
- **Middleware shape:** per-action middleware endpoints vs a single authenticated Apps-Script proxy endpoint (forwarding allow-listed `{action, params}` with the server token) — researcher/planner decides, weighing code volume vs security allow-listing.
- **Apps-Script redeploy:** whether any Apps-Script change is needed (vs a pure middleware-proxy that reuses the existing server token) — researcher determines from `apps-script/adminApi.gs` and the current response shapes.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Auth model (the credential this phase consolidates onto)
- `js/brewpad.js` — the two-credential logic: `POST /auth/google` exchange + `sv_session_token` storage (`checkAuthorization`, ~line 1250-1265); `x-session-token` request interceptor (~lines 24-30); `clearSession()` (~1023); `handleUnauthorized()` (~1406); `isUnauthorizedError()` (~1438); `adminApiGet`/`adminApiPost` (~1443/1471); silent-refresh timers (`_tokenRefreshTimer` ~1312, `doSilentRefreshOnLoad` ~1098). Line numbers drift — locate by function name.
- `js/lib/auth.js` — shared GIS/Google identity primitives (`waitForGoogleIdentity`, `gsiInitTokenClient`, `fetchGoogleUserInfo`); possibly touched.
- `apps-script/adminApi.gs` — the Apps-Script "admin API" whose batch/dashboard/reading actions must move behind the middleware; researcher inventories its actions + authz + response shapes.
- `zoho-middleware/` — the Railway app that will host the new proxied endpoints; already holds `APPS_SCRIPT_SERVER_TOKEN` and calls Apps-Script server-side (see `zoho-middleware/routes/pos.js` / `lib/brewpad-integration.js` for the existing server→Apps-Script pattern). The `/auth/google` session-mint endpoint and `x-session-token` verification live here.
- `docs/RUNBOOK.md` § Phase 46 Auth Cutover Outcome — the 3-tier auth model (`sv_session` / Google-session / legacy key) this phase builds on.

### Related prior work
- Phase 46 (Auth Re-Architecture) — introduced the `sv_session`/`x-session-token` model and the `/auth/google` exchange; this phase extends it to cover BrewPad's admin reads.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`x-session-token` request interceptor** (`js/brewpad.js:24-30`): already attaches the durable session token to middleware requests — the migrated admin reads reuse this path.
- **Middleware → Apps-Script server call** (`zoho-middleware/lib/brewpad-integration.js` + `routes/pos.js`): the middleware already authenticates to Apps-Script with `APPS_SCRIPT_SERVER_TOKEN` — the new proxy endpoints extend this existing pattern rather than inventing a new one.
- **`/auth/google` exchange**: already verifies the Google token and mints `sv_session` — stays as the sole Google-token use.

### Established Patterns
- ES5-only vanilla JS in `js/brewpad.js`; rebuild `js/brewpad.min.js` via `npm run build`; `npm test` + `npm run lint` before commit (CLAUDE.md).
- Middleware endpoints authorize via `x-session-token`; Apps-Script writes go through `callAppsScriptCreateBatch`-style server calls.

### Integration Points / risks
- **Authorization shift (KEY for research):** Apps-Script currently authorizes each admin call by the caller's **Google token/email** (allowlist check). Moving reads server-side means the middleware must enforce that an `x-session-token` maps to an **authorized staff identity**. Research must confirm `sv_session` is already bound to an allowlisted staff Google identity at `/auth/google` mint time (Phase 46) so the proxy is safe — otherwise the migration needs an explicit authz binding.
- **`sv_session` as sole credential:** confirm the 7-day session has a renewal path so it doesn't itself become a new hard expiry once the Google token is gone.

</code_context>

<specifics>
## Specific Ideas

- End state the owner wants: "BrewPad runs on ONE credential" — Google only at login, all data via middleware `x-session-token`, dual-token machinery removed.
- Symptom to eliminate: the "Session expired" full-login modal appearing while `sv_session` is still valid; "Could not load recipes" cascade after a Google/Apps-Script 401.

</specifics>

<deferred>
## Deferred Ideas

- **Reconnect-banner UX (D-04) / isUnauthorizedError tightening (D-05)** — only resurface if research finds a residual runtime Google-token dependency after migration; otherwise dropped by deletion.

### Reviewed Todos (not folded)
- `beer-cider-launch-pages.md`, `brewpad-bottled-status-stale-ui.md`, `brewpad-ready-to-bottle-filter.md` — surfaced by keyword match only; unrelated to session auth (marketing pages / Phase 69 batch-view UX). Not folded.

</deferred>

---

*Phase: 76-brewpad-session-expiry-hardening-decouple-the-durable-7-day-*
*Context gathered: 2026-08-27*
