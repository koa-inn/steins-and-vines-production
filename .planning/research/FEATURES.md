# Feature Research

**Domain:** Recipe-based ferment-in-store product system (beer / fermented products)
**Researched:** 2026-05-09
**Confidence:** MEDIUM-HIGH — competitive landscape from live sites (Terminal City Brewing, The Flying Barrel, Eudora Brewing), BeerXML from official spec, Zoho composite items from official API docs. Custom recipe consultation patterns inferred from industry practice where direct evidence was thin.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features staff and customers assume exist. Missing these = the system feels incomplete or half-built.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Pre-made recipe catalog | U-Brew norm: every competitor offers a menu of named styles (IPA, Stout, Lager) at fixed prices | LOW | Recipes defined in Google Sheets via admin; rendered on public products page alongside wine kits |
| Recipe price shown on product card | Price is the first decision point; ambiguity drives customers away | LOW | Price derives from ingredient sum + brewing fee, pre-calculated and stored on the recipe record |
| Ingredient list visible per recipe | Customers (especially homebrewers) want to know what they're getting; grain bill / hop schedule legitimizes price | MEDIUM | Collapsible detail on product card; staff need to decide how much detail to expose publicly |
| Kiosk recipe sale — ingredients auto-populate cart | The core workflow: selecting a recipe should fill the ingredient cart automatically, not require staff to add items manually | HIGH | Requires ingredient-to-SKU mapping at recipe creation time; biggest source of complexity |
| Brewing / service fee line item on receipt | Customers expect to see fees broken out; Zoho sales order must reflect this | LOW | Existing Maker's Fee + Materials Fee pattern can be adapted; beer fee TBD in value |
| Inventory deducted per ingredient at point of sale | Zoho Inventory must stay accurate; selling a recipe must reduce stock of each individual ingredient | HIGH | Options: (a) Zoho Composite Item auto-deducts on invoice, or (b) middleware explicitly deducts each ingredient via individual line items on the sales order |
| Batch auto-created in BrewPad on kiosk sale | Already exists for wine kits; must extend to recipe-based products so batch timeline starts immediately | MEDIUM | Requires recipe ID propagated through kiosk sale → middleware → BrewPad Apps Script |
| Recipe linked to batch in BrewPad | Staff need to see which recipe a batch is using during fermentation monitoring | LOW | Store recipe ID + name on the batch record; display in batch detail view |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| BeerSmith / BeerXML import for recipe setup | Staff already design recipes in BeerSmith; import eliminates manual data re-entry and reduces transcription errors in grain/hop quantities | MEDIUM | Parse XML on middleware (Node.js has DOMParser via xmldom or a lightweight parser); extract fermentables, hops, yeast, misc. Map ingredient names to Zoho SKUs via a configurable name-match table |
| Custom recipe consultation request (public-facing) | Homebrewers and curious customers who want something specific get a low-friction path to book a consultation rather than hitting a dead end | LOW | Simple form: name, contact, style/flavour intent. Triggers staff notification. Not a self-serve builder — staff control the recipe design |
| Staff ad-hoc recipe builder (kiosk / admin) | For one-off batches where no pre-made recipe exists; staff select ingredients and quantities directly and generate a sale without creating a permanent recipe | HIGH | Effectively a live ingredient-picker + quantity input that produces a synthetic recipe for that sale only. Hard UI problem on an iPad without a good design |
| Recipe style metadata (ABV, IBU, colour, fermentation time) | Sets customer expectations and positions the product alongside craft beer norms; Terminal City displays timelines (ales 2–3 weeks, lagers 4–5 weeks) | LOW | Derived from BeerXML on import or entered manually; stored on recipe record in Sheets |
| Custom label / batch name for customer | Every U-Brew competitor offers this; Steins & Vines already supports batch labels in BrewPad — extending to recipe batches maintains parity | LOW | Batch name field already exists in BrewPad; no new infrastructure needed |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Customer-facing self-serve recipe builder | Seems modern and engaging; some competitors mention it | For a ferment-in-store model, recipe building requires understanding of ingredient interactions, batch size constraints, and equipment limits. Customers who get it wrong are disappointed. Consultation is the right UX. | Custom recipe request form (see Differentiators); staff build the recipe with the customer in-store |
| Dynamic pricing calculated from live Zoho ingredient prices | Sounds like it keeps pricing accurate automatically | Zoho prices change with supplier orders; a customer quoted $185 might be re-quoted $197 days later. Breaks trust and complicates kiosk flow. | Pre-calculated price stored on the recipe record; updated manually by staff when ingredient costs shift meaningfully |
| Zoho Composite Item per recipe | Feels like the "right" Zoho way to model a recipe | Composite items require assembly steps before selling (Zoho's bundle workflow), add Zoho-side complexity, and the API support for composite item assembly via API is limited. Recipes change frequently during early operation. | Sell recipe as individual ingredient line items on the sales order + a service fee line item. Middleware handles the "which ingredients, what quantities" logic from the recipe definition stored in Sheets. |
| Online checkout for recipe products (v2.0 scope) | Customers might want to pay online | Out of scope per PROJECT.md — federal brewing licence not yet granted; kiosk-first is correct | Kiosk-only initially; defer online checkout to v2.1+ milestone |
| Recipe versioning / changelog | Sounds like good practice | Adds complexity to the data model and admin UI with minimal near-term benefit when there are only a handful of recipes | Use a simple `updated_at` timestamp on the recipe record; staff handle version notes informally until volume justifies more |

---

## Feature Dependencies

```
[Pre-made recipe catalog]
    └──requires──> [Ingredient-to-SKU mapping table]
                       └──requires──> [Ingredients already in Zoho Inventory] (EXISTS)

[Kiosk recipe sale]
    └──requires──> [Pre-made recipe catalog]
    └──requires──> [Ingredient-to-SKU mapping table]
    └──requires──> [Inventory deduction on sale]
    └──enables──>  [Batch auto-creation in BrewPad]

[BeerXML import]
    └──enhances──> [Pre-made recipe catalog] (speeds up setup, not a hard dependency)
    └──requires──> [Ingredient-to-SKU mapping table] (to resolve BeerXML names to Zoho SKUs)

[Custom recipe consultation request]
    └──independent──> (no dependency on recipe catalog; just a contact form + notification)

[Staff ad-hoc recipe builder]
    └──requires──> [Ingredient-to-SKU mapping table]
    └──requires──> [Kiosk recipe sale] (shares the cart-fill and checkout path)

[Batch auto-creation in BrewPad]
    └──requires──> [Kiosk recipe sale]
    └──enhances──> [Recipe linked to batch in BrewPad]
```

### Dependency Notes

- **Ingredient-to-SKU mapping is the keystone dependency.** Every recipe feature depends on it. BeerXML ingredient names (e.g., "Pilsner Malt (Weyermann)") must be mapped to Zoho SKUs (e.g., `GRN-PILSNER-25KG`). This mapping must be manually maintained in admin. Get this right first.
- **Kiosk recipe sale depends on pre-made catalog.** Cannot build the kiosk sale flow without recipes to sell. Build catalog CRUD (admin) before kiosk integration.
- **BeerXML import is an accelerator, not a gate.** Recipes could be entered manually in admin. Import is worth building because staff already use BeerSmith, but it's not blocking.
- **BrewPad batch integration depends on kiosk sale working.** Batch auto-creation already works for wine kits; extending it to recipes reuses the existing middleware→Apps Script pattern.

---

## MVP Definition

### Launch With (v2.0 — kiosk-first, staff-operated)

Minimum viable system to sell beer recipes through the kiosk.

- [ ] Recipe data model in Google Sheets — name, style, description, ABV/IBU/colour/fermentation time, ingredient list with quantities and Zoho SKUs, brewing fee, active/inactive flag
- [ ] Ingredient-to-SKU mapping table — name variants mapped to canonical Zoho SKU
- [ ] Admin recipe CRUD — create, edit, activate/deactivate recipes; ingredient line items editable
- [ ] Public recipe browsing — recipe cards on products page, beer label card type, style metadata shown
- [ ] Kiosk recipe sale — select recipe → ingredients auto-populate ingredient cart → brewing fee added → checkout with Helcim → Zoho sales order with individual ingredient line items + service fee
- [ ] Inventory deduction via individual line items on Zoho sales order (not composite items — simpler and more flexible)
- [ ] Batch auto-creation in BrewPad on recipe sale — recipe ID + name linked to batch

### Add After Validation (v2.1)

Features to add once the core recipe sale workflow is working in-store.

- [ ] BeerXML import — upload .xml file in admin, parse ingredients, present match table for SKU mapping, create draft recipe
- [ ] Custom recipe request form — public-facing consultation booking form; staff notification email
- [ ] Style metadata display improvements — fermentation timeline badge on product card

### Future Consideration (v2.2+)

- [ ] Staff ad-hoc recipe builder — select ingredients live in kiosk, build one-off recipe without pre-registration; defer until volume of one-off requests justifies the UI complexity
- [ ] Online checkout for recipe products — defer until brewing licence is granted and kiosk model is validated
- [ ] Recipe versioning — defer until staff have enough recipes that tracking changes becomes necessary

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Recipe catalog (Sheets + admin CRUD) | HIGH | MEDIUM | P1 |
| Ingredient-to-SKU mapping table | HIGH | LOW | P1 |
| Kiosk recipe sale (cart auto-fill + checkout) | HIGH | HIGH | P1 |
| Zoho inventory deduction via line items | HIGH | MEDIUM | P1 |
| Batch auto-creation (recipe → BrewPad) | HIGH | MEDIUM | P1 |
| Public recipe browsing | MEDIUM | LOW | P1 |
| Recipe style metadata (ABV, IBU, time) | MEDIUM | LOW | P1 |
| BeerXML import | MEDIUM | MEDIUM | P2 |
| Custom recipe request form | MEDIUM | LOW | P2 |
| Staff ad-hoc recipe builder (live ingredient picker) | LOW | HIGH | P3 |
| Online checkout for recipe products | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for kiosk launch
- P2: Should have; add in v2.1 once kiosk flow is stable
- P3: Defer to v2.2+

---

## Competitor Feature Analysis

Research from: Terminal City Brewing (Vancouver, BC), The Flying Barrel (Toronto), Eudora Brewing (US), Wine Kitz (Calgary), Brewers Corner (Nanaimo).

| Feature | Terminal City Brewing | The Flying Barrel | Steins & Vines Approach |
|---------|-----------------------|-------------------|-------------------------|
| Recipe selection | Named styles with descriptions; 14 lagers, 5 pilsners, 20+ ales, 8 IPAs, 5 stouts | "Select from many recipes" + bring your own + staff-customized | Pre-made catalog matching TCB model; fewer recipes initially |
| Pricing model | Flat per-batch price by style complexity ($170–$215 for 48L); all fees and tax included | Flat per-batch by size ($100/5gal, $175/10gal, $225/15gal); bottles extra | Flat per-recipe price (ingredient cost + brewing service fee); shown on product card |
| Custom recipes | Custom hop/grain additions; customer's own adjuncts (honey, espresso) | Staff customize on request | Consultation request form → staff-built; not self-serve in v2.0 |
| Batch size | Fixed 48L per batch | 5, 10, or 15 gallons | Single batch size initially; determined by vessel capacity |
| Fermentation timeline | Posted per style (ales 2–3 wks, lagers 4–5 wks) | 2–3 weeks | Show on recipe card; feed into BrewPad schedule template |
| Customer involvement | Choose style, add custom touches, return to bottle | Two-visit model (brew session + bottle session) | Staff-managed; customer picks up finished product |
| Pricing transparency | All-inclusive batch price on website | Per-size pricing on website | Full ingredient list + fee breakdown visible on recipe card |

### Key competitive insight

Terminal City's pricing ($170–$215 for 48L) translates to roughly $3.50–$4.50/L for the customer. At these price points, the fee is embedded in a single flat price — customers don't see "ingredients: $X + service fee: $Y." Steins & Vines' Zoho-centric model makes it natural to show ingredient line items on the receipt, but the customer-facing price should still be a single per-recipe flat rate, not a dynamic calculation. This avoids pricing surprises and matches customer expectations set by competitors.

---

## BeerXML Data — What's Available and Useful

**Source:** [BeerXML Official Standard](https://beerxml.com/beerxml.htm) — HIGH confidence.

### Fields useful for the recipe data model

| Section | Key Fields | Use |
|---------|-----------|-----|
| Recipe | name, style, batch_size, boil_time, efficiency, og, fg, color, ibu | Display on product card; feed into BrewPad batch template |
| Fermentables | name, type (grain/sugar/extract), amount (kg), yield, color | Ingredient list + quantity for inventory deduction |
| Hops | name, amount (kg), alpha, use (boil/dry hop), time | Ingredient list; use and time important for brew schedule |
| Yeast | name, type (ale/lager), form (liquid/dry), amount | Inventory item; type determines fermentation timeline |
| Misc | name, type, amount, use, time | Water treatment, finings, adjuncts |
| Water | name, calcium, bicarbonate, sulfate, chloride, sodium | Not needed for inventory; can be stored as notes |

### Limitations to plan around

- BeerXML ingredient names are not standardized — "Pale Malt (2 Row)" in BeerSmith may be listed as "2-Row Pale Malt" in Zoho Inventory. A name-matching/mapping step is mandatory at import time.
- BeerXML amounts are in kg; some ingredients (liquid yeast, hops in small batches) may be in grams — unit conversion handling needed.
- BeerXML 1.0 supports max 3 fermentation steps (not a concern for the recipe display use case).
- Water profile and equipment records are not needed for the sales/inventory workflow — parse and discard.

### Recommended import workflow

1. Staff uploads `.xml` file in admin
2. Middleware parses XML, extracts fermentables + hops + yeast + misc
3. Admin presents a mapping table: BeerXML name → (matched Zoho SKU | "no match — select manually")
4. Fuzzy matching by name substring reduces manual work (e.g., "Pilsner Malt" matches SKU for "Pilsner Malt 25kg")
5. Staff confirm mappings, set quantities and unit conversions, set brewing fee, activate recipe
6. Recipe saved to Google Sheets with confirmed SKU mappings

---

## Pricing Model Recommendation

**Use flat per-recipe pricing, not dynamic ingredient-sum pricing.**

Rationale:
- All competitors use flat per-batch prices. Customers expect to see a single price, not a breakdown.
- Ingredient prices in Zoho change when Steins & Vines re-orders stock. Dynamic pricing would cause the same recipe to vary in price week to week — confusing for customers and inconsistent for the kiosk.
- Flat pricing means the brewing fee is embedded (not a separate visible charge to the customer during browsing), but it should still appear as a line item on the Zoho sales order for accounting accuracy.
- Staff review and update recipe prices manually when ingredient costs shift significantly.

**Price storage:** `recipe.price` is the customer-facing flat price. `recipe.brewing_fee` is the service component stored separately for accounting. On the Zoho sales order: individual ingredient line items at actual Zoho prices + a service fee line item = total that should sum close to `recipe.price` (minor variance acceptable due to rounding).

---

## Inventory Deduction Strategy

**Recommended: Individual ingredient line items on Zoho sales order, not Composite Items.**

Rationale:
- Zoho Composite Items require a separate "bundle" assembly step before a sale can be created. This doesn't fit the kiosk flow where recipes change and the assembly step would need to be automated via API (poorly documented, fragile).
- Composite items are designed for physical assembly into a new SKU (e.g., a gift box). Recipes are not a physical SKU — they are a temporary collection sold in a single transaction.
- Individual line items on the sales order trigger the same inventory deduction as selling items individually. Zoho deducts stock per line item when an invoice is created.
- This approach reuses existing middleware patterns (the ingredients cart already creates multi-line-item sales orders).
- Downside: The Zoho sales order will have many line items (5–15 ingredients per recipe). This is acceptable — it also creates a clean audit trail showing exactly what was sold.

**Implementation path:** When a recipe sale is processed, middleware expands the recipe into its ingredient list, builds a line items array (item_id, quantity, rate per Zoho), adds a service fee line item, and creates a single Zoho sales order. Identical to how the current ingredients cart checkout works, just driven by a recipe definition instead of manual cart contents.

---

## Sources

- [Terminal City Brewing — Beer Menu](https://tcbrewing.com/beer/) — live competitive analysis
- [Terminal City Brewing — FAQ](https://tcbrewing.com/faq/) — pricing range, customer process, customization options
- [The Flying Barrel — Brew on Premise](https://www.flyingbarrel.com/bopinfo.html) — pricing tiers, recipe selection model
- [Eudora Brewing — Brew Your Own](https://www.eudorabrewing.com/brewyourown) — tiered pricing, batch sizes, customer process
- [BeerXML Official Standard](https://beerxml.com/beerxml.htm) — data structure, sections, field definitions
- [BeerXML Wikipedia](https://en.wikipedia.org/wiki/BeerXML) — limitations, software support
- [Zoho Inventory Composite Items API](https://www.zoho.com/inventory/api/v1/compositeitems/) — API endpoints, field requirements
- [Zoho Inventory Composite Items User Guide](https://www.zoho.com/us/inventory/help/items/composite-items.html) — assembly workflow, kit vs. assembly distinction
- [BeerSmith Importing/Exporting](https://beersmith.com/help2/importing_and_exporting_files.htm) — BeerXML export from BeerSmith
- [Brewfather Import Recipes docs](https://docs.brewfather.app/getting-started/import-recipes) — BeerXML software support confirmation

---
*Feature research for: Recipe-based ferment-in-store product system (v2.0)*
*Researched: 2026-05-09*
