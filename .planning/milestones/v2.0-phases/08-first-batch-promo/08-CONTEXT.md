# Phase 8: First-Batch Promo - Context

**Gathered:** 2026-05-03
**Status:** Ready for planning

<domain>
## Phase Boundary

New customers see a 20% discount offer on the homepage and can apply promo code FIRSTBATCH at checkout, with one-use-per-email enforcement via Redis. The promo applies to the online checkout flow and integrates with the existing kiosk discount system.

</domain>

<decisions>
## Implementation Decisions

### Banner Placement and Design
- **D-01:** Full-width hero banner on the homepage — bold strip positioned above or below the hero section for maximum visibility.
- **D-02:** Banner is dismissible with localStorage memory — once dismissed, it doesn't reappear for that visitor.
- **D-03:** Banner content is JSON-driven via `content/home.json` — a `promo-banner` object with text, code, and `enabled` flag. Toggle the promo on/off by editing the JSON and pushing. No expiry date — disable via JSON when done.

### Promo Code Input UX
- **D-04:** Promo code field appears in the online checkout flow. Placement is Claude's discretion (standard e-commerce positioning).
- **D-05:** Validation happens on "Apply" button click — a new middleware endpoint validates the code AND checks email eligibility in one call. Email field must be filled before applying.
- **D-06:** Applied code is removable — a small "x" or "Remove" link lets the user clear the discount and restore original pricing before payment.
- **D-07:** Kiosk integration — connect FIRSTBATCH to the existing kiosk discount presets system so staff can apply it there too. Same server-side redemption enforcement applies.

### Redemption Enforcement
- **D-08:** Email is required at code validation time (Apply click). The validate endpoint checks both code validity and whether the email has already redeemed.
- **D-09:** Redemption is "burned" only on successful payment — if the customer abandons checkout, the code remains available for them to use later.
- **D-10:** No expiry date — promo runs until disabled via JSON toggle in `content/home.json`.

### Discount Scope
- **D-11:** 20% off applies to all kit line items AND Maker's Fee in the cart. Not limited to one kit — all kits get the discount.
- **D-12:** Ingredients/supplies in the dual-cart are NOT discounted. The promo is about the "first batch" ferment-in-store experience only.

### Claude's Discretion
- Banner placement on products page (in addition to homepage) — pick based on conversion funnel logic
- Exact positioning of promo code field in checkout layout
- How to integrate FIRSTBATCH into kiosk discount presets (auto-appear as a preset vs. separate code input)
- Admin tooling for viewing/resetting redemptions — minimum viable approach (simple endpoint or Redis CLI)
- Redis key structure for redemption tracking
- Error message copy for already-redeemed and invalid code states
- Whether to show the discount breakdown per-line-item or as a single summary line

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Checkout flow (where promo code field goes)
- `js/modules/12-checkout.js` — Main checkout module. Already handles per-item `discount` field (percentage), renders discount badges, and calculates discounted totals. Lines 400-410 (badge rendering), 617-663 (discount math).
- `zoho-middleware/routes/checkout.js` — Server-side checkout processing. `processCheckout()` at line 152. Custom fields on sales orders at lines 380-406.

### Server-side pricing (discount enforcement)
- `zoho-middleware/lib/pricing.js` — `computeLineItem` with `discountPct` option. Server never trusts client-supplied discount (C3 constraint). Lines 31-58.

### Existing discount system (kiosk integration point)
- `zoho-middleware/routes/discounts.js` — Kiosk discount presets CRUD. `GET /api/kiosk/discounts` at line 75. Redis-cached preset storage.
- `zoho-middleware/lib/constants.js` — `CACHE_KEYS.KIOSK_DISCOUNT_PRESETS` at line 55.

### Homepage content system (banner source)
- `content/home.json` — Content JSON with `promo-news` array, `promo-featured-skus`. New `promo-banner` object will live here.
- `js/modules/06-featured.js` — Renders promo-news items. Pattern for rendering banner from content JSON.
- `js/modules/13-init.js` — Content loader that fetches `content/{page}.json` and replaces `[data-content]` elements.

### Requirements
- `.planning/REQUIREMENTS.md` — PROMO-01, PROMO-02, PROMO-03 define the acceptance criteria

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Per-item `discount` field already flows through the checkout pipeline (client-side calc + badge rendering)
- `computeLineItem` in `pricing.js` has server-side `discountPct` param — discount is applied server-authoritatively
- Content loader in `13-init.js` fetches JSON and injects into `[data-content]` elements — reuse for banner rendering
- Redis cache module available for redemption tracking (`zoho-middleware/lib/cache.js`)
- Kiosk discount presets system stores and retrieves discount configurations from Redis

### Established Patterns
- Server never trusts client-supplied discount (C3 constraint in pricing.js) — promo discount must be applied server-side
- `content/home.json` drives homepage content without code deploys — same pattern for promo banner toggle
- Dual-cart checkout handles ferment and ingredient carts separately — discount can be applied to ferment cart only
- Checkout already sends `item_type` per line item — can distinguish kits from ingredients server-side

### Integration Points
- New middleware endpoint: `POST /api/promo/validate` — accepts code + email, returns validity + discount details
- `processCheckout` in checkout.js — needs to re-validate promo code server-side and apply `discountPct` to kit line items
- `content/home.json` — new `promo-banner` object alongside existing `promo-news`
- Kiosk discount presets — FIRSTBATCH appears as a preset or code input in the kiosk flow
- Redis — new key pattern for redemption tracking (email → redeemed timestamp)

</code_context>

<specifics>
## Specific Ideas

- The promo code is literally "FIRSTBATCH" — hardcoded as the valid code (not a generic promo system)
- Banner should clearly show the code visually so visitors can remember it at checkout
- "First batch" messaging ties to the ferment-in-store experience, not general shopping

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 8-First-Batch Promo*
*Context gathered: 2026-05-03*
