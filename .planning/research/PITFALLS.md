# Pitfalls Research

**Domain:** Recipe-based fermentation products added to existing ferment-in-store e-commerce/POS system
**Researched:** 2026-05-09
**Confidence:** HIGH (system internals read directly; external pitfalls verified with official docs and community sources)

---

## Critical Pitfalls

### Pitfall 1: Inventory Race Condition on Multi-Ingredient Recipe Sales

**What goes wrong:**
A recipe sale deducts 8-15 individual ingredient line items. If two customers purchase the same recipe simultaneously (or one kiosk sale and one online order overlap), both transactions read the same stock levels before either write completes. Both see sufficient stock. Both proceed. Both deduct. One sale's deduction is silently overwritten — stock goes negative or an ingredient is committed when there wasn't enough.

**Why it happens:**
The existing `inventory-ledger.js` uses Redis `incrByFloat` per item in a pipeline, which is atomic per item. However, there is no check-then-reserve transaction that spans multiple items. The current flow is: check catalog → build line items → charge terminal → create invoice → decrement stock. The gap between "check" and "decrement" for 10+ items is wide enough for a race.

For the current single-SKU kit sales this is low risk — one item per sale. For recipes with 10-15 ingredients it becomes a real problem because the cumulative window is proportionally larger and the ingredient pool is shared with the separately-sold ingredients tab.

