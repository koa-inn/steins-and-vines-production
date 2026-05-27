# Phase 14: Kiosk Recipe Sales, Inventory, and Batch Creation - Context

**Gathered:** 2026-05-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Staff can sell a recipe on the kiosk end-to-end: browse active recipes in a dedicated tab, select one, choose in-store or take-out, process payment via Helcim terminal, have a Zoho invoice created with per-ingredient line items, inventory deducted, and (for in-store only) a batch auto-created in BrewPad. Feature-gated by `BEER_SALES_ENABLED` server-side. No public recipe browsing, no online ordering, no BeerXML import in this phase.

</domain>

<decisions>
## Implementation Decisions

### Kiosk Recipe Selection UX
- **D-01:** Dedicated "Recipes" tab on the kiosk alongside the existing Products and Sales Orders tabs. Recipe cards show name, style, ABV, and locked price. One tap selects and populates the cart with all ingredient line items plus applicable fees.

### In-Store vs Take-Out Prompt
- **D-02:** After selecting a recipe, staff is prompted to choose **"Ferment in Store"** or **"Take Out"** before proceeding to payment. This choice determines:
  - **Ferment in-store:** Brewing fee + materials fee added to cart. Batch auto-created in BrewPad after payment.
  - **Take-out:** No brewing or materials fee. Optional milling fee (existing Zoho service item) added if staff selects grain milling. No batch created.
- **D-03:** Milling fee for take-out uses the existing Zoho service item (already in Railway env vars). Staff toggles "Mill grain?" before confirming the take-out sale.

### Ingredient Reservation & Race Conditions
- **D-04:** Simple mutex — one recipe sale at a time. Redis lock (~30 sec TTL) on the recipe sale endpoint. Only one recipe sale can be in-flight. Fits single-location, single-kiosk reality. If lock acquisition fails, show "Another recipe sale in progress — try again in a moment."
- **D-05:** Availability check runs before payment (using existing `GET /api/recipes/:id/availability` from Phase 13). If any ingredient is out of stock, block the sale with a clear message. No partial sales.

### Invoice Line Item Structure
- **D-06:** One Zoho invoice line item per ingredient (quantity from recipe) plus one line for brewing fee (in-store) or milling fee (take-out, if selected). This naturally deducts per-ingredient stock through Zoho's invoice → inventory deduction path.
- **D-07:** Invoice line items use `item_id` from the recipe's ingredient records (Zoho item IDs stored in RecipeIngredients sheet). Fees use the existing `MAKERS_FEE_ITEM_ID` / `MATERIALS_FEE_ITEM_ID` env vars for in-store, or the milling fee service item for take-out.
- **D-08:** The `locked_price` is the total customer-facing price (what they pay), NOT the sum of ingredient costs. The invoice's individual ingredient lines are priced at their Zoho `rate` — the locked_price is used as the displayed total on the kiosk receipt/cart, but the invoice itemizes at ingredient rates + fee.

### Batch Auto-Creation
- **D-09:** Fire-and-forget after payment succeeds — same async pattern as existing kit→batch detection in brewpad-integration.js. Staff sees "Sale Complete" immediately; batch appears in BrewPad within seconds.
- **D-10:** `detectRecipeSale()` is a separate function from `detectKitItems()` — never conflate the two code paths. Recipe batch creation uses recipe_id to look up the recipe, serializes `recipe_snapshot` JSON, and links to the Zoho SO number.
- **D-11:** Customer info on the batch comes from the existing kiosk customer linkage (already in the kiosk sale flow). No additional input needed from staff.
- **D-12:** If batch creation fails after payment (Apps Script timeout, cold start), it fails silently — staff can create the batch manually in BrewPad. Same accepted risk as kit batch auto-creation. No void, no retry.

### Feature Gate
- **D-13:** `BEER_SALES_ENABLED` check happens server-side at the recipe sale confirm endpoint. When false, the endpoint returns a 403 with a clear message. The kiosk Recipes tab can still be visible (for testing), but payment is blocked server-side.

