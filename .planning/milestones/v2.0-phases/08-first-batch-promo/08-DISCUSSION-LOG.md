# Phase 8: First-Batch Promo - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-03
**Phase:** 8-first-batch-promo
**Areas discussed:** Banner placement and design, Promo code input UX, Redemption enforcement, Scope of kit line items

---

## Banner Placement and Design

| Option | Description | Selected |
|--------|-------------|----------|
| Full-width hero banner | A bold strip above or below the hero section — high visibility, hard to miss | ✓ |
| Inside promo-news section | Pinned/highlighted item in existing promo-news carousel. Reuses content system. | |
| Sticky top bar | Thin persistent bar at top of page, dismissible with X | |

**User's choice:** Full-width hero banner
**Notes:** None

---

| Option | Description | Selected |
|--------|-------------|----------|
| Always visible | Banner stays on page as long as promo is active. No dismiss button. | |
| Dismissible with memory | Shows X button. Once dismissed, stores in localStorage so it doesn't reappear. | ✓ |
| You decide | Claude picks simpler approach | |

**User's choice:** Dismissible with memory
**Notes:** None

---

| Option | Description | Selected |
|--------|-------------|----------|
| JSON-driven | promo-banner object in content/home.json with text, code, enabled flag | ✓ |
| Hardcoded in HTML | Banner markup in index.html directly | |
| You decide | Claude picks based on existing patterns | |

**User's choice:** JSON-driven (Recommended)
**Notes:** None

---

| Option | Description | Selected |
|--------|-------------|----------|
| Homepage only | Banner on index.html only | |
| Homepage + products page | Same banner on both pages | |
| You decide | Claude picks based on conversion funnel | ✓ |

**User's choice:** You decide
**Notes:** Claude has discretion on whether to show on products page too.

---

## Promo Code Input UX

| Option | Description | Selected |
|--------|-------------|----------|
| Above order summary | Collapsible 'Have a promo code?' link above line items | |
| Below order summary | After user sees total, before payment button | |
| You decide | Claude picks based on existing checkout layout | ✓ |

**User's choice:** You decide
**Notes:** Claude has discretion on exact placement.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Apply button | User types code, clicks Apply. Immediate server validation. Shows discount preview or error. | ✓ |
| On form submit | Code sent with full checkout payload, validated during processCheckout | |
| You decide | Claude picks best UX approach | |

**User's choice:** Apply button (Recommended)
**Notes:** None

---

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, removable | Small 'x' or 'Remove' link next to applied code | ✓ |
| No, locked once applied | Discount stays, user refreshes to start over | |
| You decide | Claude picks simpler approach | |

**User's choice:** Yes, removable
**Notes:** None

---

| Option | Description | Selected |
|--------|-------------|----------|
| Online checkout only | Promo for new online customers. Kiosk has its own discount system. | |
| Both online and kiosk | Staff could enter FIRSTBATCH on kiosk too | |
| You decide | Claude picks based on target audience | |

**User's choice:** (Free text) "We already have a discount system built in to that, if they could be connected that would be cool"
**Notes:** User wants FIRSTBATCH to integrate with the existing kiosk discount presets system.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-appear as a preset | FIRSTBATCH shows in kiosk discount preset list, staff taps it | |
| Separate code input on kiosk | Small 'Promo code' field separate from presets | |
| You decide | Claude picks approach that integrates cleanly | ✓ |

**User's choice:** You decide
**Notes:** Claude has discretion on kiosk integration approach.

---

## Redemption Enforcement

| Option | Description | Selected |
|--------|-------------|----------|
| At code validation | Apply endpoint requires email. Code validated AND email checked in same call. | ✓ |
| At payment/checkout submit | Code validated without email on Apply. Email check at final submit. | |
| You decide | Claude picks to avoid surprising customer | |

**User's choice:** At code validation (Recommended)
**Notes:** Email field must be filled before Apply button works.

---

| Option | Description | Selected |
|--------|-------------|----------|
| On successful payment | Email marked 'used' only after payment completes. Abandoned checkouts don't burn code. | ✓ |
| On code apply | Email marked used immediately on Apply. Abandoned checkouts burn code. | |
| You decide | Claude picks fairest approach | |

**User's choice:** On successful payment (Recommended)
**Notes:** None

---

| Option | Description | Selected |
|--------|-------------|----------|
| No expiry — toggle via JSON | Promo runs until enabled=false in content/home.json | ✓ |
| Configurable expiry date | Middleware rejects code after date | |
| You decide | Claude picks for operational simplicity | |

**User's choice:** No expiry — toggle via JSON
**Notes:** None

---

| Option | Description | Selected |
|--------|-------------|----------|
| No admin UI — Redis CLI | Check/reset via Redis CLI on Railway | |
| Simple admin endpoint | GET /api/promo/redemptions + DELETE endpoint | |
| You decide | Claude picks minimum viable approach | ✓ |

**User's choice:** You decide
**Notes:** Claude has discretion on admin tooling approach.

---

## Scope of Kit Line Items

| Option | Description | Selected |
|--------|-------------|----------|
| Kit product only | 20% off kit price. Maker's Fee stays full price. | |
| Kit + Maker's Fee | 20% off both kit and Maker's Fee. More generous for first-timers. | ✓ |
| You decide | Claude picks based on business sense | |

**User's choice:** Kit + Maker's Fee
**Notes:** None

---

| Option | Description | Selected |
|--------|-------------|----------|
| All kits in the cart | Every kit + Maker's Fee gets 20% off | ✓ |
| First/cheapest kit only | Discount on one kit, rest full price | |
| You decide | Claude picks based on promo behavior | |

**User's choice:** All kits in the cart
**Notes:** None

---

| Option | Description | Selected |
|--------|-------------|----------|
| Kits + Maker's Fee only | Ingredients/supplies full price. Promo is about ferment-in-store. | ✓ |
| Everything in cart | 20% off entire order including ingredients | |
| You decide | Claude picks based on 'first batch' intent | |

**User's choice:** Kits + Maker's Fee only (Recommended)
**Notes:** None

---

## Claude's Discretion

- Banner on products page (in addition to homepage)
- Promo code field placement in checkout layout
- Kiosk integration approach (preset vs. code input)
- Admin tooling for viewing/resetting redemptions

## Deferred Ideas

None — discussion stayed within phase scope.
