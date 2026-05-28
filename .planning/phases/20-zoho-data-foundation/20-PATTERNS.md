# Phase 20: Zoho Data Foundation - Pattern Map

**Mapped:** 2026-05-28
**Files analyzed:** 2 new files
**Analogs found:** 2 / 2

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `zoho-middleware/scripts/tag-subcategories.js` | utility (bulk-write script) | batch (read-classify-write) | `zoho-middleware/scripts/import-vessels.js` | role-match |
| `zoho-middleware/scripts/verify-subcategories.js` | utility (read-only verification script) | request-response | `zoho-middleware/scripts/export-snapshot.js` | exact |

---

## Pattern Assignments

### `zoho-middleware/scripts/tag-subcategories.js` (utility, batch)

**Primary analog:** `zoho-middleware/scripts/import-vessels.js`
**Secondary analog:** `zoho-middleware/scripts/sync-images.js` (rate-limiting pattern)
**Zoho API layer:** `zoho-middleware/lib/zoho-api.js` (lines 163-175 for `inventoryPut`, lines 242-266 for `fetchAllItems`)

---

**File header / JSDoc pattern** (`import-vessels.js` lines 1-16):
```javascript
/**
 * Import vessels from CSV into Zoho Books/Inventory as inventory items.
 *
 * Usage:
 *   node scripts/import-vessels.js [--dry-run]
 *
 * Requires the server's .env to be configured with valid Zoho credentials
 * and an active refresh token.
 */
```
Copy this structure exactly — Usage block, Prerequisites (if any), options list.

---

**`'use strict'` + dotenv load pattern** (`sync-images.js` is the only script using dotenv; `import-vessels.js` skips it because it calls through the middleware server instead of Zoho directly):

The tagging script calls Zoho directly (not through the middleware server), so it MUST load dotenv. Use this pattern from RESEARCH.md (confirmed against `zoho-api.js` which uses `process.env.ZOHO_ORG_ID`):
```javascript
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

var zohoApi = require('../lib/zoho-api');
```
Note: `import-vessels.js` uses `axios` directly against the middleware HTTP server. `tag-subcategories.js` must use `zohoApi.fetchAllItems` and `zohoApi.inventoryPut` directly — no running middleware required.

---

**CLI argument parsing pattern** (`sync-images.js` lines 26-43):
```javascript
var args = process.argv.slice(2);

function getArg(name, fallback) {
  var idx = args.indexOf(name);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return fallback;
}

var DRY_RUN = args.indexOf('--dry-run') !== -1;
```
Apply this pattern for `--dry-run` flag. `import-vessels.js` uses `process.argv.includes('--dry-run')` (line 37) — either form is acceptable; prefer the `sync-images.js` `indexOf` form for ES5 consistency.

---

**Rate-limit constant + sleep helper** (`sync-images.js` lines 42-51):
```javascript
// Zoho API rate limit: 100 requests per minute — add delay between calls
var DELAY_MS = 700;

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}
```
Copy verbatim. Use the comment explaining the 700ms rationale.

---

**Prefixed log helper** (`sync-images.js` lines 53-55):
```javascript
function log(msg) {
  console.log('[sync-images] ' + msg);
}
```
Rename prefix to `[tag-subcategories]`. Use for all progress/status output.

---

**`inventoryPut` call pattern** (`zoho-middleware/lib/zoho-api.js` lines 163-175):
```javascript
function inventoryPut(path, body) {
  return zohoAuth.getAccessToken().then(function (token) {
    return withRetry(function () {
      return axios.put(ZOHO_INVENTORY_BASE + path, body, {
        headers: { Authorization: 'Zoho-oauthtoken ' + token },
        params: { organization_id: process.env.ZOHO_ORG_ID },
        timeout: 15000
      }).then(function (response) {
        return response.data;
      });
    });
  });
}
```
The script does NOT re-implement this — it calls `zohoApi.inventoryPut('/items/' + item_id, body)` directly. The body shape for a custom field update is:
```javascript
{ custom_fields: [{ label: 'Subcategory', value: 'Grain' }] }
```

---

**`fetchAllItems` call pattern** (`zoho-middleware/lib/zoho-api.js` lines 242-266):
```javascript
function fetchAllItems(params) {
  // ...handles pagination automatically up to MAX_PAGES=50
}
```
Call as: `zohoApi.fetchAllItems({ status: 'active' })`. Returns a Promise resolving to a flat array of all items. Each item has `item_id`, `name`, `sku`, `product_type`, `custom_fields`, and any CF values already on the item.

---

**Item filtering pattern** (derived from `catalog.js` kit-vs-ingredient split):
```javascript
var KIT_CATEGORIES = ['wine', 'beer', 'cider', 'seltzer'];

var ingredients = allItems.filter(function(item) {
  if (item.product_type === 'service') return false;
  var cfType = (item.cf_type || '').toLowerCase();
  if (KIT_CATEGORIES.indexOf(cfType) !== -1) return false;
  return true;
});
```
This matches the same exclusion logic used in the middleware to separate kits from ingredients.

