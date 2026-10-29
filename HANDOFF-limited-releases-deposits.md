# Handoff — Limited Releases 2026-27 page + online deposits

**Date:** 2026-10-27
**Owner:** Koa
**Status:** Spec. Zoho items and page content already done (§1). Code not started.

---

## 0. What this is

A new public page, `limited-releases.html`, presenting this season's ten limited-release wine kits
(five from Winexpert, five from RJS), where a customer reserves kits by paying a **$50 deposit per
kit** online. When a kit arrives (Nov 2026 to Apr 2027) the shop contacts the customer to book a
start, and the deposit comes off the kit price on brew day.

### Owner decisions (27 Oct 2026)

| Decision | Answer |
|---|---|
| Kits | Winexpert Limited Edition 2026 (LE26) and RJS Restricted Quantities 2027 "Elemento" (RQ27). Not VineCo Passport. |
| Layout | One page for both collections |
| Commitment | Online deposit, **$50 per kit** |
| Refunds | **Non-refundable** (see §8 for the supplier-failure exception, which needs confirming) |
| Caps | **None** — every deposit is accepted |
| Launch | **Everything together** — the page doesn't go public until deposits work end to end |
| Kit prices | House markup: RQ27 $230; LE26 $200 / $210 / $220 |

**Supplier deadlines will pass before launch.** RJS pre-commitment closes 30 Oct; GVI retailer
submission is 4 Nov. Supplier orders were placed on the owner's judgment. The page fills those
orders and drives top-up orders where the supplier allows them.

---

## 1. Already done — do not redo

**Zoho items** (created and verified 27 Oct; active, stock 0 so the normal catalog hides them;
Zero Rated - Ingredients on both sides; `cf_type=Wine`):

| Release | Kit | SKU | item_id | Retail | Cost |
|---|---|---|---|---|---|
| Nov 2026 | RQ27 Ember — Pinot Noir Shiraz, Australia | 80100269 | 109900000001719001 | 230 | 118.00 |
| Dec 2026 | LE26 Connexion Red — Grenache Merlot, Languedoc | G010409 | 109900000001719056 | 210 | 103.50 |
| Jan 2027 | RQ27 Aria — Cabernet Franc, Canada | 80100270 | 109900000001719012 | 230 | 118.00 |
| Jan 2027 | LE26 Connexion White — Roussanne Marsanne Viognier | G010408 | 109900000001719067 | 200 | 99.50 |
| Feb 2027 | RQ27 Acqua — Pinot Grigio Sauvignon Blanc, Italy | 80100271 | 109900000001719023 | 230 | 118.00 |
| Feb 2027 | LE26 Milagro — Cab Carmenere Merlot Syrah, Chile | G010407 | 109900000001719078 | 210 | 103.50 |
| Mar 2027 | RQ27 Terre — Cabernet Sauvignon Merlot, France | 80100272 | 109900000001719034 | 230 | 118.00 |
| Mar 2027 | LE26 Synergy — Semillon Gewurztraminer, Australia | G010406 | 109900000001719089 | 200 | 99.50 |
| Apr 2027 | RQ27 Sol — Tempranillo Bobal, Spain | 80100285 | 109900000001719045 | 230 | 118.00 |
| Apr 2027 | LE26 Amici — Montepulciano Aglianico Sangiovese, Italy | G010404 | 109900000001719100 | 220 | 110.50 |

**Page content:** `content/limited-releases-2026-27.json` — copy, how-it-works steps, deposit
terms, checkbox wording, collection blurbs, and per-kit display data keyed by `zoho_item_id`.
**Display only.** Prices and the deposit in that file are never trusted by the server.

Fees today: Maker's Fee `MAKERS-FEE` $45, Materials Fee `MAT-FEE` $5.

---

## 2. Repo non-negotiables (from CLAUDE.md)

