# Phase 20: Zoho Data Foundation - Research

**Researched:** 2026-05-27
**Domain:** Zoho Inventory custom field tagging, middleware scripting, snapshot pipeline verification
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** 7 subcategory values in Zoho: Grain, Yeast, Additive, Packaging, Equipment, Cleaning, Hops
- **D-02:** Cleaning items (PBW, Star San, etc.) tagged as "Cleaning" in Zoho but displayed on the Equipment subpage. Separate subcategory preserves option to split later.
- **D-03:** Items that don't fit any specific category default to "Equipment" (catch-all)
- **D-04:** Hops items are already tagged (46 items) — no action needed for those
- **D-05:** Script + manual review workflow: write a bulk-tagging script that auto-tags obvious items by name/SKU pattern, then generate a list of ambiguous items for manual review
- **D-06:** Approximately 56 uncategorized items need tagging (~4 cleaning, ~19 equipment, ~33 ambiguous)
- **D-07:** Write an automated check script that hits the middleware API, counts items per subcategory, flags items missing subcategory, reports coverage percentage
- **D-08:** No pipeline changes needed — `/api/snapshot` already calls `flattenCF()` which produces `subcategory` from the Zoho CF label

### Claude's Discretion

- Script implementation details (Zoho API bulk update vs CSV import)
- Exact keyword-to-category mapping patterns in the tagging script
- Verification script output format

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DATA-01 | All ingredient items in Zoho Inventory have a Subcategory custom field set (Grain, Yeast, Additive, Packaging, Equipment, Hops, or uncategorized) | Tagging script uses `inventoryPut` from `zoho-api.js` with `custom_fields` array using label-based identification; 198 non-Hops items enumerated from live snapshot analysis |
| DATA-02 | The nightly snapshot pipeline captures the subcategory field so the static fallback renders correct categories | `flattenCF()` in `catalog.js:815` already does `(cf.label).toLowerCase().replace(/\s+/g, '_')` → produces `subcategory` key; no pipeline changes required; verification script confirms coverage after tagging |

</phase_requirements>

---

## Summary

Phase 20 is a pure data-entry and tooling phase — no frontend code changes, no pipeline changes. The goal is to tag all 219 ingredient items in Zoho Inventory with a "Subcategory" custom field, verify coverage via an automated script, and confirm the nightly snapshot captures the field correctly.

**Current state (verified from `content/zoho-snapshot.json`):** 219 total ingredient items in snapshot. 21 items already in Zoho's "Hops" category (these do have a Zoho category but their subcategory CF still shows as undefined in the snapshot — meaning the Subcategory custom field is not set even for these). 198 items are in no Zoho category at all. Zero items currently have a subcategory value in the snapshot.

**Critical finding:** The snapshot does NOT include `item_id` for ingredients — the `shapeIngredient()` function in `catalog.js:848` does not copy `item_id` into the shaped output. This means the tagging script cannot use the snapshot as its data source. It must call the live Zoho Inventory API (`GET /items`) to get `item_id` values before it can perform any `PUT /items/{item_id}` updates.

