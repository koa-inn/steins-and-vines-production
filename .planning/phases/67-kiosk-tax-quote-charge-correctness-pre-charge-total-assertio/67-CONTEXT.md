# Phase 67: Kiosk Tax Quote-Charge Correctness - Context

**Gathered:** 2026-07-30
**Status:** Ready for planning
**Source:** PRD Express Path (owner handoff 2026-07-30 + `.planning/debug/kiosk-tax-under-quote.md` diagnosis; owner approved scope in-session)

<domain>
## Phase Boundary

Close the kiosk quote≠charge seam diagnosed from INV-000160: the kiosk displayed a total taxed at 5% while the server charged the correct 12% (GST+PST). The card charge and Zoho invoice were correct; the kiosk-displayed total was silently wrong. This phase makes any client/server total divergence LOUD (fail-closed before charging) and removes every silent tax-rate guess.

In scope: kiosk client tax math + catalog freshness (`js/kiosk-core.js`, `js/kiosk.js`), middleware sale-time tax computation and pre-charge assertion (`zoho-middleware/routes/pos.js`), regression tests both sides.
Out of scope (deferred): Zoho item-create/update webhook cache busting; shareable `batch.html?...&token=` URL token exposure (`admin.js` ~8137/8148, `kiosk-core.js` ~3074 — separate finding, future phase); catalog.js enrichment refactors beyond what the fix requires.

</domain>

<decisions>
## Implementation Decisions

### Pre-charge assertion (highest-value fix)
- The kiosk client MUST send its displayed totals (at minimum tax total and grand total) with `POST /api/kiosk/sale`.
- The server MUST compare the client-displayed grand total against its computed `grandTotal` BEFORE any Helcim terminal charge. On mismatch (beyond a cent-rounding tolerance of $0.01): reject the sale (400-class, no charge, idempotency lock released per existing patterns) with a staff-actionable error like "Totals changed — refresh the product list and re-ring the sale."
- The existing documented behavior "client-supplied `tax_total` is ignored" changes to "client totals are never TRUSTED for pricing but are ASSERTED against" — server-computed totals remain the only source of financial truth (price anchoring is unchanged).
- Backward compatibility: sales from clients that do not send the displayed total (old cached JS) must not break — assertion applies only when the field is present. (Deploy ordering: middleware first, then frontend.)

### Remove all three silent 5% fallbacks
- `js/kiosk-core.js` cart tax calc (~line 767-768): `isNaN(pct) → KIOSK_TAX_RATE_DEFAULT*100` — REMOVE. Missing/unparseable `tax_percentage` is a data error: flag the affected item by name in the kiosk UI and block checkout for that cart (fail-closed), never guess.
- `js/kiosk-core.js` `kioskItemTax` (~line 605): `parseFloat(item.tax_percentage) || 0` — reconcile with the cart-calc behavior deliberately (same missing-tax detection, same flag path). One consistent behavior across both call sites.
- `zoho-middleware/routes/pos.js` `computeTax`: `!pct && !catalogItem.tax_id → defaultTaxRate` (KIOSK_TAX_RATE env, 5%) — REMOVE the guess. A catalog item with no resolvable tax (no pct, no tax_id, no rule mapping) fails the sale closed with an error naming the item/SKU. Fail-closed matches this repo's money-path doctrine (Phase 52 fail-closed sweep).
- Legitimate 0% items (zero-rated ingredients, gift certs, custom exempt lines) must keep working: 0 is a VALID resolved rate; only missing/unresolvable is an error. Custom-line and gift-cert tax handling in computeTax is unchanged.

### Client catalog freshness
- Re-fetch the kiosk in-memory catalog (`kioskLoadProducts`) when a new cart is started AND/OR immediately before checkout begins, so quotes are never computed from an arbitrarily old snapshot. Choose the implementation point(s) so a parked-overnight kiosk cannot quote from a stale catalog; a fetch failure keeps the last-good catalog (existing keep-last-good behavior) — the pre-charge assertion is the backstop when staleness persists.
- Do NOT add periodic background polling if a cart-lifecycle refresh covers the exposure; keep Zoho quota load in mind (existing 30-min server cache TTL and `?bust=1` semantics unchanged).