---

**Dry-run guard before API write** (`import-vessels.js` lines 188-192):
```javascript
if (DRY_RUN) {
  console.log('  WOULD CREATE: ' + label);
  created++;
  continue;
}
```
Apply the same guard around every `inventoryPut` call. In dry-run, log `WOULD TAG: {name} → {subcategory}` and skip the PUT.

---

**Error handling inside the item loop** (`import-vessels.js` lines 198-205):
```javascript
} catch (err) {
  var msg = err.message;
  if (err.response && err.response.data) {
    msg = err.response.data.message || err.response.data.error || msg;
  }
  console.error('  ✗ Failed:  ' + label + ' — ' + msg);
  errors.push({ id: vessel.ID, error: msg });
}
```
Copy this pattern. Collect failures into an `errors` array; continue processing remaining items (don't abort on single failure).

---

**Rate-limit delay placement** (`sync-images.js` lines 166-169):
```javascript
// Rate limit delay
if (j < allItems.length - 1) {
  await sleep(DELAY_MS);
}
```
Skip delay after the LAST item. Copy this conditional to avoid unnecessary trailing wait.

---

**Summary block at end** (`import-vessels.js` lines 212-224):
```javascript
console.log('\n--- Import Summary ---');
console.log('  Total vessels: ' + vessels.length);
console.log('  Created:       ' + created);
console.log('  Skipped:       ' + skipped);
console.log('  Errors:        ' + errors.length);

if (errors.length > 0) {
  console.log('\nFailed items:');
  errors.forEach(function (e) {
    console.log('  ' + e.id + ': ' + e.error);
  });
}
```
Adapt to show: Total ingredients, Auto-tagged, Skipped (already tagged), Failed, then the manual-review list.

---

**Fatal error handler at bottom** (`import-vessels.js` line 227, `sync-images.js` line 181):
```javascript
main().catch(function (err) {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
```
Copy verbatim. `main()` is an `async function`.

---

### `zoho-middleware/scripts/verify-subcategories.js` (utility, request-response)

**Primary analog:** `zoho-middleware/scripts/export-snapshot.js`
**Pattern source:** All of `export-snapshot.js` (83 lines) — closest structural match.

---

**File header / JSDoc pattern** (`export-snapshot.js` lines 1-17):
```javascript
/**
 * export-snapshot.js
 *
 * Fetches /api/snapshot from the local middleware and writes...
 *
 * Prerequisites:
 *   1. Local middleware running:  node server.js  (in zoho-middleware/)
 *   2. Zoho authenticated:        visit http://localhost:3001/auth/zoho
 *
 * Usage:
 *   node zoho-middleware/scripts/export-snapshot.js
 *
 * The script exits 0 on success and 1 on failure...
 */
```
Adapt for verify-subcategories — same Prerequisites block structure. Exit code 0 = full coverage, 1 = gaps found.

---

**`'use strict'` + stdlib-only imports** (`export-snapshot.js` lines 19-21):
```javascript
'use strict';

var http = require('http');
var fs   = require('fs');
var path = require('path');
```
`verify-subcategories.js` uses `http` only (no `fs` or `path` needed). Keep `'use strict'`.

---

**MIDDLEWARE_URL constant** (`export-snapshot.js` line 25):
```javascript
var MIDDLEWARE_URL = process.env.MIDDLEWARE_URL || 'http://localhost:3001';
```
Copy verbatim. Same env-var override pattern.

---

**`http.get` with body accumulation + error handler** (`export-snapshot.js` lines 32-82):
```javascript
http.get(SNAPSHOT_URL, function (res) {
  var body = '';

  if (res.statusCode !== 200) {
    console.error('[export-snapshot] ERROR: middleware returned HTTP ' + res.statusCode);
    console.error('[export-snapshot] Make sure the middleware is running and Zoho is authenticated.');
    process.exit(1);
  }

  res.setEncoding('utf8');
  res.on('data', function (chunk) { body += chunk; });
  res.on('end', function () {
    var parsed;
    try {
      parsed = JSON.parse(body);
    } catch (e) {
      console.error('[export-snapshot] ERROR: Could not parse response as JSON: ' + e.message);
      process.exit(1);
    }
    // ... process parsed ...
    process.exit(0);
  });
}).on('error', function (err) {
  console.error('[export-snapshot] ERROR: Could not reach middleware at ' + MIDDLEWARE_URL);
  console.error('[export-snapshot] ' + err.message);
  console.error('[export-snapshot] Start the middleware with: node zoho-middleware/server.js');
  process.exit(1);
});
```
The `.on('error', ...)` at the end is critical — without it, connection refused crashes ungracefully. Adapt the endpoint from `/api/snapshot` to `/api/ingredients`. The response shape is `{ items: [...] }` (not `{ products, ingredients, services }`).

---

**Zero-items guard** (`export-snapshot.js` lines 56-61):
```javascript
if (products === 0 && ingredients === 0 && services === 0) {
  console.error('[export-snapshot] ERROR: Snapshot contains 0 items...');
  console.error('[export-snapshot] The middleware cache may still be warming. Wait 30s and retry.');
  process.exit(1);
}
```
Adapt: if `items.length === 0`, warn that the cache may be warming and exit 1.

---

**Exit code contract** (`export-snapshot.js` lines 73-74):
```javascript
process.exit(0);  // success
process.exit(1);  // failure
```
For verify-subcategories: `process.exit(0)` = 100% coverage, `process.exit(1)` = any items missing subcategory. This allows CI/shell scripts to check the exit code.

---

## Shared Patterns

### Zoho API Direct Access (no running middleware needed)
**Source:** `zoho-middleware/lib/zoho-api.js` lines 128-175, plus `zoho-middleware/lib/zohoAuth.js`
**Apply to:** `tag-subcategories.js` only

The tagging script requires Zoho directly. It must load `.env` first, then use the exported functions from `zoho-api.js`. The auth module handles token refresh, Redis caching, and AES-256-GCM encryption transparently.

```javascript
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
var zohoApi = require('../lib/zoho-api');
// zohoAuth is used internally by zohoApi — no separate require needed
```

### Rate Limiting (700ms between Zoho API calls)
**Source:** `zoho-middleware/scripts/sync-images.js` lines 42-51
**Apply to:** `tag-subcategories.js` — between every `inventoryPut` call

```javascript
var DELAY_MS = 700; // Zoho API rate limit: 100 requests per minute

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}
// ...
if (j < toTag.length - 1) await sleep(DELAY_MS);
```

### Middleware HTTP Connectivity (for verify script)
**Source:** `zoho-middleware/scripts/export-snapshot.js` lines 25, 77-82
**Apply to:** `verify-subcategories.js`

The `.on('error', ...)` block is mandatory — without it, connection refused throws uncaught and produces a confusing stack trace instead of a clear "start the middleware" message.

```javascript
var MIDDLEWARE_URL = process.env.MIDDLEWARE_URL || 'http://localhost:3001';
// ...
}).on('error', function (err) {
  console.error('[verify-subcategories] ERROR: Could not reach middleware at ' + MIDDLEWARE_URL);
  console.error('[verify-subcategories] Start the middleware: node zoho-middleware/server.js');
  process.exit(1);
});
```

### Input Validation Before Every Write
**Source:** RESEARCH.md security section (ASVS V5)
**Apply to:** `tag-subcategories.js` — before every `inventoryPut` call

```javascript
var VALID_SUBCATEGORIES = ['Grain', 'Yeast', 'Additive', 'Packaging', 'Equipment', 'Cleaning', 'Hops'];

function isValidSubcategory(val) {
  return VALID_SUBCATEGORIES.indexOf(val) !== -1;
}

// Guard before every PUT:
if (!isValidSubcategory(entry.subcategory)) {
  console.error('[tag-subcategories] INVALID subcategory "' + entry.subcategory + '" for ' + entry.item.name + ' — skipping');
  continue;
}
```

---

## No Analog Found

No files in this phase lack an analog. Both scripts have strong structural matches in the existing `zoho-middleware/scripts/` directory.

---

## Key Divergences from Analogs

These are places where the new scripts deliberately differ from their analogs:

| File | Analog Behavior | New Behavior | Reason |
|------|----------------|--------------|--------|
| `tag-subcategories.js` | `import-vessels.js` calls middleware HTTP for writes | Call `zohoApi.inventoryPut` directly | Tagging script runs without middleware server; direct API avoids HTTP server dependency |
| `tag-subcategories.js` | `import-vessels.js` has no dotenv load | Must `require('dotenv').config(...)` at top | Direct Zoho API calls need env vars for OAuth credentials |
| `tag-subcategories.js` | `sync-images.js` reads from middleware `/api/snapshot` | Calls `zohoApi.fetchAllItems({ status: 'active' })` directly | Snapshot omits `item_id` for ingredients (confirmed in RESEARCH.md pitfall #1) |
| `verify-subcategories.js` | `export-snapshot.js` writes a file to disk | No file write — report to stdout only | Verification is a diagnostic read-only operation |
| `verify-subcategories.js` | `export-snapshot.js` hits `/api/snapshot` | Hits `/api/ingredients` | Verify the shaped output (with `flattenCF()` applied), not the raw snapshot |

---

## Metadata

**Analog search scope:** `zoho-middleware/scripts/`, `zoho-middleware/lib/`
**Files scanned:** 6 (sync-images.js, export-snapshot.js, import-vessels.js, csv-to-snapshot.js, zoho-api.js, catalog.js lines 800-880)
**Pattern extraction date:** 2026-05-28
