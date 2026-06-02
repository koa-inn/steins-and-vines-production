---
phase: 24-seo-staging-deploy
plan: "01"
subsystem: seo
tags: [seo, meta, og, json-ld, html]
dependency_graph:
  requires: []
  provides: [BUILD-02]
  affects: [products/grains.html, products/yeast.html, products/additives.html, products/packaging.html, products/equipment.html]
tech_stack:
  added: []
  patterns: [LocalBusiness JSON-LD, Open Graph meta, Twitter card]
key_files:
  created: []
  modified:
    - products/grains.html
    - products/yeast.html
    - products/additives.html
    - products/packaging.html
    - products/equipment.html
decisions:
  - "Inserted SEO block between CSP meta and canonical/title per reference page order from ingredients-supplies.html"
  - "LocalBusiness JSON-LD copied verbatim from reference — same business data on all pages by design"
  - "og:url matches the already-correct canonical on each page (production domain, no staging URL)"
metrics:
  duration: "~10 minutes"
  completed: "2026-06-02"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 5
---

# Phase 24 Plan 01: SEO Head for 5 Category Subpages Summary

Added the complete SEO head block (unique title, meta description, og:* block, twitter:card, LocalBusiness JSON-LD) to all 5 ingredient category subpages — grains, yeast, additives, packaging, equipment — matching the Apr-14 pattern from `ingredients-supplies.html`.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add full SEO head to grains, yeast, additives | dece78d | products/grains.html, products/yeast.html, products/additives.html |
| 2 | Add full SEO head to packaging and equipment | 32a2fe6 | products/packaging.html, products/equipment.html |

## Changes Per File

**products/grains.html**
- Title: `Grains &amp; Malt for Brewing in Squamish | Steins &amp; Vines`
- Description (152 chars): "Shop base malts, specialty grains, and malt extract for homebrewing at Steins & Vines in Squamish, BC. Serving the Sea-to-Sky corridor."
- Full og:* block (title, description, type=website, url, image icon-512.png, site_name)
- twitter:card summary
- LocalBusiness JSON-LD (verbatim from reference)
- canonical unchanged: `https://steinsandvines.ca/products/grains`

**products/yeast.html**
- Title: `Brewing &amp; Wine Yeast in Squamish | Steins &amp; Vines`
- Description (157 chars): "Ale, lager, and wine yeast strains plus yeast nutrients available at Steins & Vines in Squamish, BC — your Sea-to-Sky homebrew supply shop."
- Full og:* block, twitter:card, LocalBusiness JSON-LD
- canonical unchanged: `https://steinsandvines.ca/products/yeast`

**products/additives.html**
- Title: `Brewing Additives &amp; Flavorings in Squamish | Steins &amp; Vines`
- Description (157 chars): "Brewing additives, flavorings, fruit purées, and oak products for wine and beer at Steins & Vines in Squamish, BC — serving the Sea-to-Sky corridor."
- Full og:* block, twitter:card, LocalBusiness JSON-LD
- canonical unchanged: `https://steinsandvines.ca/products/additives`

**products/packaging.html**
- Title: `Bottling &amp; Packaging Supplies in Squamish | Steins &amp; Vines`
- Description (158 chars): "Bottles, bags, corks, caps, and other packaging supplies for finishing your wine or beer at Steins & Vines in Squamish — serving the Sea-to-Sky corridor."
- Full og:* block, twitter:card, LocalBusiness JSON-LD
- canonical unchanged: `https://steinsandvines.ca/products/packaging`

**products/equipment.html**
- Title: `Brewing &amp; Winemaking Equipment in Squamish | Steins &amp; Vines`
- Description (157 chars): "Fermenters, tubing, hydrometers, and winemaking equipment at Steins & Vines in Squamish, BC — everything you need to brew at home in the Sea-to-Sky corridor."
- Full og:* block, twitter:card, LocalBusiness JSON-LD
- canonical unchanged: `https://steinsandvines.ca/products/equipment`

## Verification Results

All acceptance criteria passed:
- Each of the 5 files contains exactly 1 meta description, 1 og:url, 1 LocalBusiness JSON-LD, 1 twitter:card
- All 5 titles are mutually unique (uniq -d found no duplicates)
- All og:url and canonical values point to `https://steinsandvines.ca/products/{category}` — no staging URL in any file
- sitemap.xml entries for all 5 subpages confirmed present (added in Phase 22, not modified here)
- GTM, CSP, stylesheet links, and body content left untouched on all 5 files

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all SEO meta content is real, production-ready copy.

## Threat Flags

None — only public business info added (name, address, public phone already present site-wide). No secrets, API keys, or PII introduced. All URLs pinned to production domain; verify step confirmed no staging URL leakage.

## Self-Check: PASSED

- products/grains.html: exists, contains LocalBusiness JSON-LD
- products/yeast.html: exists, contains LocalBusiness JSON-LD
- products/additives.html: exists, contains LocalBusiness JSON-LD
- products/packaging.html: exists, contains LocalBusiness JSON-LD
- products/equipment.html: exists, contains LocalBusiness JSON-LD
- Commit dece78d: present in git log
- Commit 32a2fe6: present in git log
