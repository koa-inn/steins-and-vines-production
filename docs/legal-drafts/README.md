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

## Facts closed from the code on 2026-09-16
- Checkout collects name, email, phone, and notes only. No address, no date of birth.
- Sentry scrubs personal data before sending (`zoho-middleware/lib/sentry-scrub.js`).
- Helcim is the only payment processor in use. Global Payments remains a package dependency and is named in `CLAUDE.md`, but nothing in the runtime calls it — worth removing separately.
- **Added to the drafts because the code does it:** Google reCAPTCHA v3 on checkout; the beer waitlist and its **MailerLite** sync (a CASL consent point).
- Not present on the site today: any age gate, any cookie-consent notice.

## Still open — owner decisions
- Registered legal entity name (Terms preamble; every policy).
- No-show handling for sessions never started.
- Satisfaction Guarantee: the fraction of product that must be returned; whether beer recipes are covered as well as wine kits; whether a different kit may be chosen for the replacement.
- Equipment returns: change-of-mind within a window, or quality-issue only.
- Return/claim window for quality issues (30 days proposed) and whether refunds carry a restocking fee (none proposed).
- Gift-card and custom-label terms (standard wording proposed).
- Refund method and timing (original payment method within 10 business days proposed; cash refunded in cash).
- Packaging window after the batch is ready, and what happens to batches not packaged in time.
- Uncollected-order hold period.
- Tax display: inclusive prices or tax added at checkout.
- Data retention periods (defaults proposed) and the named privacy contact.
- Whether a general customer newsletter exists beyond the waitlist list.
- Whether the checkout should carry a 19+ checkbox as well as the in-store ID check (recommended).

## Still open — lawyer or licence checks
- BPCPA Part 4: the pre-purchase disclosure list for future-performance (reservation) and distance-sales (order) contracts, the $10 cancellation fee, and the started-batch rule.
- Limitation-of-liability wording in Terms §10 and Warranty §5.
- PIPA cross-border storage wording.
- Governing-law clause.
- Licence wording for personal use, no resale, and the customer's own participation (pitching yeast, packaging).

## Business facts these drafts are built on (verified 2026-09-16)
- **Address:** 11-38918 Progress Way, Squamish, BC V8B 0K7 · **Contact:** hello@steinsandvines.ca · 604-567-4565
- **What is sold online:** U-Brew / U-Vin ferment-on-premises **reservations** (a service performed over several weeks), **physical goods** for in-store collection (kits, ingredients, additives, grains, hops, yeast, packaging, equipment), **custom labels**, and **gift cards**. Beer is booked through a **waitlist**, not sold directly.
- **Payments:** **Helcim** (hosted checkout + in-store terminal). Card numbers never touch Steins & Vines servers.
- **Processors:** Google (Apps Script / Sheets, reCAPTCHA, Fonts, GA4, Ads), Zoho (Books / Inventory / Bookings), Helcim, MailerLite (waitlist list), Railway (middleware), Sentry (errors, scrubbed), Meta Pixel, Metricool, Behold (Instagram feed).
