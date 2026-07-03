---
phase: 46-auth-re-architecture-critical-split-from-phase-45
plan: 05
subsystem: kiosk-frontend-auth
tags: [auth, kiosk, device-token, security, D-46-01, D-46-02, D-46-03]
dependency_graph:
  requires: []
  provides:
    - "kiosk.js device-token gate (kioskDeviceToken/saveKioskDeviceToken)"
    - "kiosk-scoped x-device-token header on all standalone-kiosk middleware calls"
    - "narrow /api/contacts/search customer-search route usage"
  affects:
    - "js/kiosk.js (standalone kiosk frontend)"
    - "tests/frontend/kiosk-recipe-modify.test.js (T2d updated)"
tech_stack:
  added: []
  patterns:
    - "typed-in device credential in localStorage, sent as x-device-token header, replacing browser-shipped shared admin API key"
key_files:
  created:
    - tests/frontend/kiosk-device-token.test.js
  modified:
    - js/kiosk.js
    - tests/frontend/kiosk-recipe-modify.test.js
decisions:
  - "Removed the client-side kit batch review/create_batch flow (Apps-Script call depended on the deleted Google accessToken); server-side auto-creation already covers batch creation (D-01/D-02/D-03), and Phase 27's pending-batch guided-activation flow covers post-hoc start-date/vessel/schedule entry."
  - "Repurposed both 'Sign Out' affordances (shell bar + PIN lock screen) as 'Device Settings', reopening the device-token entry prompt for recovery/replacement (D-46-03), instead of removing them."
  - "Reused the existing #kiosk-signin DOM screen (previously the Google sign-in card) as the device-token entry prompt — no kiosk.html changes needed; the input/button are injected the same way the removed showSignInButton() injected its Google button."
metrics:
  duration: "~45 min"
  completed: "2026-07-02"
---

# Phase 46 Plan 05: Kiosk Device-Token Auth Migration Summary

Replaced the standalone kiosk's per-staff Google OAuth sign-in gate with a typed-in device token (localStorage-persisted, sent as `x-device-token`), migrated every kiosk middleware fetch off the leaked shared admin API key, and narrowed customer search onto the slim `/api/contacts/search` route.

## What Was Built

