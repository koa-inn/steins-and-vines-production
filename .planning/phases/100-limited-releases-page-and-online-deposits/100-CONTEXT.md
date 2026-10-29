# Phase 100: Limited Releases page and online deposits - Context

**Gathered:** 2026-10-29
**Status:** Ready for planning

<domain>
## Phase Boundary

A new public page, `limited-releases.html`, presents this season's ten limited-release wine kits:
five Winexpert Limited Edition 2026 (LE26) and five RJS Restricted Quantities 2027 "Elemento" (RQ27).
It is rendered from `content/limited-releases-2026-27.json` using the suppliers' own marketing assets.
Customers reserve kits by paying a **$50 non-refundable deposit per kit** online through
`POST /api/preorder/deposit`, which books correctly in Zoho.

The phase also includes the **brew-day side**: the kiosk must use up the deposit when the kit is
started (D-02). Without that, the deposit flow books money that is never applied.

Policy-page wording (`refunds.html`, `terms.html`) and the staff runbook entry are in scope.
Nothing is public on production until deposits work end to end and the owner signs off a full
staging run.

The handoffs already lock most of the WHAT, and they stand unless a decision below overrides them:
- `HANDOFF-limited-releases-deposits.md` §0–§11
- `HANDOFF-limited-releases-assets.md`

</domain>

<decisions>
## Implementation Decisions

### Locked by owner before this discussion (handoff §0, restated, not re-asked)
- Ten kits: LE26 + RQ27 (not VineCo Passport). One page for both collections.
- $50 per kit, non-refundable, **no cap**. Keep a per-item cap easy to add in
  `zoho-middleware/lib/limited-releases.js`, which holds the ten-item_id allowlist and
  `DEPOSIT_PER_KIT = 50`. The server never reads the frontend JSON.
- Launch everything together. The nav link and sitemap entry are held back on production until
  launch day (beer page hold-back commit `6e05a60d` is the pattern).
- The server flow follows handoff §4: validate the allowlist (qty 1–10 per line, total ≥ 1), take
  the `moneyPath.acquireIdempotencyLock` on the Helcim `transaction_id`, verify the Helcim amount
  equals the server-computed deposit to the cent (otherwise void + 400), void on any failure after
  capture with the `sendVoidFailureAlert` fallback, never call `createBatchesFromSale`, and keep
  PII out of logs.
- First step: commit the supplier images and the content JSON **unchanged** as their own commit.

### Deposit booking in Zoho and brew day
- **D-01: Book the deposit as an unapplied advance.** Record the customer payment with
  `salesorders_to_apply`, as handoff §4.6 says. This is a **deliberate, documented exception** to
  the codebase rule "NEVER salesorders_to_apply" (`lib/money-path.js:357-366` and the Phase 71
  tests). The existing ban tests must keep passing for checkout, collect and kiosk SO-pay. Put the
  deposit booking in its own clearly named helper with its own test, explaining why an advance is
  correct here (the deposit is a liability until the kit is invoiced). Don't loosen the existing
  guards.
- **D-02: The kiosk applies the advance automatically on brew day.** When staff take payment on a
  limited-release SO through the kiosk SO-pay path (`routes/pos.js` `/api/kiosk/salesorder-pay`
  → `moneyPath.finalizeSalesOrderInvoiceAndApplyPayment`), the $50 advance is applied to the new
  invoice and the terminal charges only the remainder. Today that path charges `so.balance`
  (`pos.js:2617`) and ignores existing advances, so the customer would pay full price and the
  deposit would stay stranded. Research must confirm how Zoho reports an SO's balance and the
  advance once a `salesorders_to_apply` payment exists, and how to apply that advance to an
  invoice. Staff must not need to do anything by hand in Zoho.
- **D-03: Put the fees on the SO.** Each kit's SO carries the kit at its Zoho item rate
  (zero-rated) plus the Maker's Fee (`MAKERS-FEE`, $45) and the Materials Fee (`MAT-FEE`, $5),
  taxed as usual. The kiosk SO-pay path does not add fees, so this keeps the brew-day balance
  right. The fees are only invoiced when the SO converts. Document this in the SO notes and the
  runbook.
