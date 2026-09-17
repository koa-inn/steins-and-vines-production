# Legal Policy Drafts — REVIEW REQUIRED (not live)

**Status:** DRAFT, **second pass** 2026-09-16. First pass generated 2026-08-13 to satisfy the Consumer Protection BC disclosure items raised in the merchant review. **These are NOT published to the website** and **NOT legal advice.** They are starting-point content for the owner and a qualified BC lawyer to review, correct, and finalize before anything is wired into the site.

The review copy for the owner and lawyer is the artifact at https://claude.ai/artifact/3rHihfkXGb4NqaiyZapumv (same content, republished 2026-09-16).

## Built 2026-09-17 (staging-bound, not yet on production)
The four drafts are now real pages — `terms.html`, `refunds.html`, `warranty.html`, `privacy.html` — generated from the drafts with the `[CONFIRM]` markers stripped and the proposed wording kept, effective date 17 September 2026. Every public page's footer links to them; the checkout carries the required acknowledgement box ("I confirm I am 19 or older and agree to the Terms & Conditions, the Refund, Return & Cancellation Policy, and the Privacy Policy" — the 19+ phrase shows only for kit orders) and a separate unticked newsletter opt-in that, when ticked, subscribes the email to MailerLite (`MAILERLITE_NEWSLETTER_GROUP_ID`, optional) and logs a consent event. Kiosk-mode checkouts hide the box (ID and slip are handled in store). Two deliberate departures from the drafts: Privacy §4 describes cookies as they work today (no consent gating yet) and no longer mentions a footer "Cookie settings" link; the Terms' "checkout acknowledgement (for the build phase)" note is gone because it is built.

**Still to build:** the cookie-consent notice gating the GTM tags (then restore the Privacy §4 wording), the reCAPTCHA notice near the checkout form, and CASL consent wording on the waitlist form. **Still with the owner:** the lawyer review (seven questions below), the Zoho organisation legal name, and the accountant check on the kit zero-rating.

## The four documents
1. `privacy-policy.md`
2. `terms-and-conditions.md`
3. `refund-return-cancellation.md`
4. `warranty.md`

## How to use this
- Anything in **`[CONFIRM: …]`** is a decision only the owner or a lawyer can make. Every one must be resolved before publishing; do not ship a policy with a bracket left in it. Markers tagged **(lawyer)** or **(licence)** are wording checks, not business decisions.
- Facts filled in from the site were re-verified against the code on 2026-09-16.
- Once the content is finalized, a follow-up build phase scaffolds these as real site pages (matching the existing template + CSP + build), adds footer/nav links site-wide, adds the 19+ / terms acknowledgement checkbox to checkout, adds the cookie-consent notice and gates the GTM tags on it, adds the reCAPTCHA notice near the checkout form, and adds CASL consent wording to the waitlist form. That build is separate from this content review. The BPCPA check below found further checkout and confirmation-email gaps; all that could be fixed without the policy pages were fixed on 2026-09-16 (see the table), leaving the policy links and the acknowledgement checkbox for the build.

