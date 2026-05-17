# Phase 15: BeerXML Import - Research

**Researched:** 2026-05-17
**Domain:** BeerXML parsing (browser-side), fuzzy ingredient matching, admin recipe editor integration
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Browser-side parsing using DOMParser. No file upload to the middleware. The XML is parsed entirely in the browser JS, ingredients are extracted, and the final mapped recipe is sent to the existing `create_recipe` API via the middleware.
- **D-02:** File size validation (500KB max) and basic XML well-formedness check happen client-side before parsing. Malformed or oversized files show a clear error message.
- **D-03:** "Import from BeerXML" button lives inside the admin recipe editor (Recipes tab), alongside the existing "New Recipe" button. Clicking it opens a file picker, parses the XML, and pre-fills the recipe form (name, style, ABV, batch size, ingredients). Staff reviews and saves like any manual recipe.
- **D-04:** No import from the kiosk — admin panel only. Kiosk recipe editor is a future feature (deferred).
- **D-05:** Auto-match each parsed ingredient against the Zoho ingredient catalog using fuzzy name matching. Reuse the existing `filterIngredientCatalog()` function in admin.js.
- **D-06:** Show a review table after parsing: BeerXML ingredient name → best Zoho match + confidence indicator. Staff can accept, change (via search dropdown reusing existing pattern), or skip/remove each row. Unmatched items flagged visually.
- **D-07:** All matches must be confirmed by staff before saving — no silent auto-save. The review table IS the mandatory review step required by the success criteria.
- **D-08:** Auto-convert all weights to kg (grains, fermentables) or g (hops, small additions). BeerXML AMOUNT field is in kg per spec, but detect and convert if values appear to be in lbs.
- **D-09:** Show both original BeerXML value and converted value in the review table so staff can verify the conversion is correct.
- **D-10:** Yeast items use "pcs" as unit (1 packet = 1 pcs). Misc items keep their BeerXML unit or default to g.

### Claude's Discretion

- **BeerXML element mapping:** Claude decides which BeerXML elements to extract (FERMENTABLES, HOPS, YEASTS, MISCS) and how to map them to the recipe schema fields (name, style, abv from RECIPE element; ingredients from sub-elements).
- **Fuzzy matching algorithm:** Claude decides the matching approach — could be simple substring/includes, Levenshtein distance, or a scoring heuristic. Should produce reasonable matches for common brewing ingredients (e.g., "Pale Malt 2-Row" → "Gambrinus Pale Malt").
- **Review table layout:** Claude designs the mapping review table. Should be scannable, with clear accept/change/skip actions per row.
- **Error handling:** Claude decides how to handle BeerXML files with multiple recipes (import first recipe only? Let staff choose?), missing fields, or unusual ingredient types.

### Deferred Ideas (OUT OF SCOPE)

- **Kiosk inline recipe editor** — full recipe create/edit form in kiosk.html
- **Kiosk BeerXML import** — import from the kiosk page, not just admin
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| IMP-01 | Staff can upload a BeerXML file (.xml) from any brewing software (BeerSmith, Brewfather, Brewtarget, etc.) | FileReader + `<input type="file" accept=".xml">` pattern confirmed from existing importOrderCSV() in admin.js; DOMParser confirmed available in jsdom test env |
| IMP-02 | Parser extracts fermentables, hops, yeast, and misc ingredients with correct units (kg, using AMOUNT not DISPLAY_AMOUNT) | BeerXML spec verified: AMOUNT always kg for fermentables/hops; AMOUNT_IS_WEIGHT flag for yeast/misc; DISPLAY_AMOUNT is localized string to ignore |
| IMP-03 | Staff review an ingredient-to-Zoho-SKU mapping table before saving, with manual match/correction per ingredient | filterIngredientCatalog() + selectIngredientFromAutocomplete() pattern verified in admin.js; existing modal infrastructure in admin.css (.admin-modal) |
| IMP-04 | Imported recipe saves as draft status until staff sets a price and activates it | populateRecipeForm() sets status field; default value is 'draft'; canActivateRecipe() guardrail already enforces locked_price before active |
</phase_requirements>

---

## Summary

Phase 15 adds a "Import from BeerXML" button to the admin Recipes tab. Clicking it opens a native file picker (`<input type="file">`), reads the selected `.xml` file via `FileReader`, validates size (≤500KB) and well-formedness before any parse, then uses `DOMParser` to extract ingredients from the four BeerXML ingredient collections (FERMENTABLES, HOPS, YEASTS, MISCS). Extracted ingredients are auto-matched against the already-loaded Zoho catalog via `filterIngredientCatalog()`, and results are shown in a review table rendered inside an `.admin-modal` overlay. Staff accepts, corrects, or skips each mapping row; on confirm the recipe form is pre-filled and normal `saveRecipe()` proceeds — no new API endpoints required.