- **D-04: One SO per kit.** A checkout with several kits takes **one** Helcim charge
  ($50 × total kits), then creates one SO per kit unit (qty 2 of Ember = 2 SOs). Each SO has a
  $50 advance against it and reference `LIMITED-2026-27`. Every brew day converts exactly one SO,
  which matches one batch per kit. The response and both emails list every SO number. The
  response shape changes from the handoff's single `salesorder_number` to a list (planner picks
  the field name).
  - Implication for failure handling: if creating the SOs or payments fails part-way after
    capture, void the whole charge **and** clean up (void or delete) any SOs or payments already
    created. Never leave a partial set. The idempotency lock covers the whole multi-SO operation.

### Launch policy (handoff §8)
- **D-05: Refund in full if the supplier can't deliver.** Keep the existing copy line. Add a
  runbook entry in `docs/RUNBOOK.md`: refund in Helcim, then remove the advance in Zoho (and void
  the SO).
- **D-06: Hold for 60 days.** A kit is held 60 days after it arrives; after that the deposit is
  forfeited. State this on the page's deposit terms, in `refunds.html` and in `terms.html`.
  Forfeited-deposit accounting stays case by case with the accountant (§8 item 4, not a build
  item).
- **D-07: Switching is staff-handled.** Before the kit's release month, a customer may ask to
  move a deposit to another limited kit, subject to availability. Staff edit the SO in Zoho. No
  self-serve UI. Add this to the deposit terms and the policy pages.
- **D-08: Show LE26 brew times only when known.** The card shows weeks only when the JSON
  `weeks` is non-null. LE26 kits are `null` today, RQ27 kits are 6. The owner fills them in
  later, with no code change.
- Updating the deposit terms in the content JSON (adding the hold-period and switching lines,
  removing `open_decisions_for_owner`) is a **separate commit after** the unchanged-assets
  commit. The owner approves the final policy wording before launch.

### Reservation basket and form
- **D-09: A +/- stepper on each kit card (0–10).** The flow is standalone, not the site cart
  (`js/modules/11-cart.js`) or `/api/checkout`, so limited kits never mix with regular orders.
  One reservation form near the bottom lists the chosen kits and the deposit total.
- **D-10: A sticky bottom bar on mobile.** It appears once at least one kit is chosen:
  "N kits · $X deposit → Reserve". Tapping it scrolls to the form.
- **D-11: Confirm in the page.** After payment the form is replaced with a summary: kits, release
  months, deposit paid, SO references, and what happens next. The same content goes in the
  customer email. No separate thank-you page.
- **D-12: No reserved counts or scarcity indicators.** The copy's "once they're gone, they're
  gone" is enough.
- The pay button stays disabled until the non-refundable checkbox is ticked and at least one kit
  is chosen (handoff §3). Store the checkbox text and a timestamp in the SO notes.

### Contact and spam protection
- **D-13: Use the existing contact helper as it is.** Use the same find-or-create contact helper
  as `/api/checkout` (`lib/checkout-helpers.js` `buildContactPayload` plus the
  lookup-by-`contact_name` logic). **Do not** fold in the "Last, First" fix from
  `HANDOFF-contact-name-format.md`. Deposits pick that fix up automatically when it lands. Don't
  fork the helper.
- **D-14: reCAPTCHA v3, fail-closed, like `/api/checkout`.** A reject after capture voids the
  charge. Also mount the existing payment rate limiter on the new route. The `reservation.html`
  CSP already allows reCAPTCHA and Helcim, so copy it.
- **D-15: Newsletter opt-in is optional and unticked by default.** Use the existing CASL wording
  and send to MailerLite only when ticked, the same as checkout.

