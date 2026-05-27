# Requirements — v3.0 Catalog Subpages

## v1 Requirements

### Data Foundation
- [ ] **DATA-01**: All ingredient items in Zoho Inventory have a Subcategory custom field set (Grain, Yeast, Additive, Packaging, Equipment, Hops, or uncategorized)
- [ ] **DATA-02**: The nightly snapshot pipeline captures the subcategory field so the static fallback renders correct categories

### Subpage Template
- [ ] **TPL-01**: A shared standalone JS module renders product cards, filters, sort, search, and cart controls on any category subpage — parameterized by a per-page config object
- [ ] **TPL-02**: Each subpage has a simple hero section with a unique accent color and category heading
- [ ] **TPL-03**: Users can toggle between grid and list view on any subpage
- [ ] **TPL-04**: Out-of-stock items show a clear indicator; empty categories show a friendly message

### Category Subpages
- [ ] **CAT-01**: Grains subpage shows items with subcategory Grain or Malt Extract, with weight-based cart controls where applicable
- [ ] **CAT-02**: Yeast subpage shows items with subcategory Yeast or Yeast Nutrient
- [ ] **CAT-03**: Additives subpage shows items with subcategory Additive, Flavoring, Fruit, or Oak
- [ ] **CAT-04**: Packaging subpage shows items with subcategory Bottle, Bag, or closures
- [ ] **CAT-05**: Equipment subpage shows items with subcategory Fermenter, Hose/Tubing, or uncategorized

### Navigation
- [ ] **NAV-01**: A horizontal sub-nav bar appears on every ingredient page (All | Hops | Grains | Yeast | Additives | Packaging | Equipment) for quick category switching
- [ ] **NAV-02**: The main site Products dropdown includes category sublinks so customers can navigate directly to any subpage from any page
- [ ] **NAV-03**: The sub-nav highlights the current category page

### Search
- [ ] **SRCH-01**: A cross-category search overlay shows results grouped by category when triggered from the sub-nav search icon
- [ ] **SRCH-02**: Clicking a search result navigates to the item on its category subpage with the item's detail panel expanded

### Build & SEO
- [ ] **BUILD-01**: All subpages are integrated into the build pipeline (minify CSS/JS, cache-bust stamps, sitemap entries)
- [ ] **BUILD-02**: Each subpage has unique SEO meta (title, description, og tags, canonical URL, JSON-LD)

## Future Requirements

- Subcategory filter pills within each category page (e.g. Grain: Base/Specialty/Roasted) — gated on Zoho custom field data
- Sort by category-specific attributes (Lovibond for grains, attenuation for yeast)
- Product images on cards
- URL filter state persistence (shareable filtered views)
- Item count badges on sub-nav tabs

## Out of Scope

- Individual product detail pages — deep-linking to category page with expanded panel is sufficient
- Product images — not available in Zoho currently
- Mobile app — web-only
- Framework migration — vanilla JS ES5 constraint maintained

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DATA-01 | Phase 20 | Not started |
| DATA-02 | Phase 20 | Not started |
| TPL-01 | Phase 21 | Not started |
| TPL-02 | Phase 21 | Not started |
| TPL-03 | Phase 21 | Not started |
| TPL-04 | Phase 21 | Not started |
| BUILD-01 | Phase 21 | Not started |
| CAT-01 | Phase 22 | Not started |
| CAT-02 | Phase 22 | Not started |
| CAT-03 | Phase 22 | Not started |
| CAT-04 | Phase 22 | Not started |
| CAT-05 | Phase 22 | Not started |
| NAV-01 | Phase 22 | Not started |
| NAV-02 | Phase 22 | Not started |
| NAV-03 | Phase 22 | Not started |
| SRCH-01 | Phase 23 | Not started |
| SRCH-02 | Phase 23 | Not started |
| BUILD-02 | Phase 24 | Not started |