The entire implementation is client-side JavaScript in `js/admin.js`, operating inside the existing recipes IIFE. The only HTML changes are one new button in `admin.html` and one new hidden file input plus the review modal markup. CSS additions are a handful of new classes inside `css/admin.css`. No middleware changes. No new dependencies.

**Primary recommendation:** Implement as three focused functions — `parseBeerXML(xmlString)` (pure, returns structured data), `autoMatchIngredients(parsed)` (runs filterIngredientCatalog on each item), and `showBeerXMLReviewModal(matched)` (renders review table inside existing `.admin-modal` infrastructure). Export `parseBeerXML` and `autoMatchIngredients` via module.exports for testing.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| File validation (size, well-formedness) | Browser / Client | — | D-02: no server upload; FileReader.readAsText gives content, file.size gives size before read |
| XML parsing | Browser / Client | — | D-01: DOMParser is synchronous, runs entirely in browser; no server round-trip |
| Ingredient fuzzy matching | Browser / Client | — | D-05: reuse filterIngredientCatalog() which queries already-loaded catalog |
| Review table UI | Browser / Client | — | D-06/D-07: inline admin modal, no new views |
| Recipe save | API / Backend | — | Unchanged: saveRecipe() hits existing POST /api/recipes via middleware |
| Status enforcement (draft) | Browser / Client | API / Backend | IMP-04: form default + canActivateRecipe() client guard; middleware also requires active status change to pass validation |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| DOMParser (browser built-in) | N/A | Parse XML string into DOM document | Zero-dependency; available in all modern browsers and Jest jsdom; already used pattern in project |
| FileReader (browser built-in) | N/A | Read File object to string | Same pattern as importOrderCSV() already in admin.js (line 3681) |

No npm packages required. This phase adds zero new dependencies. [VERIFIED: codebase grep]

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `escapeHTML()` (js/lib/utils.js) | project | Sanitize BeerXML text before innerHTML | Always — ingredient names from XML must be escaped before rendering |
| `filterIngredientCatalog()` (admin.js) | project | Fuzzy search against loaded catalog | Auto-matching step after parse |
| `.admin-modal` CSS infrastructure (admin.css) | project | Review overlay container | Reuse existing modal pattern — no new CSS needed for structure |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| DOMParser | XMLHttpRequest with `responseXML` | DOMParser is cleaner, synchronous with string input, universally available |
| Custom fuzzy scorer | fuzzyset.js or fast-fuzzy npm | Adding an npm dep is disproportionate for ingredient name matching; substring + word-overlap scoring is sufficient for ~50-ingredient catalogs |
| Inline review in recipe form | Separate modal overlay | Modal keeps the review step clearly distinct from the recipe editor, preventing confusion between "imported data" and "confirmed data" |

**Installation:** None required.

---

## Architecture Patterns

### System Architecture Diagram

```
Staff clicks "Import from BeerXML"
        |
        v
[Hidden <input type="file">].click()
        |
   File selected
        |
        v
[validateBeerXML(file)]
  - file.size > 500 * 1024? --> showToast error, abort
  - FileReader.readAsText()
        |
   onload fires
        |
        v
[DOMParser.parseFromString(text, 'application/xml')]
  - parsererror element present? --> showToast error, abort
        |
   xmlDoc object
        |
        v
[parseBeerXML(xmlDoc)] --> returns parsedRecipe {
    name, style, abv, batch_size_l, ibu, colour_srm,
    ingredients: [{ beerxml_name, type, amount_kg, amount_display, unit }]
}
        |
        v
[autoMatchIngredients(parsedRecipe.ingredients)]
  - for each ingredient: filterIngredientCatalog(beerxml_name)
  - take first result as best_match (or null if no results)
  - attach confidence: 'high' | 'low' | 'none'
        |
        v
[showBeerXMLReviewModal(parsedRecipe, matchedIngredients)]
  - Renders .admin-modal with review table
  - Each row: beerxml name | converted amount | unit | Zoho match dropdown | status badge | skip
  - "Confirm Import" button at bottom
        |
   Staff reviews each row
   (accept / change dropdown / skip)
        |
   Staff clicks "Confirm Import"
        |
        v
[openRecipeDetail(null)] -- blank new recipe
        |
        v
[populateRecipeForm(parsedRecipe)] -- fills name/style/abv/batch_size
        |
        v
[_recipesState.currentIngredients = confirmedIngredients]
        |
        v
[renderIngredientRows(_recipesState.currentIngredients)]
        |
   Recipe form shown with pre-filled data
        |
   Staff sets price, adjusts, clicks "Save Recipe"
        |
        v
[saveRecipe()] -- existing function, no changes
        |
        v
POST /api/recipes --> status: 'draft'
```

