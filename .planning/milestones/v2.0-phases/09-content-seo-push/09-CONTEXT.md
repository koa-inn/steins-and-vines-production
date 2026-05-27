# Phase 9: Content & SEO Push - Context

**Gathered:** 2026-05-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Product pages and homepage feel professional, trustworthy, and discoverable — with real facility photos, SEO landing copy, and linked Google Review testimonials. No new features or functionality — this is content, imagery, and social proof.

</domain>

<decisions>
## Implementation Decisions

### Landing Page Copy
- **D-01:** Full landing page copy is provided in a content document (pasted during discussion). Two pages: "Ferment on Premise / U-Vin Winemaking" and "Homebrew Ingredients & Supplies". Copy is compliance-reviewed against BC FOP licence, CRTC code, and BC Liquor Regulation.
- **D-02:** Copy targets 3-5 primary keywords per page (u-vin squamish, homebrew supplies squamish, etc.) with 400-500 words each.
- **D-03:** The "[Insert address, hours, phone number]" placeholders in the copy should be omitted — that info is already in the header, footer, and about page site-wide.

### Facility Photos
- **D-04:** Professional facility/process photos are ready and will be provided by dropping files into the `images/` directory.
- **D-05:** Photos appear on three locations: the landing pages (ferment-in-store.html, ingredients-supplies.html), the homepage, and the about page. Not on the product grid page.

### Google Reviews
- **D-06:** Reviews are manually curated — hand-picked by the user and stored in a content JSON file (text, reviewer first name, star rating, link to Google Business Profile).
- **D-07:** 3 reviews displayed.
- **D-08:** Reviews appear on the homepage only.
- **D-09:** Each review card links to the Google Business Profile reviews page (not individual reviews, which Google doesn't support).

### Testimonial Display
- **D-10:** Static cards row — three side-by-side cards that stack on mobile. Star rating, quote text, reviewer name, and "View on Google" link per card.
- **D-11:** Section heading only (e.g., "What Our Customers Say") — no Google logo or aggregate rating badge.
- **D-12:** Positioned after the "Why Make Your Own Wine?" section on the homepage.

### Claude's Discretion
- Where copy lives technically (inline HTML vs content JSON) — pick approach that best balances SEO crawlability and maintainability
- Copy placement on products.html in addition to landing pages (condensed intro vs landing pages only)
- Photo sizing, format, and optimization (WebP vs JPEG, responsive srcset or not)
- Whether review data lives in `content/home.json` or a separate `content/reviews.json`
- Testimonial card styling details (shadows, borders, font sizes) — match existing site design patterns
- Photo layout/placement within each page — break up text naturally

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Landing page copy (user-provided content doc)
- The full copy was provided during discussion — it is NOT in a file in the repo. Planner/executor must use the copy verbatim from the DISCUSSION-LOG.md or this context. Two pages with sections, headings, and SEO notes included.

### Existing landing pages (where copy goes)
- `products/ferment-in-store.html` — Existing SEO landing page with JSON-LD, meta tags, canonical URL. Currently minimal content above the product grid.
- `products/ingredients-supplies.html` — Same structure for ingredients/supplies.

### Content system (how homepage content works)
- `content/home.json` — Homepage content JSON with existing keys (hero-title, why-title, supplies-title, etc.). Content loader reads this at runtime.
- `js/modules/13-init.js` — Content loader that fetches `content/{page}.json` and replaces `[data-content]` elements.
- `js/modules/06-featured.js` — Renders promo-news items from home.json. Pattern reference for rendering content from JSON.

### Homepage sections (where testimonials and photos go)
- `index.html` — Homepage with existing "Why Make Your Own Wine?", "Homebrew Supplies in Squamish", "Serving the Sea-to-Sky Corridor" sections. Testimonials go after "Why Make Your Own Wine?"

### Images (where photos are placed)
- `images/` — Existing image directory. Facility photos will be added here (subfolder convention at Claude's discretion).

### Requirements
- `.planning/REQUIREMENTS.md` — SEO-01, SEO-02, SEO-03 define the acceptance criteria

### SEO foundation (already in place)
- `sitemap.xml` — Existing sitemap at project root
- `robots.txt` — Existing robots.txt with admin page exclusions

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Content loader in `13-init.js` fetches JSON and injects into `[data-content]` elements — reuse for testimonial content if data stored in JSON
- Existing card-based design patterns throughout the site (product cards, label cards) — testimonial cards should match the visual language
- JSON-LD LocalBusiness schema already on all public pages — no new structured data needed unless adding Review schema

### Established Patterns
- `content/{page}.json` drives page content without code deploys — same pattern available for review data
- Landing pages already have full HTML boilerplate with GTM, JSON-LD, canonical URLs, and meta tags
- Homepage sections follow a consistent pattern: heading + descriptive text + optional visual element
- `images/products/` stores product images; facility photos likely belong in `images/facility/` or similar

### Integration Points
- Landing page copy integrates into existing `products/ferment-in-store.html` and `products/ingredients-supplies.html`
- Testimonial section integrates into `index.html` between existing homepage sections
- Facility photos integrate into the landing pages, homepage, and about page
- Service worker (`sw.js`) caches CSS/JS — new images may need cache consideration

</code_context>

<specifics>
## Specific Ideas

- Landing page copy is compliance-reviewed against BC UBrew/UVin Licence, CRTC advertising code, and BC Liquor Regulation — use verbatim, no substantive edits
- Two items flagged as "watch" in compliance review: "make your cellar look sharp" (mild lifestyle association) and "store-bought bottle doesn't quite fit the moment" (indirect comparison) — both deemed acceptable
- Target keywords explicitly listed: u-vin squamish, make your own wine squamish, homebrew supplies squamish, beer brewing supplies, etc.
- Copy explicitly avoids: per-bottle pricing, liquor store comparisons, consumption language, tasting/sampling references, health claims, appeal to minors

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 9-Content & SEO Push*
*Context gathered: 2026-05-04*
