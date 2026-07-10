---
phase: 48-kiosk-pos-de-fork-kiosk-core-js
status: verified
audited: 2026-07-10
auditor: gsd-security-auditor
asvs_level: 1
block_on: high
threats_total: 22
threats_closed: 22
threats_open: 0
verdict: SECURED
---

# Phase 48 — Kiosk POS De-Fork (js/kiosk-core.js) — Security Audit

**Register origin:** authored at plan time (`register_authored_at_plan_time: true`).
Verified each declared mitigation against implemented code; did not scan for new threats.
Implementation files were NOT modified. Structural evidence reused from
`48-VERIFICATION.md`; money-path threats (idempotency / auth / price / void /
override) were re-derived directly against source.

## Verdict: SECURED

22/22 threats CLOSED. No HIGH-severity unmitigated `mitigate` threat remains, so
under `block_on: high` this phase is not blocked. Five money-path robustness
WARNINGs (WR-01..WR-05, from `48-REVIEW.md`) are advisory follow-ups, not gating.

## Threat Verification

| Threat ID | Category | Disposition | Status | Evidence |
|-----------|----------|-------------|--------|----------|
| T-48-01 | Tampering | mitigate | CLOSED | Node-only require guard `typeof window!=='undefined' && !window.KioskCore && typeof require==='function'` — `js/kiosk.js:12`, `js/admin.js:11`. Inert in browser (window.KioskCore already set by `<script src=kiosk-core.min.js>`). |
| T-48-02 | Spoofing | accept | CLOSED | No auth change introduced; phase relocates code only. Accepted risk (see log). `x-device-token` behaviour unchanged; guarded by `kiosk-device-token.test.js` T2/T3. |
| T-48-03 | Tampering | mitigate | CLOSED | Discount calc not re-implemented: `js/kiosk-core.js:650-651` calls `discountMatches(...)` behind `typeof discountMatches==='function'` guard; single source `js/lib/discount-match.js:77`. |
| T-48-04 | Spoofing | mitigate | CLOSED | Kiosk injects ONLY `x-device-token` (`js/kiosk.js:43-44`); zero `x-api-key` anywhere in `js/kiosk.js`. |
| T-48-05 | Repudiation | accept | CLOSED | Server re-computes discount allocation + tax: `zoho-middleware/routes/pos.js:89-117` (per-line share, `matchedSubtotal`, GST). Client totals display-only. pos.js/pos-recipe.js untouched by Phase 48. Accepted risk (see log). |
| T-48-06 | Tampering/Repudiation (dup charge) | mitigate | CLOSED | `js/kiosk-core.js:2399` `refNumber='KIOSK-'+Date.now()`; `:2421`/`:2432` `idempotency_key === reference_number`; `:2540` confirm reuses same key (CR-01 deterministic replay). No `Math.random()` in the sale path. |
| T-48-07 | Spoofing | mitigate | CLOSED | Sale fetch auth via `_kcMergeAuth()` → `buildAuthOptions()` (`js/kiosk-core.js:101-113`, applied at `:288` and the sale POST). Kiosk surface contributes only `x-device-token`. |
| T-48-08 | Elevation of Privilege | accept | CLOSED | Client never POSTs a void; it only RENDERS the server-set flag `result.data.payment_voided` (`js/kiosk-core.js:2462`, `:2513`, `:3614`). Void authority is server-side. Accepted risk (see log). Live-confirmed: UAT Test 3 (void-on-failure) PASS. |
| T-48-08O | Tampering (silent feature loss) | mitigate | CLOSED | `#kiosk-stock-override-btn` handler exists ONLY in `js/kiosk-core.js:2605` (0 in kiosk.js/admin.js); 409/`conflicts` → override → resubmit; server 409 gate authoritative (pos-recipe.js re-checks at confirm, `:610`). UAT Test 4 PASS (standalone). |
| T-48-09 | Spoofing | mitigate | CLOSED | Admin injects ONLY `credentials:'include'` (`js/admin.js:9827-9831` `buildAuthOptions`); `grep -c x-device-token js/admin.js` = 0. |
| T-48-10 | Repudiation (dup batch) | mitigate | CLOSED | Client-side create_batch loop removed from the kiosk sale path: `js/kiosk-core.js:2454-2458` (D-46-01 server-side batch creation) and `js/admin.js:9856` (D-05 "create_batch loop is gone"). Server auto-creates one linked batch. NB: `js/admin.js:7194` create_batch is the separate manual BrewPad batch-scheduling tool (batch-submit-create UI), NOT the kiosk money path. |
| T-48-11 | Tampering (price mismatch) | mitigate | CLOSED | `modified_ingredients` forwarded in sale body `js/kiosk-core.js:2417` and mirrored in confirm body `:2487`, sourced from `_kcEnv.getModifiedIngredients()` (bridged per-surface, real data). |
| T-48-12 | Tampering (dup charge) | mitigate | CLOSED | Unified `idempotency_key === reference_number` on both surfaces; admin's old `Math.random()` suffix dropped. `js/admin.js:2427` Math.random is a hold-ID generator (non-money path). |
| T-48-12O | Tampering (silent feature loss) | mitigate | CLOSED | Override capability lives in KioskCore; admin sends `override` via the core sale-body (`recipeSaleBody.override`), no admin-local override handler (`js/admin.js:9861`). |
| T-48-13 | Tampering (future re-fork) | mitigate | CLOSED | `tests/frontend/kiosk-core-parity.test.js` locks identical URL+body (modulo idempotency) across surfaces; 3/3 passing. |
| T-48-14 | Spoofing (auth regression) | mitigate | CLOSED | Parity test `assertAuthDivergence` asserts admin sends no `x-device-token` and kiosk sends no stale `x-api-key`; passing. |
| T-48-14O | Tampering (override re-break) | mitigate | CLOSED (weak guard — WR-05) | Parity test's 3rd suite asserts both surfaces send `override` and resubmit on 409; passing. CAVEAT: WR-05 — the `modified_ingredients` assertion is tautological (no modification seeded), so a future one-surface drop of modified_ingredients would not be caught. Recommended test-strengthening follow-up, not an open threat. |
| T-48-15 | Tampering (real money, live charge) | mitigate (HUMAN GATE) | CLOSED | UAT Test 1 PASS on STANDALONE (real Helcim charge → receipt → Zoho invoice/payment at discounted total; test invoices refunded/deleted). Admin-surface half owner-waived; covered by automated parity test. Stated on record below. |
| T-48-16 | Repudiation (admin kit dup batch) | mitigate (HUMAN GATE) | CLOSED (owner-waived) | Live admin single-batch check NOT run — admin surface out of scope by owner decision. Covered by automated tests + T-48-10 code removal. Owner-accepted-waived-with-automated-coverage — NOT an open blocker. Stated on record below. |
| T-48-17 | Tampering (override both surfaces) | mitigate (HUMAN GATE) | CLOSED | UAT Test 4 PASS on STANDALONE (previously-dead override revived: 409→override→success). Admin-surface half owner-waived; covered by parity test. Stated on record below. |
| T-48-SC | Tampering (npm installs) | accept | CLOSED | Zero new dependencies. Phase-48 package.json change (`0d93ba6`) is build wiring only (terser `kiosk-core.min.js` target + stamp clauses); no `dependencies`/`devDependencies`/lockfile additions. |

