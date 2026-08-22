---
title: Beer & Cider launch announcement pages (beer.html + cider.html)
status: pending
created: 2026-08-22
source: owner prompt (2026-08-22) — "two new pages … Beer & Cider launch announcement pages"; full spec pasted into the session
area: frontend / marketing content
priority: medium
---

## What

Two **one-time launch announcement pages** (not per-batch release logs, not a full catalog):

1. **`beer.html`** — "We're now offering beer." Brew-your-own / ferment-on-premise beer (was wine only).
2. **`cider.html`** — "We're now offering 100% Okanagan Juice Cider." Ferment-on-premise cider from 100% real
   Okanagan apple juice (not concentrate).

Each page's job: announce the offering and drive **one** action. Focus on **(a) availability & dates** and
**(b) price & how to order**; keep style/ABV/tasting-note detail minimal (a short "what it is" hook is fine).
Single-screen-ish, skimmable.

## Why it matters

Owner-requested product launch. Beer is a new offering (previously wine-only); cider's differentiator is
100% real Okanagan juice. These pages are the public announcement + the funnel into the existing booking flow.

## Locked decisions (from owner, 2026-08-22)

- **Primary CTA = booking flow.** Wire "how to order" on both pages to the existing ferment-session booking
  flow (`POST /api/bookings` + `GET /api/bookings/slots` in `zoho-middleware/routes/bookings.js`, Cal.com behind
  it). **Reuse the existing booking component/markup** — do not rebuild. Respect middleware CORS/CSP.
- **Business content = placeholders for now.** Build the full page structure with clearly-marked placeholder
  price/dates/what's-included; owner fills real values **before production promotion** (see "Placeholders to
  fill" below — these must NOT be guessed).
- **Placement:** captured as a backlog todo first; formalize into a GSD phase (next free number, e.g. Phase 72)
  via `/gsd:discuss-phase` → `/gsd:plan-phase` → `/gsd:execute-phase` when picked up. Off-theme for the v4.5
  money-path milestone — treat as its own phase.

## Design notes (match the site — do NOT invent a design system)

- **Learn conventions first:** read `CLAUDE.md`, `README.md`, `docs/` (deploy runbook overrides). Open 2–3
  existing top-level pages (`about.html`, `hops.html`, `ingredients.html`) and mirror EXACTLY: shared
  header/nav markup, footer, `<head>` boilerplate (meta, favicon, **CSP**, canonical/OG/Twitter tags), and the
  `css/` classes. New pages must be visually indistinguishable from the rest of the site.
- **Constraints:** static GitHub Pages site, `.nojekyll`, `CNAME` (steinsandvines.ca). **Frontend is ES5-only**
  (enforced by `eslint.config.js` — no `let`/`const`/arrows/template literals in any inline or `js/` script).
  **Strict CSP** — no new external CDNs/fonts/trackers; comply with existing inline-style/script handling
  (middleware origin already whitelisted in `connect-src`). Images: existing `images/` pattern (webp + `srcset`,
  no multi-MB files); use flagged placeholders where a real photo is needed.
- **Brand/tone:** house palette (confirm against `css/`): maroon `#3C1518`, forest `#3E5C3A`, cream `#EAE3D7`,
  card `#FBF9F5`, gold `#C79A3B`, ink `#2b2320`, muted `#8a7f74`, hairline `#ddd4c7`. Voice: warm, local,
  craft-forward, Squamish community feel; confident, not salesy; short sentences; same level as `about.html`.
  Reuse existing type scale + buttons; no new fonts.

## Page structure (both pages; content differs)

Shared header/footer + main content:
1. **Hero / announcement banner** — "now available" headline + one-sentence subhead.
   (Beer: ~"Now brewing: beer at Steins & Vines." / Cider: ~"Now fermenting: 100% Okanagan Juice Cider.")
2. **What it is** — 1 short paragraph (2–4 sentences).
3. **Availability & dates** — compact scannable block (small table / definition list): available-from,
   now vs. starting-soon, typical ready time, seasonal/limited note.
4. **Price** — clear price(s) + what's included, consistent with how the site shows prices elsewhere.
5. **How to order (primary CTA)** — single prominent button (→ booking flow) + one-line "or call/visit" fallback.
6. **Short FAQ (optional, 2–3 Q&As)** — only if it removes friction ("Do I need experience?",
   "How long until it's ready?", "Can I bring my own recipe?").
7. **Cross-link** — each page links to the other ("Prefer cider? →" / "Prefer beer? →") + back to homepage.

## Navigation & discovery

- Add **Beer** and **Cider** to site nav — same nav include/markup as every page, updated **consistently across
  all pages** (match how the out-of-stock/catalog change touched all pages).
- Add a launch feature/banner or two on-brand cards on `index.html` pointing to the new pages.
- Both pages reachable + internally cross-linked.

## Definition of done

- Responsive (mobile-first, existing breakpoints), accessible (semantic h1→h2, descriptive link text, `alt` on
  images, contrast, keyboard-focusable CTA).
- Complete `<head>`: unique `<title>`, meta description, canonical, OG/Twitter, favicon — matching existing pages.
- No new external deps; passes **eslint (ES5)** + existing jest tests; run lint/build/test and fix before finishing.
- **`npm run build`** after any `js/` change (regenerates `main.js`/`main.min.js`) if scripts are touched.
- CSP-clean (no console violations).
- Commit to a **feature branch on staging** with a conventional `feat(...)` message. **Do NOT deploy to
  production** — owner promotes via `docs/` staging→prod runbook. Summarize changes + exact promote steps.

## Placeholders to fill BEFORE production promotion (do NOT guess)

**Beer:** one-line "what it is"; optional starter styles to name-drop; price ("$X per batch (~N bottles)" or
"starting at $X"); what's included (ingredients, equipment use, bottling, maker's + materials fees);
availability/dates (now? launch date? ready-in e.g. 4–6 wks? seasonal note); exact CTA text.

**Cider:** one-line "what it is"; what makes it special (100% Okanagan juice, source/region); price; what's
included (juice, equipment, bottling, fees); availability/dates (seasonal juice note); exact CTA text.

**Shared:** contact fallback — phone 1-604-567-4565, email hello@steinsandvines.ca, address
Unit 11–38918 Progress Way, Squamish BC (owner to confirm). Real photos? (filenames or "placeholders for now").

## Sequencing

Independent of Phase 71 money-path / prod cutover. Frontend-only (plus reuse of existing booking endpoints —
no middleware changes expected). Good candidate for `/gsd:ui-phase` or a straight `/gsd:plan-phase` since the
design is "match existing pages." Ready to formalize whenever the owner supplies (or greenlights placeholders
for) the launch content.