### Post-research decisions (owner, 2026-10-29, after 100-RESEARCH.md)
- **D-16: Real money on staging is approved.** Staging uses the LIVE Zoho org and the LIVE
  Helcim account. The owner approves the Wave-0 spike and the staging run making real charges on
  their own card: one $50 charge, then $150. All of them are voided, and the Zoho records are
  cleaned up afterwards (the Phase 71 precedent). The spike settles the [LIVE-VERIFY] items before
  the money-path plans are final. If the advance turns out to be dropped or unlinked, switch to
  research Plan B (Zoho retainer invoices) and tell the owner.
- **D-17: Bind each payment to its order with a nonce. This is approved and deviates from the
  handoff.** Add `POST /api/preorder/initialize`, which mints a one-time nonce and sets it as the
  Helcim `invoiceRequest.invoiceNumber`. `POST /api/preorder/deposit` accepts a transaction, and
  voids one, only when its readback carries this nonce, is `APPROVED`, is `type=purchase`, and
  matches the amount in cents. Do NOT copy checkout's `rejectWithVoid`-on-any-400 pattern.
- **D-18: Each order is limited to 10 kits in total.** This is a request-size bound, not an
  inventory cap, so "no cap" still holds across orders. Each line is 1–10 per kit. The form copy
  reads: "Up to 10 kits per order. Call us for more: (604) 567-4565".
- **D-19: The existing checkout void weakness is out of scope.** It is filed as
  `.planning/todos/pending/checkout-reject-with-void-no-ownership-check.md`. Phase 100 does not
  change `/api/checkout`.
- **D-13 amended:** there is no shared contact find-or-create helper (`resolveCustomerId` is a
  closure inside `processCheckout`). Extract it **verbatim** into a shared lib function, keeping
  `/api/checkout`'s behaviour byte-identical with its tests still green, and use it in the deposit
  route. The "Last, First" fix is still out of scope.

### Claude's Discretion
- Card layout details within the asset rules: a bottle shot on every card, and the scene image as
  a header band only when present.
- The pairings presentation (a list, or an expandable "Pairs with" on mobile) and the release
  calendar's visual form.
- The response field names and the staff email layout.
- The JSON-LD shape within handoff §7: a `Product` per kit, `PreOrder`, and
  `availabilityStarts` set to the release month.

### Folded Todos
- `.planning/todos/pending/limited-releases-page-and-deposits.md` is this phase's source todo and
  is folded in whole. The other 20 keyword matches from todo matching were noise (generic words
  like "pending" or "owner") and are unrelated to this phase.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase spec (owner handoffs)
- `HANDOFF-limited-releases-deposits.md` — the main spec, §0–§11. Decisions D-01 to D-15 above
  override it where they differ, notably D-02 (the brew-day kiosk change is in scope), D-03 (fees
  on the SO) and D-04 (one SO per kit, not one per order).
- `HANDOFF-limited-releases-assets.md` — the asset rendering rules, the don'ts and the required
  frontend tests.
- `.planning/todos/pending/limited-releases-page-and-deposits.md` — the todo summary.
- `content/limited-releases-2026-27.json` — the page content. **Display only**: the server never
  trusts its prices or deposit.
- `.planning/ROADMAP.md` Phase 100 — the draft success criteria.

### Money path (must follow)
- `zoho-middleware/lib/money-path.js` — `acquireIdempotencyLock`, `voidWithTimeout`,
  `sendVoidFailureAlert`, `finalizeSalesOrderInvoiceAndApplyPayment`, and the
  "NEVER salesorders_to_apply" doc comment (D-01 carve-out).
- `zoho-middleware/routes/checkout.js` — the reference flow: reCAPTCHA (~l.157), captured-amount
  verification (~l.625-660), void on failure (~l.957), and the orphaned-advance invariant
  (~l.700-725).
- `zoho-middleware/routes/pos.js` `/api/kiosk/salesorder-pay` (~l.2575-2760) — the brew-day path
  that D-02 changes.
- `zoho-middleware/routes/payments.js` — `/api/payment/initialize` accepts a client amount, which
  is why the server-side amount check is required.
- Ban tests that must keep passing: `zoho-middleware/__tests__/checkout-so-deposit-reconcile.test.js`,
  `kiosk-salesorders.test.js`, `collect-webhook-reconcile.test.js`,
  `helcim-terminal-success.test.js`.