## Owner decisions applied on 2026-09-16
1. **Pickup only.** No shipping. Shipping sections removed; pickup and risk-on-collection stated in Terms §6.
2. **Sessions.** Paid in full at booking, no deposit. Free rescheduling. Cancellation before the batch is started: refund less a **$10 administrative fee** (lawyer to confirm enforceability). A **started batch is not refundable**; it is covered by a new **Satisfaction Guarantee**: replace the kit and rerun the batch at no cost, **once per batch**, claimed within **30 days of packaging day** (extendable at the owner's discretion), with most of the product returned.
3. **Returns.** Ferment-on-premises kits are non-returnable. Other consumables are returnable **only for a quality issue**.
4. **Warranty.** No Steins & Vines warranty on equipment; manufacturer warranty, if any, is the customer's to use with our help.
5. **19+.** Verified **in store with photo ID** when the customer signs the batch slip and pitches the yeast. Online booking carries a declaration.
6. **Cookie consent.** Yes, **unobtrusive**. Written into Privacy §4 as a build requirement.

## Owner decisions applied on 2026-09-16 (third pass)
7. **Legal entity:** 1571221 B.C. Ltd., doing business as Steins & Vines — in every preamble.
8. **No-shows:** treated as a cancellation (refund less $10) if not started within 30 days of the missed appointment and not rebooked.
9. **Guarantee:** at least **75%** of the bottles must come back; **wine kits only**, beer not covered for now.
10. **Equipment returns:** allowed if unused and in as-new condition, with receipt.
11. **Finished-batch storage:** wine up to **1 month**, beer up to **2 weeks**, from the confirmed packaging date.
12. **Gift cards / custom labels:** standard wording accepted.
13. **Guarantee replacement:** same kit or a different kit of equal or lower price; no refund of the difference.
14. **Windows:** 30 days for equipment returns, quality-issue claims, and warranty claims; refunds within 10 business days to the original method, cash in cash; uncollected orders held 30 days.
15. **Tax display:** prices shown before tax; GST/PST added at checkout.
16. **No restocking fee.**
17. **Retention:** 6-year tax records, licence period for customer slips and batch records (figure to confirm), 2 years other booking details, marketing until unsubscribe, error reports 90 days.
18. **Privacy Officer:** the owner, via hello@steinsandvines.ca.
19. **Storage window consequence:** reasonable efforts to contact, then after a further 14 days the batch may be destroyed (the handbook's "Unclaimed Product" rule), no refund.
20. **19+ checkbox at checkout:** yes.
21. **Newsletter:** exists; an unticked opt-in checkbox is added at checkout (CASL express consent).
22. **Checkout acknowledgement wording:** accepted.
23. **Equipment warranty line:** accepted.
24. **Helcim fields:** whatever Helcim returns by default.
25. **Effective date:** the publish date.
26. **Beer programme:** Steins & Vines holds a **Federal Wort Licence**, so staff prepare the wort and the customer adds the yeast — the arrangement the handbook permits (p.10). Terms §2 now says so.

## Facts taken from the UBrew/UVin Terms and Conditions Handbook (LCRB, revised June 2020)
- Records — ingredient purchases, all sales, invoices, customer declarations, and disposal of spoiled/unclaimed/returned liquor — must be available for inspection for **at least six years** (p.9).
- Each customer must pay for ingredients before starting, **sign a personal-use declaration** (kept for audit), and **add the ingredients that start fermentation** themselves (p.10). On the return visit they must sterilise, bottle, seal, and label, and **remove bottled product immediately**; bottled product cannot be left on the premises and cannot be delivered (p.10).
- The batch invoice must carry the customer's name and phone number, product and quantity, date and amount, and be retained (p.12).
- Unclaimed product: make a reasonable attempt to contact the customer; after a reasonable interval it may be destroyed (p.14).
- Customer returns: a free or discounted replacement batch is allowed only if the customer repeats all production steps, signs a new declaration, and the unsatisfactory product is destroyed; finished product the customer did not make can never be handed over (p.14). The Satisfaction Guarantee is written to fit this.
- Customers may sample their own product before bottling, up to two samples of 100 ml (p.13).
- Minors may not manufacture liquor; ID is judged case by case (pp.5–6).

## Facts closed from the code on 2026-09-16
- Checkout collects name, email, phone, and notes only. No address, no date of birth.
- Sentry scrubs personal data before sending (`zoho-middleware/lib/sentry-scrub.js`).
- Helcim is the only payment processor in use. Global Payments remains a package dependency and is named in `CLAUDE.md`, but nothing in the runtime calls it — worth removing separately.
- **Added to the drafts because the code does it:** Google reCAPTCHA v3 on checkout; the beer waitlist and its **MailerLite** sync (a CASL consent point).
- Not present on the site today: any age gate, any cookie-consent notice.

## Still open — owner decisions
- The effective date, filled in when the pages go live.

## Still open — lawyer or licence checks
Seven markers, all wording checks. Each now names the current section of the Act and carries a proposed answer where one could be drafted; the lawyer approves or redrafts rather than starting from a blank.
1. **Terms §11 + Refund §H — disclosure.** Confirm that the checkout, Terms §3–4 and the confirmation email together satisfy BPCPA **ss. 18.2 (a), (d)–(t) and 18.3** (see the check below), and that no amount has been prescribed for s.18.3 (none found in B.C. Reg. 272/2004 as amended to 2026-08-01).
2. **Refund §A — the $10 fee.** A contractual term for a voluntary pre-start cancellation, disclosed before purchase (s.18.2 (q), s.18.3). Not deductible from a refund on a cancellation made *under the Act* (s.45 "without deduction"; §H now says so). Confirm $10 is a defensible pre-estimate of administrative cost.
3. **Refund §H — the started-batch rule.** Once the customer has pitched the yeast the service has begun (s.53) and the customer holds the goods; the only statutory cancellation rights left are s.18.4 (defective disclosure) and s.23 (5) (no copy within 15 days / late supply). Confirm "not refundable once started" is consistent with that.
4. **Terms §10 — limitation of liability.** Proposed clause drafted (cap at the amount paid; no consequential loss; carve-outs for negligence causing injury, fraud, non-excludable implied conditions). Approve or redraft. Sale of Goods Act s.20; BPCPA s.3.
5. **Warranty §5 — limitation.** Proposed clause drafted (replace-or-refund for goods; Satisfaction Guarantee then amount paid for batches; no consequential loss; statutory carve-out). Approve or redraft.
6. **Privacy §3 — PIPA cross-border.** BC PIPA has no express duty to notify of storage outside Canada (Alberta's does); the OIPC recommends saying so, which the draft does. Confirm the sentence is enough.
7. **Terms §12 — governing law.** Plain BC law + BC courts; confirm no arbitration or forum clause is wanted.

Also for the lawyer, without a marker: **Terms §1** treats refusal of a session for missing ID as a customer cancellation (refund less $10). The 19+ condition is disclosed before purchase and confirmed at checkout, so it is a term under s.18.2 (p); confirm the fee treatment.

## BPCPA check against the current Act (2026-09-16, third session)
**Finding: the Act changed under the drafts.** The 2025 amendments (S.B.C. 2025 c. 3, in force in the bclaws consolidation as read on 2026-09-16) repealed the old contents lists in **s.19** (future performance) and **s.46** (distance sales) and replaced them with a single **Division 1.1 — Contract Requirements**: **s.18.2** (what every direct-sales, future-performance, time-share and distance-sales contract must contain), **s.18.3** (what must be disclosed *before* the contract, "in a clear and comprehensible manner", with "an express opportunity to view the entire contract"), and **s.18.4** (a new cancellation right when either is missed: **one year** for a reservation, **7 days** after receiving the copy for an online goods order). The copy-of-contract duties survive: **s.23 (3)** (reservation) and **s.48** (goods order), both within 15 days. Refunds on statutory cancellation: **s.45 / s.50**, within 15 days, without deduction. The drafts and the previous README bullet cited the repealed sections; Terms §11, Refund §A/§H and this file now cite the current ones.

A reservation is a future performance contract (paid in full at booking, service supplied weeks later, total over the $50 threshold in reg. s.1.1) **and** a distance sales contract (not entered into in person). Under s.18 both sets of rules apply and the more consumer-favourable one wins. A ferment session is **not** a "fitness or other personal services contract" (reg. s.2 designates physical-fitness services only), so the 10-day cooling-off and the 30 %-cost cap in s.25 and reg. s.3 do not apply.

Item-by-item against s.18.2, checked against the reservation page (`reservation.html`, `js/modules/12*.js`), the Terms draft, and the confirmation the customer receives (the Zoho invoice or sales-order PDF emailed by `zoho-middleware/routes/checkout.js`, with a plain-text Resend fallback):

| s.18.2 | Requirement | Before payment (checkout) | In the Terms | In the confirmation | Status |
|---|---|---|---|---|---|
| (a) | Supplier's name and, if different, trading name | site brand only | preamble ✓ | Zoho org name is **"Steins and Vines"**, no legal name | **Owner: add "1571221 B.C. Ltd." to the Zoho organisation profile** so the PDF header carries it |
| (c) | Contract date | — | — | invoice date ✓ | ✓ |
| (d) | Detailed description of goods/services | kit or recipe name, qty, Maker's/Materials fee lines ✓ | §2–4 describe the service ✓ | line items ✓ | ✓ |
| (e) | Delivery arrangements | pickup-and-currency note above the payment block ✓ | §6 pickup only ✓ | "Everything is collected in store at 11-38918 Progress Way …" in both confirmation bodies ✓ | **Done 2026-09-16** |
| (f) | Supply date; completion date if later | start appointment ✓; "Estimated ready the week of …" ✓ (`12c-checkout-scheduling.js`) | §4 ✓ | start appointment ✓; the same estimate line, sent with the order as `ready_estimate` ✓ | **Done 2026-09-16** |
| (g) | Itemised price | Kit supplies / Maker's Fee / Materials Fee / Kit Total ✓ | §3 ✓ | ✓ | ✓ |
| (h) | Other determinable costs incl. taxes | GST row for the maker's fee and PST+GST row for the materials fee ✓. Kits show no tax row because they are **zero-rated in Zoho by design** (INV-000200: kit 0 %, maker's fee GST 5 %, materials fee PST+GST 12 %); the `tax-display` note in `docs/tasks.md` is stale | §3 ✓ | ✓ | ✓ — owner to confirm with the accountant that ingredient-only wine kits are correctly zero-rated; if not, the fix is in Zoho item tax settings, not code |
| (i) | Costs that cannot be determined | none; §3 "nothing further is added on packaging day" ✓ | ✓ | — | ✓ |
| (j) | Currency if not CAD | "Total (CAD)" on both total rows; "Prices in Canadian dollars" note ✓ | §3 CAD ✓ | CAD ✓ | **Done 2026-09-16** |
| (k) | Terms of payment | pay-in-full via Helcim ✓ | §4–5 ✓ | ✓ | ✓ |
| (l) | Total price | ✓ | — | ✓ | ✓ |
| (o) | Promotional offers: conditions, duration, what applies after | conditions line under the promo label: 20 % off kits and fees on the first batch, one use per email, no stacking ✓ | §3 generic | discount line | **Done 2026-09-16** |
| (p) | Restrictions, limitations, conditions | not shown | §1 (19+), §2 (personal use, customer starts and packages), §4 (storage windows) ✓ | — | **Build (planned):** Terms link + acknowledgement checkbox before pay |
| (q) | Return, exchange, cancellation, refund policies | kit reminder now says "Rescheduling is free. Cancel before your start appointment for a full refund less a $10 administrative fee." ✓; policy link not yet possible (pages do not exist) | Refund policy | — | **Build (planned):** Refund link before pay once the page exists |
| (b)(m)(n)(r)(s) | Motor dealer no., trade-in, security interest, renewal, designated notice | n/a (reg. s.7 designates fitness, direct-sales and time-share contracts only) | | | n/a |
| (t) | Other prescribed information | none in B.C. Reg. 272/2004 as amended to 2026-08-01 | | | lawyer to confirm |

**s.18.3 and s.47 (how it must be disclosed):** before payment, without charge or conditions, clearly, with an express opportunity to view the entire contract; in electronic form the customer must be able to access, retain and print it. The planned checkout block (links to Terms, Refund and Privacy from the acknowledgement checkbox; HTML policy pages; the emailed PDF) satisfies this once built.

**Copy of the contract (s.23 (3), s.48):** paid orders get the Zoho PDF automatically. **Unpaid reservations are "confirmed manually by staff"** (`checkout.js`), so a written confirmation within 15 days is a staff duty until it is automated. **Code defect found and fixed 2026-09-16** (with a regression test): the Resend fallback in `zoho-middleware/lib/mailer.js` signed off with the old **38021 Cleveland Ave** address; both confirmation bodies now use 11-38918 Progress Way and carry the appointment, the estimate and the pickup line.

**Consequence of getting it wrong (s.18.4):** a reservation becomes cancellable for a year, and a goods order for 7 days after the copy arrives, with a full refund within 15 days and no fee. That is the business case for the build items above.

## Business facts these drafts are built on (verified 2026-09-16)
- **Address:** 11-38918 Progress Way, Squamish, BC V8B 0K7 · **Contact:** hello@steinsandvines.ca · 604-567-4565
- **What is sold online:** U-Brew / U-Vin ferment-on-premises **reservations** (a service performed over several weeks), **physical goods** for in-store collection (kits, ingredients, additives, grains, hops, yeast, packaging, equipment), **custom labels**, and **gift cards**. Beer is booked through a **waitlist**, not sold directly.
- **Payments:** **Helcim** (hosted checkout + in-store terminal). Card numbers never touch Steins & Vines servers.
- **Processors:** Google (Apps Script / Sheets, reCAPTCHA, Fonts, GA4, Ads), Zoho (Books / Inventory / Bookings), Helcim, MailerLite (waitlist list), Railway (middleware), Sentry (errors, scrubbed), Meta Pixel, Metricool, Behold (Instagram feed).