**Task 1 — Device-token gate replacing Google sign-in.** Removed `initGoogleAuth`, `showSignInButton`, `onTokenResponse`, `kioskCheckAuthorization`, the periodic Google token-refresh timer, `google.accounts.oauth2.revoke`, and `handleUnauthorized` from `js/kiosk.js`, along with the now-dead `adminApiGet`/`adminApiPost`/`fetchWithRetry`/`isUnauthorizedError` Apps-Script helpers and the Google-session persistence layer (`saveSession`/`loadSession`/`loadSessionRaw`/`isSessionValidForPin`/`clearSession`, `SESSION_KEY`, `SESSION_MAX_AGE`). Added `kioskDeviceToken()`/`saveKioskDeviceToken()` backed by `localStorage['sv_kiosk_device_token']`. Boot flow (`initKioskAuth`, wired from `DOMContentLoaded`): a stored token goes straight to the existing PIN lock screen (`showLockScreen({})`); an empty token shows a hidden device-token entry prompt built inside the existing `#kiosk-signin` screen (no `kiosk.html` changes — the input/Save button are injected into `#kiosk-google-signin-btn`, mirroring the removed `showSignInButton()`'s DOM-injection pattern). Both "Sign Out" affordances (shell-bar button, PIN-lock-screen button) are repurposed as "Device Settings" to reopen this prompt for recovery/replacement (D-46-03) rather than being removed.

**Task 2 — Header + customer-search migration.** All ~28 `'x-api-key': SHEETS_CONFIG.MW_API_KEY || ''` header sites (verify-pin, recipe quote/availability, gift-card lookup/next-number/void-adjacent reads, sale/confirm/status, salesorder create/update/pay, contacts create, discount preset CRUD) now send `'x-device-token': kioskDeviceToken()`. The two conditional `headers['x-api-key'] = SHEETS_CONFIG.MW_API_KEY` blocks (recipe-quote debounce fetch, ingredient-catalog fetch) became unconditional `headers['x-device-token'] = kioskDeviceToken()`. The three customer-search call sites (cart customer selector, "create sales order" customer search, new-customer-step search) now call `GET /api/contacts/search?q=` instead of `GET /api/contacts?search=`; no response-shape changes were needed since kiosk.js already only reads the slim `{contact_id, contact_name, email, phone}` fields.

**Task 3 — Test coverage.** Added `tests/frontend/kiosk-device-token.test.js` (5 tests): no-token boot shows the settings prompt (device-token input present, no Google sign-in button); saving a token via the prompt persists it and reveals the PIN lock screen; a pre-stored token skips straight to the lock screen; `kioskFetchRecipeQuote` sends `x-device-token` (never `x-api-key`); customer search hits `/api/contacts/search` (not `/api/contacts?search=`). Exported `kioskDeviceToken`, `saveKioskDeviceToken`, `initKioskAuth`, `showDeviceTokenPrompt`, `showKioskApp`, `kioskShowCustomerStep` from `kiosk.js`'s existing test-export block for direct test invocation (mirrors the file's established pattern — DOM `DOMContentLoaded` firing isn't relied on in jsdom tests here, same as existing kiosk test files).

## Verification

- `npx jest tests/frontend/kiosk-device-token.test.js` → 5/5 pass
- `grep -c "MW_API_KEY\|x-api-key" js/kiosk.js` → 0
- `npx eslint js/kiosk.js` → 0 errors (8 pre-existing `eqeqeq` warnings, unrelated to this plan, untouched lines)
- Full frontend suite (`npx jest`): 51 suites / 936 tests passing (931 pre-existing + 5 new), including the updated `kiosk-recipe-modify.test.js`
- `npm run build` intentionally NOT run (per plan objective — the single rebuild happens in 46-09)

## Deviations from Plan

### Auto-fixed / Required Adjustments

**1. [Rule 1 — Bug, discovered mid-task] Removed the client-side kit "review batches" `create_batch` flow.**
- **Found during:** Task 1, while tracing every `accessToken` reference before deleting the Google-auth state (per the task's explicit instruction to remove "any now-dead references to ... accessToken").
- **Issue:** `kioskShowBatchReview()` (shown after a kit-item kiosk sale, letting staff enter start date/vessel/schedule) POSTed directly to Google Apps Script's `create_batch` action using the per-staff Google `accessToken`, authenticated via Apps Script's own `checkAuthorization()` (a completely separate auth system from the Express middleware / `x-api-key` guard this phase otherwise targets). Removing Google auth from the standalone kiosk (as Task 1 requires) leaves this call with no way to authenticate — it would throw a `ReferenceError` on `accessToken` if left as-is (a crash, not a graceful failure), since the variable no longer exists.
- **Further investigation:** The Express middleware already auto-creates one batch per kit line item on **every** kiosk sale confirm, server-to-server, fire-and-forget (`zoho-middleware/lib/brewpad-integration.js` `createBatchesFromSale`/`callAppsScriptCreateBatch`, using a separate `APPS_SCRIPT_SERVER_TOKEN` — this is D-01/D-02/D-03 from the v1.1 "kit sale on kiosk auto-creates a batch" requirement). Apps Script's `createBatch()` (`apps-script/adminApi.gs`) has a `duplicate_so_number` dedup guard keyed on `zoho_so_number` + `product_sku` specifically because both the server auto-create path and this client-side form call the same action for the same sale — but the client-side call never included `zoho_so_number` in its payload, so the dedup guard never caught it. In current production, whenever staff filled in and saved this form, it created a **second, unlinked batch** (no `zoho_so_number` to tie it back to the invoice) in addition to the server's automatic pending batch.
- **Fix:** Removed `kioskShowBatchReview()` entirely; kit sales now go straight to the receipt like any other sale (`kioskShowReceipt(result.data, totals, items, [])`). Batch creation is unaffected in practice (the server already creates it automatically); staff now enter start date/vessel/schedule via BrewPad's existing Phase 27 pending-batch guided-activation flow instead of at kiosk checkout.
- **Files modified:** `js/kiosk.js`
- **Commit:** `1d55d4c`
- **Flagged for owner review (not silently absorbed):** this changes a staff-facing workflow (no more "enter batch details at kiosk checkout" screen) and surfaces a **pre-existing duplicate-batch bug** (unrelated to this phase's auth work) that was masked only because Google auth was always present for staff. Recommend confirming with the owner whether the "enter details at checkout" UX is still wanted; if so, it would need a new kiosk-scoped middleware endpoint (device-token authenticated) in a follow-up phase, since Apps Script's `create_batch` action cannot safely accept a browser-shipped credential without reintroducing the "secret shipped to the browser" problem this phase exists to close.

**2. [Rule 1 — Required test fix] Updated `tests/frontend/kiosk-recipe-modify.test.js` T2d.**
- **Found during:** Task 2, running the full frontend suite before commit (per CLAUDE.md "never commit with failing tests").
- **Issue:** The existing test `T2d: API key header is sent` asserted `opts.headers['x-api-key']).toBe('test-api-key')` — behavior this plan's Task 2 explicitly removes.
- **Fix:** Renamed to `T2d: device token header is sent (D-46-01 — replaces x-api-key)`; now seeds `localStorage['sv_kiosk_device_token']` and asserts `x-device-token` is sent with no `x-api-key`. This file is outside this plan's `files_modified` frontmatter but the change was unavoidable — the test was directly asserting the exact behavior Task 2 was instructed to remove, and CLAUDE.md requires the full suite to pass before commit.
- **Files modified:** `tests/frontend/kiosk-recipe-modify.test.js`
- **Commit:** `d3395c8`

### Residual / Deferred (out of scope for this plan, noted for the record)

- `kiosk.html` still loads `<script src="https://accounts.google.com/gsi/client" async>` and `js/lib/auth.js` — both now unused by the standalone kiosk. `kiosk.html` is not in this plan's file scope (frontmatter lists only `js/kiosk.js` + the test file); removing these script tags is a small, safe follow-up whenever `kiosk.html` is next touched (e.g. 46-09's rebuild pass, or a later cleanup phase). No functional impact — they simply load unused code.
- The duplicate-batch bug described in Deviation 1 predates this phase and is unrelated to the auth re-architecture; it is now moot (the buggy call path is deleted), but is recorded here per CLAUDE.md's "surface bad code you discover" guidance.

## Known Stubs

None. No hardcoded empty values, placeholder text, or unwired data sources were introduced.

## Threat Flags

None. This plan only removes a shared-secret browser credential and narrows a customer-search endpoint's data shape exposure (both reduce attack surface); no new endpoints, auth paths, or trust boundaries were introduced. Server-side enforcement of the `x-device-token` header's scope (D-46-02) lands in Phase 46 Wave 3/4 (46-03/46-04), not in this plan.

## Self-Check: PASSED

- `tests/frontend/kiosk-device-token.test.js` — FOUND
- `js/kiosk.js` — FOUND (contains `sv_kiosk_device_token`, `x-device-token`, `contacts/search`; contains none of `initGoogleAuth`, `kioskCheckAuthorization`, `google.accounts.oauth2.revoke`, `MW_API_KEY`, `x-api-key`)
- Commit `1d55d4c` — FOUND in `git log`
- Commit `d3395c8` — FOUND in `git log`
- Commit `cc132b6` — FOUND in `git log`