### Contact and spam
- `zoho-middleware/lib/checkout-helpers.js` — `buildContactPayload` (~l.218), used as is (D-13).
- `HANDOFF-contact-name-format.md` — context only. Not in this phase.

### Site rules
- `CLAUDE.md` — test, lint and build rules, rule 12 (CSP on all public pages), and staging first.
- `docs/TRACKING.md` — CSP and tracking.
- `reservation.html` — the CSP source to copy.
- `refunds.html` (~l.106: "we do not take a separate deposit" must change), `terms.html`.
- `docs/RUNBOOK.md` — new entries for supplier failure, switching, and forfeits.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lib/money-path.js` primitives: the idempotency lock, void with timeout, the void-failure alert,
  and the SO-to-invoice finalize-and-apply helper (extend it for D-02 rather than writing a
  parallel path).
- `lib/checkout-helpers.js` for contact find-or-create; `lib/mailer.js` for the customer and
  staff emails; `lib/eventLog.js` for PII-free event logs.
- `js/modules/12-checkout.js` for the HelcimPay iframe integration pattern on the frontend.
- The `serverEnv` payment rate limiter in `zoho-middleware/server.js` (~l.720, `paymentLimiter`).

### Established Patterns
- Money-path discipline: compute the amount on the server, verify the captured amount to the
  cent, void on any failure after capture, alert if the void fails, and record a reconcile
  sentinel (`lib/reconcile.js`).
- Frontend: ES5 vanilla JS modules in `js/modules/`, wired in `13-init.js` by `data-page`. Run
  `npm run build` after module changes and never edit `js/main.js` or `main.min.js`.
- New public pages are added to `stamp:pages` in `package.json` and to the hard-coded page lists
  in `cookie-consent.test.js`, `page-search-consistency.test.js`, `legal-pages.test.js` (if the
  page has the policy footer) and `tests/e2e/static-pages.spec.js`. Call these list additions out
  in the commit message.

### Integration Points
- New `zoho-middleware/routes/preorder.js` plus `lib/limited-releases.js`, mounted in `server.js`
  with the rate limiter.
- The kiosk SO-pay route (D-02) must recognise SOs that carry an advance. Reference
  `LIMITED-2026-27` is a likely discriminator; research confirms whether a general rule ("apply
  any SO advance") is safer.
- `refunds.html`, `terms.html`, the nav on every page, and `sitemap.xml` (the last two held back
  on prod).

</code_context>

<specifics>
## Specific Ideas

- Never overlay text on `le26-hero.webp`, because its CTA and logo are baked in. `rq27-hero.webp`
  can take an overlay.
- Brochure links use `download` and show the file size, e.g. "Brochure (PDF, 0.6 MB)".
- Show the attribution line from `assets.attribution` in small print.
- Mobile first: the steppers and the pay button must work on a phone.
- Staging run (handoff §10): Helcim test mode, reserve 1 kit and then 3 kits across both
  collections, and confirm the SOs, the advances, both emails and that no BrewPad batch was
  created. **Add a brew-day check (D-02)**: take a staging SO through kiosk SO-pay and confirm
  the advance is applied and only the remainder is charged. Then production: one real $50
  deposit by the owner, refunded afterwards.

</specifics>

<deferred>
## Deferred Ideas

- **BrewPad Dashboard v2: restore the Today's Tasks and Ready to Bottle sections** on the main
  page alongside the new widgets. This is an owner note from this session and is unrelated to
  Phase 100. Filed as `.planning/todos/pending/brewpad-dashboard-v2-restore-tasks-and-ready-to-bottle.md`.
- A staff-only reservation summary (count per kit) in BrewPad admin. Handoff §6 lists it as
  welcome but not needed for launch.
- Self-serve kit switching and public reserved counts were both rejected for now (D-07, D-12).
- The contact-name "Last, First" fix stays its own piece of work (`HANDOFF-contact-name-format.md`).

</deferred>

---

*Phase: 100-limited-releases-page-and-online-deposits*
*Context gathered: 2026-10-29*
