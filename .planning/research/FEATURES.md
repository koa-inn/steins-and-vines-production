# Feature Landscape — Ingredient Category Subpages (v3.0)

**Domain:** Homebrew supply e-commerce, category subpages, cross-category sub-nav, search overlay
**Researched:** 2026-05-27
**Overall confidence:** HIGH (existing codebase confirmed, UX patterns verified against industry research and live sites)

---

## Critical Data Prerequisite

**Before any subpage renders useful content, Zoho items must have category tags.**

Current snapshot (2026-05-27): 219 ingredients, 21 with `category: "Hops"`, the remaining ~198 have `category: ""`. The subpages need `category` values of "Grains", "Yeast", "Additives", "Packaging", "Equipment" set in Zoho Inventory for each SKU.

This is a **Phase 0 blocker** — it must happen before the subpage UI is worth building, because every page will render an empty grid until it is done. The snapshot pipeline (`export-snapshot.js`) already captures `category`. No pipeline change is needed — only Zoho data entry by staff.

Hops already have their own page (`hops.html`) and their own standalone module (`15-hops.js`). Hops items should NOT appear on any of the new ingredient subpages.

---

## Category Landing Page Features

### Table Stakes

Features users expect on a dedicated ingredient category page. Absence makes the page feel unfinished.

| Feature | Why Expected | Complexity | Dependencies on Existing Code |
|---------|--------------|------------|-------------------------------|
| Product grid: name, price, add-to-cart | Core browsing function | Low | `renderWeightControl`, `renderReserveControl`, `setReservationQty` all exist as shared globals; reuse directly |
| In-page text search | Homebrewers arrive knowing what they want — "Cascade", "Nottingham", "Irish Moss" | Low | Fuse.js already loaded on hops page; identical pattern; 200ms debounce already in `08-catalog-ingredients.js` |
| Sort: name A–Z (default), price low–high, price high–low | Orientation after arriving at the page | Low | Existing `catalog-sort` select pattern; copy verbatim |
| Empty state with helpful message | When filter or search yields zero results | Low | Existing `.catalog-no-results` pattern already implemented |
| Out-of-stock indicator | Homebrew customers need to plan purchases | Low | `stock` field exists in snapshot; already rendered on hops cards; use same CSS |
| Loading skeleton / error state with retry | Async data; middleware can fail | Low | `catalog-error` + retry button already in `08-catalog-ingredients.js`; extract and reuse |
| Short page description above the grid | Orients new visitors; SEO value | Low | Static HTML, no code dependency |

### Differentiators

Features that add real value but are not expected baseline.

| Feature | Value Proposition | Complexity | Dependencies |
|---------|-------------------|------------|--------------|
| Subcategory filter pills | Grains has base malt vs. specialty vs. roasted; Yeast has ale vs. lager vs. wine; essential for 30+ item pages | Low–Med | `buildIngredientFilterRow` pattern reusable; subcategory data must exist in Zoho custom fields |
| Weight-based quantity controls on grain/additive items | Grains sold by weight (kg/g); existing weight control already handles this | Low | `renderWeightControl` + `hasWeightConfig` exist; needs `low_amount`/`high_amount`/`step` filled in Zoho for each grain SKU |
| Grid/list (table) view toggle | Power users want table view for quick comparison; hops page already has this | Low | Copy directly from `15-hops.js` and `hops.html`; identical HTML/JS pattern |
| Category-specific sort options | Grains: sort by Lovibond; Yeast: sort by brand (Lallemand vs. Wyeast vs. White Labs) — not generically useful | Med | Requires reliable Lovibond/attenuation data in Zoho custom fields; build only for categories where data exists |
| Product image when available | Visual differentiation between grain sacks, yeast packets, bottle types | Med | `images/products/{sku}.png` sync script exists; currently patchy coverage — must gracefully degrade to no-image state; do not block on this |
| Compact category hero (not full-bleed) | Sets page theme without burying the grid; hops page shows this at appropriate scale | Low | Static HTML + CSS; matches hops pattern; each subpage gets unique accent color |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Sidebar filter panel | Space-hungry; fights the existing horizontal pill filter pattern; overkill for 20–60 items per category | Keep horizontal pill filters; collapse into a "Filters" toggle on mobile |
| Pagination | Per-category counts (estimate 10–60 items) make pagination friction without benefit | Show all items; JS filtering handles the visible count |
| Breadcrumb trail | Only 2 levels of depth; "Home > Products > Ingredients > Grains" is noise | Page title + sub-nav provides sufficient orientation |
| Lovibond color swatch visual filter | Requires accurate Lovibond data for all grains in Zoho; visually impressive but fragile against incomplete data | Sort by Lovibond if the field exists; skip the color swatch filter |
| "Customers also bought" recommendations | No purchase data infrastructure | Out of scope for this milestone |
| Persistent filter state in URL | `?subcategory=Base+Malt` deep-linking is a nice-to-have, adds ES5 JS complexity | Keep filter state in memory only |
| Per-category standalone JS module files (16-grains.js, 17-yeast.js, etc.) | Would require copy-pasting the same logic 5 times | One shared subpage module (e.g., `16-subpages.js`) initialized with a category config object per page |

