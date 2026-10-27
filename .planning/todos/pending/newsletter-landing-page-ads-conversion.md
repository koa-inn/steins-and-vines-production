---
title: "Newsletter landing page usable as an ads conversion (reCAPTCHA v3 + new-subscriber flag)"
status: pending
created: 2026-10-27
source: owner handoff 2026-10-27 (spec below, verbatim)
area: frontend + middleware / newsletter, tracking
priority: medium
---

Build `newsletter.html` (`/newsletter`). Gate every newsletter form with server-verified invisible reCAPTCHA v3.
Return `new_subscriber` from `POST /api/newsletter`. Push `newsletter_new` with `newsletter_signup`,
so only new subscribers count as a Google Ads / Meta conversion.

Open owner decisions before launch: the incentive (default FIRSTBATCH), how often the newsletter goes out, and the welcome email wording (§6).
The ads/analytics setup (§8) happens only after this is live in production.

---

# Handoff — Newsletter landing page that can be an ads conversion

**Date:** 2026-10-27
**Owner:** Koa
**Status:** Spec. Not started. Small build: one page, two server changes, three test files.

---

## 0. What this is

A dedicated page, `newsletter.html` (served by GitHub Pages at `steinsandvines.ca/newsletter`),
that ads, QR codes, socials and in-store signage can point to. A sign-up there must be safe to use
as a **Google Ads and Meta conversion goal**.

### Owner decisions (27 Oct 2026)

| Decision | Answer |
|---|---|
| Bot protection | **Invisible reCAPTCHA v3**, server-verified, on every newsletter form |
| Conversions count | **New subscribers only** — a repeat sign-up never counts |
| Ads/analytics setup (GTM, GA4, Google Ads, Meta) | Done by Claude in the owner's browser after this ships (§8). Not part of this build. |
| Incentive | Open — see §6. Default: the existing **FIRSTBATCH** offer in the welcome email. |

### Why the bot rules matter

`docs/TRACKING.md` records that bot traffic once produced ~97% of GA4 "conversions" (819/840 in 28
days), and that only events "a bot cannot trivially trigger" may be key events. Today
`newsletter_signup` is protected by a honeypot field and a 5-per-minute IP rate limit — not enough
for a paid-ads goal. This build closes that gap.

---

## 1. Repo non-negotiables (from CLAUDE.md)

1. `npm test` AND `cd zoho-middleware && npm test` before every commit; `npm run lint` clean.
2. ONE logical change per commit; read existing code and tests first; grep every usage.
3. `lib/*` changes on either side → FULL suite, both sides.
4. Never edit `js/main.js` / `main.min.js`; `npm run build` after module changes.
5. Don't modify existing tests unless asked (adding the page to hard-coded page lists is expected).
6. **CSP:** adding reCAPTCHA to a page means adding its domains to **that page's** CSP. The
   newsletter forms are on `index.html`, `contact.html`, `links.html` and the new page. Copy the
   reCAPTCHA entries from `reservation.html`. A missing domain silently breaks the form.
7. Staging first.

---

## 2. What already exists — reuse, don't rebuild

- **`js/newsletter.js`** drives every `.newsletter-form[data-newsletter="<source>"]`: honeypot
  `company`, the consent text sent as the CASL record, and a `newsletter_signup` dataLayer push
  **after** the server confirms (line ~77).
- **`POST /api/newsletter`** (`zoho-middleware/server.js:~408`): rate-limited, MailerLite upsert
  into `MAILERLITE_NEWSLETTER_GROUP_ID`, staff notification, CASL consent log. It already works
  out `alreadySubscribed` from MailerLite's `created_at`/`updated_at` but doesn't return it.
- **`verifyRecaptcha(token)`** in `zoho-middleware/lib/checkout-helpers.js:47` — v3, fail-closed in
  production. The frontend gets tokens via `getRecaptchaToken(action, cb)` (checkout validation
  module) with `window.RECAPTCHA_SITE_KEY`.
- **FIRSTBATCH** (`routes/promo.js`): 20% off, one use per email, works online and in the kiosk.

---

## 3. Server changes (`zoho-middleware/server.js`, `/api/newsletter`)

1. Add `'landing'` to `NEWSLETTER_SOURCES`.
2. **Require a reCAPTCHA token** (`recaptcha_token`, action `newsletter`) for all sources. Verify
   with `verifyRecaptcha`; reject with 400 *"We couldn't verify the sign-up. Please try again."* when
   `success` is false, the action doesn't match, or `score < 0.5`. Check the honeypot first, as now.
   Consider extracting `verifyRecaptcha` out of `checkout-helpers.js` into its own lib module now
   that two routes use it — if so, that's its own commit, full suite both sides.
3. Return **`{ success: true, new_subscriber: <bool> }`** using the existing `alreadySubscribed`
   (inverted). The honeypot short-circuit returns `new_subscriber: false`.
4. Keep the CASL consent log; add `new_subscriber` to it. No email or name in logs beyond the
   existing `maskEmail`.

## 4. Frontend changes (`js/newsletter.js`)

1. Before submit, get a reCAPTCHA token (`newsletter` action) and send it. If reCAPTCHA can't load,
   show *"Sign-up isn't available right now — please try again shortly."* rather than submitting
   without a token.
