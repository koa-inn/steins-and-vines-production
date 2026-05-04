---
title: First-batch promo decisions
date: 2026-05-03
context: Explored during /gsd-explore session — planning a 20% first-batch discount promotion
---

## Decisions

- **Promo code:** `FIRSTBATCH` — displayed on homepage banner, customer types it at checkout
- **Discount:** 20% off kit line items
- **Enforcement:** Soft — honour system, but one redemption per email address
- **Redemption check:** Middleware + Redis (not Google Sheets, not Zoho order history)
- **No account requirement:** Customer just needs to enter email at checkout (already collected)
- **In-store reality:** Customers come in person to make their kit, so outright abuse is socially awkward
- **Not checking:** Whether customer is truly "new" — only whether this email has used the code before

## Rejected Alternatives

- **Hard enforcement (Zoho order history lookup):** Too complex for launch, adds API calls and edge cases (different email = bypass anyway). Saved as a seed for future upgrade if abuse becomes noticeable.
- **Auto-apply via URL parameter:** Simpler UX but more to build. Went with manual code entry — feels more like a traditional promo.