**How to avoid:**
Implement a reservation step before payment. Before collecting payment:
1. Attempt to atomically reserve all recipe ingredients in Redis using `DECRBY` with a floor check (Lua script or pipeline that reads then conditionally decrements).
2. If any ingredient can't be reserved (would go below zero), abort the sale and display which ingredient is out of stock.
3. On payment success: confirm reservation (it's already decremented). On payment failure: restore reservation with `INCRBY`.

Concretely: write a `reserveIngredients(lineItems)` function in `inventory-ledger.js` that uses a single Redis Lua script covering all items atomically, or use Redis `MULTI/EXEC` watch on all stock keys (optimistic locking). A simpler acceptable alternative given kiosk-only sales volume: add a recipe sale mutex key (e.g., `recipe:sale:lock`) with a short TTL to serialize recipe sales without blocking ingredient sales.

**Warning signs:**
- Zoho Inventory shows stock at -1 or -2 for an ingredient that should have been blocked.
- Two batch records for the same brew date with the same customer but different Zoho invoice numbers (two sales went through).
- Staff reports "we ran out but the system showed in stock."

**Phase to address:**
Recipe data model phase (Phase 1) — before any recipe sales flow is built. The reservation model must be designed before the kiosk sale route is extended.

---

### Pitfall 2: Pricing Drift When Recipe Price Is Computed as Sum of Live Ingredient Rates

**What goes wrong:**
If the recipe's displayed price is computed at browse time by summing current Zoho ingredient rates, the price shown to the customer changes whenever a supplier raises an ingredient price. A customer browses, sees $62 for a pale ale, and ten minutes later during checkout the price recalculates to $67 because malt was updated in Zoho. Or worse: the price is cached at $62 and a sale goes through at the lower price, eroding margin.

Ingredient prices fluctuate: hop prices are particularly volatile seasonally. A 20% increase in one primary ingredient (e.g., pale malt at ~5 kg per batch) can silently move a recipe from 40% margin to 28% margin without any alert.

**Why it happens:**
Developers naturally reach for "just sum the ingredients" as the recipe price — it's accurate and auto-updating. But live rate summation couples pricing to inventory cost in ways that are hard to control. The existing pricing module (`pricing.js`) is server-authoritative and uses catalog rates — that's correct — but recipes don't yet exist as first-class catalog items.

**How to avoid:**
Store a `locked_price` on each recipe in Google Sheets that is explicitly set by staff, not computed live. The locked price is the price customers see and what Zoho charges. Separately store a `cost_basis` (sum of ingredient rates at time of last lock) so staff can see margin. Show staff a warning when current ingredient costs have drifted more than X% from cost basis. Never compute a customer-facing price from live ingredient rates at runtime.

For the brewing fee: define it as a flat line item (like the existing Maker's Fee/Materials Fee pattern) separate from ingredient cost. This gives pricing control independent of ingredient market prices.

**Warning signs:**
- Recipe prices on the public site change between page loads.
- Staff notices the recipe "should cost $65" but system shows $58 on some days.
- Margin reports show unexplained variance week to week despite stable sales volume.

**Phase to address:**
Recipe data model phase — locked_price and cost_basis fields must be in the recipe schema from the start. Pricing drift is impossible to retrofit once customers have seen "live price" behavior.

---

### Pitfall 3: BeerXML Unit Ambiguity and BeerSmith Non-Compliance

**What goes wrong:**
BeerXML mandates kilograms for all weights and liters for all volumes. BeerSmith's export does not strictly comply with the BeerXML spec — the Brewtarget manual documents this explicitly: "Beersmith does not strictly adhere to XML standards or even BeerXML itself, so you may have some trouble importing recipes from time to time." BeerSmith 2's BeerXML export was documented as "not yet complete" at release.

Specific failure modes:
- `AMOUNT_IS_WEIGHT` flag defaults to `FALSE` (volume) for yeast and misc items. A dry yeast packet recorded as 11g will be interpreted as 11 liters if this flag is absent or false.
- Display-only fields in Appendix A (like `DISPLAY_AMOUNT`) are explicitly marked "not for use in calculations" — but they often contain human-readable values like "2 oz" that look like the real amount. Importing `DISPLAY_AMOUNT` instead of `AMOUNT` will give wildly wrong quantities.
- Booleans must be uppercase `TRUE`/`FALSE` — any other value (including `true`, `1`, `yes`) is technically invalid and parsers that use `=== 'TRUE'` will misread flags.
- Hop alpha acid is expressed as a percentage (0-100), not a decimal (0-1). Misreading 5.5% as 0.055 produces hop quantities 100x off, which may still pass a sanity check for small recipes.
- Tag order is not guaranteed — any field can appear in any position. An XML parser that assumes sequential order (common with naive manual parsing) will silently skip fields.

**How to avoid:**
Write the BeerXML importer against the spec, not against BeerSmith's specific output. Test against at least three sources: BeerSmith export, Brewfather export, Brewtarget export — they all differ. Validate `AMOUNT_IS_WEIGHT` explicitly before treating any amount as weight or volume. Reject or warn on `DISPLAY_AMOUNT` if `AMOUNT` is present. Parse with a real XML parser (not regex or string splitting). Add a "review before import" step where staff sees a table of mapped ingredients before committing, so unit errors are caught visually.

Canonical unit assertions to check on import:
- Grain amounts: must be in kg, typically 0.1–10 kg per ingredient per batch
- Hop amounts: must be in kg, typically 0.01–0.2 kg per ingredient per batch
- Water volumes: must be in liters, typically 20–30 liters per batch
- Yeast: check `AMOUNT_IS_WEIGHT`; typical dry yeast packet = 0.011 kg

**Warning signs:**
- An imported recipe shows 2000 kg of pale malt (forgot to convert from grams, or misread display value).
- A dry yeast ingredient maps to 11 L quantity.
- Import produces a recipe with zero ingredients (tag name casing mismatch — BeerXML requires uppercase tags, some tools export mixed case).
- Hop bittering shows 0% IBU contribution (alpha acid misread as decimal instead of percentage).

**Phase to address:**
BeerSmith import phase — validation and preview step must be built before any recipe is auto-imported into the system. No import should commit to Sheets without staff review.

---

### Pitfall 4: Recipe-as-Cart Confuses the Existing Dual-Cart Architecture

**What goes wrong:**
The existing system has two carts with separate storage keys (`sv-cart-ferment` and `sv-cart-ingredients`), separate checkout flows, and explicit routing via `_item_type`. A recipe sale is fundamentally different: it is a set of ingredients that should not go into the ingredients cart (the customer isn't buying them to take home), but it also isn't a single-SKU kit that goes in the ferment cart.

If recipes are naively added to the ingredients cart, staff checking out a recipe at the kiosk will also check out any ingredients the customer separately added. If recipes are added to the ferment cart, the checkout flow will expect a Maker's Fee item and a single kit SKU — neither of which maps to a multi-ingredient recipe.

A second failure mode: `getReservedQty(productKey)` searches both carts. If an ingredient appears in a recipe cart and the customer separately adds it to the ingredients cart, the displayed quantity combines them, confusing staff.

**Why it happens:**
The dual-cart system was designed for two distinct product types. Recipe sales are a third type. Adding them by shoehorning into one of the existing carts is expedient but breaks assumptions throughout cart rendering, checkout routing, and BrewPad batch detection.

**How to avoid:**
Recipe sales at the kiosk should bypass the client-side cart system entirely for the initial implementation. The kiosk staff selects a recipe, the middleware receives the recipe ID, explodes it into ingredient line items server-side, adds the brewing fee, and processes as a single atomic kiosk sale. The kiosk UI shows the recipe selection but the cart is not a persistent multi-item cart — it's a one-shot "select recipe → confirm → charge" flow with a summary view.

This avoids modifying the dual-cart architecture and keeps the recipe sale path isolated. The existing `processSale` in `pos.js` can accept an expanded line items array; nothing needs to change in the cart client code.

**Warning signs:**
- The cart count badge shows ingredient quantities that include recipe ingredients.
- A customer tries to add a recipe to their cart alongside loose ingredient purchases and sees a combined checkout.
- BrewPad batch detection (`detectKitItems`) fires for recipe ingredients and tries to create one batch per ingredient rather than one batch per recipe.

**Phase to address:**
Kiosk recipe sales phase — the architectural boundary must be drawn explicitly in the kiosk UI before any recipe sale code is merged. Document clearly: recipe sales are a distinct server-side flow, not a cart-based flow.

---

### Pitfall 5: Zoho API Rate Budget Exhaustion During Multi-Item Recipe Deduction

**What goes wrong:**
A recipe sale with 12 ingredients currently requires no special Zoho handling because Zoho creates the invoice with all line items in a single `POST /invoices` call. However, if the system is extended to do individual per-ingredient inventory adjustments via the Zoho Inventory API (separate from the invoice creation), it could fire 12+ API calls per sale.

At 100 requests/minute and 10 concurrent calls (Zoho's paid plan limits), a burst of 3-4 simultaneous recipe sales in the morning rush could exhaust the per-minute quota. The existing 90-second cooldown backoff in `catalog.js` was already triggered in production (noted in MEMORY.md: "Rate limited at 700ms delay; may need multiple runs for 429 errors"). Adding recipe deduction calls compounds this.

**Why it happens:**
The existing architecture already pushes against Zoho rate limits during cold-cache catalog refreshes. Recipe sales add a multiplier: instead of 1 API call to create an invoice for a kit sale, a recipe sale might trigger invoice creation + inventory update calls per ingredient.

**How to avoid:**
Use Zoho's invoice line items (already implemented) as the single inventory deduction mechanism — Zoho Inventory deducts stock when an invoice/sales order with those item IDs is created. Do not add separate inventory adjustment API calls per ingredient. The existing `decrementStock` in `inventory-ledger.js` handles the Redis shadow copy immediately; Zoho handles the authoritative deduction via the invoice creation. This design already minimizes Zoho API calls.

Verify: confirm in Zoho that creating a sales order/invoice with 12 ingredient line items correctly deducts each ingredient's stock (it should — this is Zoho's standard behavior). Do not add additional `PUT /inventoryadjustments` calls unless Zoho is not deducting correctly.

**Warning signs:**
- 429 errors spiking in logs coinciding with recipe sales, not just catalog refreshes.
- Cooldown windows extending past 90 seconds (new rate limit trigger beyond catalog).
- Ingredient stock in Zoho drifting from expected values (double-deduction if both invoice and adjustment calls fire).

**Phase to address:**
Kiosk recipe sales phase — confirm Zoho deduction behavior with a test sale before adding any supplementary inventory calls.

---

### Pitfall 6: Recipe Versioning Breaks Existing Batches When Ingredient Availability Changes

**What goes wrong:**
A recipe is created with 12 ingredients. Six months later, one hop variety becomes unavailable (out of season, supplier discontinues). Staff updates the recipe to substitute a different hop. Now all historical batches linked to that recipe appear to have used the new hop, which is wrong. The fermentation schedule templates, Plato reading targets, and any QA notes all reference the recipe, not a recipe version. A customer who asks "what did you use in my batch from January" gets incorrect information.

A worse scenario: staff edits the recipe quantity for an ingredient, changing the price basis. Existing batch records that reference the recipe ID now reflect the updated quantities, potentially invalidating cost records for completed batches.

**Why it happens:**
Recipe data stored in Google Sheets is mutable. Batch records store a reference (recipe ID or name) not a snapshot. This is the same problem version control solves for code, but most developers don't think about it for recipe data until a batch's historical record becomes wrong.

Brewfather solves this by storing "a copy of the recipe as it was when brewed" per batch. This is the right model.

**How to avoid:**
When a kiosk recipe sale is processed, snapshot the full recipe (all ingredients, quantities, fee structure) into the batch record at creation time. The batch's recipe data is immutable after creation. Recipe updates in admin only affect future sales. The recipe in Sheets is a template; the batch record in Sheets contains the authoritative historical snapshot.

For the Google Sheets data model: add a `recipe_snapshot` JSON column to the Batches tab that contains the full ingredient list at time of batch creation. This can be serialized as a JSON string in a single cell (Sheets supports long strings; the 50,000 character cell limit is unlikely to be hit by a recipe snapshot).

**Warning signs:**
- A batch created 6 months ago shows a hop variety that wasn't available at that time.
- Updating a recipe changes the displayed ingredient list for historical batches.
- Cost analysis for completed batches shows inconsistent ingredient costs over time even when the recipe "didn't change."

**Phase to address:**
Recipe data model phase (Phase 1) — the snapshot field must be in the Batches schema before the first recipe sale. Cannot be added retroactively without data migration.

---

### Pitfall 7: Brewing Licence Timing Creates a "Feature Exists But Can't Be Used" Gap

**What goes wrong:**
The federal brewing licence is pending. If recipe sales are built, tested, and deployed to production before the licence is granted, staff can accidentally ring up a beer recipe sale — or customers on the public site can enquire about (or attempt to purchase) products that cannot yet legally be sold. If the licence takes longer than expected (common with federal approvals), the system sits in an awkward state for an extended period.

A second risk: the system is designed assuming a certain licence structure. If the licence comes with conditions (e.g., can only sell for on-premises consumption, or specific permit number must appear on all receipts), the system may need changes just before go-live.

**Why it happens:**
Building ahead of licence is efficient — but it creates pressure to enable features before regulatory clearance, and it makes assumptions about licence conditions that may not hold.

**How to avoid:**
Build the entire recipe system with a feature flag (`BEER_SALES_ENABLED` env var on Railway, defaulting to `false`). Recipe browsing on the public site can be enabled before the licence (informational/coming soon). Recipe sales on the kiosk must be gated behind the flag. The flag requires a Railway env var change to enable — no code deploy needed.

Additionally: before enabling, read the licence conditions carefully and confirm no receipt fields, product registration, or tax treatment requirements were missed. In BC, manufactured beer sold on-premises requires PST collection under different rules than brewing ingredient sales (PST-121 bulletin). Confirm the tax rule for "beer brewed and served by a micro-brewery" vs "fermentation service with customer ownership" before the first sale — they may differ.

**Warning signs:**
- Staff asks "can we sell beer recipes yet?" before licence is granted.
- Public site shows recipe products with a "buy now" button before licence approval.
- Recipe sales work on staging but licence conditions haven't been reviewed against the implementation.

**Phase to address:**
Recipe data model and kiosk recipe sales phases — feature flag implementation is mandatory before any recipe feature ships to production.

---

### Pitfall 8: BrewPad Batch Detection Fails for Multi-Ingredient Recipe Sales

**What goes wrong:**
The current `detectKitItems` function in `brewpad-integration.js` identifies kit items by the presence of a Maker's Fee line item, then creates one batch per non-fee item. For a recipe sale with 12 ingredient line items, this logic would create 12 batches — one per ingredient — which is completely wrong. A recipe sale should create exactly one batch.

Additionally, `detectKitItems` filters out only the Maker's Fee and Materials Fee items by their `item_id`. If the recipe brewing fee uses a different fee item ID, it won't be filtered out and may appear as a "kit" to batch creation.

**Why it happens:**
`detectKitItems` was designed for single-SKU kit sales. The detection heuristic ("presence of Maker's Fee = kit sale; everything else = the kit") breaks immediately when a sale has multiple non-fee line items.

**How to avoid:**
Recipe sales must trigger batch creation through a separate, explicit code path rather than relying on `detectKitItems`. When a recipe sale is processed on the kiosk, the sale payload should include an explicit `recipe_id` field. The `createBatchesFromSale` caller should check for `recipe_id` first and, if present, create one batch linked to the recipe rather than running `detectKitItems`.

The batch payload for a recipe sale needs an additional field: `recipe_id` and `recipe_name` stored in the batch record (and in the snapshot).

Existing kit sales continue to use `detectKitItems` unchanged. Recipe sales bypass it entirely. Document this explicitly in code comments to prevent future developers from unifying the two paths.

**Warning signs:**
- A test recipe sale creates 10+ batch records instead of 1.
- BrewPad shows ingredient names (e.g., "Pale Malt 2-Row") as product names in the batch list.
- The Zoho batch sync custom field on the invoice gets written 12 times, with the last write overwriting earlier ones.

**Phase to address:**
Kiosk recipe sales phase — before any recipe sale test, verify the batch creation path explicitly handles `recipe_id` and that `detectKitItems` is not in the call chain for recipe sales.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Compute recipe price live from ingredient rates | Always accurate, no maintenance | Price volatility visible to customers; margin invisible to staff | Never — use locked_price from day one |
| Store recipe ingredients as a flat comma-separated list in one Sheets cell | Simple to read | Impossible to query by ingredient; breaks when ingredient names contain commas | Never — use a separate RecipeIngredients tab |
| Reuse the existing ferment cart for recipe selections | No new cart code | Breaks dual-cart assumptions, cart count wrong, checkout routing wrong | Never — recipe kiosk flow is server-side |
| Skip the recipe snapshot on batch creation | Simpler batch schema | Historical batches show wrong ingredients after any recipe edit | Never — snapshot is mandatory for data integrity |
| Parse BeerXML with regex or string splitting | No XML parser dependency | Breaks on attribute order, multiline content, special characters, encoding differences | Never — use a real XML DOM parser |
| Use a single Sheets tab for all recipe data | Fewer tabs to manage | Google Sheets row/column limits hit sooner; Apps Script reads become slow | Only for MVP with fewer than ~20 recipes |
| Import BeerXML directly to production without review step | Faster workflow | Silent unit errors (11 liters of yeast) corrupt recipe data | Never — always require staff review before commit |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Zoho Inventory | Creating separate inventory adjustment API calls per ingredient after invoice creation | Invoice/sales order line items already trigger stock deduction in Zoho — no supplementary calls needed |
| Zoho Inventory | Treating composite items (assemblies) as the recipe model | Composite items require a separate assembly workflow in Zoho that conflicts with selling ingredients individually; keep recipes in Sheets only |
| Google Apps Script | Calling Apps Script synchronously and blocking the kiosk sale response | Fire batch creation as a post-sale async call (fire-and-forget with retry queue) — pattern already established in `brewpad-integration.js` |
| Google Apps Script | Storing recipe snapshots as separate cell values per ingredient field | Serialize the full snapshot as JSON in one cell; Apps Script reads the whole row and deserializes — avoids column proliferation |
| BeerSmith / BeerXML | Trusting `DISPLAY_AMOUNT` fields over `AMOUNT` fields | `DISPLAY_AMOUNT` is for UI rendering only (per spec, Appendix A); always use `AMOUNT` for calculations |
| Redis inventory ledger | Decrementing recipe ingredients without checking available stock first | Add pre-sale availability check before payment; a recipe sale that oversells an ingredient is harder to unwind than a declined pre-payment check |
| Helcim terminal | Processing a recipe sale amount computed from live ingredient rates | Amount must be computed server-side from locked_price, not from summed live rates; mirrors existing server-authoritative pricing pattern |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Apps Script cold-start latency on recipe load | First recipe catalog load takes 3-8 seconds (Apps Script wakes from cold start) | Cache recipe catalog in Redis with same TTL pattern as product catalog; warm on server start | Every time Railway restarts the middleware (Railway restarts are common on free-tier and after deploys) |
| Fetching full ingredient catalog to validate a recipe ingredient list on every sale | Ingredient catalog fetch on every recipe sale causes Zoho 429s during busy periods | Keep ingredient catalog in Redis (already done for `zoho:ingredients`); validate recipe ingredients against cache not Zoho live | When 5+ simultaneous kiosk recipe sales trigger concurrent Zoho fetches |
| Google Sheets row scan for recipe lookup | Apps Script reads all rows and filters in memory; slow at 200+ recipes | Add an index by recipe ID using `getValues()` on the ID column first, then `getRow()` for the target | Above ~500 recipe rows in the Sheets tab |
| BeerXML import parsing large files in the browser | Browser freezes parsing a 500KB BeerXML export with 50+ recipes | Parse on the server (middleware endpoint); browser only sends file, server returns parsed preview JSON | BeerSmith export of full recipe library |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Accepting recipe_id from kiosk client and exploding it to ingredients without server-side validation | Client can pass a fake recipe_id that resolves to a crafted ingredient list at unexpected prices | Always resolve recipe_id from server-side Sheets cache; never trust client-supplied ingredient lists for recipe sales |
| Storing the Apps Script server token in frontend JS for recipe management calls | Token exposed; anyone can modify recipe data | Recipe management is admin-only; token stays in middleware env vars; admin UI calls middleware endpoints, not Apps Script directly |
| Allowing BeerXML upload without file type and size validation | Malicious XML (billion laughs attack, XXE injection) via upload endpoint | Validate file size limit (e.g., 2MB max), use a safe XML parser with entity expansion limits, strip DOCTYPE declarations |
| Logging full recipe ingredient lists including quantities at INFO level | PII risk is low but recipe data could leak in log aggregation | Log recipe_id and recipe_name only; not ingredient details |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Showing recipe price as "from $X" because ingredients change | Customer arrives in-store with wrong price expectation | Show locked_price only; add "price may vary for custom recipes" disclaimer for custom consultations only |
| Recipe on the kiosk explodes into 12 ingredient line items on the receipt | Staff and customer confused by the receipt; looks like 12 separate purchases | Show recipe name as primary receipt line; ingredient detail in a collapsible section or a separate "recipe detail" printout |
| Treating recipe browsing on public site as equivalent to online purchase | Customer thinks they can order online before brewing licence is granted | Clear "reserve in store" / "book a consultation" CTA; no add-to-cart button for recipe products until licence is granted and online sales are enabled |
| Letting customers build custom recipes entirely self-serve on public site | Out of scope (per PROJECT.md); customers need staff guidance for custom recipes | Custom recipe requests are a consultation request form — not a cart/builder |
| BrewPad showing recipe batch with ingredient names as product | Staff confused when managing batch — "Pale Malt 2-Row" is not a useful batch description | Recipe batch always shows recipe name and style as primary identifiers |

---

## "Looks Done But Isn't" Checklist

- [ ] **BeerXML import:** Preview/review step before committing — verify staff sees a human-readable ingredient table, not raw XML field names.
- [ ] **Recipe sale on kiosk:** Confirm exactly one batch is created in BrewPad, not one per ingredient.
- [ ] **Recipe price:** Verify locked_price is used for Helcim charge amount, not a runtime sum of ingredient rates.
- [ ] **Inventory deduction:** Verify ingredient stock in Zoho decrements correctly from a recipe sale — test with a real test sale and check Zoho inventory before/after.
- [ ] **Licence gate:** Confirm `BEER_SALES_ENABLED=false` actually prevents recipe sale completion on kiosk (not just hides UI).
- [ ] **Recipe snapshot on batch:** Open a batch record in Sheets after a test recipe sale and verify the snapshot JSON field is populated with all ingredients and quantities.
- [ ] **Tax rules for recipes:** Confirm each ingredient line item in the recipe sale invoice uses the correct tax_id (brewing ingredients = 12% BC HST; brewing service fee = 5% GST only) — do not assume the same tax rule applies to all line items.
- [ ] **Concurrent recipe sale test:** Run two simultaneous kiosk recipe sales for a recipe that uses the same hop with only 2 units in stock — verify only one succeeds.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Race condition resulted in oversold ingredient | MEDIUM | Check Zoho inventory adjustment log; manually adjust stock; contact affected customer if needed; implement reservation before next deployment |
| BeerXML import committed wrong quantities | LOW | Delete the recipe from Sheets (or mark inactive); re-import with corrected file; no sales have occurred yet so no downstream impact |
| Wrong recipe version data in historical batches | HIGH | Requires manual data entry to reconstruct original ingredient list from BeerSmith source; add snapshot field retroactively; time-consuming for more than a handful of batches |
| Recipe sale created 12 batches instead of 1 | LOW | Delete the spurious batch records from Sheets (Apps Script admin endpoint); close the duplicate Zoho invoice custom field entries; fix the batch detection code before re-enabling |
| Beer sales went live without licence | HIGH | Immediately set `BEER_SALES_ENABLED=false` in Railway; refund any completed recipe sales; review BC LCRB requirements; document that no actual alcohol was sold (ferment-in-store means customer's product, not brewery's) |
| Locked_price not set on a recipe — sale went through at wrong price | MEDIUM | Void the Helcim transaction; reprocess at correct price; add schema validation that locked_price is required before any recipe can be marked active |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Inventory race condition | Phase 1 (Recipe data model) — design reservation model | Integration test: concurrent recipe sales against low-stock ingredient |
| Pricing drift from live ingredient rates | Phase 1 (Recipe data model) — locked_price required field in schema | Check: recipe price shown on kiosk does not change when Zoho ingredient rate changes |
| BeerXML unit ambiguity | Phase 2 (BeerSmith import) — validation and review step mandatory | Test: import BeerSmith export, Brewfather export, Brewtarget export and compare parsed quantities |
| Recipe-as-cart architecture confusion | Phase 3 (Kiosk recipe sales) — recipe flow is server-side, not cart-based | Check: no recipe ingredients appear in `sv-cart-ferment` or `sv-cart-ingredients` storage |
| Zoho API rate exhaustion | Phase 3 (Kiosk recipe sales) — confirm no supplementary inventory calls | Load test: 3 simultaneous recipe sales; monitor Zoho API call count in logs |
| Recipe versioning / snapshot | Phase 1 (Recipe data model) — snapshot field in Batches schema | Check: edit a recipe after a test sale; verify batch record still shows original ingredients |
| Licence timing / feature flag | Phase 1 (Recipe data model) — BEER_SALES_ENABLED flag implemented | Check: flag=false blocks kiosk recipe sale; flag=true enables it; no code deploy required to toggle |
| BrewPad batch detection failure | Phase 3 (Kiosk recipe sales) — explicit recipe_id path in batch creation | Test: recipe sale creates exactly 1 batch with recipe name, not ingredient names |

---

## Sources

- Zoho Inventory API documentation (rate limits): https://www.zoho.com/inventory/api/v1/introduction/
- BeerXML standard specification: https://beerxml.com/beerxml.htm
- BeerXML Wikipedia (version history, known limitations): https://en.wikipedia.org/wiki/BeerXML
- Brewtarget manual (BeerSmith non-compliance note): http://www.brewtarget.org/manual.html
- Brewfather inventory documentation (recipe versioning model): https://docs.brewfather.app/inventory
- Google Apps Script best practices (execution time limits, batching): https://developers.google.com/apps-script/guides/support/best-practices
- BC PST-121 bulletin (liquor producer tax rules): https://www2.gov.bc.ca/assets/gov/taxes/sales-taxes/publications/pst-121-liquor-producers.pdf
- Medium: Race conditions in production e-commerce inventory systems: https://medium.com/@chaturvediinitin/how-i-eliminated-inventory-race-conditions-in-a-production-e-commerce-system-2302ba81846b
- Sylius inventory race condition issue (real-world pattern documentation): https://github.com/Sylius/Sylius/issues/2776
- Direct codebase analysis: `zoho-middleware/lib/inventory-ledger.js`, `zoho-middleware/lib/brewpad-integration.js`, `zoho-middleware/routes/pos.js`, `zoho-middleware/lib/pricing.js`, `zoho-middleware/lib/constants.js`

---

*Pitfalls research for: Recipe-based fermentation products added to ferment-in-store system*
*Researched: 2026-05-09*
