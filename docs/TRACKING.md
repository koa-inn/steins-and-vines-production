# TRACKING.md — Analytics & Ads Measurement

_Last updated: 2026-07-22 (CSP fix for Meta pixel / Google Ads)_

## Stack

| Layer | ID | Where configured |
|---|---|---|
| Google Tag Manager | `GTM-NHRCGLC5` | Inline snippet in every public page `<head>` |
| GA4 | `G-WDYSXCM703` (stream 14369980301) | Via GTM (Google tag "GA4 - Steins and Vines") |
| Google Ads | `AW-18091171314` | Via GTM (Google tag + Conversion Linker) |
| Meta pixel | `2247679639387941` | Via GTM Custom HTML tags ("Meta Pixel - Base" + per-event tags) |
| Metricool | tracker script | Via GTM Custom HTML |

There is a second, **unused** Meta pixel in the Business Manager ("Wine and Brew's Pixel", `1410160679750490`). Ignore it.

## How events flow

1. Site JS (`js/modules/`, built into `js/main.min.js`) pushes events to `dataLayer`:
   `add_to_cart`, `begin_checkout`, `purchase` (with `ecommerce.transaction_id`, `value`, `currency`, `items`), plus page-specific view events (`fis_page_view`, `is_page_view`, `resrvation_page_view` — note the long-standing typo, kept for data continuity).
2. GTM custom-event triggers (`CE - add_to_cart`, `CE - begin_checkout`, `CE - purchase`) fire both the GA4 event tags and the Meta pixel Custom HTML tags.
3. Payment is a HelcimPay iframe on our own domain — checkout never leaves steinsandvines.ca. There is **no server-side tracking**: no GA4 Measurement Protocol secrets exist; the middleware does not send analytics events.

## GA4 key events policy (changed 2026-07-22)

Only events that a bot cannot trivially trigger may be key events. Current key events:
- `purchase` (built-in, cannot be unmarked)
- `phone_click`

**Do NOT re-mark** `resrvation_page_view`, `form_start`, `fis_page_view`, `is_page_view`, or any pageview/scroll/form-focus event as a GA4 key event. That configuration previously let bot traffic register ~97% of all "conversions" (819/840 in a 28-day window).

## CSP — the rule that broke everything once

Every public HTML page carries a `<meta http-equiv="Content-Security-Policy">` tag. **A tracking service only works if its domains are allowlisted there.** Until 2026-07-22, `connect.facebook.net` was missing from every page's `script-src`, so the Meta pixel was silently blocked site-wide — except on `products/ferment-in-store.html`, which had no CSP at all. Result: Meta received PageView/ViewContent/AddToCart from that single page and **zero** InitiateCheckout/Purchase ever, while all the GTM tags were configured correctly.

### Required measurement domains (present on all 16 public pages as of 2026-07-22)

- `script-src`: `https://connect.facebook.net` `https://www.googleadservices.com` `https://googleads.g.doubleclick.net`
- `connect-src`: `https://www.facebook.com` `https://www.google.com` `https://googleads.g.doubleclick.net` `https://www.googleadservices.com` `https://*.google-analytics.com`
- `img-src`: `https://www.facebook.com` `https://www.google.com` `https://www.google.ca` `https://googleads.g.doubleclick.net` `https://*.google-analytics.com`
- `frame-src`: `https://td.doubleclick.net`

(Plus the pre-existing GTM/GA/Metricool/Helcim/Sentry/behold entries, which vary per page.)

### Rules when touching CSP or adding a page/service

1. **New public HTML page** → copy the CSP from its closest sibling page. No public page ships without a CSP (`ferment-in-store.html` did, by accident, for months).
2. **New third-party service** → add its domains to the CSP on **every** public page, not just the page you're testing on.
3. **Removing a service** → remove its CSP entries everywhere too.
4. `404.html` intentionally has a minimal CSP (no trackers). `admin.html`, `brewpad.html`, `batch.html` are internal surfaces with no CSP — out of scope for measurement. **`kiosk.html` now carries a scoped CSP** (Phase 70-02, KIOSK-MOTO): it renders the HelcimPay hosted card-entry iframe for phone-order sales, so it has its own `<meta http-equiv="Content-Security-Policy">` limited to the kiosk runtime domains (GSI, Google Fonts, the Railway middleware, Apps Script) plus HelcimPay (`secure.helcim.app` / `secure.myhelcim.com`) — **no trackers, no `'unsafe-inline'`** (kiosk.html has zero inline scripts). Keep this CSP in sync whenever the kiosk's external services change. The domain set was static-analysis-derived and live-verified on staging per Plan 70-03 (Network + Console, zero CSP violations) before production.
5. After any CSP change, verify in the browser console (look for "Refused to load / violates the following Content Security Policy") and in GTM's container diagnostics ("security settings are blocking measurement" warning should stay clear).

## Verifying tracking end-to-end

1. GA4 DebugView (Admin → DebugView) + GTM Preview on a reservation flow.
2. Complete a real test booking; confirm `purchase` fires **once**, with `transaction_id`, `value`, `currency`.
3. Meta Events Manager → Test Events: confirm PageView on non-landing pages, InitiateCheckout on checkout start, Purchase on completion.
4. Within 24–48h, confirm the purchase's session attribution in GA4 (should not be "Unassigned").

## Known open items (as of 2026-07-22)

- "Unassigned" revenue in GA4 predates the CSP fix; re-verify attribution with a post-deploy test transaction.
- `resrvation_page_view` typo: rename only with a coordinated change (site JS + GTM trigger + GA4 reports expectations).
- Cloudflare bot rules could still be tightened upstream (bots no longer pollute conversions, but still pollute traffic stats).