---

## Sub-Nav Bar Features

A horizontal bar on all ingredient category pages enabling fast switching between categories without returning to a hub page.

### Table Stakes

| Feature | Why Expected | Complexity | Dependencies |
|---------|--------------|------------|--------------|
| Links to all 5 subpages + "All Ingredients" hub | Users expect to move between categories; absence forces back-button navigation | Low | Static HTML on each page; no JS dependency |
| Active state highlighting current page | Visual orientation — users need to know where they are | Low | CSS class; can be set statically per page since each page is a separate HTML file |
| Horizontal scroll on mobile (no wrapping) | 6+ items won't fit at mobile width; wrapping breaks layout | Low | CSS: `overflow-x: auto; white-space: nowrap` or `flex-wrap: nowrap` with scroll |
| Search trigger (icon or button) in the bar | Cross-category search is the primary use case; must be reachable from any ingredient page | Low | Button triggers the search overlay (see below); no data dependency |

### Differentiators

| Feature | Value Proposition | Complexity | Dependencies |
|---------|-------------------|------------|--------------|
| Sticky positioning below the main site header | Keeps category switching accessible mid-scroll; shown to reduce back-navigation by 22% faster scan time (research verified) | Low | CSS `position: sticky; top: [header-height]`. Must measure actual header height — it is not a round number on mobile. Use a CSS custom property `--header-height` set once on init |
| Icon per category (grain icon, yeast droplet, etc.) | Visual scanability; matches the quality level of the hops foil bag design | Low–Med | SVG icons needed; inline SVG is the right approach given CSP restrictions (no external icon CDN) |
| Item count badge on each tab | Helps users gauge catalog size before clicking; useful when Equipment is small | Low | JS updates count after data loads; or omit initially — secondary feature |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| JavaScript-rendered sub-nav HTML | Navigation should appear instantly; JS-rendered nav has a flash-of-nothing before load | Static HTML in each page's `<main>` |
| Dropdown sub-menu within the sub-nav | Unnecessary complexity for 5 flat categories | Flat horizontal links |
| Fixed (not sticky) position | Permanently consumes viewport height | CSS `sticky` activates only when scrolling past |
| Shared sub-nav injected via JS from a single source | Tempting for DRY reasons, but creates a nav flash and adds a dependency | Accept the duplication of static HTML across 5 pages; use an HTML comment `<!-- sub-nav: update all 5 pages when changing -->` to flag it |

**Sticky offset note:** The site header is already sticky (`.site-header`). The sub-nav's `top` value must equal the rendered header height (approximately 60–70px on desktop, varies on mobile). Hard-code the value initially; if it breaks on resize add a one-time JS measurement on `DOMContentLoaded` that sets `--header-height` on `<html>`. Do not over-engineer this on first pass.

---

## Cross-Category Search Overlay Features

An inline overlay that appears when the user activates the search trigger in the sub-nav, showing results from all ingredient categories grouped by category.

### Table Stakes

| Feature | Why Expected | Complexity | Dependencies |
|---------|--------------|------------|--------------|
| Results appear within ~200ms of typing | Immediate feedback; delay breaks the perceived responsiveness | Low | Fuse.js already loaded; 200ms debounce already used in ingredient search |
| Results grouped by category | Without grouping, cross-category results are an undifferentiated list — grouping is the entire value of cross-category search | Med | Requires all ingredient items (minus hops, which have their own page) loaded into a single Fuse instance |
| 3–5 results per category maximum | Limits overlay height; forces a "see all" click for deeper browsing (Baymard verified) | Low | Simple `slice(0, 5)` per category group |
| "See all [N] results in [Category]" link per group | Directs users to the right subpage for deeper browsing | Low | Static URL pattern: `grains.html?search=cascade` or navigate to page and trigger search on load |
| Close on ESC key | Standard modal behavior; accessibility requirement | Low | `keydown` on `document`; return focus to search trigger |
| Close on click outside | Standard overlay behavior | Low | `mousedown` listener on `document`; check if target is outside overlay |
| Empty state ("No results for X") | Required for every search implementation | Low | Static message |
| Keyboard navigation: arrow keys highlight, Enter navigates | Users who type want to stay on keyboard | Med | `keydown` handler; `aria-activedescendant` for screen readers |
| Focus trap while overlay is open | Accessibility requirement; matches existing cart drawer pattern | Low | Tab cycles within overlay; Shift+Tab works too; established pattern in the codebase |

