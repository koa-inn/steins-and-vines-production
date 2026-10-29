# Phase 100: Limited Releases page and online deposits - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md. This log keeps the alternatives that were considered.

**Date:** 2026-10-29
**Phase:** 100-limited-releases-page-and-online-deposits
**Areas discussed:** Deposit booking & brew day, Launch policy decisions, Reservation basket & form, Contact & spam protection

---

## Deposit booking & brew day

Code scout finding presented first: the spec's `salesorders_to_apply` booking is banned in
`lib/money-path.js` and in three test files, and the kiosk SO-pay path charges `so.balance` and
never uses up an advance.

| Option | Description | Selected |
|--------|-------------|----------|
| Advance + fix brew day | Keep the spec's advance as a deliberate exception and change kiosk SO-pay to apply it | ✓ |
| Zoho retainer invoice | Zoho's built-in deposit feature; a new pattern here | |
| Research decides | Compare both, then confirm | |

| Option | Description | Selected |
|--------|-------------|----------|
| Kiosk applies the deposit automatically | No manual step for staff | ✓ |
| Staff apply it by hand in Zoho | Less code; risk of overcharging | |

| Option | Description | Selected |
|--------|-------------|----------|
| Fees on the SO | Kit + Maker's + Materials fees per kit | ✓ |
| Staff add the fees on brew day | Risk of forgetting them | |

| Option | Description | Selected |
|--------|-------------|----------|
| One SO per kit | One charge, one SO per kit unit | ✓ |
| One SO per release month | Fewer SOs | |
| One SO per order | Spec wording; needs partial invoicing | |

**User's choice:** all recommended options.

---

## Launch policy decisions

| Question | Options | Selected |
|---|---|---|
| Supplier failure | Full refund / Offer a swap first | Full refund |
| Hold period | 60 / 30 / 90 days / Decide later | 60 days |
| Switching kits | Staff do it on request / No switching | Staff do it on request |
| LE26 brew weeks | Hide if unknown / Supply now | Hide if unknown |

---

## Reservation basket & form

| Question | Options | Selected |
|---|---|---|
| Picking kits | Stepper on each card / Checklist in the form / Site cart | Stepper on each card |
| Mobile total | Sticky bottom bar / Form summary only | Sticky bottom bar |
| Confirmation | In-page / Separate thank-you page | In-page |
| Scarcity | No counts / Show counts | No counts |

---

## Contact & spam protection

Scout finding: the "Last, First" name fix has still not landed (`buildContactPayload` saves names
as typed).

| Question | Options | Selected |
|---|---|---|
| Contact names | Existing helper as it is / Fix names first in this phase / Separate first and last fields | Existing helper as it is |
| Bot protection | reCAPTCHA v3 like checkout / Rate limit only | reCAPTCHA v3 |
| Newsletter | Optional and unticked, CASL wording / Leave it off | Optional and unticked |

---

## Claude's Discretion

- Card layout within the asset rules, the pairings presentation, the release calendar's form,
  response field names, the staff email layout, and the JSON-LD details.

## Deferred Ideas

- The owner's BrewPad Dashboard v2 note: restore Today's Tasks + Ready to Bottle on the main page
  (todo filed).
- A staff reservation summary in BrewPad, self-serve switching, public reserved counts, and the
  contact-name fix.
