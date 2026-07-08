---
phase: 54-gift-card-management-on-the-kiosk-surface
plan: 02
subsystem: ui
tags: [kiosk, gift-cards, kiosk-core, fetch-auth, ES5]

# Dependency graph
requires:
  - phase: 54-01
    provides: "/api/kiosk/gift-card/void added to the kiosk device-token allowlist (D-54-GC)"
provides:
  - "kioskShowGiftCardMgmt() + showGiftCardMgmt export in js/kiosk-core.js — kiosk-native lookup+void panel"
  - "kgcm-panel overlay markup in kiosk.html (sibling top-level div, mirrors kiosk-discount-mgmt-modal)"
  - "Gift Cards entry button in kiosk.html shell-user bar, wired in js/kiosk.js's initKioskAuth (Device Settings cluster, not the sales toolbar)"
  - "Rebuilt js/kiosk-core.min.js / js/kiosk.min.js bundles; kiosk.html re-stamped"
affects: [54-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "kgcm- panel container open/close mirrors kioskShowDiscountMgmt (guarded getElementById, style.display toggle, inline close-button wiring)"
    - "Two-step lookup->void state machine ported verbatim from js/admin.js kioskShowAdminGiftCardMgmtModal(), with _kcMergeAuth replacing admin's hard-coded credentials:'include'"

key-files:
  created: []
  modified:
    - kiosk.html
    - js/kiosk.js
    - js/kiosk-core.js
    - js/kiosk-core.min.js
    - js/kiosk.min.js

key-decisions:
  - "Entry button placed in the shell-user bar next to the repurposed 'Device Settings' (kiosk-signout) button — not the discount popover/sales toolbar — per D-54-01"
  - "Reused the existing kiosk-discount-mgmt-modal/-sheet/-header/-close CSS classes verbatim for the kgcm- overlay container (no CSS file changes needed — classes are generic, not id-scoped)"
  - "No local alias (var kioskShowGiftCardMgmt = KioskCore.showGiftCardMgmt) added in kiosk.js since the entry button calls KioskCore.showGiftCardMgmt() directly, matching Task 1's file scope (kiosk-core.js changes are Task 2 only)"

requirements-completed: [KIOSK-GC-54]

# Metrics
duration: 18min
completed: 2026-07-08
---

# Phase 54 Plan 02: Kiosk Gift Card Management Panel Summary

**Kiosk-native `kgcm-` lookup+void panel authored in `js/kiosk-core.js`, entry gated behind kiosk Device Settings (not the sales toolbar), auth-injected via `_kcMergeAuth` — behavior parity with the admin two-step void flow.**

## Performance

- **Duration:** 18 min
- **Started:** 2026-07-08T20:35:00Z (approx.)
- **Completed:** 2026-07-08T20:53:08Z
- **Tasks:** 2
- **Files modified:** 5 (kiosk.html, js/kiosk.js, js/kiosk-core.js, js/kiosk-core.min.js, js/kiosk.min.js)

## Accomplishments
- `kgcm-panel` overlay added to `kiosk.html` — outer-modal > sheet > header(h2 + close) > body shape, sibling of `#kiosk-app`, mirroring `kiosk-discount-mgmt-modal`. Addressable child ids for cert input, lookup button, error slot, result-info slot, void button, void-view, reason field, void error slot, confirm/cancel buttons.
- "Gift Cards" entry button added to the kiosk shell-user bar next to the "Device Settings" button; wired in `js/kiosk.js`'s `initKioskAuth()` to call `KioskCore.showGiftCardMgmt()` — not reachable from the sales toolbar or discount popover (D-54-01).
- `kioskShowGiftCardMgmt()` implemented in `js/kiosk-core.js`: container open/close mirrors `kioskShowDiscountMgmt()`; the lookup→result-card→void→required-reason→confirm state machine ports `js/admin.js`'s `kioskShowAdminGiftCardMgmtModal()` behavior verbatim (D-54-02 parity), including the 200/404/409/other void response branching and the "Voiding…" disabled-button state.
- Both fetch calls (`GET /api/kiosk/gift-card/lookup`, `POST /api/kiosk/gift-card/void`) route through `_kcMergeAuth(...)` — grep-confirmed no new `credentials:'include'` literal was added to `kiosk-core.js` (D-54-03).
- `escapeHTML` / `kioskFmt` reused for every rendered value (cert #, status, face value, current balance) in the result card.
- `showGiftCardMgmt: kioskShowGiftCardMgmt` added to the `KioskCore` export object.
- `npm run build` regenerated `js/kiosk-core.min.js` / `js/kiosk.min.js` and re-stamped `kiosk.html`'s cache-busted script/style tags.
- `js/admin.js` left untouched (D-54-04).

## Task Commits

1. **Task 1: Add kgcm- overlay markup + settings-gated entry button** - `5a421c9` (feat)
2. **Task 2: Implement the kgcm- lookup→void panel in kiosk-core.js + export + rebuild bundles** - `51fa837` (feat)

## Files Created/Modified
- `kiosk.html` - `kgcm-panel` overlay markup (lookup + void views); "Gift Cards" entry button in the shell-user bar; cache-busted script tags re-stamped by the build
- `js/kiosk.js` - `initKioskAuth()` wires the new `kiosk-gc-mgmt-btn` to `KioskCore.showGiftCardMgmt()`
- `js/kiosk-core.js` - new `kioskShowGiftCardMgmt()` function (~164 lines) + `showGiftCardMgmt` export
- `js/kiosk-core.min.js` / `js/kiosk.min.js` - regenerated build artifacts (never hand-edited)

## Decisions Made
- Entry point lives in the shell-user bar (next to "Device Settings"/`kiosk-signout`), which the plan explicitly names as a valid anchor for D-54-01 — distinct from the discount popover (`kiosk-discount-manage-btn`), which is reachable mid-sale and was explicitly excluded by the plan/PATTERNS.md.
- Reused the `kiosk-discount-mgmt-modal` / `-sheet` / `-header` / `-close` CSS classes for the new overlay's container styling instead of adding new CSS — those classes are generic (not id-scoped) and this plan's `files_modified` list did not include a CSS file.
- Void-view "cannot be undone" label, required-reason gate, and 200/404/409/other branching were ported behavior-for-behavior from admin's reference implementation, matching D-54-02's explicit behavior-parity requirement.

## Deviations from Plan

**1. [Rule 3 - Blocking / build tooling] Reverted incidental cross-page build churn**
- **Found during:** Task 2 (`npm run build` step)
- **Issue:** The project's monolithic `npm run build` script re-stamps cache-bust `?v=` query strings on every HTML page (admin.html, about.html, all `products/*.html`, etc.) and bumps `js/admin.js`'s `BUILD_TIMESTAMP`, regardless of which source file actually changed. Committing these would violate the plan's `files_modified` scope and CLAUDE.md's "don't touch unrelated code" principle.
- **Fix:** After running the required build, reverted the unrelated files (`about.html`, `admin.html`, `brewpad.html`, `contact.html`, `custom-labels.html`, `index.html`, `ingredients.html`, `products.html`, `products/*.html`, `reservation.html`, `js/admin.js`, `js/admin.min.js`) with targeted `git checkout -- <path>` calls (not a blanket reset), keeping only `kiosk.html`, `js/kiosk-core.js`, `js/kiosk-core.min.js`, `js/kiosk.min.js` staged for commit.
- **Files reverted:** see list above (no functional change to any of them — pure cache-stamp/timestamp noise from the shared build command).
- **Verification:** `git status --short` after revert showed only the four plan-scoped files modified; `npm run build`'s actual required output (kiosk bundles + kiosk.html stamp) was preserved.
- **Committed in:** `51fa837` (Task 2 commit) — reflects only the reverted, scoped file set.

---

**Total deviations:** 1 auto-fixed (build-tooling scope containment)
**Impact on plan:** No scope creep; the plan's required kiosk-only build output is intact and committed. Unrelated site-wide cache-stamp churn was excluded from the commit.

## Issues Encountered
None beyond the build-tooling deviation documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `kioskShowGiftCardMgmt()` / `showGiftCardMgmt` export and the `kgcm-` panel markup are in place and ready for 54-03's regression test (device-token lookup+void path assertion, reason-required gating).
- Frontend suite (955/955) + middleware suite (1258/1258, unaffected) + `npm run lint` (0 warnings) all green before this commit.
- No blockers for 54-03.

---
*Phase: 54-gift-card-management-on-the-kiosk-surface*
*Completed: 2026-07-08*

## Self-Check: PASSED

All created/modified files verified present on disk; all task commits (`5a421c9`, `51fa837`) and the summary commit (`551aba1`) verified in `git log`.