### Recommended Project Structure

No new files. All code goes in:
```
js/admin.js           # New functions inside recipes IIFE: parseBeerXML,
                      #   autoMatchIngredients, showBeerXMLReviewModal,
                      #   validateAndReadBeerXML, confirmBeerXMLImport
admin.html            # One new button, one hidden file input, one modal div
css/admin.css         # New classes: .beerxml-review-*, .beerxml-match-*
tests/frontend/
  admin-beerxml.test.js   # New test file for parseBeerXML + autoMatchIngredients
```

### Pattern 1: FileReader with File Validation

**What:** Validate before reading; use FileReader.readAsText for XML.
**When to use:** Any client-side file import in admin.js.
**Example:**
```javascript
// Source: existing importOrderCSV() admin.js line 3680; adapted for XML
function validateAndReadBeerXML(file) {
  var MAX_BYTES = 500 * 1024; // 500 KB per D-02
  if (!file) return;
  if (file.size > MAX_BYTES) {
    showToast('BeerXML file is too large (max 500 KB). Please export a single recipe.', 'error');
    return;
  }
  var reader = new FileReader();
  reader.onload = function (e) {
    var text = e.target.result;
    var parser = new DOMParser();
    var xmlDoc = parser.parseFromString(text, 'application/xml');
    // Check for parse errors (malformed XML)
    if (xmlDoc.getElementsByTagName('parsererror').length > 0) {
      showToast('The file contains invalid XML. Please re-export from your brewing software.', 'error');
      return;
    }
    var parsed = parseBeerXML(xmlDoc);
    if (!parsed) {
      showToast('No valid BeerXML recipe found in this file.', 'error');
      return;
    }
    var matched = autoMatchIngredients(parsed);
    showBeerXMLReviewModal(parsed, matched);
  };
  reader.readAsText(file);
}
```

### Pattern 2: BeerXML Element Extraction

**What:** Use getElementsByTagName to navigate BeerXML structure.
**When to use:** All BeerXML parsing.
**Example:**
```javascript
// Source: BeerXML 1.0 spec verified at beerxml.com/beerxml.htm
function getTagText(parent, tagName) {
  var els = parent.getElementsByTagName(tagName);
  return els.length > 0 ? (els[0].textContent || '').trim() : '';
}

function parseBeerXML(xmlDoc) {
  var recipes = xmlDoc.getElementsByTagName('RECIPE');
  if (recipes.length === 0) return null;
  var recipe = recipes[0]; // Always use first recipe (D-08 discretion: import first)

  var styleEl = recipe.getElementsByTagName('STYLE');
  var styleName = styleEl.length > 0 ? getTagText(styleEl[0], 'NAME') : '';

  var parsed = {
    name:          getTagText(recipe, 'NAME'),
    style:         styleName,
    abv:           parseFloat(getTagText(recipe, 'EST_ABV')) || 0,
    batch_size_l:  parseFloat(getTagText(recipe, 'BATCH_SIZE')) || 0,
    ibu:           parseFloat(getTagText(recipe, 'EST_IBU')) || 0,
    colour_srm:    parseFloat(getTagText(recipe, 'EST_COLOR')) || 0,
    ingredients:   []
  };

  // FERMENTABLES: AMOUNT in kg per spec
  var ferms = recipe.getElementsByTagName('FERMENTABLE');
  for (var i = 0; i < ferms.length; i++) {
    var amtKg = parseFloat(getTagText(ferms[i], 'AMOUNT')) || 0;
    parsed.ingredients.push({
      beerxml_name:    getTagText(ferms[i], 'NAME'),
      beerxml_type:    'fermentable',
      amount_kg:       amtKg,
      amount_display:  amtKg.toFixed(3) + ' kg',
      unit:            'kg'
    });
  }

  // HOPS: AMOUNT in kg per spec -- convert to grams for Zoho catalog compatibility
  var hops = recipe.getElementsByTagName('HOP');
  for (var j = 0; j < hops.length; j++) {
    var hopKg = parseFloat(getTagText(hops[j], 'AMOUNT')) || 0;
    var hopG = hopKg * 1000;
    parsed.ingredients.push({
      beerxml_name:    getTagText(hops[j], 'NAME'),
      beerxml_type:    'hop',
      amount_kg:       hopKg,
      amount_display:  hopG.toFixed(1) + ' g',
      unit:            'g'
    });
  }

  // YEASTS: 1 packet = 1 pcs (D-10)
  var yeasts = recipe.getElementsByTagName('YEAST');
  for (var k = 0; k < yeasts.length; k++) {
    parsed.ingredients.push({
      beerxml_name:    getTagText(yeasts[k], 'NAME'),
      beerxml_type:    'yeast',
      amount_kg:       1,
      amount_display:  '1 pcs',
      unit:            'pcs'
    });
  }

  // MISCS: default g; check AMOUNT_IS_WEIGHT flag
  var miscs = recipe.getElementsByTagName('MISC');
  for (var m = 0; m < miscs.length; m++) {
    var miscAmt = parseFloat(getTagText(miscs[m], 'AMOUNT')) || 0;
    var isWeight = getTagText(miscs[m], 'AMOUNT_IS_WEIGHT').toLowerCase() === 'true';
    var miscDisplay = isWeight ? (miscAmt * 1000).toFixed(1) + ' g' : miscAmt.toFixed(3) + ' L';
    parsed.ingredients.push({
      beerxml_name:    getTagText(miscs[m], 'NAME'),
      beerxml_type:    'misc',
      amount_kg:       miscAmt,
      amount_display:  miscDisplay,
      unit:            isWeight ? 'g' : 'L'
    });
  }

  return parsed;
}
```

