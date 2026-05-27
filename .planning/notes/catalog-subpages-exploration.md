---
title: Catalog Subpages — Exploration Notes
date: 2026-05-27
context: Explore session on restructuring the monolithic ingredients/supplies page into dedicated category subpages
---

# Catalog Subpages Exploration

## Decision: Six category subpages

Break the ingredients & supplies catalog into dedicated subpages, each with its own browsing experience:

| Page | Subcategories included | Status |
|------|----------------------|--------|
| Hops | Hops | Done (hops.html, 15-hops.js) |
| Grains | Grain, Malt Extract | New |
| Yeast | Yeast, Yeast Nutrient | New |
| Additives | Additive, Flavoring, Fruit, Oak | New |
| Packaging | Bottle, Bag, caps/corks/closures | New |
| Equipment | Fermenter, Hose/Tubing, uncategorized items | New |

The existing combined "Ingredients & Supplies" view stays as the "All" browse-everything page.

## Decision: Sub-nav bar for category switching

- Main Products dropdown stays lean (Ferment in Store, Browse Ingredients, Custom Labels)
- Every ingredient subpage gets a horizontal category bar: All | Hops | Grains | Yeast | Additives | Packaging | Equipment
- Enables quick switching without going back to the main nav

## Decision: Cross-category search with inline overlay

- Search bar on any subpage triggers a grouped results overlay
- Results organized by category, clicking a result deep-links to the item on its subpage (e.g. `grains.html?item=pale-malt-2-row`)
- Auto-expands the item's detail panel on arrival
- No individual product pages needed — deep-linking to category pages is sufficient

## Decision: Shared template with unique accents

- All subpages share the same structural template: grid/list layout, filters, search, sub-nav, cart integration
- Each page gets a unique hero section and color accent for personality
- Hops keeps its existing foil background design
- Reusable JS module pattern established by 15-hops.js

## Item counts from live Zoho data (May 2026)

- Hops: 46 items
- Additive: 27 items
- Grain: 16 items
- Yeast: 15 items
- Bottle: 6 items
- Fermenter: 5 items
- Flavoring: 4 items
- Fruit: 3 items
- Oak: 3 items
- Malt Extract: 2 items
- Yeast Nutrient: 2 items
- No Subcategory: 56 items