### Differentiators

| Feature | Value Proposition | Complexity | Dependencies |
|---------|-------------------|------------|--------------|
| All-ingredient Fuse index built from middleware `/api/ingredients` | Single fetch covers all categories at once; reuses the existing endpoint and cache pattern from `08-catalog-ingredients.js` | Med | MW already returns all ingredients in one call; filter by category client-side |
| Highlight matched text in results | Standard search UX; reduces cognitive load — user sees why the result matched | Low | `String.replace` with `<mark>` tag on the matched portion; use `escapeHTML` first |
| Trigger from sub-nav search icon only (not page-specific input) | Makes the cross-category nature explicit; the per-page search bars handle within-category search | Low | One trigger button per page; overlay is a shared JS component |
| Auto-focus the search input when overlay opens | Standard overlay UX; no extra clicks needed | Low | `.focus()` on input after overlay becomes visible |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Full-screen overlay takeover | Too aggressive for a local shop; suits enterprise; out of place | Semi-transparent dropdown under the search input, width ~400–500px or full-width on mobile |
| Scrollable results list inside the overlay | Inline scroll creates unintentional clicks and obscured content (Baymard research) | Cap at 3–5 per category with "see all" link; no scroll |
| Auto-navigate on single result | Disorienting if user mistyped; user may expect to see zero results and try again | Show the result; let user click |
| Full search results page as the primary pattern | Adds a navigation step; overlay handles 90% of cases for a 200-item catalog | Overlay + "see all in [category]" covers the need; defer a full results page to a later milestone |
| `role="dialog"` with overlay | Overkill for a search dropdown | Use `role="listbox"` with `role="option"` items; simpler ARIA pattern |
| Fetch-per-keystroke to middleware | Would hit Railway endpoint 5–10 times per search | Load once on first overlay open, cache in memory; Fuse searches entirely client-side |

**Accessibility requirements (non-negotiable):** `role="listbox"`, `aria-expanded` on trigger, `aria-activedescendant` tracking highlighted option, ESC closes and returns focus to trigger, focus trap. The existing site uses skip-to-content links and full ARIA roles throughout — the overlay must match that standard.

---

## Feature Dependencies (Build Order)

```
[1] Zoho category tagging (staff data entry — not dev work)
    → snapshot re-run captures tags automatically
        → [2] Shared subpage JS module (16-subpages.js)
               with: filter pills, sort, grid render, error state
            → [3] Per-subpage HTML files (5 pages)
                  each with: hero, sub-nav static HTML, catalog div, script load
                → [4] Sticky sub-nav CSS tuning (offset from header)
                    → [5] Cross-category Fuse index (built in 16-subpages.js on first overlay open)
                        → [6] Search overlay JS component
                            → [7] Sub-nav search trigger wired to overlay
```

**Shared module is the key architectural choice.** Do NOT create one JS module per subpage. Create one `16-subpages.js` that accepts a `CATEGORY_CONFIG` object (category name, page URL, subcategory list, sort options) and initializes the page. Each HTML file just sets `var CATEGORY_CONFIG = { name: 'Grains', ... }` before loading the module.

This mirrors the `15-hops.js` standalone pattern but is shared across all 5 pages instead of being page-specific.

---

## Estimated Catalog Sizes

Rough estimates based on product names in the snapshot. Exact counts depend on Zoho tagging.

| Category | Estimated SKU Count | Weight-Based? | Key Filter Dimensions |
|----------|--------------------|--------------|-----------------------|
| Grains | 30–50 | Yes (kg/g) | Base / specialty / roasted; Lovibond if available |
| Yeast | 15–25 | No (pcs/packets) | Ale / lager / wine / wild; brand |
| Additives | 30–50 | Mixed | Clarifier / nutrient / acid / adjunct / sanitizer |
| Packaging | 30–50 | No (pcs) | Bottle type; caps / corks / closures |
| Equipment | 30–50 | No (pcs) | Fermentation / transfer / measuring / sanitizing |

