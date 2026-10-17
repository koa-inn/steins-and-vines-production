---
phase: 93-kiosk-ledger-week-and-month-views
verified: 2026-10-17T00:00:00Z
status: gaps_found
score: 7/8 requirements fully verified (PSL-11 and PSL-14 carry confirmed defects; see gaps)
overrides_applied: 0
gaps:
  - truth: "D-10: truncated range flags affected days and drilling into a day still gives exact day figures (PSL-14)"
    status: partial
    reason: "A partial day with 0 loaded sales is rendered greyed/inert, so the exact day ledger is unreachable exactly where truncation hides sales (WR-02, confirmed in code)."
    artifacts:
      - path: "js/kiosk-core.js"
        issue: "line ~4761 `var zero = !(Number(day.count) > 0);` ignores day.partial; kioskPsWireDayRows skips --zero rows"
    missing:
      - "zero = count<=0 && !day.partial; add test that a partial:true,count:0 row opens the day ledger"
  - truth: "Week/Month stepping, refresh and label act on the correct period (PSL-11)"
    status: partial
    reason: "kioskPsSetMode keeps the other type's _kioskPsRange payload; until the new load returns (or if it fails) ‹ › / ↻ use the old payload's anchors, loading the wrong period (WR-01, confirmed in code)."
    artifacts:
      - path: "js/kiosk-core.js"
        issue: "kioskPsSetMode (~4668) / kioskPsLoadRange / kioskPsShiftDay (~4965) / kioskPsRefresh (~5036) use stale _kioskPsRange"
    missing:
      - "Null _kioskPsRange and disable prev/next when requested type differs from payload type; add test"
---

# Phase 93: Kiosk ledger week and month views Verification Report

**Phase Goal:** Add Week (Mon-Sun) and Month (calendar) ranges to the Phase 92 kiosk Ledger tab as per-day summary rows (date, count, gross) that drill into the existing day ledger, with a count + gross footer, America/Vancouver time.
**Verified:** 2026-10-17
**Status:** gaps_found (two small, localized frontend state bugs; middleware is sound)
**Re-verification:** No, initial verification

## Requirements Coverage

All eight IDs (PSL-08..15) are defined in ROADMAP.md and claimed by plans 93-01..05. No orphans.

| Req | Status | Evidence |
|-----|--------|----------|
| PSL-08 range endpoint | SATISFIED | `routes/kiosk-history.js:278` GET `/api/kiosk/past-sales/range`; self-gate, allowlist entry `lib/authTiers.js:71`; hard-coded caps `RANGE_MAX_INVOICE_PAGES/PAYMENT_PAGES = 5` (:24-25); only GET. |
| PSL-09 exact match with day ledger | SATISFIED | `buildLedger` (:158) and `buildRange` (:244) both go through `hist.ledgerRowsForDay` + `ledgerTotals`; equality test in `kiosk-history-range.test.js` passes. |
| PSL-10 bounds, zero-fill, order | SATISFIED | Pure helpers in `lib/kiosk-history.js` with unit tests (`kiosk-history-range-lib.test.js`) passing; "Today" label and flat list rendered in `kiosk-core.js` ~4755-4770. |
| PSL-11 chips, date bar, stepping | PARTIAL | Chips in `kiosk.html:431-433`, wired `kiosk.js:1601`. Stepping defect on Week<->Month switch (WR-01). |
| PSL-12 drill-in and back | SATISFIED | `kioskPsOpenDay` / backlink (`kiosk.html:441`, `kiosk.js:1622`), scroll-restore covered by `kiosk-past-sales-range-drill.test.js`. WR-03 (‹ stays disabled in day view after floor-period range) is a minor side effect, only at the 2020 floor. |
| PSL-13 cache/bust/dedupe/throttle | SATISFIED | `KIOSK_HISTORY_RANGE_PREFIX` in `constants.js:47`; 300 s current / 3600 s past; shared `sharedBuild`. IN-01 (key lacks rangeEnd) is a low-impact midnight edge. |
| PSL-14 one-go load, partial handling | PARTIAL | One-go load, "at least" footer, partial badge present. Drill-in on partial zero-count days is blocked (WR-02). |
| PSL-15 clearing and late-response drop | SATISFIED | Range state reset at `kiosk-core.js:4529-4530`; shared `_kioskPsLedgerSeq`; tests passing. |

## Decision D-10 judgement (explicit)

D-10 says "Drilling into a day still gives exact day figures." Drill-in to a day with loaded sales works and day figures equal the day ledger (D-12 by construction). It is NOT achieved for days that are partial AND loaded zero sales: truncation drops the oldest invoices first, so those are the days most likely to show zero, and they are greyed and untappable (confirmed `kiosk-core.js:4761`). This only manifests when a range hits the 5-page cap, which the cap is sized to avoid for normal months, but it is a real miss of the stated escape hatch. Classified gap (partial), low severity.

## Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Day/Week/Month chips; Day default unchanged | VERIFIED | `kiosk.html:430-433`, `_kioskPsMode='day'` default |
| 2 | Range shows per-day rows, newest first, zero days greyed, future trimmed | VERIFIED | helper tests + render code |
| 3 | Footer shows count + gross | VERIFIED | `kiosk-core.js` ~4772 |
| 4 | Day figures in range equal day ledger | VERIFIED | D-12 equality test, shared chain |
| 5 | Tap day opens day ledger; Back returns to range | VERIFIED | drill tests; zero-count partial exception see gap 1 |
| 6 | Stepping/date-jump/refresh target correct period | PARTIAL | WR-01 |
| 7 | Read-only, auth-gated, slim, caps not caller-controlled | VERIFIED | route + allowlist |
| 8 | Phase 92 clearing rules cover range state | VERIFIED | `kiosk-core.js:4529` |
| 9 | Build artifacts regenerated | VERIFIED | `past-sales/range` present in `js/kiosk-core.js` and `js/kiosk-core.min.js` |

## Behavioral Spot-Checks

| Check | Result |
|-------|--------|
| `jest __tests__/kiosk-history` (middleware) | PASS: 7 suites, 150 passed, 2 skipped |
| `jest tests/frontend/kiosk-past-sales` | PASS: 5 suites, 90 passed |
| Reported full gates (204 suites / 2676 frontend, lint clean; middleware 3546 pass, 2 fail) | Not rerun; the 2 failures are the known Node 20 vancouver-timezone tzdata issue (prod Node 24) |

Passing tests do not cover WR-01/WR-02 scenarios (the review's proposed tests do not exist yet).

## Anti-Patterns

No TBD/FIXME/XXX in the changed middleware files. Review info items IN-01..05 are advisory (stale `today` for 5 min after midnight, week loading copy names a month, rows are click-only divs, payment cap unsized, 400 copy for pre-2020).

## Human Verification

None outstanding. Owner UAT on the staging iPad approved 2026-10-17 (93-05-SUMMARY), but without itemised month-vs-day figures and with no truncation or Week<->Month-with-slow-network scenario, so it does not cover the two gaps. Staging only; production not part of this phase.

## Gaps Summary

Middleware and the core flow are achieved. Two frontend state bugs remain (WR-01 stale range payload on Week<->Month switch; WR-02 partial zero-count days untappable, which breaches D-10's drill-in guarantee). WR-03 is cosmetic at the 2020 floor. Fixes are small and local (a few lines each plus tests); recommend a gap-closure plan (`/gsd:plan-phase 93 --gaps`) before the production promotion. If the owner accepts the risk, add overrides for these two truths.

---

_Verified: 2026-10-17_
_Verifier: Claude (gsd-verifier)_
