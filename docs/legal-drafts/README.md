# Legal Policy Drafts — REVIEW REQUIRED (not live)

**Status:** DRAFT, **second pass** 2026-09-16. First pass generated 2026-08-13 to satisfy the Consumer Protection BC disclosure items raised in the merchant review. **These are NOT published to the website** and **NOT legal advice.** They are starting-point content for the owner and a qualified BC lawyer to review, correct, and finalize before anything is wired into the site.

The review copy for the owner and lawyer is the artifact at https://claude.ai/artifact/3rHihfkXGb4NqaiyZapumv (same content, republished 2026-09-16).

## The four documents
1. `privacy-policy.md`
2. `terms-and-conditions.md`
3. `refund-return-cancellation.md`
4. `warranty.md`

## How to use this
- Anything in **`[CONFIRM: …]`** is a decision only the owner or a lawyer can make. Every one must be resolved before publishing; do not ship a policy with a bracket left in it. Markers tagged **(lawyer)** or **(licence)** are wording checks, not business decisions.
- Facts filled in from the site were re-verified against the code on 2026-09-16.
- Once the content is finalized, a follow-up build phase scaffolds these as real site pages (matching the existing template + CSP + build), adds footer/nav links site-wide, adds the 19+ / terms acknowledgement checkbox to checkout, adds the cookie-consent notice and gates the GTM tags on it, adds the reCAPTCHA notice near the checkout form, and adds CASL consent wording to the waitlist form. That build is separate from this content review.

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
- BPCPA Part 4: the pre-purchase disclosure list for future-performance (reservation) and distance-sales (order) contracts, the $10 cancellation fee, and the started-batch rule.
- Limitation-of-liability wording in Terms §10 and Warranty §5.
- PIPA cross-border storage wording.
- Governing-law clause.
- Age-check wording in Terms §1 (refusing a session for missing ID and treating it as a cancellation).

## Business facts these drafts are built on (verified 2026-09-16)
- **Address:** 11-38918 Progress Way, Squamish, BC V8B 0K7 · **Contact:** hello@steinsandvines.ca · 604-567-4565
- **What is sold online:** U-Brew / U-Vin ferment-on-premises **reservations** (a service performed over several weeks), **physical goods** for in-store collection (kits, ingredients, additives, grains, hops, yeast, packaging, equipment), **custom labels**, and **gift cards**. Beer is booked through a **waitlist**, not sold directly.
- **Payments:** **Helcim** (hosted checkout + in-store terminal). Card numbers never touch Steins & Vines servers.
- **Processors:** Google (Apps Script / Sheets, reCAPTCHA, Fonts, GA4, Ads), Zoho (Books / Inventory / Bookings), Helcim, MailerLite (waitlist list), Railway (middleware), Sentry (errors, scrubbed), Meta Pixel, Metricool, Behold (Instagram feed).
