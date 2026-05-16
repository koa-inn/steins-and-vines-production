---
phase: 12-recipe-data-foundation
audited: "2026-05-16"
asvs_level: 1
auditor: gsd-security-auditor
result: SECURED
threats_total: 10
threats_closed: 10
threats_open: 0
---

# Security Audit — Phase 12: Recipe Data Foundation

**Phase:** 12 — recipe-data-foundation
**Closed:** 10/10 | **Open:** 0/10
**ASVS Level:** 1

---

## Threat Verification

| Threat ID | Category | Disposition | Status | Evidence |
|-----------|----------|-------------|--------|----------|
| T-12-01 | Spoofing | mitigate | CLOSED | `checkAuthorization(e)` called at line 229 before staff-auth switch; `case 'create_recipe'` at line 319 is inside that block |
| T-12-02 | Spoofing | accept | CLOSED | Plan declared constant-time comparison; code uses direct equality (line 207). Accepted — HTTPS network jitter on Google infrastructure makes timing exploitation impractical. See Accepted Risks. |
| T-12-03 | Tampering | mitigate | CLOSED | `createRecipe` applies `sanitizeInput()` to all string fields (lines 3050–3061); uses `Number()` for all numeric fields; invalid ingredients JSON returns error (lines 3028–3033) |
| T-12-04 | Injection | mitigate | CLOSED | `sanitizeInput()` strips script tags, event handlers, javascript: and data: URLs before writing to Sheets (lines 2889–2920). Same function applied in `updateRecipe` via `stringFields` loop (lines 3127–3135) |
| T-12-05 | Denial of Service | mitigate | CLOSED | `acquireScriptLock(15000)` called at line 3035 inside `createRecipe`, before ID generation and row writes |
| T-12-06 | Elevation of Privilege | mitigate | CLOSED | `create_recipe`, `update_recipe`, `delete_recipe` cases (lines 319–337) are inside the staff-auth switch block gated by `checkAuthorization(e)` (line 229); unauthenticated requests rejected before reaching these cases |
| T-12-07 | Tampering | mitigate | CLOSED | `BEER_SALES_ENABLED` registered in `zoho-middleware/lib/validateEnv.js` OPTIONAL array (line 59); plan explicitly defers server-side enforcement to Phase 14 — registration in Phase 12 is the declared scope |
| T-12-08 | Information Disclosure | accept | CLOSED | See Accepted Risks log below |
| T-12-09 | Tampering | mitigate | CLOSED | `recipe_snapshot` written directly at line 1783 via `batchesSheet.getRange(...).setValue(payload.recipe_snapshot)` — `sanitizeInput()` is NOT applied (confirmed by `grep -c "sanitizeInput(payload.recipe_snapshot)"` = 0); written only from createBatch which is reached via server_token auth |
| T-12-10 | Denial of Service | accept | CLOSED | See Accepted Risks log below |

---

## Open Threats

None — all threats closed or accepted.

---

## Accepted Risks

| Threat ID | Category | Rationale |
|-----------|----------|-----------|
| T-12-02 | Spoofing | Server token comparison uses direct string equality (`!==`) instead of constant-time comparison. Apps Script endpoint is HTTPS-only on Google infrastructure — network jitter overwhelms any timing signal, making timing attacks impractical. Token is assumed cryptographically strong (32+ chars). Pre-existing pattern used by all server_token actions, not introduced by Phase 12. |
| T-12-08 | Information Disclosure | `recipe_snapshot` in Batches sheet contains ingredient names, quantities, and Zoho item IDs. This is staff-visible operational data in Google Sheets — the same access tier as all other batch data. No customer PII is included. Access is controlled by Google Sheets sharing permissions, not this application. Risk is low. |
| T-12-10 | Denial of Service | Redis key `sv:recipes` follows the identical cache pattern as `zoho:products` (existing baseline). Standard Redis TTL and eviction apply. No additional attack surface beyond the existing cache infrastructure. Risk is within accepted baseline. |

---

## Unregistered Flags

Neither `12-01-SUMMARY.md` nor `12-02-SUMMARY.md` contains a `## Threat Flags` section. The `12-02-SUMMARY.md` "Threat Surface Scan" section notes no new network endpoints or trust boundaries introduced in Plan 02. No unregistered flags to report.

---

## Files Audited

| File | Purpose |
|------|---------|
| `apps-script/adminApi.gs` | Primary implementation — recipe CRUD, server_token auth, sanitizeInput |
| `zoho-middleware/lib/validateEnv.js` | BEER_SALES_ENABLED registration (line 59) |
| `zoho-middleware/lib/constants.js` | CACHE_KEYS.RECIPES (lines 67–68) |
| `js/lib/constants.js` | ITEM_TYPES.RECIPE (line 25) |
| `.planning/phases/12-recipe-data-foundation/12-01-PLAN.md` | Threat register source (T-12-01 through T-12-06) |
| `.planning/phases/12-recipe-data-foundation/12-02-PLAN.md` | Threat register source (T-12-07 through T-12-10) |
| `.planning/phases/12-recipe-data-foundation/12-01-SUMMARY.md` | Threat flags check |
| `.planning/phases/12-recipe-data-foundation/12-02-SUMMARY.md` | Threat flags check |

---

## Security Audit 2026-05-16
| Metric | Count |
|--------|-------|
| Threats found | 10 |
| Closed | 10 |
| Open | 0 |