### Pattern 3: Auto-Matching Ingredients

**What:** Run filterIngredientCatalog against each BeerXML ingredient name and assign confidence.
**When to use:** After parseBeerXML, before review modal.
**Example:**
```javascript
// Source: filterIngredientCatalog verified in admin.js line 8384
function autoMatchIngredients(parsed) {
  return (parsed.ingredients || []).map(function (ing) {
    var results = filterIngredientCatalog(ing.beerxml_name);
    var best = results.length > 0 ? results[0] : null;
    // Confidence: high if name contains any word from query (already filtered by indexOf)
    var confidence = best ? (results.length === 1 ? 'high' : 'low') : 'none';
    return {
      beerxml_name:    ing.beerxml_name,
      beerxml_type:    ing.beerxml_type,
      amount_display:  ing.amount_display,
      unit:            ing.unit,
      quantity:        ing.beerxml_type === 'hop' ? (ing.amount_kg * 1000)
                       : ing.beerxml_type === 'fermentable' ? ing.amount_kg
                       : ing.amount_kg,
      zoho_match:      best,    // catalog item or null
      confidence:      confidence,
      skipped:         false
    };
  });
}
```

### Pattern 4: Confirm Import into Recipe Form

**What:** After modal confirm, pre-fill recipe form using existing populateRecipeForm + _recipesState.
**When to use:** When staff clicks "Confirm Import" in review modal.
**Example:**
```javascript
// Source: openRecipeDetail(null) admin.js line 8181 and populateRecipeForm admin.js line 8233
function confirmBeerXMLImport(parsedRecipe, confirmedRows) {
  // Open blank recipe form first
  openRecipeDetail(null);
  // Populate header fields
  populateRecipeForm({
    name:          parsedRecipe.name,
    style:         parsedRecipe.style,
    abv:           parsedRecipe.abv,
    batch_size_l:  parsedRecipe.batch_size_l,
    ibu:           parsedRecipe.ibu,
    colour_srm:    parsedRecipe.colour_srm,
    status:        'draft'  // IMP-04: always draft on import
  });
  // Build confirmed ingredient list from non-skipped rows with a valid Zoho match
  var ings = [];
  confirmedRows.forEach(function (row) {
    if (row.skipped || !row.zoho_match) return;
    ings.push({
      item_id:   row.zoho_match.item_id,
      item_name: row.zoho_match.name,
      sku:       row.zoho_match.sku,
      quantity:  row.quantity,
      unit:      row.unit,
      purchase_rate: parseFloat(row.zoho_match.purchase_rate) || 0,
      rate:          parseFloat(row.zoho_match.rate || row.zoho_match.price_per_unit) || 0
    });
  });
  _recipesState.currentIngredients = ings;
  renderIngredientRows(ings, null);
}
```

### Pattern 5: Multiple Recipes in File

Per Claude's discretion: if `xmlDoc.getElementsByTagName('RECIPE').length > 1`, show a toast "This file contains multiple recipes — importing the first one." and proceed with `recipes[0]`. Staff can re-import the file and the software can be instructed to export one recipe at a time. No recipe picker UI needed.

