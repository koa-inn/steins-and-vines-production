# Phase 20: Zoho Data Foundation - Context

**Gathered:** 2026-05-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Tag all ingredient items in Zoho Inventory with a Subcategory custom field, ensure the snapshot pipeline captures subcategory data, and write an automated verification script to confirm coverage. This is a data prerequisite — all downstream subpage phases depend on accurate subcategory filtering.

</domain>

<decisions>
## Implementation Decisions

### Category Mapping Rules
- **D-01:** 7 subcategory values in Zoho: Grain, Yeast, Additive, Packaging, Equipment, Cleaning, Hops
- **D-02:** Cleaning items (PBW, Star San, etc.) tagged as "Cleaning" in Zoho but displayed on the Equipment subpage alongside Equipment items. Separate subcategory preserves the option to split them into their own page if inventory grows.
- **D-03:** Items that don't fit any specific category default to "Equipment" (catch-all)
- **D-04:** Hops items are already tagged (46 items) — no action needed for those

### Tagging Approach
- **D-05:** Script + manual review workflow: write a bulk-tagging script that auto-tags obvious items by name/SKU pattern (equipment keywords, cleaning products, packaging items), then generate a list of ambiguous items for manual review and tagging in Zoho
- **D-06:** Approximately 56 uncategorized items need tagging. Breakdown from live data: ~4 cleaning, ~19 equipment, ~33 ambiguous (mix of packaging, additives, misc)

### Snapshot Verification
- **D-07:** Write an automated check script that hits the middleware API, counts items per subcategory, flags any items still missing a subcategory value, and reports coverage percentage
- **D-08:** No pipeline changes needed — the `/api/snapshot` endpoint already calls `flattenCF()` on `custom_fields`, which produces `subcategory` from the Zoho CF label. The nightly `update-snapshot.yml` workflow will capture it automatically after items are tagged.

### Claude's Discretion
- Script implementation details (Zoho API bulk update vs CSV import)
- Exact keyword-to-category mapping patterns in the tagging script
- Verification script output format

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Zoho Data Pipeline
- `zoho-middleware/routes/catalog.js` lines 811-867 — `/api/snapshot` endpoint with `shapeIngredient()` and `flattenCF()` that produces subcategory from CF
- `zoho-middleware/scripts/csv-to-snapshot.js` lines 153-172 — `shapeIngredient()` and `flattenCFCols()` for CSV-based snapshot generation
- `.github/workflows/update-snapshot.yml` — nightly snapshot refresh from middleware

### Existing Subcategory Usage
- `js/modules/15-hops.js` lines 312-316 — filter pattern: `(r.subcategory || r.category || '').toLowerCase() === 'hops'`
- `content/zoho-snapshot.json` — current snapshot (198 items missing subcategory)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `flattenCF()` in catalog.js line 815: already flattens custom fields into snake_case keys — subcategory comes through automatically
- `update-snapshot.yml` workflow: nightly fetch + commit to `content/zoho-snapshot.json` — no changes needed

### Established Patterns
- Zoho item update: Zoho Inventory REST API `PUT /items/{item_id}` with `custom_fields` array
- Middleware auth: `zoho-middleware/lib/zohoAuth.js` handles OAuth token management

### Integration Points
- After tagging: nightly snapshot auto-captures subcategory
- After tagging: middleware `/api/ingredients` returns `custom_fields` with Subcategory value
- Frontend `mapItem()` in `15-hops.js` already flattens custom fields to `obj.subcategory`

</code_context>

<specifics>
## Specific Ideas

- The tagging script should produce a clear report of what it tagged and what needs manual review
- Equipment page will show both Equipment AND Cleaning subcategories together

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 20-zoho-data-foundation*
*Context gathered: 2026-05-27*
