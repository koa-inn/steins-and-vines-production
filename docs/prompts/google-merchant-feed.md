# Prompt: Google Merchant Center Product Feed Endpoint

## Task

Add a new **public** route to the Express middleware at `zoho-middleware/` that serves a Google Merchant Center–compatible XML product feed. Google will fetch this URL daily to import our product catalog.

## Endpoint

`GET /feeds/google-merchant.xml`

This must be a **public endpoint** — no auth guard, no API secret key required — because Google's crawler needs to fetch it unauthenticated. Mount it in `server.js` alongside the health check (before the auth guard), similar to how `/health` is mounted.

## How the middleware works (context you need)

- **Zoho API helpers** are in `lib/zoho-api.js` — use `inventoryGet()` for Inventory endpoints and `fetchAllItems()` for paginated item lists. There's also `fetchItemDetailsBulk(itemIds)` that batches detail calls (100 per request) to get `custom_fields`, `brand`, `image_name`, etc.
- **Product caching** is already built in `routes/catalog.js`. The function `refreshProducts()` (around line 130) fetches all items, enriches them with detail data (custom_fields, brand, image_name), and caches to Redis with key defined by `C.CACHE_KEYS.PRODUCTS` (1hr TTL). There's also a file-based fallback at `data/products.json` and a static snapshot fallback.
- **Existing cache pattern**: Call `cache.get(PRODUCTS_CACHE_KEY)` first. On miss, call `refreshProducts()`. This is the stale-while-revalidate pattern used by `GET /api/products`. **Reuse this exact pattern** — do NOT duplicate the Zoho fetch logic.
- **Auth**: `lib/zohoAuth.js` handles OAuth with auto-refresh. All API calls through `zoho-api.js` automatically use valid tokens.
- **Rate limiting**: Zoho has aggressive rate limits. The middleware has built-in retry with exponential backoff and a cooldown mechanism. By reusing the cache, you avoid extra API calls.
- **Code style**: ES5 only (no arrow functions, no `const`/`let`, no template literals, no destructuring). Use `var`, `function(){}`, string concatenation. Match existing patterns exactly.

## Product fields available after enrichment

Each cached product object has these fields (see kiosk mapping at line ~717 of catalog.js):

```
item_id, name, sku, rate, stock_on_hand, category_name, product_type,
image_name, tax_id, tax_name, tax_percentage, custom_fields[], brand,
group_name, description (from detail), upc (if set in Zoho)
```

## Google Merchant XML spec

Generate an RSS 2.0 / Google Shopping feed. Required fields per item:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>Steins and Vines</title>
    <link>https://steinsandvines.ca</link>
    <description>Steins and Vines product catalog</description>
    <item>
      <g:id>{item_id}</g:id>
      <g:title>{name}</g:title>
      <g:description>{description or name}</g:description>
      <g:link>https://steinsandvines.ca</g:link>
      <g:image_link>{construct from image_name — see note below}</g:image_link>
      <g:availability>{in_stock or out_of_stock based on stock_on_hand}</g:availability>
      <g:price>{rate} CAD</g:price>
      <g:brand>{brand}</g:brand>
      <g:condition>new</g:condition>
      <g:gtin>{upc if available}</g:gtin>
      <g:product_type>{category_name}</g:product_type>
    </item>
  </channel>
</rss>
```

### Image URL construction

Zoho Inventory image URLs follow this pattern — check how images are currently referenced on the frontend or in the existing codebase. The `image_name` field from the detail endpoint is the filename. You may need to add a `SITE_URL` or `IMAGE_BASE_URL` env var. If you can't determine the exact image URL pattern, add a `GOOGLE_MERCHANT_IMAGE_BASE_URL` env var with a sensible default and a TODO comment.

### Filtering

- Only include items where `rate > 0` (has a price)
- Only include items where `product_type !== 'service'`
- Only include items where `status === 'active'` (if that field exists on the cached object)
- Exclude kit sub-items if possible (the catalog code tracks these via `_kitItemIds`)

### XML safety

All text values must be XML-escaped (ampersands, angle brackets, quotes). Write a small `escapeXml()` helper or reuse one if it exists.

## Caching the feed itself

Cache the generated XML string in Redis with its own key (e.g., `google_merchant_feed`) and a 1-hour TTL. On cache hit, serve the cached XML directly. On miss, build from the product cache (which itself falls back to Zoho). This means Google hitting the endpoint never directly triggers Zoho API calls in the hot path.

Set `Content-Type: application/xml; charset=utf-8` on the response.

## File organization

- Create `zoho-middleware/routes/feeds.js` for the route
- Mount in `server.js` before the auth guard, after the health check
- Add the cache key constant to `lib/constants.js` if that's where other cache keys live
- Update `.env.example` if you add any new env vars

## Tests

Create `zoho-middleware/__tests__/feeds.test.js` with tests covering:

1. Returns valid XML with `Content-Type: application/xml` when products are cached
2. Returns cached XML on subsequent calls (doesn't rebuild)
3. Handles empty product list gracefully (valid XML, no `<item>` elements)
4. XML-escapes special characters in product names/descriptions
5. Filters out zero-price items and services
6. Sets availability based on `stock_on_hand`

Follow the existing test patterns: mock `cache`, `logger`, `zohoAuth` as done in other test files. Use the jest config already in place.

## What NOT to do

- Do NOT create a cron job or scheduled task — Google Merchant Center handles the fetch schedule
- Do NOT duplicate the Zoho fetch logic — reuse the product cache from catalog.js
- Do NOT modify any existing tests
- Do NOT use ES6+ syntax — this codebase is ES5
- Do NOT add any npm dependencies unless absolutely necessary (xml building should be done with string concatenation, matching the codebase style)
