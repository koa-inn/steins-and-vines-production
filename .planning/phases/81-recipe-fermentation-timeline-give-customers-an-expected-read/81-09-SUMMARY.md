---
phase: 81
plan: 09
status: complete
completed: 2026-09-23
---

# 81-09 Summary — Production cutover (executed 2026-09-23)

**Route:** blessed `gated-deploy.yml` workflow_dispatch on koa-inn/steins-and-vines-staging (run 35900308822), not the plan's literal break-glass push. Shipped commit `6e05a60d`; production main is `2375b234` (that commit plus the CNAME swap). Railway production middleware auto-redeployed on the push.

**Scope shipped:** everything on main as of 2026-09-23 — Phase 81 ferment timeline, 74 catalogue pages (wine live; **beer page held back**: deployed but unlinked, unindexed, absent from the sitemap, `BEER_PAGE_LIVE=false`), 78/80 waitlist, 79, 73/75/76, 50/51 kiosk money-path, the 2026-09-16 pre-cutover fixes, the policy pages + checkout acknowledgement + cookie consent (2026-09-17), confirmation-email and admin cost fixes.

**Rollback targets (unused):** frontend `351d28b8`; Railway production deployment `5b0fe0d2-64ec-4a5d-854b-5c4781c869ce` (2026-09-05). Apps Script v56 / Sheet unchanged.

**Verification on production (browser + curl, 2026-09-23):**
- `/api/recipes?status=active`: 3 recipes, `ferment_days` = 21, 21, 35; none of `schedule_id`, `steps_parsed`, `is_transfer` in the response (D-16 boundary).
- `beer.html` (by URL only): "about 3 weeks" ×2 and "about 5 weeks" ×1 with "from brew day"; the consult-timeline phrase is gone; the queue-order sentence is present; noindex meta present; CSP meta present.
- Home: cookie notice shown, zero third-party requests before a choice, no Beer nav item, Wine in nav, footer policy links + Cookie settings.
- wine, terms, refunds, warranty, privacy, reservation, hub: 200; checkout carries the acknowledgement box and the reCAPTCHA notice; hub has no Explore Beer; sitemap has no beer entry.

**Incident during cutover:** after the Railway restart the middleware came up with `authenticated:false` ("No saved refresh token" path — the Redis refresh-token key is written with a 90-day TTL only on connect). Online checkout would have run in offline-fallback and kiosk sales could not book to Zoho for ~12 minutes until the owner re-authorised at `/auth/zoho`. The gated workflow's smoke check soft-warns on this by design. **Follow-up:** make the startup refresh re-persist the token (so the 90-day clock restarts on every refresh) and/or alert on `authenticated:false` persisting past the grace window.

**Not verified by Claude (owner):** a kiosk sale, a BrewPad sign-in, the admin West Coast IPA cost display.