### Tests (regression-first per CLAUDE.md rule 3 — write failing tests before fixes)
- Middleware: compound-tax catalog resolution — item with BC PST + GST (`tax_id 109900000000029101` / rule `109900000000033423`) resolves `tax_percentage === 12` through the kiosk catalog build path.
- Middleware: `computeTax` with a catalog item missing tax data does NOT silently apply 5% — sale is rejected fail-closed.
- Middleware: pre-charge assertion — client total ≠ server grandTotal → 400, no charge; matching totals (within $0.01) → sale proceeds; absent client total → sale proceeds (back-compat).
- Frontend: kiosk cart calc with missing `tax_percentage` does NOT compute 5% — surfaces the flagged-item state instead.
- Frontend: catalog refresh fires at the chosen cart-lifecycle point(s).

### Claude's Discretion
- Exact field name(s) for the client-displayed totals in the sale body; exact error codes/copy; how the kiosk UI flags a missing-tax item (banner vs line badge) as long as checkout is blocked and the item is named; where precisely the catalog refresh hooks in (`New Sale` already force-refreshes — cover the paths it misses); tolerance implementation detail.
- Whether kiosk-core changes require the standard `npm run build` artifact regeneration for `kiosk-core.js` min artifacts — follow existing build conventions (never hand-edit min.js; revert unrelated stamp churn as in phases 64-02/64-03).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Diagnosis (primary source of truth for this phase)
- `.planning/debug/kiosk-tax-under-quote.md` — full root-cause analysis, exact file/line targets, live-payload evidence, proposed fix set

### Code under change
- `js/kiosk-core.js` — client cart tax calc (~755-779), `kioskItemTax` (~603-607), `KIOSK_TAX_RATE_DEFAULT` (~237), `kioskLoadProducts` (~833)
- `js/kiosk.js` — kiosk page wiring: product load (~315), post-sale refresh (~1178), refresh button (~1174-1180)
- `zoho-middleware/routes/pos.js` — `/api/kiosk/sale` (~237), `processSale` price anchoring (~341-375), `computeTax`, `processSaleWithPrices`
- `zoho-middleware/routes/catalog.js` — `rebuildKioskCatalog` (~802-872), `_TAX_RULE_PCT` map (~111-120) — read-only context for how tax_percentage is produced

### Doctrine
- Phase 52 fail-closed sweep (`.planning/phases/52-fail-closed-sweep/`) — money-path fail-closed patterns this phase must match
- `CLAUDE.md` — regression-test-first, build-artifact, and dual-test-suite rules

</canonical_refs>

<specifics>
## Specific Ideas

- Confirmed live example: INV-000160, kiosk ref KIOSK-1785367461820, Helcim txn 52320110 — kiosk quoted ~$300.30, charged $315.42; delta $15.12 = 7% PST on $216 of `750-champ-fl`.
- Live catalog today serves `750-champ-fl` correctly (12%): the payload-side enrichment is NOT the active defect; client staleness + silent fallbacks + missing assertion are.
- `processSale` already receives `tax_total` in the body (currently documented-ignored at pos.js ~229-233) — natural vehicle for the assertion.

</specifics>

<deferred>
## Deferred Ideas

- Zoho item create/update webhook → catalog cache bust (or TTL shortening) — server cache was correct at sale time; revisit if assertion rejections show staleness in practice.
- Public batch-view token in shareable URLs (`admin.js`, `kiosk-core.js`) — distinct security finding from 64-03, needs its own phase.
- Unifying the compound-tax sum inconsistency across all four catalog.js enrichment paths — only touch if the kiosk-path fix requires it.

</deferred>

---

*Phase: 67-kiosk-tax-quote-charge-correctness*
*Context gathered: 2026-07-30 via PRD Express Path (owner handoff + in-session diagnosis)*