2. On success push:
   ```js
   { event: 'newsletter_signup', newsletter_source: source, newsletter_new: d.new_subscriber === true }
   ```
   The event name stays the same so existing reports don't break. **The conversion keys on
   `newsletter_new === true`** (§8).
3. Load the reCAPTCHA script on every page with a newsletter form (and update each page's CSP).

## 5. The page — `newsletter.html`

`data-page="newsletter"`, the standard header/footer/consent/Sentry pattern, CSP copied from
`reservation.html`. Indexable. Mobile first — most ad traffic will be on phones.

Sections, top to bottom:

1. **Hero** with the form right there (no scrolling needed on a phone): heading, one-line pitch, email field,
   Sign up button, consent text. Form: `class="newsletter-form" data-newsletter="landing"`, exactly
   the existing markup from `links.html` (honeypot included).
2. **What you'll get** — three or four short items: new kits and seasonal releases; **first word on
   limited releases** (ties into `limited-releases.html`); recipes and brewing tips; events and
   offers. Plus how often we send (owner fills in — §6).
3. **The offer** (if §6 keeps FIRSTBATCH): "New to Steins & Vines? Your welcome email includes 20%
   off your first batch."
4. **Thank-you state** replacing the form on success: confirmation line plus three next steps —
   Limited Releases, Wine kits, Book a session. A repeat subscriber sees "You're already on the
   list" (from `new_subscriber: false`) with the same next steps.
5. Small FAQ: how often, how to unsubscribe, link to the Privacy Policy.

Also:
- Footer link "Newsletter" on every public page; `sitemap.xml` entry; add to `stamp:pages` in
  `package.json`; add to the page lists in `cookie-consent.test.js`,
  `page-search-consistency.test.js`, `legal-pages.test.js` (if it carries the policy footer),
  `tests/e2e/static-pages.spec.js`, and extend `tests/frontend/newsletter.test.js`.
- UTM parameters and `gclid`/`fbclid` need no code — GTM's Conversion Linker and the Meta pixel
  read them from the URL.

## 6. Owner content decisions (before launch)

1. **Incentive.** Default: the welcome email gives **FIRSTBATCH** (20% off a first batch) — no new
   code; it's set up as a MailerLite welcome automation. Caveat: FIRSTBATCH is already advertised on
   the home page, so it isn't exclusive, and it only helps people who haven't brewed yet.
   Store credit for existing customers is a later option (§9).
2. **How often** the newsletter goes out (for the page copy).
3. **Welcome email** wording in MailerLite.

## 7. Tests

Middleware: missing token → 400; low score → 400; wrong action → 400; honeypot still short-circuits
with `new_subscriber: false`; new MailerLite record → `new_subscriber: true`; existing → `false`;
`'landing'` accepted as a source; no PII in logs.

Frontend: token requested and sent; `newsletter_signup` pushed with `newsletter_new` matching the
response; nothing pushed on error; reCAPTCHA load failure shows the message and doesn't submit;
`newsletter.html` passes the page-consistency suites.

## 8. After it ships — ads and analytics setup (Claude, in the owner's browser)

Only once the reCAPTCHA + new-subscriber version is **live in production**. Each change is shown to
the owner and approved before it's published.

1. **GTM:** Data Layer Variable `newsletter_new`; Custom Event trigger `CE - newsletter_signup`;
   a second trigger `CE - newsletter_signup (new)` on the same event where `newsletter_new` equals
   `true`.
2. **GA4:** event tag `newsletter_signup` (params `newsletter_source`, `newsletter_new`) on
   `CE - newsletter_signup`; a separate event tag **`newsletter_signup_new`** on the "(new)" trigger,
   and mark **only `newsletter_signup_new`** as a key event.
3. **Google Ads:** conversion action "Newsletter sign-up" (category Sign-up, count One, no value or a
   nominal value) with its GTM conversion tag on the "(new)" trigger.
4. **Meta:** standard `Lead` event Custom HTML tag on the "(new)" trigger, following the existing
   per-event tag pattern.
5. Verify in GTM Preview + GA4 DebugView + Meta Test Events with a fresh email and a repeat one.
6. Update `docs/TRACKING.md`: the key-event list, why `newsletter_signup_new` is allowed under the
   bot policy, and remove the "no GTM trigger yet" open item.

Note: the cookie consent gate means only consenting visitors are counted; Ads may model the rest if
Consent Mode modelling is enabled.

## 9. Later: store credit as the incentive (not in this build)

Possible on the existing gift-card system (`lib/gift-card-*.js`) — e.g. a $10 digital card per
verified new subscriber. Before doing it, decide on: fraud (free money per email address invites
throwaway emails; reCAPTCHA reduces but doesn't remove it), BC gift-card rules on expiry, and
treating issued credit as a liability. Recommend: launch with FIRSTBATCH, look at sign-up volumes
and quality for a month, then decide.

## 10. Acceptance criteria

- `steinsandvines.ca/newsletter` loads on a phone with the form above the fold.
- A new email subscribes, shows the thank-you state, and pushes `newsletter_signup` with
  `newsletter_new: true`; the same email again pushes `newsletter_new: false`.
- A request without a valid reCAPTCHA token is rejected and fires nothing.
- All four pages with newsletter forms still work, with CSPs updated.
- Existing reports on `newsletter_signup` keep working.