Hops (21 SKUs) has its own page and must be excluded from these subpages and from the cross-category search overlay's ingredient index.

---

## MVP Recommendation

**Phase 1 — Data + shared template:**
1. Zoho category tagging for all 198 uncategorized ingredients (staff task, not dev)
2. Snapshot re-run to capture new tags
3. Single shared `16-subpages.js` module: load by category, filter pills, sort, grid render, error state
4. 5 HTML pages (Grains, Yeast, Additives, Packaging, Equipment) each with: hero, static sub-nav, catalog div, config object, script load
5. Per-page text search + subcategory filter pills (driven by what Zoho data provides)

**Phase 2 — Navigation and search:**
6. Sticky sub-nav CSS with measured header offset
7. Cross-category Fuse index (all non-hops ingredients) built in `16-subpages.js` on first overlay open
8. Search overlay component (dropdown, grouped results, keyboard nav, focus trap)
9. Sub-nav search icon wired to overlay

**Defer to later:**
- Sort by Lovibond / attenuation (needs reliable Zoho custom fields)
- Product images in search results (currently patchy)
- Full-page search results page
- URL-based filter state (deep-linking)
- Item count badges on sub-nav

---

## Sources

- [Baymard: Intermediary Category Pages](https://baymard.com/blog/ecommerce-sub-category-pages) — MEDIUM confidence (paywalled; summary from search result)
- [Baymard: Horizontal Filtering Toolbars](https://baymard.com/blog/horizontal-filtering-sorting-design) — MEDIUM confidence
- [Baymard: Search Autodirect and Category Scopes](https://baymard.com/blog/autodirect-searches-matching-category-scopes) — MEDIUM confidence
- [NNG: eCommerce Homepages, Category Pages, Listing Pages](https://www.nngroup.com/articles/ecommerce-homepages-listing-pages/) — HIGH confidence
- [Boost Commerce: Instant Search Dropdown UX — 10 Protips](https://blog.boostcommerce.net/posts/8-ui-ux-protips-for-ecommerce-instant-search-dropdown) — MEDIUM confidence
- [Hidde.blog: Trapping Focus in Vanilla JS](https://hidde.blog/using-javascript-to-trap-focus-in-an-element/) — HIGH confidence
- [Mugo Web: Focus Trap Accessibility](https://www.mugo.ca/Blog/Making-keyboard-navigation-more-accessible-with-JavaScript-focus-traps) — HIGH confidence
- [CXL: eCommerce Navigation Best Practices](https://cxl.com/ecommerce-best-practices/navigation/) — MEDIUM confidence
- [Anatta: eCommerce Navigation UX](https://anatta.io/blog/ecommerce-navigation-ux) — MEDIUM confidence (sticky nav 22% faster stat)
- [Northern Brewer: Yeast category page](https://www.northernbrewer.com/collections/beer-yeast/yeast_style-ipa-ale-yeast) — live site reference
- Existing codebase: `js/modules/08-catalog-ingredients.js`, `js/modules/15-hops.js`, `hops.html`, `products/ferment-in-store.html` — HIGH confidence (read directly)
- Zoho snapshot: `content/zoho-snapshot.json` (generated 2026-05-27) — HIGH confidence

---

## Prior Milestone Feature Research (v2.0 — Recipe-Based Products)

The research below is preserved from the v2.0 milestone (2026-05-09) for reference.
It covers the recipe data model, BeerXML import, kiosk sale, and inventory deduction strategy.
It is superseded for v3.0 planning purposes but may be useful for later milestones.

---

# Feature Research (v2.0 — Recipe-Based Products)

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

## Feature Dependencies (v2.0)

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

---

## Sources (v2.0)

- [Terminal City Brewing — Beer Menu](https://tcbrewing.com/beer/)
- [The Flying Barrel — Brew on Premise](https://www.flyingbarrel.com/bopinfo.html)
- [Eudora Brewing — Brew Your Own](https://www.eudorabrewing.com/brewyourown)
- [BeerXML Official Standard](https://beerxml.com/beerxml.htm)
- [Zoho Inventory Composite Items API](https://www.zoho.com/inventory/api/v1/compositeitems/)

---
*v3.0 research: 2026-05-27 | v2.0 research: 2026-05-09*
