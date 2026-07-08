---
phase: 54-gift-card-management-on-the-kiosk-surface
verified: 2026-07-08T21:11:11Z
status: passed
score: 10/11 automatically verified; 1 owner-override (D-54-01 placement)
overrides_applied: 1
override_notes:
  - decision: "D-54-01 (entry-point placement)"
    resolution: "Owner ACCEPTED the shell-bar placement 2026-07-08 (overrides D-54-01's gated-settings requirement)."
    rationale: >
      Opening the panel only triggers a harmless balance LOOKUP; the destructive
      void remains behind the two-step lookup → Void → typed-reason → Confirm
      ('cannot be undone') flow, so a mistap on the persistent 'Gift Cards'
      button voids nothing. A visible button also better matches the owner's
      'do everything from the kiosk' intent than a buried submenu. Residual
      mistap risk formally accepted; supersedes D-54-01's placement clause
      (D-54-GC and the rest of D-54-01/02/03/04/05 stand).
gaps:
  - truth: "From the kiosk settings/Device Settings gate (NOT the sales toolbar) staff can open a Gift Card Management panel (D-54-01)"
    status: accepted_override
    reason: >
      The new "Gift Cards" button (#kiosk-gc-mgmt-btn) was placed in
      `.kiosk-shell-bar` — the persistent header rendered as a flex sibling
      above every kiosk view (kiosk.html line 47-62; #kiosk-app is
      `display:flex; flex-direction:column`, css/kiosk.css line 381-387).
      This header has no view-based or lock-based hide/show logic beyond the
      app-level show/hide performed once at sign-in (showKioskApp()/
      showLockScreen()); it remains on-screen and one tap away throughout
      browsing, cart-building, and checkout — the exact "busy sale" moment
      D-54-01's rationale says must be protected from a mistap. The button
      sits directly beside "Sales Orders" and "Customer View", both
      routine sales-flow controls, not behind any separate settings screen,
      submenu, or PIN step. The "Device Settings" button used as the
      placement precedent (id="kiosk-signout") is not actually hidden either
      — it is shown unconditionally by `initKioskAuth()` on every app load
      (js/kiosk.js line 208) and lives in the same always-visible shell bar.
      So the precedent itself does not deliver a "hidden settings area";
      placing Gift Cards next to it reproduces the same always-visible
      exposure the decision was meant to avoid.
    artifacts:
      - path: "kiosk.html"
        issue: "kgcm- entry button (#kiosk-gc-mgmt-btn, line 59) lives inside .kiosk-shell-bar, a persistent top-level header with no display-toggle logic tied to sale/view state or a lock/PIN gate."
      - path: "js/kiosk.js"
        issue: "initKioskAuth() (lines 200-227) wires #kiosk-gc-mgmt-btn unconditionally, alongside the 'Device Settings' (#kiosk-signout) button, which is itself always shown post-login (line 208) — neither button is behind a hidden submenu."
      - path: "css/kiosk.css"
        issue: "#kiosk-app (line 381-387) is display:flex/flex-direction:column with .kiosk-shell-bar as the first (persistent) child — no CSS or JS hides the shell bar during an active sale."
    missing:
      - "A genuinely gated placement: e.g. move the Gift Cards entry inside the existing PIN-lock screen's post-unlock settings path, a collapsed/hidden settings submenu, or add a confirmation/PIN step before the panel opens — something that is not visible/clickable during ordinary product browsing and cart building."
      - "Or: an owner decision to formally accept the current shell-bar placement (its risk is materially reduced anyway by the two-step + required-reason + 'cannot be undone' void flow), recorded as a VERIFICATION.md override."
---

# Phase 54: Gift-Card Management on the Kiosk Surface Verification Report

**Phase Goal:** Staff can do full gift-card management — balance lookup + void — directly from the staff-only standalone kiosk page, not only the admin panel. Backend adds `/api/kiosk/gift-card/void` to the kiosk device-token scope (D-54-GC, supersedes D-46-02/T-46-07). Frontend is a kiosk-native `kgcm-*` lookup+void panel in `js/kiosk-core.js` via injected auth (`_kcMergeAuth`), entry behind the Device Settings gate, admin's modal left untouched.

**Verified:** 2026-07-08T21:11:11Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | POST `/api/kiosk/gift-card/void` with a valid `x-device-token` is NOT rejected 403 (D-54-GC) | ✓ VERIFIED | `zoho-middleware/lib/authTiers.js` line 52: `'/api/kiosk/gift-card/void'` literal in `KIOSK_ROUTES` with inline D-54-GC comment. `auth-tiers-guard.test.js` test (3) (line 118) and `pos-auth-tier.test.js` test (3) (line 123) both assert `expect(res.status).not.toBe(403)`. |
| 2 | Device token still cannot reach other admin-grade routes (PII GET, BrewPad GET, admin GET) | ✓ VERIFIED | `auth-tiers-guard.test.js` (7a) line 157-163 `GET /api/contacts` → `toBe(403)` intact. `pos-auth-tier.test.js` (7b) line 210-216 `GET /api/batch/search-invoices` → `toBe(403)` intact; (8a) line 223-228 `GET /api/orders/recent` → `toBe(403)` intact. |
| 3 | `authTiers.js` comment records the D-54-GC reversal while preserving the "explicit list, not a prefix" rationale | ✓ VERIFIED | Lines 20-38: rationale paragraph unchanged/preserved (`grep "prefix"` matches), new "D-54-GC reversal" paragraph added (lines 28-37) documenting the supersession without weakening the explicit-list guidance for future routes. `isKioskRoute()` (lines 87-95) and `requireTiers()` (lines 147-174) bodies confirmed unchanged (pure exact-membership / prefix checks, no new logic). |
| 4 | From the kiosk settings/Device Settings gate (NOT the sales toolbar) staff can open a Gift Card Management panel (D-54-01) | ✗ FAILED | See gaps section — entry button lives in the persistent `.kiosk-shell-bar` header (kiosk.html line 47-62; `#kiosk-app` is `flex-direction:column`, css/kiosk.css 381-387), which has no hide/show logic tied to sale state. It is visible and clickable throughout browsing/cart-building, the exact "busy sale" scenario D-54-01 was meant to protect. |
| 5 | The panel looks up a certificate by number and renders cert #, status (color-coded), face value and current balance (D-54-02, D-54-05) | ✓ VERIFIED | `js/kiosk-core.js` lines 4459-4503: `GET /api/kiosk/gift-card/lookup` handler renders `kgcm-result-info` innerHTML with cert # (escapeHTML), status color-coded (`#2e7d32` active / `#c00` else, escapeHTML), face value and current balance (both `kioskFmt`). Void button hidden when `status === 'voided'`. |
| 6 | Voiding is a two-step flow: result card → Void button → required reason field → Confirm Void with a "cannot be undone" label; empty reason blocked client-side (D-54-02) | ✓ VERIFIED | `js/kiosk-core.js` lines 4505-4567: Void button swaps to void view, sets "Void {cert}? This cannot be undone." label (line 4512); Confirm Void handler (lines 4526-4531) returns early with an inline error when `reason.trim()` is empty — no fetch fired in that branch. |
| 7 | Both the lookup GET and the void POST are sent through the injected auth seam (`_kcMergeAuth`), never a hard-coded `credentials:'include'` (D-54-03) | ✓ VERIFIED | Lines 4467, 4536: both `fetch(...)` calls wrap their options in `_kcMergeAuth(...)`. `grep "credentials" js/kiosk-core.js` shows only the doc-comment mentions and the merge-helper's own `opts.credentials = auth.credentials` (lines 96-116) — no new hard-coded `credentials:'include'` literal added. |
| 8 | `kiosk.html` loads the freshly rebuilt `kiosk-core.min.js` / `kiosk.min.js` bundles | ✓ VERIFIED | Re-ran `npm run build`: regenerated `js/kiosk-core.min.js` and `js/kiosk.min.js` are byte-identical to the committed versions (`diff` reported no differences); `kioskShowGiftCardMgmt`/`showGiftCardMgmt` string present in the minified bundle. Unrelated build churn (HTML cache-stamps, admin.js/admin.min.js) reverted after the check, restoring a clean working tree. |
| 9 | A test drives the real `js/kiosk-core.js` panel through `js/kiosk.js` env injection and proves the fetch calls carry `x-device-token`, not `credentials:'include'` (D-54-03) | ✓ VERIFIED | `tests/frontend/kiosk-gift-card-mgmt.test.js` line 129-146: `loadSurface()` harness, asserts `opts.headers['x-device-token']).toBe('kiosk-gc-mgmt-token')` and `opts.credentials).toBeUndefined()`. |
| 10 | A test proves lookup renders the returned cert fields and void POSTs `cert_number` + `reason` to `/api/kiosk/gift-card/void` (D-54-02, D-54-05) | ✓ VERIFIED | Lines 149-191: lookup-render test + void-POST test asserting URL, `x-device-token` header, and `JSON.parse(body)` contains `cert_number`/`reason`. |
| 11 | A test proves an empty reason blocks Confirm Void client-side — no second (void) fetch fired (D-54-02 reason-required gate) | ✓ VERIFIED | Lines 197+: negative case asserts `global.fetch` call count stays at 1 (lookup only) and an inline error is shown when reason is empty. |

**Score:** 10/11 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `zoho-middleware/lib/authTiers.js` | `KIOSK_ROUTES` entry for `/api/kiosk/gift-card/void` | ✓ VERIFIED | Literal present line 52; `isKioskRoute`/`requireTiers` bodies unchanged. |
| `zoho-middleware/__tests__/auth-tiers-guard.test.js` | Flipped device-not-403 void assertion + intact PII negative | ✓ VERIFIED | Test (3) flipped; test (7a) intact. |
| `zoho-middleware/__tests__/pos-auth-tier.test.js` | Flipped device-not-403 void assertion + intact BrewPad/admin negatives | ✓ VERIFIED | Test (3) flipped; tests (7b)/(8a) intact. |
| `js/kiosk-core.js` | `kgcm-` panel + `kioskShowGiftCardMgmt()` + `showGiftCardMgmt` export | ✓ VERIFIED | Function at lines 4417-4568 (~150 lines, well above the 80-line floor); export at line 4668. |
| `kiosk.html` | `kgcm-` overlay markup + settings-gate entry button | ⚠️ VERIFIED (exists/wired) — see Truth #4 for placement concern | Overlay at lines 479-514 (sibling of `#kiosk-app`, `display:none`); entry button at line 59, but button is inside the always-visible shell bar, not a gated submenu (see gap). |
| `js/kiosk.js` | Entry button near Device Settings calling `KioskCore.showGiftCardMgmt()` | ✓ VERIFIED (wiring); ⚠️ placement concern shared with above | Lines 212-220. |
| `tests/frontend/kiosk-gift-card-mgmt.test.js` | Kiosk-surface regression coverage | ✓ VERIFIED | 218 lines (min 40); asserts `x-device-token`, void POST body, reason-required negative. |
| `js/kiosk-core.min.js` / `js/kiosk.min.js` | Rebuilt bundles (not hand-edited) | ✓ VERIFIED | Re-running `npm run build` produced byte-identical output to the committed files. |
| `js/admin.js` (D-54-04) | Untouched | ✓ VERIFIED | `git diff` across every phase-54 commit range shows zero changes to `js/admin.js` / `js/admin.min.js`. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `authTiers.js KIOSK_ROUTES` | `isKioskRoute()` / global guard on `/api/kiosk/gift-card/void` | array membership (`indexOf`) | ✓ WIRED | `isKioskRoute` line 88 checks `KIOSK_ROUTES.indexOf(path) !== -1`; new literal is a plain array member, no special-casing needed. |
| `js/kiosk.js` Device Settings area | `KioskCore.showGiftCardMgmt()` | button `onclick`/`addEventListener` | ✓ WIRED (mechanically) | Lines 215-219: `gcMgmtBtn.addEventListener('click', ...)` calls `KioskCore.showGiftCardMgmt()`. Mechanically wired; see Truth #4 for the placement/gating concern this link does not resolve. |
| `js/kiosk-core.js` `kgcm-` panel | `/api/kiosk/gift-card/lookup` and `/api/kiosk/gift-card/void` | fetch wrapped in `_kcMergeAuth` | ✓ WIRED | Lines 4467 and 4536; both fetches pass through `_kcMergeAuth(...)`. |
| `kiosk.html` | `kiosk-core.min.js` / `kiosk.min.js` | cache-stamped script tags | ✓ WIRED | Lines 24-25, `?v=` stamps present; bundle rebuild confirmed byte-identical. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `kgcm-result-info` render | `result.data.data` (cert_number/status/face_value/current_balance) | `GET /api/kiosk/gift-card/lookup` → `routes/gift-cards.js` → Apps Script sheet lookup | Yes — response contract matches the pre-existing F7/45-09 lookup, consumed identically to the already-shipped `kgcr-` redeem panel | ✓ FLOWING |
| Void POST body | `_mgmtCert` (from prior lookup) + `reason` (user input) | client-side state (`_mgmtCert`) + `voidReasonEl.value` | Yes — not hardcoded; server enforces cert format + non-empty reason (`routes/gift-cards.js` lines 126-135) independent of client checks | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full frontend suite green | `npm test` | 55 suites / 959 tests passed | ✓ PASS |
| Full middleware suite green | `cd zoho-middleware && npm test` | 77 suites / 1258 tests passed | ✓ PASS |
| Lint clean | `npm run lint` | 0 problems (`--max-warnings 0`) | ✓ PASS |
| Bundle rebuild reproducibility | `npm run build` then diff vs. committed `.min.js` | No diff | ✓ PASS |
| Live device-token round trip on iPad hardware | N/A (requires physical device + prod middleware) | not run | ? SKIP — routed to human verification, folded into Phase 48 iPad UAT per phase sequencing note |

### Probe Execution

No probe scripts declared or discovered for this phase (`scripts/*/tests/probe-*.sh` — none found; PLAN/SUMMARY do not reference probes). Step 7c: SKIPPED (no probes applicable).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|--------------|--------|----------|
| KIOSK-GC-54 | 54-01, 54-02, 54-03 (all three) | Owner-requested ad-hoc addition — full gift-card management (lookup+void) on the kiosk surface | ⚠️ PARTIALLY SATISFIED | Backend scope widening + panel + tests all shipped and function correctly; the D-54-01 placement clause of the requirement (off the sales screen) is not met as implemented — see Truth #4. |

**Note on REQUIREMENTS.md:** KIOSK-GC-54 does not appear in `.planning/REQUIREMENTS.md`'s v1 traceability table. Per the phase brief, this is expected — Phase 54 was an ad-hoc owner addition outside the v1 requirements set, not a gap in requirements tracking.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER markers found in any phase-54-modified file | — | None — clean |

No debt markers, empty-return stubs, or console.log-only implementations found in `authTiers.js`, the two flipped test files, `kiosk-core.js`'s new function, `kiosk.js`'s new wiring, `kiosk.html`'s new markup, or the new test file.

### Human Verification Required

### 1. Live device-token gift-card lookup+void round trip (iPad hardware)

**Test:** On the physical kiosk iPad, against the deployed staging/production middleware, open the "Gift Cards" panel, look up a real (or test) certificate, and complete a void with a reason.
**Expected:** Lookup renders the correct cert fields; void succeeds and the certificate subsequently shows as voided; the event is logged (`kiosk.gift_card_voided`).
**Why human:** Requires physical hardware, a live device token, and the deployed middleware — cannot be exercised from static code analysis or jsdom tests. Per the phase's own sequencing note, this is intended to be folded into the pending Phase 48 iPad UAT session.

### 2. Gift Cards entry-point placement — owner UX judgment

**Test:** On the physical kiosk iPad, during a simulated busy sale (actively browsing products / building a cart), observe whether the "Gift Cards" button in the header is a plausible mistap target, and decide whether its current placement (persistent shell-bar, no PIN/submenu gate) meets the intent of D-54-01.
**Expected:** Owner either (a) confirms the current placement is acceptable given the two-step + required-reason + "cannot be undone" void flow already mitigates mistap risk, and records an override, or (b) requests the entry be moved behind an actual hidden/gated settings area.
**Why human:** This is a UX/risk-tolerance judgment call the code cannot resolve — it depends on how the owner weighs the residual risk in practice on the real device, not just what the static markup shows.

## Gaps Summary

10 of 11 must-have truths are fully verified with strong evidence: the backend auth-scope widening is surgical and correctly scoped (all negative-scope tests for PII/BrewPad/admin routes remain intact and green), the kiosk-native `kgcm-` panel correctly mirrors the admin two-step lookup→void flow using the injected `_kcMergeAuth` auth seam (no hard-coded `credentials:'include'` anywhere in the new code), the regression test locks in both the device-token auth path and the reason-required void gate, admin.js is untouched, and both the frontend (959 tests) and middleware (1258 tests) suites plus lint are fully green.

The one gap is the entry-point placement (D-54-01): the "Gift Cards" button was wired into `.kiosk-shell-bar`, a persistent header that is visible and one tap away throughout ordinary kiosk operation — including while actively building a sale — because that header has no display-toggle logic tied to sale state, and the "Device Settings" button used as the placement precedent is itself always-visible in the same header (not actually hidden). This does not match the stated goal ("NOT the sales toolbar... prevents a mistap during a busy sale from reaching it"), even though the plan's own `<interfaces>` guidance pointed the executor to this exact spot. This looks like a planning-level analog mismatch rather than an execution error — the code faithfully implements what the plan specified.

**This looks intentional-adjacent, not clearly resolvable by re-running code.** Two paths forward: (1) close the gap with a follow-up plan that moves the entry behind an actual gated/hidden settings path, or (2) the owner reviews the real device behavior and, if the two-step/required-reason/irreversible-warning mitigation is judged sufficient, accepts the current placement via an override:

```yaml
overrides:
  - must_have: "From the kiosk settings/Device Settings gate (NOT the sales toolbar) staff can open a Gift Card Management panel (D-54-01)"
    reason: "Owner reviewed the shell-bar placement on the physical device and accepts it — the two-step + required-reason + 'cannot be undone' void flow is judged sufficient mistap protection without a separate hidden submenu."
    accepted_by: "{name}"
    accepted_at: "{ISO timestamp}"
```

---

*Verified: 2026-07-08T21:11:11Z*
*Verifier: Claude (gsd-verifier)*