**Primary recommendation:** Write the tagging script as a standalone Node.js script in `zoho-middleware/scripts/` that (1) fetches all items from live Zoho via the existing `inventoryGet('/items')` pattern, (2) auto-tags 185 items by name/SKU keyword matching, (3) outputs a manual review list for 13 ambiguous items (candles, soaps, Falconer's Flight, Fermenting Starter Kit), then write a separate verification script that hits `/api/ingredients` via the running middleware and reports coverage.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Tagging items in Zoho | Script (local) | — | Direct Zoho Inventory API PUT via middleware auth layer; no frontend involvement |
| Reading item_id for tagging | Script (local) | — | Must call live Zoho API — snapshot omits item_id for ingredients |
| Snapshot pipeline capture | Middleware (production) | GitHub Actions | `flattenCF()` already handles subcategory; no code change needed |
| Coverage verification | Script (local) | — | Calls `/api/ingredients` on local middleware, analyzes subcategory field |
| Frontend filtering | Frontend (browser) | — | Phase 21+ concern; this phase only ensures data exists in Zoho |

---

## Standard Stack

### Core (no new packages needed)

This phase adds zero new npm packages. All tooling uses existing middleware dependencies.

| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| `axios` | already in middleware | HTTP calls to Zoho API | Already required by `zoho-api.js` |
| `dotenv` | already in middleware | Load `.env` for OAuth credentials | Already required by middleware |
| Node.js | v20.17.0 (verified) | Script runtime | Already installed |

### Existing Middleware Assets Reused

| Asset | File | How Used |
|-------|------|----------|
| `inventoryGet` | `zoho-middleware/lib/zoho-api.js:128` | Fetch all items with `item_id` from Zoho |
| `inventoryPut` | `zoho-middleware/lib/zoho-api.js:163` | PUT custom field update to Zoho |
| `zohoAuth.getAccessToken()` | `zoho-middleware/lib/zohoAuth.js` | OAuth token management |
| `flattenCF()` | `zoho-middleware/routes/catalog.js:815` | Already produces `subcategory` from CF label |
| `export-snapshot.js` pattern | `zoho-middleware/scripts/export-snapshot.js` | Script structure to follow (requires local middleware running) |
| `sync-images.js` pattern | `zoho-middleware/scripts/sync-images.js` | Rate-limiting pattern (700ms delay between calls) |

**Installation:** None required.

---

## Package Legitimacy Audit

No external packages are installed in this phase. All scripting uses existing middleware dependencies.

| Package | Status |
|---------|--------|
| (none) | — |

---

## Architecture Patterns

### System Architecture Diagram

```
Developer workstation
     |
     | (1) node zoho-middleware/scripts/tag-subcategories.js
     |       - loads .env (ZOHO credentials)
     |       - calls zohoAuth.getAccessToken()
     |       - calls inventoryGet('/items') → all items with item_id
     |       - auto-tags 185 items via keyword matching
     |       - calls inventoryPut('/items/{id}') for each → 700ms delay
     |       - prints ambiguous-items.md for human review
     |
     | (2) Human manually tags ~13 ambiguous items in Zoho UI
     |
     | (3) node zoho-middleware/scripts/verify-subcategories.js
     |       - requires local middleware running + authenticated
     |       - calls GET http://localhost:3001/api/ingredients
     |       - counts items per subcategory
     |       - flags items with empty subcategory
     |       - exits 0 if coverage >= 100%, 1 if any gaps
     |
     v
Zoho Inventory (cloud)
     |
     | nightly cron (6 AM UTC)
     v
update-snapshot.yml → GET /api/snapshot → flattenCF() → content/zoho-snapshot.json
```

### Recommended Project Structure

No new directories. Two new scripts only:

```
zoho-middleware/scripts/
├── csv-to-snapshot.js       # existing
├── export-snapshot.js       # existing
├── sync-images.js           # existing
├── import-vessels.js        # existing
├── tag-subcategories.js     # NEW — bulk Zoho tagger
└── verify-subcategories.js  # NEW — coverage checker
```

### Pattern 1: Script connects to Zoho directly (not via middleware HTTP)

**What:** Scripts in `zoho-middleware/scripts/` require `dotenv` and call `zohoAuth` + `zoho-api` directly, bypassing the Express server entirely. This is the pattern used by `sync-images.js`.

**When to use:** When the script needs to mutate Zoho data (not just read from it via the middleware endpoint).

**Example (from `sync-images.js` — `[CITED: zoho-middleware/scripts/sync-images.js]`):**
```javascript
// sync-images.js uses axios directly against middleware /api/snapshot
// tag-subcategories.js should instead require zoho-api directly:
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
var zohoApi = require('../lib/zoho-api');
var zohoAuth = require('../lib/zohoAuth');

// Get token, then call inventoryGet + inventoryPut
zohoAuth.getAccessToken().then(function(token) {
  // proceed with item fetch + update loop
});
```

**Caution:** `sync-images.js` calls the middleware HTTP endpoint, not Zoho directly. The tagging script should call Zoho directly via `inventoryGet`/`inventoryPut` — this matches how `catalog.js` works internally, and avoids needing the middleware server running for the write path.

### Pattern 2: Zoho Inventory item custom field update

**What:** `PUT /inventory/v1/items/{item_id}` with a `custom_fields` array using label-based identification. [CITED: https://www.zoho.com/inventory/api/v1/items/]

**Payload structure (from official Zoho Inventory docs):**
```javascript
// Source: [CITED: https://www.zoho.com/inventory/api/v1/items/]
var body = {
  custom_fields: [
    {
      label: 'Subcategory',   // exact label as shown in Zoho UI
      value: 'Grain'          // one of: Grain, Yeast, Additive, Packaging, Equipment, Cleaning, Hops
    }
  ]
};

// Using existing inventoryPut from zoho-api.js:
zohoApi.inventoryPut('/items/' + item_id, body);
```

**Alternative payload using api_name:** Community forum indicates `api_name` may also work (e.g., `cf_subcategory`) but the official docs schema shows `label` + `value` + `customfield_id`. Using `label` is safest without knowing the `customfield_id`. [ASSUMED — api_name field format not confirmed via official docs]

**Rate limit:** Zoho Inventory allows ~100 requests/minute. Use a 700ms delay between PUT calls (same as `sync-images.js`). For 198 items this means ~138 seconds total. [CITED: zoho-middleware/scripts/sync-images.js comment "Zoho API rate limit: 100 requests per minute"]

### Pattern 3: Verification script reads from middleware /api/ingredients

**What:** The verification script should call the running local middleware's `/api/ingredients` endpoint (which returns shaped items with subcategory field already flattened), count subcategory values, and report gaps.

**Why middleware, not Zoho directly:** The verification validates the full pipeline — that Zoho → middleware `flattenCF()` → shaped ingredient output is working end-to-end.

```javascript
// Source: pattern from export-snapshot.js [CITED: zoho-middleware/scripts/export-snapshot.js]
var MIDDLEWARE_URL = process.env.MIDDLEWARE_URL || 'http://localhost:3001';

http.get(MIDDLEWARE_URL + '/api/ingredients', function(res) {
  var body = '';
  res.setEncoding('utf8');
  res.on('data', function(c) { body += c; });
  res.on('end', function() {
    var data = JSON.parse(body);
    var items = data.items || [];
    var missing = items.filter(function(i) { return !i.subcategory || !i.subcategory.trim(); });
    var counts = {};
    items.forEach(function(i) {
      var sub = i.subcategory || '(missing)';
      counts[sub] = (counts[sub] || 0) + 1;
    });
    // report and exit 0/1
  });
});
```

### Anti-Patterns to Avoid

- **Using snapshot as data source for tagging:** `content/zoho-snapshot.json` ingredients do NOT include `item_id` — cannot use it to look up Zoho IDs for the PUT call. Always fetch from live Zoho API.
- **Patching snapshot JSON directly:** Do not edit `zoho-snapshot.json` manually. The nightly workflow regenerates it from Zoho. Any manual edits would be overwritten next morning.
- **One request per item without delay:** Will hit Zoho rate limits quickly. Always add 700ms between PUT calls.
- **Skipping the manual review step:** 13 items cannot be auto-tagged (candles, soaps, Falconer's Flight, Fermenting Starter Kit). The script must output these explicitly for human action in the Zoho UI.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| OAuth token management | Custom token refresh | `zohoAuth.getAccessToken()` | Already handles refresh, encryption, Redis persistence |
| Zoho API retries | Custom retry logic | `inventoryPut` (uses `withRetry`) | Already handles 429, 5xx, exponential backoff |
| Rate limiting | Custom delay timer | 700ms `setTimeout` between calls | Proven pattern from sync-images.js |
| Item fetching pagination | Custom paginator | `fetchAllItems()` from zoho-api.js | Already handles `has_more_page` up to 50 pages |

**Key insight:** All the hard Zoho API infrastructure is already built. The tagging script is ~100 lines of business logic wired to existing helpers.

---

## Item-by-Item Tagging Analysis

This section gives the planner precise data for the auto-tagging script's keyword rules and the manual review list.

### Auto-Taggable Items by Category (verified from snapshot analysis)

**Hops (45 items — need Subcategory = "Hops" even though Zoho category already set):**
All Cryo varieties (Motueka, Sabro, Strata), El Dorado, Huell Melon, Idaho 7, Krush (HBC 586), Magnum, Northern Brewer, Nugget, NZ Wai-iti, Saphir, Spalter Select, UK East Kent Golding, UK Fuggle, plus the 21 already in Hops category (Amarillo, Citra, Cryo Nelson, Czech Saaz, Hallertau Mittelfruh, Mosaic, Simcoe). Note: D-04 says "Hops items are already tagged" — but the snapshot shows 0 subcategory values even for Hops-category items. The tagging script should include all hops in its run to ensure the Subcategory CF is set.

**Grain (18 items — keyword: malt, grain, pilsner, wheat, oat, rice, corn, chit, flaked, crystal, chocolate, carafa, maris otter, bohemian):**
Briess DME (Golden Light, Pilsen Light), Gambrinus (Chit, Munich Dark, Munich Light, Pale, Pilsner, Vienna), OiO (Rice Hulls, Flaked Corn, Flaked Rice, Rolled Oat Flakes), Rahr (Extra Pale Wheat, Malted Oats), Simpsons Maris Otter, Thomas Fawcett Pale Chocolate Malt, Weyermann (CARAFA Special Type 2, Floor-Malted Bohemian Pilsner).
**Caution:** "Floating Thermometer" matched grain patterns in testing (false positive via "floating") — exclude it. "Malto-Dextrin" matched grain — it is legitimately an adjunct, keep as Grain. "Monster Mill" matched grain via "mill" keyword — it is Equipment, exclude from Grain.

**Yeast (15 items — keyword: yeast, fermentis, lalvin, lallemand, wlp, hyperdrive, verdant):**
Fermentis SafAle (BE-134, S-04, US-05, W-68, WB-06), SafLager (E-30, W-34/70), Hyperdrive RTD, Lalvin (EC-1118, K1 V1116), Verdant IPA Dry Ale, WLP820, WLP860, WLP920, WLP940.
**Caution:** Kerry Yeastex 82 is a yeast nutrient/additive, not yeast. Tag as Additive.

**Additive (55 items — keyword: acid, tannin, bentonite, campden, irish moss, whirlfloc, pectic, fermaid, potassium, conditioner, lactose, dextrose, malto-dextrin, candi syrup, coriander, orange peel, grapefruit peel, rose hip, elderber, sarsaparilla, oak spiral, lactic, malic, tartaric, calcium, fruit puree, flavoring):**
Belgian Candi Syrup (x2), Bentonite, Blueberry/Cherry/Dark Cherry Fruit Purees, Brewer's Best Natural Flavorings (Black Currant, Cherry, Cranberry, Grapefruit, Lemon, Raspberry), Calcium (Carbonate x3, Chloride x3, Sulfate x3), Campden Tablets, Citric Acid, Coriander Seed, Dextrose (x4), Dried Rose Hips, Elderberries, Fermaid K, Fermaid O, Grapefruit Peel, Irish Moss, Kerry Yeastex 82, Lactic Acid, Lactose, Malic Acid (x3), Malto-Dextrin, Oak Spirals (x3), Orange Peel (x2), Pectic Enzyme, Potassium Metabisulphite, Potassium Sorbate, Red Tart Cherry Puree, Sarsaparilla Root, Scott'tan Tannins (x3), Tartaric Acid (x3), Whirlfloc Tablets, Wine Conditioner.

**Cleaning (4 items — keyword: pbw, star san, sanitizer, cleaner, powdered brewery wash):**
PBW (SKU: BZZZ2101), Powdered Brewery Wash (PBW) 400g, Star San Sanitizer 32oz, Star San Sanitizer 8oz.

**Packaging (19 items — keyword: bottle, cork, cap, capper, bag, crown, bung — BUT exclude brushes, wands, fillers):**
1L Swing-top Amber, 1L Swing-top Amber Used, 4L Beverage Bag, 750mL Bordeaux (Brown, Clear, Amber), 750mL Swing-top Clear, Bung #10 Drilled, Bung #7 Drilled, Carboy Cap Orange, Corks (x3 varieties), Crown Cap 355mL Brown, Pry-off Crown Caps (Gold, Hop, Silver), Silicon Bung #8 Drilled.
**Caution:** Crown Cap Handheld Bottle Capper — it's Equipment (a capper tool), not Packaging.

**Equipment (23 items — keyword: airlock, carboy, fermenter, siphon, hose, clamp, thermometer, hydrometer, paddle, spoon, thief, filter pad, mill, cane, clip, brush, wand, filler, capper):**
1 Piece S-type Airlock, 23L Pail Fermenter, 23L PET Carboy Ported, 3-piece Airlock, 3/8" Clear Vinyl Hose, 71cm Mash Paddle, 71cm Spoon, Auto Siphon, Bottle Brush (33cm), Bottle Filler Wand 3/8", Carboy L-Brush Soft, Crown Cap Handheld Bottle Capper, Filter Pads Mini Jet (x3), Floating Thermometer, Glass Carboy 19L, Glass Carboy 23L, Hose Flow Pinch Clamp (Large, Small), Hydrometer Brix/SG/%, Hydrometer Cylinder 10", Monster Mill MM-2, PET Carboy 23L, Racking Cane/Hose Clip 1/2", Silicon Food-Grade Hose 1/2", Wine Thief.

### Manual Review List (13 items — cannot be auto-tagged)

| Item Name | SKU | Recommended Tag | Confidence | Notes |
|-----------|-----|-----------------|------------|-------|
| Alpenglow Candle 4oz | ALPENGLOW-4 | Equipment | MEDIUM | Non-brewing retail item; Equipment as catch-all per D-03 |
| Alpenglow Candle 9oz | ALPENGLOW-9 | Equipment | MEDIUM | Same as above |
| Backcountry Candle 4oz | BACKCOUNTRY-4 | Equipment | MEDIUM | Same as above |
| Backcountry Candle 9oz | BACKCOUNTRY-9 | Equipment | MEDIUM | Same as above |
| Bartenders Bar Soap | BARTENDERS-BAR | Equipment | MEDIUM | Same as above |
| Steins and Cedar Soap | STEINS-CEDAR | Equipment | MEDIUM | Same as above |
| Steins and Pine Soap | STEINS-PINE | Equipment | MEDIUM | Same as above |
| Northern Lights Candle 4oz | NORTHERN-4 | Equipment | MEDIUM | Same as above |
| Northern Lights Candle 9oz | NORTHERN-9 | Equipment | MEDIUM | Same as above |
| Falconer's Flight 7 C's Bulk | FAL-B | Hops | HIGH | It's a hop blend — "Flight" doesn't match hop names pattern |
| Falconer's Flight 7 C's-100g | FAL-100 | Hops | HIGH | Same blend, 100g pack |
| Falconer's Flight 7 C's-500g | FAL-500 | Hops | HIGH | Same blend, 500g pack |
| Fermenting Starter Kit - 23L / 6 Gal | 6GAL | Equipment | HIGH | A kit/bundle sold as equipment |

**Note on D-04 vs snapshot reality:** D-04 states "Hops items already tagged (46 items)." The live snapshot shows 21 items in Zoho's "Hops" category but zero items with a `subcategory` custom field set. This gap likely means the Zoho category field is set but the Subcategory *custom field* is not. The tagging script must set the Subcategory CF on all hops items — including the 21 already in Hops category and the 45+ additional hops that have no Zoho category yet. Total items that need tagging: 198 (non-Hops-category) + potentially 21 (Hops-category but no CF). Verify during script execution.

---

## Common Pitfalls

### Pitfall 1: No item_id in ingredient snapshot
**What goes wrong:** Script tries to read item IDs from `content/zoho-snapshot.json` and finds none.
**Why it happens:** `shapeIngredient()` in `catalog.js` deliberately omits `item_id` from the shaped output (it's an internal Zoho ID not needed by the frontend).
**How to avoid:** Always fetch from live Zoho API via `inventoryGet('/items', { status: 'active' })` to get `item_id`. Filter results to non-kit items the same way `doRefreshIngredients()` does.
**Warning signs:** Script logs "0 items fetched from snapshot" or finds no items to update.

### Pitfall 2: Zoho label must match exactly
**What goes wrong:** PUT succeeds (HTTP 200) but subcategory field remains unset in Zoho.
**Why it happens:** Zoho's API silently ignores custom field updates if the label string doesn't match the label defined in the org's custom field configuration exactly (case-sensitive).
**How to avoid:** The label in the PUT payload must be "Subcategory" (capital S) matching what `flattenCF()` expects: `(cf.label || '').toLowerCase().replace(/\s+/g, '_')` → `subcategory`. Verify the actual CF label in Zoho UI before running the script.
**Warning signs:** Verification script reports 0 tagged items after tagging script completes.

### Pitfall 3: Hops-category items still need the Subcategory CF set
**What goes wrong:** Planner assumes D-04 ("Hops already tagged") means no action needed for any hops. Snapshot shows subcategory is undefined even for Hops-category items.
**Why it happens:** Zoho has two separate data points: the "category" field (set to "Hops" in Zoho's native category system) vs the "Subcategory" custom field. `flattenCF()` reads from `custom_fields` array — not from the native category. The Zoho native category does not appear in the snapshot's `subcategory` field.
**How to avoid:** Include all hops (those with Zoho category="Hops" and those without) in the tagging script run.
**Warning signs:** Verification shows Hops subcategory count = 0.

### Pitfall 4: Script running without local middleware auth
**What goes wrong:** `verify-subcategories.js` returns 0 items or connection refused.
**Why it happens:** The verification script calls the local middleware which needs Zoho OAuth to be active.
**How to avoid:** Before running verification: `node zoho-middleware/server.js`, then visit `http://localhost:3001/auth/zoho`, then run script.

### Pitfall 5: Kerry Yeastex tagged as Yeast
**What goes wrong:** Auto-tagger hits "yeast" keyword and tags Kerry Yeastex 82 as Yeast. It's a yeast nutrient — an additive.
**How to avoid:** Add an exclusion rule in the keyword matcher: if name contains "yeastex" → Additive.

### Pitfall 6: false positive grain matches
**What goes wrong:** "Floating Thermometer" matches grain patterns. "Monster Mill" matches grain.
**How to avoid:** The keyword matching should check equipment keywords first (thermometer → Equipment, mill → Equipment) before checking grain patterns. Order of keyword evaluation matters.

---

## Code Examples

### Tagging Script Structure (verified pattern)

```javascript
// Source: [CITED: zoho-middleware/scripts/sync-images.js + zoho-api.js]
// zoho-middleware/scripts/tag-subcategories.js

'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

var zohoApi = require('../lib/zoho-api');

var KIT_CATEGORIES = ['wine', 'beer', 'cider', 'seltzer'];
var DELAY_MS = 700;

// Keyword rules — order matters (equipment before grain, cleaning before additive)
var RULES = [
  { subcategory: 'Hops',      keywords: ['mosaic','citra','saaz','hallertau','simcoe','fuggle','golding','nugget','magnum','northern brewer','saphir','spalter','melon','idaho','el dorado','wai-iti','krush','strata','sabro','motueka','amarillo','falconer'] },
  { subcategory: 'Cleaning',  keywords: ['pbw', 'star san', 'sanitizer', 'powdered brewery wash'] },
  { subcategory: 'Yeast',     keywords: ['fermentis','lalvin','lallemand','wlp','hyperdrive','verdant'] },
  { subcategory: 'Equipment', keywords: ['airlock','carboy','fermenter','siphon','thermometer','hydrometer','paddle','spoon','thief','filter pad','mill','hose','clamp','cane','brush','filler wand','capper','bung','cap orange'] },
  { subcategory: 'Grain',     keywords: ['malt','pilsner malt','wheat malt','malted oat','flaked corn','flaked rice','rice hull','rolled oat','carafa','maris otter','bohemian pilsner','chit malt','munich','vienna','malto-dextrin','dme','dry malt'] },
  { subcategory: 'Additive',  keywords: ['acid','tannin','bentonite','campden','irish moss','whirlfloc','pectic','fermaid','potassium','conditioner','lactose','dextrose','candi syrup','coriander','orange peel','grapefruit peel','rose hip','elderber','sarsaparilla','oak spiral','fruit puree','flavoring','yeastex','calcium carbonate','calcium chloride','calcium sulfate'] },
  { subcategory: 'Packaging', keywords: ['bottle','cork','crown cap','bung','beverage bag'] }
];

function guessSubcategory(item) {
  var name = (item.name || '').toLowerCase();
  for (var i = 0; i < RULES.length; i++) {
    var rule = RULES[i];
    for (var j = 0; j < rule.keywords.length; j++) {
      if (name.indexOf(rule.keywords[j]) !== -1) return rule.subcategory;
    }
  }
  return null; // ambiguous — needs manual review
}

function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

async function main() {
  // 1. Fetch all items from Zoho
  var allItems = await zohoApi.fetchAllItems({ status: 'active' });

  // 2. Filter to ingredients only (exclude kits and services)
  var ingredients = allItems.filter(function(item) {
    if (item.product_type === 'service') return false;
    var cfType = (item.cf_type || '').toLowerCase();
    if (KIT_CATEGORIES.indexOf(cfType) !== -1) return false;
    return true;
  });

  // 3. Classify
  var toTag = [];
  var ambiguous = [];
  ingredients.forEach(function(item) {
    var sub = guessSubcategory(item);
    if (sub) toTag.push({ item: item, subcategory: sub });
    else ambiguous.push(item);
  });

  // 4. Apply tags with rate limiting
  for (var i = 0; i < toTag.length; i++) {
    var entry = toTag[i];
    await zohoApi.inventoryPut('/items/' + entry.item.item_id, {
      custom_fields: [{ label: 'Subcategory', value: entry.subcategory }]
    });
    await sleep(DELAY_MS);
    console.log('[tag] ' + entry.item.name + ' → ' + entry.subcategory);
  }

  // 5. Output ambiguous list for manual review
  console.log('\n=== MANUAL REVIEW REQUIRED (' + ambiguous.length + ' items) ===');
  ambiguous.forEach(function(item) {
    console.log('  SKU: ' + item.sku + ' | ' + item.name);
  });
}

main().catch(function(err) { console.error(err); process.exit(1); });
```

### Verification Script Structure

```javascript
// Source: [CITED: zoho-middleware/scripts/export-snapshot.js pattern]
// zoho-middleware/scripts/verify-subcategories.js

'use strict';
var http = require('http');

var MIDDLEWARE_URL = process.env.MIDDLEWARE_URL || 'http://localhost:3001';

http.get(MIDDLEWARE_URL + '/api/ingredients', function(res) {
  var body = '';
  res.setEncoding('utf8');
  res.on('data', function(c) { body += c; });
  res.on('end', function() {
    var data = JSON.parse(body);
    var items = data.items || [];
    var counts = {};
    var missing = [];

    items.forEach(function(item) {
      var sub = (item.subcategory || '').trim();
      if (!sub) {
        missing.push(item);
      } else {
        counts[sub] = (counts[sub] || 0) + 1;
      }
    });

    console.log('\n=== Subcategory Coverage Report ===');
    console.log('Total ingredients: ' + items.length);
    console.log('Tagged:   ' + (items.length - missing.length));
    console.log('Missing:  ' + missing.length);
    console.log('Coverage: ' + Math.round((items.length - missing.length) / items.length * 100) + '%');
    console.log('\nBreakdown:');
    Object.keys(counts).sort().forEach(function(k) {
      console.log('  ' + k + ': ' + counts[k]);
    });

    if (missing.length > 0) {
      console.log('\n=== Items Still Missing Subcategory ===');
      missing.forEach(function(i) { console.log('  ' + i.sku + ' | ' + i.name); });
      process.exit(1);
    }
    process.exit(0);
  });
}).on('error', function(err) {
  console.error('Could not reach middleware: ' + err.message);
  console.error('Start middleware: node zoho-middleware/server.js');
  process.exit(1);
});
```

---

## Runtime State Inventory

This phase mutates Zoho Inventory data directly (custom field values on item records). No local database migration, no git-stored state change beyond the nightly snapshot.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Zoho Inventory: ~219 ingredient item records, Subcategory custom field currently empty | Script sets CF value via PUT /items/{id} — Zoho persists permanently |
| Live service config | None | — |
| OS-registered state | None | — |
| Secrets/env vars | `.env` in `zoho-middleware/` — needs ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_ORG_ID, ZOHO_DOMAIN already set | No changes needed — already configured for local dev |
| Build artifacts | `content/zoho-snapshot.json` — will auto-update next nightly run after tagging | Manual trigger of `update-snapshot.yml` workflow available to get immediate update |

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|-----------------|--------|
| Direct HTTP to Zoho from scripts | Scripts require `zoho-api.js` directly (no HTTP server needed) | Simpler: no middleware running required for tagging script |
| Manual Zoho UI edits per item | Bulk script + manual review list | ~2 minutes script runtime vs hours of manual UI work |

---

## Open Questions (RESOLVED)

1. **Does the "Subcategory" custom field exist in the Zoho org with that exact label?**
   - What we know: `flattenCF()` produces `obj.subcategory` from `cf.label === 'Subcategory'`. If the label is different (e.g. "Sub Category" with a space), the PUT payload needs to match.
   - What's unclear: Cannot verify CF label without Zoho org access.
   - Recommendation: The tagging script should first call `inventoryGet('/items/' + anyItemId)` to inspect the `custom_fields` array on a known item and log the actual label before starting bulk updates. Add a `--dry-run` flag to the script.
   - **RESOLVED:** Plan 01 Task 1 includes a pre-flight CF label inspection step: before any bulk tagging, the script fetches a single known item via `inventoryGet`, logs all custom_fields labels, and aborts with an error if no field matching "Subcategory" (case-sensitive) is found. The --dry-run flag is also included. If the CF does not exist, Plan 02 Task 1 instructs the human to create it in Zoho UI first.

2. **D-04 gap: Are the 46 hops items actually tagged in Zoho?**
   - What we know: Snapshot shows 0 items with subcategory value. Zoho's "Hops" native category != Subcategory custom field.
   - What's unclear: Whether D-04 refers to the native Zoho category or the CF.
   - Recommendation: Tagging script should include all hops — no harm in setting a CF that's already set.
   - **RESOLVED:** Plan 01 Task 1 action explicitly includes all hops items in the tagging run (per D-04 correction, step 6). The script does not skip hops-category items.

3. **Candles and soaps: should they be tagged or excluded?**
   - What we know: 9 retail gift items (candles, soaps) have no brewing category. D-03 says default to "Equipment."
   - Recommendation: Tag as Equipment per D-03. Their price > 0 so they appear in the ingredients list. Manual reviewer should confirm this is intentional (they may want them hidden via "Internal Only" CF instead).
   - **RESOLVED:** Plan 02 Task 1 instructs the human to tag candles and soaps as Equipment per D-03. The manual review step surfaces these items explicitly for human confirmation.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | tagging script | Yes | v20.17.0 | — |
| Local middleware running | verify-subcategories.js | No (not currently running) | — | Start with `node zoho-middleware/server.js` |
| Zoho OAuth auth | tagging script + middleware | Yes (env vars present) | — | Re-auth via `/auth/zoho` if token expired |
| `update-snapshot.yml` manual trigger | Immediate snapshot refresh | Yes | GitHub Actions | Wait for next nightly run (6AM UTC) |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:**
- Local middleware: start with `node zoho-middleware/server.js` then visit `http://localhost:3001/auth/zoho`

---

## Security Domain

`security_enforcement: true`, `security_asvs_level: 1`.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Scripts are developer-only CLI tools, no user auth |
| V3 Session Management | No | No sessions |
| V4 Access Control | No | Scripts run locally with developer credentials |
| V5 Input Validation | Yes | Category values validated against fixed enum before PUT |
| V6 Cryptography | No | OAuth tokens managed by existing zohoAuth.js (AES-256-GCM) |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Script logs Zoho credentials | Information Disclosure | Never `console.log` env vars — already enforced by project CLAUDE.md |
| Bulk PUT overwrites correct values | Tampering | Add `--dry-run` flag; script should log every change before applying |
| Subcategory typo in PUT payload | Tampering | Validate value against VALID_SUBCATEGORIES enum before each PUT call |

```javascript
// Input validation pattern
var VALID_SUBCATEGORIES = ['Grain', 'Yeast', 'Additive', 'Packaging', 'Equipment', 'Cleaning', 'Hops'];
function isValidSubcategory(val) {
  return VALID_SUBCATEGORIES.indexOf(val) !== -1;
}
// Guard before every PUT:
if (!isValidSubcategory(entry.subcategory)) {
  console.error('[tag] INVALID subcategory "' + entry.subcategory + '" for ' + entry.item.name + ' — skipping');
  continue;
}
```

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Zoho custom field label is exactly "Subcategory" (capital S) | Code Examples | PUT would silently succeed but CF would not be updated; verification would catch this |
| A2 | PUT /items/{item_id} with `custom_fields: [{label, value}]` is the correct payload format | Code Examples | Update silently fails; `api_name` or `customfield_id` may be required instead |
| A3 | The 46 hops D-04 mentions are the Subcategory CF, not just Zoho native category | Item Analysis section | May need to tag more or fewer hops items than expected |
| A4 | Candles/soaps should be tagged Equipment (D-03 catch-all) | Manual Review List | Owner may prefer Internal Only flag to hide them entirely |

---

## Sources

### Primary (HIGH confidence)
- `zoho-middleware/routes/catalog.js:815-867` — `flattenCF()` and `shapeIngredient()` verified via direct file read
- `zoho-middleware/lib/zoho-api.js:128-175` — `inventoryGet` and `inventoryPut` verified via direct file read
- `zoho-middleware/lib/zohoAuth.js` — OAuth module verified via direct file read
- `.github/workflows/update-snapshot.yml` — nightly snapshot workflow verified via direct file read
- `content/zoho-snapshot.json` — live snapshot analyzed: 219 ingredients, 0 with subcategory field set
- `zoho-middleware/scripts/sync-images.js` — rate-limit pattern (700ms) verified via direct file read

### Secondary (MEDIUM confidence)
- [Zoho Inventory API Items documentation](https://www.zoho.com/inventory/api/v1/items/) — custom_fields payload structure: `[{customfield_id, label, value}]`

### Tertiary (LOW confidence / ASSUMED)
- Community forum: `api_name` field may work as alternative to `label` in custom_fields payload — unverified, single source

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — uses only existing middleware code, no new packages
- Architecture: HIGH — all code paths verified in source
- Item categorization: HIGH — 198 items enumerated from live snapshot with suggested tags
- Pitfalls: HIGH — derived from direct source code analysis
- Zoho API payload format: MEDIUM — official docs confirm structure, A1/A2 still need runtime confirmation

**Research date:** 2026-05-27
**Valid until:** 2026-06-27 (stable Zoho API, stable middleware; snapshot data may drift if items added)
