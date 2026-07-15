---
phase: 58-revenue-operations-integrity
status: complete
completed: 2026-07-15
requirements: [REVIEW-02]
commits: [d25bf6c2, 37e9e9bb]
approach: executed directly (investigation-informed) — no separate plan/check cycle, per owner decision (low-risk admin display + a verify)
---

# 58 Summary — Revenue & Operations Integrity

Both review findings resolved. One turned out to be a real (small) bug; the other
was verified correct with no fix — exactly the "verify before fixing" split the
milestone was designed around.

## (a) Malformed negative price in Kit Inventory — FIXED (`d25bf6c2`)

**Root cause found by reading the render, not guessing.** `renderKitsTab`
(`js/admin.js`) had two price paths: the Zoho-sourced path rounded, but the
**sheet-fallback path printed `kit.retail_instore` raw** —
`'$' + String(kit.retail_instore).replace('$','')` — no round, no negative/NaN
guard. So a bad negative value in the Kits sheet's `retail_instore` column rendered
verbatim as the reviewer's `$-68.949…`.

**Fix:** one shared `formatKitPrice()` rule applied to BOTH paths:
- missing price → blank (not an error; the kit just has no price entered)
- present-but-invalid (negative / non-numeric) → em dash (a garbage value can never
  read as a real price) — **owner decision 2026-07-15**
- valid → rounded to 2 decimals

RED→GREEN: `tests/frontend/admin-kit-price.test.js` (7 tests). Frontend 1009 green,
lint clean, artifacts rebuilt.

**Still open — OWNER DATA ACTION (not code):** the underlying Kits-sheet row still
holds a bad value. The display now hides it (shows a dash), which — per the chosen
"blank/dash" behaviour — means it is no longer conspicuous. Correcting the sheet is
the owner's to do; the specific row can be found by sorting the In-Store column in
the authenticated admin, or Claude can locate it via the live admin on request.
(The Kits sheet was not reachable via the Drive MCP this session — likely a Shared
Drive scope limit.)

## (b) Open/Closed indicator — VERIFIED CORRECT, no fix

Read `renderOpenStatus()` + `BUSINESS_HOURS` in `js/modules/13-init.js`:
- `BUSINESS_HOURS` matches the posted hours EXACTLY (Tue/Wed/Fri/Sat 10–4, Thu
  12–7; Sun=0 / Mon=1 absent → closed).
- Current time computed in `America/Vancouver` via `Intl.DateTimeFormat`, so PST/PDT
  is handled; a midnight `h===24 → 0` edge case is guarded.

**Conclusion:** the logic is correct. The reviewer saw "Closed" because they
genuinely reviewed during closed hours. SC#2 (Open/Closed) is satisfied by the
verification; no code change. This is the predicted "confirm confirms no bug"
outcome.

**Minor observation (NOT fixed, not in scope):** `renderOpenStatus()` computes once
on load and doesn't re-run, so a page left open across an open→close boundary shows
a stale pill until reload. Low impact; noted for a future polish pass if desired.

## Net

REVIEW-02 closed. Code change is small and low-risk (admin display only — no money
path, no middleware). One owner data action remains (correct the bad Kits-sheet
row). Next phase in the milestone: 59 (Public-Site Trust Polish) — footer gap, cart
state, missing/lazy images.