### Claude's Discretion
- **Recipe card design:** Claude designs the card layout for the kiosk Recipes tab. Should feel consistent with existing kiosk product cards. Show: name, style, ABV, locked_price, availability status dot.
- **In-store/take-out prompt UI:** Claude decides the prompt format. Could be two large buttons, a modal, or inline selection. Should be fast and clear — staff makes this choice dozens of times a day.
- **Endpoint structure:** Claude decides whether recipe sales use the existing `/api/kiosk/sale` with a `type: 'recipe'` flag, or a new dedicated `/api/kiosk/recipe-sale` endpoint. Recommendation: new endpoint keeps concerns separated from the existing product sale flow.
- **Mutex implementation:** Claude decides Redis key pattern and lock/unlock approach. Standard redlock-lite pattern with TTL is fine.
- **Error handling:** Claude decides how to handle edge cases (payment success + invoice failure, partial ingredient deduction). Should follow existing void-on-Zoho-failure pattern from the kiosk.

</decisions>

<deferred>
## Deferred Ideas

- **BeerXML import** — Phase 15, not this phase
- **Public recipe browsing** — v2.1 (PUB-01, PUB-02)
- **Ad-hoc recipe builder** — v2.1 (ADH-01)
- **Batch completion auto-adjusts inventory** — v2.1 (BWF-01)
</deferred>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Context
- `.planning/PROJECT.md` — Milestone goals, constraints, key decisions
- `.planning/REQUIREMENTS.md` — KSK-01 through KSK-04, BAT-01 through BAT-03, INV-01 through INV-03
- `.planning/ROADMAP.md` — Phase 14 success criteria, dependency on Phase 13

### Prior Phase Context
- `.planning/phases/12-recipe-data-foundation/12-CONTEXT.md` — Recipe schema decisions (fee structure, status workflow, feature flag)
- `.planning/phases/13-middleware-api-admin-recipe-management/13-CONTEXT.md` — Middleware API contract, availability checking, caching strategy
- `.planning/phases/13-middleware-api-admin-recipe-management/13-02-SUMMARY.md` — Middleware recipe API shape (endpoints, response format)

### Existing Kiosk Patterns
- `zoho-middleware/routes/pos.js` — Existing kiosk sale flow (POST /api/kiosk/sale), Helcim terminal integration, void-on-failure pattern
- `zoho-middleware/routes/collect.js` — POS collect endpoint (terminal payment confirmation)
- `zoho-middleware/lib/brewpad-integration.js` — Existing kit→batch auto-creation (detectKitItems, fire-and-forget pattern)
- `js/admin.js` — Kiosk tab UI (product grid, cart, payment flow)
- `zoho-middleware/lib/constants.js` — CACHE_KEYS, ITEM_TYPES, fee item IDs

### Recipe API (from Phase 13)
- `zoho-middleware/routes/recipes.js` — GET /api/recipes (list), GET /api/recipes/:id (detail), GET /api/recipes/:id/availability (stock check)
- `apps-script/adminApi.gs` — Recipe CRUD via server-token POST branch

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `routes/pos.js` POST /api/kiosk/sale: Full sale flow pattern (validate → Helcim terminal → Zoho invoice → payment record → cache bust). Recipe sale endpoint can follow same structure.
- `lib/brewpad-integration.js` detectKitItems(): Async batch creation after sale. Recipe batch creation follows same fire-and-forget pattern but with separate `detectRecipeSale()` function.
- `routes/recipes.js` GET /api/recipes/:id/availability: Pre-sale stock validation. Call this before payment to ensure all ingredients are in stock.
- Helcim POS terminal flow: Push → poll → confirm pattern already handles timeouts. Recipe sales reuse this entirely.
- Existing kiosk tab system in admin.js: Tab switching, product grid rendering, cart management. Recipes tab integrates alongside.

### Integration Points
- `BEER_SALES_ENABLED` env var: Already registered in validateEnv.js. Just needs enforcement logic at the sale endpoint.
- `MAKERS_FEE_ITEM_ID` / `MATERIALS_FEE_ITEM_ID`: Already in Railway env. Used as Zoho line items for in-store fee.
- Milling fee: Existing Zoho service item. Need the item_id in an env var (or hardcode if stable).
- Customer linkage: Kiosk flow already captures customer info for Zoho invoice. Passes through to batch creation.
- `recipe_snapshot` column: Already exists in Batches sheet (Phase 12). Populated at sale time.

### Constraints
- Redis reservation must be simple (mutex, not per-ingredient) per D-04.
- Feature flag enforcement must be server-side per D-13 and existing roadmap decision.
- No composite items — invoice uses individual ingredient line items per D-06.
</code_context>
