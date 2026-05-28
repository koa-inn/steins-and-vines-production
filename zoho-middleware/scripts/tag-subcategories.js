/**
 * tag-subcategories.js
 *
 * Bulk-tags ingredient items in Zoho Inventory with the "Subcategory" custom
 * field using keyword-based classification. Outputs a manual-review list for
 * items that cannot be auto-tagged.
 *
 * Prerequisites:
 *   1. .env configured with valid Zoho credentials and an active refresh token
 *      (ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_ORG_ID, ZOHO_DOMAIN)
 *   2. Zoho "Subcategory" custom field must exist on items
 *      (Settings > Preferences > Items > Custom Fields in Zoho Inventory)
 *
 * Usage:
 *   node zoho-middleware/scripts/tag-subcategories.js [--dry-run]
 *
 * Options:
 *   --dry-run   Log what would be tagged without making any API PUT calls
 *
 * Exit codes:
 *   0 — completed (all taggable items processed, even if some errors occurred)
 *   1 — completed with errors, or fatal error
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

var zohoApi = require('../lib/zoho-api');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

var args = process.argv.slice(2);
var DRY_RUN = args.indexOf('--dry-run') !== -1;

// Valid subcategory values — validate every write against this list (T-20-01)
var VALID_SUBCATEGORIES = ['Grain', 'Yeast', 'Additive', 'Packaging', 'Equipment', 'Cleaning', 'Hops'];

// Exclude kit categories (same filter used in middleware routes/catalog.js)
var KIT_CATEGORIES = ['wine', 'beer', 'cider', 'seltzer'];

// Zoho API rate limit: 100 requests per minute — add delay between calls
var DELAY_MS = 700;

// ---------------------------------------------------------------------------
// Keyword classification rules
//
// Order matters — first match wins. Equipment must come before Grain to catch
// "Monster Mill" and "Floating Thermometer" (RESEARCH.md pitfalls 5 and 6).
// Hops first to catch all hop varieties quickly.
// Yeast has a yeastex exclusion (Kerry Yeastex 82 is Additive, not Yeast).
// Packaging is last to avoid matching "bottle brush" before Equipment catches it.
// ---------------------------------------------------------------------------

var RULES = [
  {
    subcategory: 'Hops',
    keywords: [
      'mosaic', 'citra', 'saaz', 'hallertau', 'simcoe', 'fuggle', 'golding',
      'nugget', 'magnum', 'northern brewer', 'saphir', 'spalter', 'melon',
      'idaho', 'el dorado', 'wai-iti', 'krush', 'strata', 'sabro', 'motueka',
      'amarillo', 'falconer', 'cryo'
    ]
  },
  {
    subcategory: 'Cleaning',
    keywords: ['pbw', 'star san', 'sanitizer', 'powdered brewery wash']
  },
  {
    subcategory: 'Equipment',
    keywords: [
      'airlock', 'carboy', 'fermenter', 'siphon', 'thermometer', 'hydrometer',
      'paddle', 'spoon', 'thief', 'filter pad', 'mill', 'hose', 'clamp',
      'cane', 'brush', 'filler wand', 'capper', 'starter kit'
    ]
  },
  {
    subcategory: 'Yeast',
    // yeastex exclusion applied in guessSubcategory() — Kerry Yeastex 82 is Additive
    keywords: ['fermentis', 'lalvin', 'lallemand', 'wlp', 'hyperdrive', 'verdant']
  },
  {
    subcategory: 'Grain',
    keywords: [
      'dme', 'dry malt', 'pilsner', 'wheat', 'malted oat', 'flaked corn',
      'flaked rice', 'rice hull', 'rolled oat', 'carafa', 'maris otter',
      'bohemian', 'chit', 'munich', 'vienna', 'malto-dextrin', 'pale malt',
      'crystal'
    ]
  },
  {
    subcategory: 'Additive',
    keywords: [
      'acid', 'tannin', 'bentonite', 'campden', 'irish moss', 'whirlfloc',
      'pectic', 'fermaid', 'potassium', 'conditioner', 'lactose', 'dextrose',
      'candi syrup', 'coriander', 'orange peel', 'grapefruit peel', 'rose hip',
      'elderber', 'sarsaparilla', 'oak spiral', 'fruit puree', 'flavoring',
      'yeastex', 'calcium carbonate', 'calcium chloride', 'calcium sulfate',
      'lactic', 'malic', 'tartaric', 'citric'
    ]
  },
  {
    subcategory: 'Packaging',
    keywords: [
      'bottle', 'cork', 'crown cap', 'bung', 'beverage bag', 'swing-top',
      'bordeaux'
    ]
  }
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function log(msg) {
  console.log('[tag-subcategories] ' + msg);
}

function isValidSubcategory(val) {
  return VALID_SUBCATEGORIES.indexOf(val) !== -1;
}

/**
 * Classify an item by name keywords. Returns a subcategory string or null
 * if the item cannot be auto-tagged.
 */