1. `npm test` AND `cd zoho-middleware && npm test` before every commit; `npm run lint` clean.
2. ONE logical change per commit. Read existing code and tests first; grep every usage.
3. Changing anything in `js/lib/*` or `zoho-middleware/lib/*` → FULL suite, both sides.
4. Never edit `js/main.js` / `main.min.js`; run `npm run build` after module changes.
5. Do NOT modify existing tests unless asked (adding the new page to hard-coded page lists in
   existing tests is required by those tests' own purpose — call it out in the commit message).
6. **CSP:** copy from `reservation.html` (it already allows Helcim and reCAPTCHA), not from
   `wine.html`. See `docs/TRACKING.md`.
7. **Staging first.** This touches the money path: no production push without the owner signing
   off a full staging run (§10).

---

## 3. Customer flow

```
limited-releases.html
  choose kits + quantities (any number, no cap)
  -> name, email, phone; optional newsletter opt-in (existing CASL wording)
  -> REQUIRED checkbox: deposit_checkbox_label from the content JSON
  -> "Pay $NN deposit" -> HelcimPay iframe for 50 x total kits
  -> POST /api/preorder/deposit { transaction_id, items:[{item_id, qty}], customer, consent }
  -> confirmation on page + email
```

The pay button stays disabled until the checkbox is ticked and at least one kit is chosen.

---

## 4. Server: `POST /api/preorder/deposit`

New route (e.g. `routes/preorder.js`) and a small server-side config module
(`lib/limited-releases.js`) holding the **allowlist of the ten item_ids** and
`DEPOSIT_PER_KIT = 50`. The server never reads the frontend JSON.

In order:

1. **Validate.** Every `item_id` is on the allowlist; `qty` integer 1–10 per line; total kits ≥ 1;
   customer name/email required. Reject anything else with 400.
2. **Idempotency.** Lock on the Helcim `transaction_id` with `moneyPath.acquireIdempotencyLock`, the
   way checkout and the kiosk do, so a retry can't create a second order.
3. **Verify the money.** Expected = `DEPOSIT_PER_KIT × total kits`, computed here. Fetch the Helcim
   transaction and confirm it is approved and its amount equals expected, to the cent. If not:
   void and return 400. Note that `/api/payment/initialize` accepts a client-supplied amount — this
   check is what makes that safe, exactly as `/api/checkout` does.
4. **Contact.** Find or create the Zoho contact with the existing helper. (Be aware of the open
   name-format issue in `HANDOFF-contact-name-format.md`; use whatever that work settles on.)
5. **Sales order.** One Zoho sales order: each kit at its **Zoho item rate** (zero-rated), qty as
   reserved. Reference `LIMITED-2026-27`. Notes: deposit amount, Helcim txn id, release months,
   and the consent text with timestamp.
   - **Fees:** check whether the kiosk's sales-order-to-invoice path on brew day adds the Maker's
     and Materials fees. If it does, keep them off the SO. If it doesn't, add them to the SO so the
     balance is right on brew day. Document which.
6. **Record the deposit** as a customer payment against the sales order **that Zoho holds as an
   unapplied advance** — not applied to an invoice. The comment in `routes/pos.js` (~line 2725)
   notes that `salesorders_to_apply` books exactly that; here it is the wanted behaviour, because
   the deposit is a liability until the kit is invoiced. Same deposit-to account as other online
   card payments.
7. **Do NOT create BrewPad batches.** Don't call `createBatchesFromSale`. The batch is created when
   the kit has arrived and the start is booked.
8. **Emails.** Customer confirmation (kits, release months, deposit paid, non-refundable, what
   happens next) and a staff notification with the SO number.
9. **Failure after capture** (contact, SO or payment recording fails): void the Helcim charge and,
   if the void fails, `sendVoidFailureAlert` — the same discipline as `/api/checkout`
   (`lib/money-path.js`). Never leave a captured card with no Zoho record.

Respond with `{ ok, salesorder_number, deposit_total }`. No PII in logs (ZERO PII POLICY,
`lib/eventLog.js`).

---

## 5. Accounting (for the owner and accountant)

- **On deposit:** card payment held as a customer advance (liability). No revenue, no tax — the kit
  is zero-rated.
- **On brew day:** convert the SO to an invoice (kit + fees), apply the advance, charge the balance.
  Fees are taxed as normal on the invoice.
- **Forfeited deposits** (customer never brews): needs an owner rule (§8) and an accountant view on
  where forfeited deposits go and how they're taxed. Until then staff handle them case by case.

---

## 6. Staff operations

- **Who reserved what:** Zoho sales orders with reference `LIMITED-2026-27`, grouped by item. A
  staff-only summary (count per kit) in BrewPad admin is a welcome addition but not required for
  launch — the staff email per deposit plus the Zoho filter is enough.
- **Before each supplier order:** count reservations per kit and order at least that many.
- **When a kit arrives:** receive it (bill), then contact each depositor to book a start. Reuse the
  `sendWaitlistContact` pattern later if this becomes routine.
- **Supplier can't deliver:** refund the deposit in Helcim and remove the advance in Zoho. Write
  this up as a short runbook entry in `docs/RUNBOOK.md`.

---

## 7. Page build

- `limited-releases.html`, `data-page="limited-releases"`, rendered from the content JSON by a new
  module (`js/modules/`), wired in `13-init.js`.
- Sections: hero; how it works; both collections with kit cards (grapes, region, release month,
  colour, sweetness, body, oak, ABV, notes, kit price, quantity picker); a release calendar
  (Nov–Apr); deposit terms; the price note (fees, 23 L ≈ 30 bottles); the reservation form.
- JSON-LD: a `Product` per kit with an `Offer` at the kit price, `availability`
  `https://schema.org/PreOrder`, `availabilityStarts` = release month. The deposit is not the price.
- Navigation link on every page; `sitemap.xml` entry; add the page to `stamp:pages` in
  `package.json`; add it to the hard-coded page lists in `cookie-consent.test.js`,
  `page-search-consistency.test.js`, `legal-pages.test.js` (if it has the policy footer), and
  `tests/e2e/static-pages.spec.js`.
- **Hidden until launch:** develop on staging; don't add the nav link or sitemap entry to
  production until launch day (the beer page's hold-back commit `6e05a60d` is the pattern).
- Mobile first; the quantity pickers and pay button must work on a phone.

### 7a. Supplier marketing materials

The owner wants the page to use the suppliers' own marketing assets. The content JSON has slots
for them; render whatever is filled and degrade cleanly when a slot is `null`.

- **Per kit:** `image` / `image_alt` (bottle or label shot), `food_pairings`, `region_note`.
  Pairings and region notes are filled for the five LE26 kits, summarised from Winexpert's retailer
  product descriptions (on file in Drive). RQ27 pairings are pending the RJS toolkit.
- **Per collection:** `hero_image`, `brochure_pdf` (link "Download the brochure").
- **Files live in `images/limited-releases/`**, self-hosted, WebP, about 200 KB max, with
  width/height attributes. Never hotlink supplier sites — the CSP's `img-src` is `'self'`, and
  supplier URLs move.
- Show the attribution line from `assets.attribution` in the page footer area.
- Check `assets` in the JSON for what has arrived; the build must not wait on missing images.

**LE26 assets are in** (27 Oct, from Winexpert's retailer pack), all in `images/limited-releases/`:
- Per kit: `image` (transparent bottle shot, 455×900) and `scene_image` (1200×857 vineyard/
  landscape photo — good as a card header or background).
- Collection: `hero_image` (1920×1080 — it already has "RESERVE YOURS NOW." and the Winexpert
  logo baked in, so don't overlay text on it), `group_image` (all five bottles), `logo.dark` /
  `logo.light`, and `brochure_pdf` (the consumer brochure, 585 KB).

**RQ27 assets are in** (27 Oct, from the RJS Elemento retailer pack): bottle shots, `hero_image`
(1920×1233, cropped from RJS's digital banner — safe to use as-is), `group_image` (4:5, carries
the Elemento wordmark), logos and a web-weight `brochure_pdf` (686 KB). Tasting notes and food
pairings are filled for all ten kits.

RQ27 kits have **no `scene_image`** — the card layout must look right with a bottle shot alone.
Don't pull more imagery from the RJS pack's print files: its landscape photography includes
licensed stock images meant for RJS's own materials.

---

## 8. Policy pages and open owner decisions

`refunds.html:106` currently says *"we do not take a separate deposit"*. Add a **Limited Release
deposits** section to `refunds.html` and `terms.html` before launch. **Owner approves the wording.**

Decisions still needed from the owner (also listed in the content JSON):

1. **Supplier-failure refund.** The content includes "If a supplier can't deliver a kit you've
   reserved, we'll refund that deposit in full." Recommended even with non-refundable deposits.
2. **Hold period** after arrival before a deposit is forfeited (suggested 60 days).
3. **Switching kits:** can a deposit move to a different limited kit before release?
4. **Forfeited deposit accounting** — with the accountant.
5. **LE26 brew times** — Winexpert hasn't stated them in the material on file; RQ27 is 6 weeks.
6. **No cap** is the decision. Note the risk: RJS's launch deck says RQ27 kits are sold **first
   come, first served until inventory is depleted**, so extra deposits may not be fillable after
   the pre-book. If it becomes a problem, add a per-item cap to `lib/limited-releases.js`.

---

## 9. Tests

Middleware (Jest, existing fake style):
- Allowlist: unknown item → 400; qty bounds; empty basket → 400.
- Amount: server computes 50 × kits; a Helcim amount off by a cent → void + 400.
- Idempotency: same `transaction_id` twice → one SO.
- Failure after capture at each step → void called; void failure → alert called.
- Never calls `createBatchesFromSale`.
- Payment recorded against the SO as an advance, not applied to an invoice.
- No email/phone/name in logs.

Frontend:
- Renders all ten kits from the JSON in release order.
- Pay button disabled until checkbox ticked and ≥ 1 kit chosen.
- Deposit total shown = 50 × kits.
- Page passes the existing page-consistency tests once added to their lists.

---

## 10. Rollout

1. Build and test locally; push to staging.
2. **Staging run in Helcim test mode** with test card numbers: reserve 1 kit, then 3 kits across
   both collections; confirm the SO, the advance, both emails, and no BrewPad batch.
3. Owner approves the policy wording and §8 decisions.
4. Production: one real $50 deposit by the owner; confirm in Zoho; refund it in Helcim.
5. Add nav link and sitemap entry; announce (newsletter, socials).

---

## 11. Acceptance criteria

- A customer can reserve any mix of the ten kits and pay exactly $50 per kit, on a phone.
- Each deposit produces one Zoho SO (reference `LIMITED-2026-27`) with the deposit held as an
  unapplied advance — no invoice, no revenue, no BrewPad batch.
- Any failure after the card is charged voids the charge or raises the void-failure alert.
- The non-refundable checkbox is required and its text is stored with the order.
- Refund and terms pages describe limited-release deposits.
- Nothing is public on production until the owner signs off the staging run.