### Anti-Patterns to Avoid

- **Using DISPLAY_AMOUNT instead of AMOUNT:** DISPLAY_AMOUNT is a localized string like "8.00 lb" — not parseable reliably. Always use `<AMOUNT>` which is always in kg.
- **Sending raw XML to the middleware:** D-01 is a locked decision. XML never leaves the browser.
- **Auto-saving on import confirm:** The confirmed ingredient list goes into the form for staff to review again before clicking "Save Recipe". The middleware create_recipe call only happens on explicit save.
- **innerHTML with unsanitized BeerXML text:** Ingredient names from BeerXML are user-controlled. Always wrap in `escapeHTML()` before inserting into innerHTML.
- **Treating AMOUNT in yeast records as kg:** Yeast AMOUNT is in liters (or kg if AMOUNT_IS_WEIGHT=true), but for the store catalog the meaningful unit is 1 pcs (1 packet). Use AMOUNT only to confirm "is any amount present" and default quantity to 1 pcs per D-10.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| XML parsing | Custom regex/string split for XML | `DOMParser.parseFromString()` | Regex on XML breaks on nested elements, CDATA, entity refs, attribute variations |
| XML error detection | Try/catch text heuristics | `xmlDoc.getElementsByTagName('parsererror')` | DOMParser returns a parsererror document on malformed XML — the spec-defined way to detect it |
| Fuzzy ingredient matching | New algorithm | `filterIngredientCatalog(query)` | Already implemented, tested, and handles the catalog size; adding a second matcher creates divergence |
| Modal overlay | New modal component | Existing `.admin-modal` / `.admin-modal-overlay` / `.admin-modal-content` CSS in admin.css | Already animated, scrollable, z-indexed; reuse |

**Key insight:** The entire technical complexity of this phase (XML parse, match, review, save) is solved with built-in browser APIs and already-written project functions. The only new logic is the BeerXML element mapping and the fuzzy confidence scoring.

---

## Runtime State Inventory

Step 2.5 SKIPPED — this is a greenfield feature, not a rename/refactor phase.

---

## Environment Availability Audit

Step 2.6 SKIPPED — no external tools, services, CLIs, or runtimes required. This phase is browser-side JS and admin.html markup only.

---

## Common Pitfalls

### Pitfall 1: DOMParser parsererror false negative

**What goes wrong:** `DOMParser.parseFromString()` never throws — it returns a document with a `<parsererror>` element on malformed input. If the check is omitted, subsequent `getElementsByTagName()` calls silently return empty HTMLCollections and the import appears to succeed with no ingredients.

**Why it happens:** DOMParser design decision — it never throws synchronously.

**How to avoid:** Always check `xmlDoc.getElementsByTagName('parsererror').length > 0` immediately after parse.

**Warning signs:** Import reports "0 ingredients found" on a file that clearly has ingredients.

### Pitfall 2: AMOUNT in hops is tiny (kg not g)

**What goes wrong:** A 28g hop addition is `<AMOUNT>0.028</AMOUNT>` in BeerXML (kg). If rendered directly as the quantity in grams without conversion, staff sees "0.028" in the review table, which is confusing.

**Why it happens:** BeerXML spec stores everything in kg. Hops use gram-level additions.

**How to avoid:** For hop ingredients, multiply `amount_kg * 1000` to get grams before populating `quantity` and `amount_display`. Always show `amount_display` (the human-readable converted value) in the review table alongside `amount_kg` (the raw BeerXML value) per D-09.

**Warning signs:** Hop quantities showing as 0.028, 0.057, etc. in review table.

### Pitfall 3: Yeast AMOUNT is not the catalog quantity

**What goes wrong:** BeerXML `<AMOUNT>0.011587</AMOUNT>` for yeast is liters of slurry — not meaningful as a Zoho catalog quantity. Saving `0.011587 L` of yeast to the recipe is incorrect; the store sells packets.

**Why it happens:** BeerXML was designed for homebrew software that thinks in liters of slurry, not commercial packets.

**How to avoid:** Per D-10, yeast quantity is always hardcoded to 1 pcs. Ignore the BeerXML AMOUNT value for yeast entirely.

**Warning signs:** Yeast quantities like 0.011 or 11.587 in the ingredient list.

### Pitfall 4: filterIngredientCatalog returns 0 results when catalog is cold

**What goes wrong:** `_recipesState.catalogLoaded` is false when the recipes tab hasn't been loaded yet. `filterIngredientCatalog` would work against an empty array, producing 0 matches for every ingredient.