function guessSubcategory(item) {
  var name = (item.name || '').toLowerCase();

  for (var i = 0; i < RULES.length; i++) {
    var rule = RULES[i];
    for (var j = 0; j < rule.keywords.length; j++) {
      var keyword = rule.keywords[j];
      if (name.indexOf(keyword) !== -1) {
        // Yeast exclusion: Kerry Yeastex 82 → Additive (not Yeast)
        if (rule.subcategory === 'Yeast' && name.indexOf('yeastex') !== -1) {
          // Fall through to Additive rule — don't return Yeast
          break;
        }
        return rule.subcategory;
      }
    }
  }

  return null; // ambiguous — needs manual review
}

/**
 * Check if an item already has a non-empty Subcategory CF value.
 * Skips re-tagging items that are already tagged.
 */
function getExistingSubcategory(item) {
  var cfs = item.custom_fields || [];
  for (var i = 0; i < cfs.length; i++) {
    if (cfs[i].label === 'Subcategory' && cfs[i].value && String(cfs[i].value).trim()) {
      return String(cfs[i].value).trim();
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (DRY_RUN) {
    log('=== DRY RUN — no API PUT calls will be made ===');
    console.log('');
  }

  // Step 1: Fetch all active items from Zoho Inventory
  log('Fetching all active items from Zoho Inventory...');
  var allItems = await zohoApi.fetchAllItems({ status: 'active' });
  log('Fetched ' + allItems.length + ' total items');

  // Step 2: Pre-flight CF label inspection (resolves RESEARCH.md Q1 — T-20-03)
  // Fetch a single item to verify the "Subcategory" custom field exists with
  // the expected label. This prevents 200+ silent no-op PUT calls if the CF
  // label is wrong or missing.
  if (allItems.length === 0) {
    console.error('[tag-subcategories] ABORT: No items returned from Zoho. Check credentials and org ID.');
    process.exit(1);
  }

  var firstItem = allItems[0];
  log('[preflight] Inspecting custom fields on first item: ' + firstItem.name);

  var itemDetail = await zohoApi.inventoryGet('/items/' + firstItem.item_id);
  var detailItem = (itemDetail && itemDetail.item) ? itemDetail.item : firstItem;
  var cfs = detailItem.custom_fields || [];
  var labels = cfs.map(function (cf) { return cf.label || '(no label)'; });

  log('[preflight] Custom fields on ' + firstItem.name + ': ' + (labels.length ? labels.join(', ') : '(none found)'));

  var subcategoryLabelFound = false;
  for (var fi = 0; fi < cfs.length; fi++) {
    if (cfs[fi].label === 'Subcategory') {
      subcategoryLabelFound = true;
      break;
    }
  }

  if (!subcategoryLabelFound) {
    console.error('[tag-subcategories] [preflight] ABORT: No custom field with label "Subcategory" found. Available labels: ' + (labels.length ? labels.join(', ') : '(none)') + '. Create the CF in Zoho first (Settings > Preferences > Items > Custom Fields).');
    process.exit(1);
  }

  log('[preflight] Confirmed: "Subcategory" custom field exists');
  console.log('');

  // Step 3: Filter to ingredients only
  // Exclude: services, kit categories (wine/beer/cider/seltzer via cf_type)
  var ingredients = allItems.filter(function (item) {
    if (item.product_type === 'service') return false;
    var cfType = (item.cf_type || '').toLowerCase();
    if (KIT_CATEGORIES.indexOf(cfType) !== -1) return false;
    return true;
  });

  log('Ingredient items (after filtering kits and services): ' + ingredients.length);
  console.log('');

  // Step 4: Classify items
  var toTag = [];
  var ambiguous = [];
  var alreadyTagged = [];

  for (var ci = 0; ci < ingredients.length; ci++) {
    var item = ingredients[ci];
    var existing = getExistingSubcategory(item);
    if (existing) {
      alreadyTagged.push(item);
      log('[skip] Already tagged: ' + item.name + ' (' + existing + ')');
      continue;
    }
    var subcategory = guessSubcategory(item);
    if (subcategory) {
      toTag.push({ item: item, subcategory: subcategory });
    } else {
      ambiguous.push(item);
    }
  }

  log('To tag: ' + toTag.length + ' items');
  log('Already tagged: ' + alreadyTagged.length + ' items');
  log('Ambiguous (manual review): ' + ambiguous.length + ' items');
  console.log('');

  // Step 5: Apply tags with rate limiting
  var tagged = 0;
  var errors = [];

  for (var ti = 0; ti < toTag.length; ti++) {
    var entry = toTag[ti];
    var label = '[' + (ti + 1) + '/' + toTag.length + '] ' + entry.item.name + ' → ' + entry.subcategory;

    // Input validation guard before every PUT (T-20-01)
    if (!isValidSubcategory(entry.subcategory)) {
      console.error('[tag-subcategories] INVALID subcategory "' + entry.subcategory + '" for ' + entry.item.name + ' — skipping');
      errors.push({ id: entry.item.item_id, sku: entry.item.sku, name: entry.item.name, error: 'Invalid subcategory: ' + entry.subcategory });
      continue;
    }

    if (DRY_RUN) {
      log('WOULD TAG: ' + label);
      tagged++;
      continue;
    }

    try {
      await zohoApi.inventoryPut('/items/' + entry.item.item_id, {
        custom_fields: [{ label: 'Subcategory', value: entry.subcategory }]
      });
      log('Tagged: ' + label);
      tagged++;
    } catch (err) {
      var msg = err.message;
      if (err.response && err.response.data) {
        msg = err.response.data.message || err.response.data.error || msg;
      }
      console.error('[tag-subcategories] Failed: ' + label + ' — ' + msg);
      errors.push({ id: entry.item.item_id, sku: entry.item.sku, name: entry.item.name, error: msg });
    }

    // Rate limit delay — skip after last item
    if (ti < toTag.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  // Step 6: Summary
  console.log('');
  console.log('--- Tag Summary ---');
  console.log('  Total ingredients:  ' + ingredients.length);
  console.log('  Auto-tagged:        ' + tagged);
  console.log('  Already tagged:     ' + alreadyTagged.length);
  console.log('  Errors:             ' + errors.length);
  console.log('  Ambiguous:          ' + ambiguous.length);

  if (errors.length > 0) {
    console.log('\nFailed items:');
    errors.forEach(function (e) {
      console.log('  ' + (e.sku || e.id) + ' | ' + e.name + ': ' + e.error);
    });
  }

  if (ambiguous.length > 0) {
    console.log('\n=== MANUAL REVIEW REQUIRED (' + ambiguous.length + ' items) ===');
    console.log('These items could not be auto-tagged. Tag them manually in Zoho Inventory.');
    console.log('Suggested: Equipment (catch-all per D-03), or Hops for hop blends.');
    console.log('');
    ambiguous.forEach(function (item) {
      console.log('  SKU: ' + (item.sku || '(no SKU)') + ' | ' + item.name);
    });
  }

  process.exit(errors.length > 0 ? 1 : 0);
}

main().catch(function (err) {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
