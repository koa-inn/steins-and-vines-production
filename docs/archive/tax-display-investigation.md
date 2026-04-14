# Tax Display Investigation (Apr 2026)

## Problem
Tax amounts (GST 5%) not displaying on the reservation page for either Maker's Fee or supply items, even though items have sales tax properties defined in Zoho.

## What the code does (all correct — no bugs here)

| Layer | File | What it does |
|-------|------|-------------|
| Middleware enrichment | `zoho-middleware/routes/catalog.js` lines 180–190 | 3-tier fallback: `detail.tax_percentage` → `detail.taxes[]` sum → `_TAX_RULE_PCT[sales_tax_rule_id]` |
| Frontend product object | `js/modules/07-catalog-kits.js` line 71, `08-catalog-ingredients.js` line 72 | Maps `tax_percentage` and `tax_name` from API response |
| Cart storage | `js/modules/11-cart.js` line 141 | `parseFloat(product.tax_percentage) \|\| 0` — preserves value |
| Section A tax display | `js/modules/12-checkout.js` lines 735–791 | Groups tax by `tax_name`, renders one row per group; Maker's Fee GST separate at lines 748–762 |
| Section B tax display | `js/modules/12-checkout.js` lines 868–879, 1047–1052 | Accumulates `taxTotal`; renders "Est. Tax" row only if `taxTotal > 0` |

## Root causes identified

### 1. Kit supply items are correctly zero-rated (expected behaviour)
Kit products are classified as "Zero Rated - Ingredients" (`tax_percentage: 0`) under BC FoP rules — raw materials are zero-rated. No tax row for kit supplies is correct.

### 2. Maker's Fee GST — `sales_tax_rule_id` mismatch (most likely cause)
The `_TAX_RULE_PCT` map in `catalog.js` lines 103–115 maps rule IDs to percentages. It supports env var overrides:

| Env var | Hardcoded fallback ID | Rate |
|---------|-----------------------|------|
| `ZOHO_TAX_SERVICES_RULE` | `109900000000033417` | 5% GST |
| `ZOHO_TAX_STANDARD_RULE` | `109900000000033423` | 12% GST+PST |
| `ZOHO_TAX_ZERO_RULE` | `109900000000033411` | 0% Zero Rated |
| `ZOHO_TAX_LIQUOR_RULE` | `109900000000033429` | 15% GST+PST Liquor |

If the Maker's Fee item's actual `sales_tax_rule_id` in Zoho doesn't match any of these, tier 3 falls through and `tax_percentage` stays 0.

**Note:** `content/zoho-snapshot.json` was manually patched (commit `747369c`) to show `tax_percentage: 5` for services — this masked the issue. The live enrichment pipeline may still return 0.

### 3. Ingredient items — stale localStorage
Cart items have `tax_percentage` baked in at the time they were added. Stale carts saved before enrichment was working will always show 0 until cleared.

### 4. No frontend test coverage
Zero frontend tests cover the tax display path. The full chain (API → product object → cart → `renderReservationItems()` tax rows) is untested.

## Fix walkthrough

### Step 1 — Find actual Zoho tax rule IDs
Start local middleware (`node server.js` in `zoho-middleware/`), re-auth if needed (`/auth/zoho`), then:
```bash
curl -s http://localhost:3001/api/taxes/rules \
  -H "Referer: http://localhost:3001" | python3 -m json.tool | grep -A3 "tax_rule_id\|tax_rule_name\|rate\|percentage"
```
Note the rule ID for "GST Only / GST - Services".

### Step 2 — Compare against hardcoded fallbacks
If the GST-only rule ID matches `109900000000033417` → go to Step 4.
If it doesn't match → Step 3.

### Step 3 — Set correct rule IDs in Railway env vars
Railway dashboard → middleware service → Variables:
```
ZOHO_TAX_SERVICES_RULE=<actual_id>
```
Repeat for any other mismatched rules. Railway redeploys automatically.

### Step 4 — Clear Redis cache on staging
```bash
curl -X POST https://<railway-url>/api/admin/cache-clear \
  -H "x-api-key: <MW_API_KEY>" \
  -H "Content-Type: application/json"
```
`MW_API_KEY` is in `js/sheets-config.js`.

### Step 5 — Clear localStorage cart and re-add items
In DevTools console on the reservation page:
```js
localStorage.removeItem('sv-cart-ferment');
localStorage.removeItem('sv-cart-ingredients');
```
Then re-add items fresh from the products page.

### Step 6 — Verify on staging
`staging.steinsandvines.ca/reservation.html?cart=ferment` — confirm Maker's Fee shows a GST line.

## If it still doesn't work after all steps
The tier 3 fallback may not be firing (e.g. `detail.tax_percentage` is returning a non-zero-but-wrong value from Zoho). Add a temporary log in `catalog.js` enrichment block to print `detail.tax_percentage`, `detail.taxes`, and `detail.sales_tax_rule_id` for the Maker's Fee item to see exactly what Zoho is returning.

## Future improvement
Bootstrap `_TAX_RULE_PCT` dynamically from Zoho's `/settings/taxrules` at middleware startup instead of hardcoded fallbacks — would make this self-maintaining and remove the need for the 4 env vars. Requires checking what fields Zoho returns on each rule object.