## Money-Path Adversarial Notes

- **Idempotency (T-48-06/12):** Single deterministic key `KIOSK-<Date.now()>` used
  as both `reference_number` and `idempotency_key` across sale + confirm. No random
  suffix. Confirmed there is no client path that mints two keys for one cart.
- **Auth divergence (T-48-04/07/09/14):** kiosk = `x-device-token` only (no x-api-key);
  admin = `credentials:'include'` only (no x-device-token). Both are injected via the
  `buildAuthOptions` seam, never hard-coded in the core. Pinned by the parity test.
- **Price integrity (T-48-11):** `modified_ingredients` flows sale→confirm so the
  charged total matches the staff-edited preview.
- **Void authority (T-48-08):** No client-initiated void. Client only reads
  `payment_voided` from the server response. Server owns the reversal decision.
- **Override replay (WR-02, advisory):** The override resubmit reuses the 409'd
  idempotency key. This would defeat Manager Override ONLY if the middleware persisted
  non-terminal (409) responses under that key. UAT Test 4 (standalone: 409→override→
  success) empirically demonstrates the server does NOT replay the cached conflict, so
  the WR-02 failure mode did not manifest for the exercised surface. Retained as an
  advisory to confirm the same holds for the admin surface if it is ever put into
  live sale use.

## Human-Gate / Scope-Waiver Record (on the record per instructions)

The live human-gate threats were exercised on real hardware 2026-07-10 (iPad Safari →
staging → PROD middleware → live Helcim terminal), recorded in `48-HUMAN-UAT.md`:

- **T-48-15 (live charge):** PASS on the standalone kiosk. Admin-surface half NOT run —
  owner scoped this UAT to standalone-only (admin-embedded kiosk not used for sales in
  practice). Admin path covered by the automated parity test.
- **T-48-17 (Manager Override):** PASS on the standalone kiosk (409→override→success on
  the previously-dead standalone button). Admin-surface half NOT run (same scope).
- **T-48-16 (admin kit single-batch):** NOT run — admin surface, out of scope.

**Disposition:** The standalone-surface money path is HUMAN-VERIFIED. The admin-surface
halves of T-48-15/16/17 are **owner-accepted-waived-with-automated-coverage** (parity
test 3/3), NOT open blockers. This waiver is explicitly recorded so it is on the record.

## Accepted-Risk Log

| ID | Risk | Why acceptable |
|----|------|----------------|
| T-48-02 | Phase relocates code with no auth-model change | Auth is behaviour-preserving; `x-device-token` injection unchanged and test-guarded (`kiosk-device-token.test.js`). |
| T-48-05 | Client displays cart totals | Server (`pos.js`) is the sole authority for tax/discount/total on invoice creation; client figures are display-only. pos.js untouched this phase. |
| T-48-08 | Void rendering is client-side | Void DECISION is server-side; client only renders `payment_voided`. Live-confirmed (UAT Test 3 PASS). |
| T-48-SC | No dependency additions | Verified: phase-48 package.json diff is build wiring only. |
| T-48-16/admin halves of 15/17 | Admin-surface live sale not human-tested | Owner-waived (admin kiosk not used for sales); automated parity coverage stands in. |

## Advisory Follow-Ups (non-blocking, from 48-REVIEW.md)

- WR-01: `mwUrl` cached at init — mitigated in code (`js/admin.js:9828` passes the
  `kioskMwUrl` resolver, not its value; comment confirms lazy read).
- WR-02: override resubmit reuses idempotency key — see Money-Path Notes above.
- WR-03: manual-confirm timer not cleared on 409 early-return — defended only by the
  server confirm-time stock re-check; recommend clearing the timer.
- WR-04: admin recipe-sale migrated to poll-based confirm — intended unification; not
  covered by the parity test.
- WR-05: parity test `modified_ingredients` assertion tautological — strengthen to seed
  a real modification (weakens the T-48-11 / T-48-14O regression guard).

## Unregistered Flags

None. No `## Threat Flags` section is present in any `48-0*-SUMMARY.md`; no new attack
surface was declared by the executor. No dependency additions detected.