**Why it happens:** The ingredient catalog is lazy-loaded on first Recipes tab visit (line 8047).

**How to avoid:** The import button should only be active (or even visible) after the catalog is loaded. Check `_recipesState.catalogLoaded` before triggering the file picker; if catalog is not ready, show a toast "Loading ingredient catalog, please try again in a moment." In practice this is not an issue because the import button lives inside the Recipes tab detail view, which is only accessible after the tab has already loaded the catalog.

**Warning signs:** Every ingredient in the review table shows "No match found" even for common ingredients like "Pale Malt".

### Pitfall 5: escapeHTML omitted on BeerXML content

**What goes wrong:** A BeerXML file with an ingredient name like `Malt <2-Row>` or a description containing `&` causes either broken HTML or XSS in the review modal.

**Why it happens:** BeerXML is user-generated XML from brewing software; ingredient names can contain angle brackets or ampersands.

**How to avoid:** All text from BeerXML nodes must pass through `escapeHTML()` before being assigned to `.innerHTML` or concatenated into HTML strings. Use `element.textContent` assignment where possible (no escaping needed).

**Warning signs:** Broken table layout in review modal, or browser DevTools showing unescaped angle brackets in DOM.

### Pitfall 6: File input not reset after use

**What goes wrong:** After a successful import, clicking "Import from BeerXML" a second time with the same file fires no `change` event, silently doing nothing.

**Why it happens:** Browser `change` event on file inputs does not fire if the same file is selected again.

**How to avoid:** Reset the file input value to `''` inside the `change` handler after reading the file. Same pattern used by the existing CSV import (line 3758: `importFile.value = '';`).

### Pitfall 7: Case-sensitivity in getElementsByTagName

**What goes wrong:** `getElementsByTagName('fermentable')` (lowercase) misses `<FERMENTABLE>` elements in an XML document.

**Why it happens:** XML is case-sensitive. BeerXML uses uppercase element names. Unlike HTML, the XML parser does not normalize case.

**How to avoid:** Always use uppercase tag names: `getElementsByTagName('FERMENTABLE')`, `getElementsByTagName('HOP')`, etc. [VERIFIED: BeerXML spec at beerxml.com/beerxml.htm]

---

## Code Examples

### BeerXML sample structure (real export from BeerSmith)

```xml
<!-- Source: GitHub codekitchen/beerxml examples confirmed via WebFetch -->
<RECIPES>
  <RECIPE>
    <NAME>Burton Ale</NAME>
    <BATCH_SIZE>18.93</BATCH_SIZE>
    <EST_ABV>5.2</EST_ABV>
    <STYLE>
      <NAME>English Pale Ale</NAME>
    </STYLE>
    <FERMENTABLES>
      <FERMENTABLE>
        <NAME>Pale Malt (2 Row) UK</NAME>
        <AMOUNT>3.628736</AMOUNT>        <!-- 8 lb in kg -->
        <TYPE>Grain</TYPE>
        <DISPLAY_AMOUNT>8.00 lb</DISPLAY_AMOUNT>  <!-- DO NOT USE -->
      </FERMENTABLE>
    </FERMENTABLES>
    <HOPS>
      <HOP>
        <NAME>East Kent Goldings (EKG)</NAME>
        <AMOUNT>0.0638</AMOUNT>          <!-- ~63.8g in kg -->
        <USE>Boil</USE>
      </HOP>
    </HOPS>
    <YEASTS>
      <YEAST>
        <NAME>London ESB Ale</NAME>
        <FORM>Liquid</FORM>
        <AMOUNT>0.035</AMOUNT>           <!-- liters of slurry -- ignore, use 1 pcs -->
      </YEAST>
    </YEASTS>
    <MISCS>
      <MISC>
        <NAME>Irish Moss</NAME>
        <AMOUNT>0.007</AMOUNT>           <!-- kg or L depending on AMOUNT_IS_WEIGHT -->
        <AMOUNT_IS_WEIGHT>TRUE</AMOUNT_IS_WEIGHT>
      </MISC>
    </MISCS>
  </RECIPE>
</RECIPES>
```

### DOMParser well-formedness check

```javascript
// Source: MDN Web API documentation (developer.mozilla.org/en-US/docs/Web/API/DOMParser)
var parser = new DOMParser();
var xmlDoc = parser.parseFromString(xmlString, 'application/xml');
if (xmlDoc.getElementsByTagName('parsererror').length > 0) {
  // XML is malformed -- show error, do not proceed
}
```

### Confidence scoring for review table badges

```javascript
// Source: project pattern (filterIngredientCatalog admin.js line 8384)
// filterIngredientCatalog uses indexOf substring match; a single result = unambiguous
function getMatchConfidence(beerxmlName, results) {
  if (!results || results.length === 0) return 'none';
  var q = beerxmlName.toLowerCase();
  var topName = (results[0].name || '').toLowerCase();
  // Exact match or very close: 'high'
  if (topName === q || topName.indexOf(q) === 0 || q.indexOf(topName) === 0) return 'high';
  return 'low';
}
```

### Review modal HTML pattern

```javascript
// Reuses existing .admin-modal structure from admin.css (line 727)
// maxWidth should be wider than default 560px for the ingredient table
var modalHtml = '<div class="admin-modal" id="beerxml-review-modal" role="dialog" aria-modal="true" aria-labelledby="beerxml-modal-title">' +
  '<div class="admin-modal-overlay"></div>' +
  '<div class="admin-modal-content" style="max-width:800px;">' +
    '<div class="admin-modal-header">' +
      '<h3 id="beerxml-modal-title">Review BeerXML Import: ' + escapeHTML(parsedRecipe.name) + '</h3>' +
      '<button type="button" class="admin-modal-close" id="beerxml-modal-close">&times;</button>' +
    '</div>' +
    '<div class="admin-modal-body">' +
      '<!-- Review table rows here -->' +
    '</div>' +
    '<div class="recipes-detail-actions">' +
      '<button type="button" class="btn" id="beerxml-confirm-btn">Confirm Import</button>' +
      '<button type="button" class="btn-secondary" id="beerxml-cancel-btn">Cancel</button>' +
    '</div>' +
  '</div>' +
'</div>';
document.body.appendChild(modalEl);
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Server-side XML parse | Browser-side DOMParser | D-01 decision | No middleware endpoint needed; zero latency |
| npm xml2js or fast-xml-parser | Built-in DOMParser | — | Zero deps added |
| DISPLAY_AMOUNT for quantities | AMOUNT (kg) per spec | BeerXML 1.0 always | Correct SI units for calculation |

**Deprecated/outdated:**
- BeerXML 2.0/2.07: An updated spec exists (BeerXML-Standard repo on GitHub) but BeerSmith 2/3 and most homebrew software export BeerXML 1.0. The parsing approach is the same; the planner should target 1.0 compatibility.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | BeerSmith exports AMOUNT in kg even when user's settings are imperial | Code Examples / Pitfalls | Fermentable/hop quantities would be ~2.2x too large; D-08 detection logic would need lbs detection heuristic |
| A2 | filterIngredientCatalog(query) returns up to 6 results via `.slice(0,6)` — adequate for auto-matching (take first result) | Architecture / Don't Hand-Roll | If catalog returns 0 results for BeerXML names due to poor naming overlap, all confidence=none; staff must manually assign every row |
| A3 | The Zoho ingredient catalog uses 'g' as unit for hops and 'kg' for fermentables, making unit-based routing reliable | Code Examples | If catalog mixes units, the unit shown in review table may be wrong; staff review step is the safety net |

**Claims A1-A3 tagged `[ASSUMED]`** — not verified against live Zoho catalog or live BeerSmith export during this session. The review table (IMP-03, D-07) is the safety net for all three: staff confirms quantities and units before save.

---

## Open Questions

1. **Multiple recipes in one BeerXML file**
   - What we know: BeerXML allows `<RECIPES>` to contain multiple `<RECIPE>` elements; BeerSmith export wizard defaults to the selected recipe only but can export all.
   - What's unclear: Should the planner build a recipe-picker step, or just always use the first?
   - Recommendation: Per Claude's discretion, import first recipe + show toast "N recipes found; importing the first." This keeps the review flow simple and staff can re-export for other recipes.

2. **BeerXML EST_COLOR field units (SRM vs EBC)**
   - What we know: EST_COLOR in BeerXML 1.0 is in SRM. The recipe form has `colour_srm`.
   - What's unclear: Some BeerSmith setups display EBC (1 SRM ≈ 1.97 EBC). The raw EST_COLOR field is always SRM per spec.
   - Recommendation: Populate `colour_srm` directly from EST_COLOR; show in review table so staff can correct if needed.

3. **No IBU field in RECIPE element**
   - What we know: BeerXML 1.0 has `EST_IBU` as an estimated field; not always present.
   - What's unclear: If missing, recipe IBU field should be left blank (0 or empty string).
   - Recommendation: `parseFloat(getTagText(recipe, 'EST_IBU')) || 0` — 0 defaults to blank display.

---

## Security Domain

### Applicable ASVS Categories (ASVS Level 1)

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Feature is admin-only; existing Google OAuth gates admin.html |
| V3 Session Management | no | No new session handling |
| V4 Access Control | no | No new endpoints; existing admin auth unchanged |
| V5 Input Validation | yes | escapeHTML() on all BeerXML text before DOM insertion; size check before parse; well-formedness check via parsererror |
| V6 Cryptography | no | No crypto operations |

### Known Threat Patterns for BeerXML + DOMParser

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS via crafted ingredient names (`<script>`, `&lt;img onerror`) | Tampering | `escapeHTML()` all BeerXML text before innerHTML; prefer `textContent` assignment where possible |
| XML bomb / billion laughs | DoS | 500KB file size limit (D-02) prevents files large enough to cause entity expansion DoS |
| XXE (XML external entity) | Information Disclosure | DOMParser in browsers does NOT process external entities or DTD declarations — browser sandboxing prevents network fetches from DOMParser [VERIFIED: MDN DOMParser docs] |
| Oversized file exhausting memory | DoS | 500KB limit per D-02 applied before FileReader.readAsText() is called |

**Security note:** XXE is not a risk here because DOMParser runs in the browser sandbox, which disables external entity resolution and DTD processing. This is a browser-specific safety property that does not apply to server-side XML parsers — the client-side decision (D-01) is thus also the security-correct decision.

---

## Sources

### Primary (HIGH confidence)
- `js/admin.js` (project codebase) — filterIngredientCatalog (line 8384), addIngredientRow (line 8451), openRecipeDetail (line 8168), populateRecipeForm (line 8233), importOrderCSV pattern (line 3680), module.exports export pattern (line 8687)
- `admin.html` (project codebase) — recipes tab structure (line 446–581), existing button/form IDs
- `css/admin.css` (project codebase) — .admin-modal (line 727), .recipes-* classes (line 2956+)
- `tests/frontend/admin-recipes.test.js` (project codebase) — test patterns, mock setup for DOMParser/FileReader in jsdom env
- [beerxml.com/beerxml.htm](https://beerxml.com/beerxml.htm) — BeerXML 1.0 specification, AMOUNT units (kg for fermentables/hops), AMOUNT_IS_WEIGHT flag, STYLE/NAME element, EST_ABV, BATCH_SIZE
- [MDN DOMParser](https://developer.mozilla.org/en-US/docs/Web/API/DOMParser) — parseFromString API, parsererror detection, XXE non-risk in browser context
- [GitHub codekitchen/beerxml examples](https://github.com/codekitchen/beerxml/blob/master/examples/beerxml.com/recipes.xml) — real BeerXML file structure with actual AMOUNT values confirming kg units

### Secondary (MEDIUM confidence)
- BeerSmith unit conversion docs (beersmith.com) — confirms BeerSmith stores AMOUNT in kg even for imperial-unit users [CITED: beersmith.com/blog/2019/07/19/unit-conversions-and-settings-in-beersmith-3/]

### Tertiary (LOW confidence)
- A1 (ASSUMED): BeerSmith imperial export behavior — not verified against a live BeerSmith export in this session

---

## Project Constraints (from CLAUDE.md)

- **Never edit `js/main.js` or `js/main.min.js` directly** — all code goes in `js/admin.js` (admin is a separate build artifact, not in the concat:js pipeline)
- **`npm run build`** required after any `js/admin.js` change to regenerate `js/admin.min.js`
- **`npm test` AND `cd zoho-middleware && npm test`** before every commit
- **`npm run lint`** — fix all ESLint errors before committing
- **ES5 style** — use `var`, function declarations, no arrow functions, no template literals, no `const`/`let`; code targets the same syntax as the rest of admin.js
- **Write regression test first** (bug fix rule) — for this feature: write `tests/frontend/admin-beerxml.test.js` covering `parseBeerXML` and `autoMatchIngredients` before implementation
- **Never commit `.env` or credentials**
- **Staging first** — push to `origin` first; production only after human approval

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — DOMParser and FileReader are W3C/WHATWG standards; verified in MDN and project jsdom env
- Architecture: HIGH — all integration points verified in project codebase; no server changes required
- BeerXML element mapping: HIGH — verified against official beerxml.com spec and real example files
- Fuzzy matching algorithm: MEDIUM — filterIngredientCatalog behavior verified; catalog naming overlap is ASSUMED
- Pitfalls: HIGH — all pitfalls derived from verified spec behavior or direct code inspection

**Research date:** 2026-05-17
**Valid until:** 2026-08-17 (stable domain — BeerXML 1.0 spec is frozen; browser DOMParser API is stable)
