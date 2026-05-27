# Phase 6: Kiosk-to-Brewpad Integration - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-03
**Phase:** 06-kiosk-to-brewpad-integration
**Areas discussed:** Trigger mechanism, Missing required fields, Customer data source, From-kiosk indicator

---

## Trigger Mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Middleware calls Apps Script | After successful Zoho invoice creation, middleware POSTs to Apps Script to create the batch immediately | ✓ |
| BrewPad polls for new sales | BrewPad periodically checks middleware or Zoho for recent kit sales without a matching batch | |
| You decide | Let Claude pick the best approach | |

**User's choice:** Middleware calls Apps Script
**Notes:** Uses existing APPS_SCRIPT_URL + APPS_SCRIPT_SERVER_TOKEN

| Option | Description | Selected |
|--------|-------------|----------|
| Log and retry later | Store pending batch creation in Redis, retry on schedule | ✓ |
| Log and alert staff | Sale succeeds, staff gets notification to create manually | |
| Fire-and-forget | Best-effort call, staff notices missing batch | |

**User's choice:** Log and retry later

| Option | Description | Selected |
|--------|-------------|----------|
| All kit sales | Every item with _item_type 'kit' gets a batch | |
| Only ferment-in-store kits | Filter by KIT_CATEGORIES | |
| (Free text) | Only for kits sold that have the makers fee sold with it | ✓ |

**User's choice:** Only kits sold with Maker's Fee — the Maker's Fee line item is the signal.

| Option | Description | Selected |
|--------|-------------|----------|
| One batch per kit item | 2 kits = 2 batches, each tracks one fermentation | ✓ |
| One batch per sale | Single batch for the entire sale | |

**User's choice:** One batch per kit item

---

## Missing Required Fields

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — pending state | Create batch immediately without schedule, status 'pending' | ✓ |
| Defer creation entirely | Store as queue item, staff must action | |
| Auto-assign default schedule | Pick schedule by product category | |

**User's choice:** Pending state — batch appears immediately

| Option | Description | Selected |
|--------|-------------|----------|
| Make schedule optional | Modify createBatch to accept optional schedule_id/start_date | ✓ |
| New action: create_pending_batch | Separate Apps Script action for kiosk batches | |

**User's choice:** Make schedule optional — single code path

| Option | Description | Selected |
|--------|-------------|----------|
| Main list with 'Pending' badge | Pending batches in regular list with status badge | ✓ |
| Separate queue/tab | New 'Needs Setup' section | |

**User's choice:** Main list with badge

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — auto-suggest | Pre-select schedule based on product category | |
| No — manual pick | Full dropdown, no pre-selection | ✓ |

**User's choice:** No auto-suggest — staff always explicitly chooses

---

## Customer Data Source

| Option | Description | Selected |
|--------|-------------|----------|
| Zoho sales order | Use SO's customer_name and customer_id (canonical source) | ✓ |
| Kiosk cart/checkout data | Use what customer typed at kiosk | |
| You decide | Let Claude pick | |

**User's choice:** Zoho sales order — canonical source

| Option | Description | Selected |
|--------|-------------|----------|
| Name + ID only | Less PII in Sheets, email looked up from Zoho if needed | ✓ |
| Name + ID + email | Also store email for convenience | |

**User's choice:** Name + ID only — reduces PII in Sheets

---

## From-Kiosk Indicator

| Option | Description | Selected |
|--------|-------------|----------|
| Source field + badge | New 'source' column in Batches sheet, colored badge in list | ✓ |
| Status prefix | Encode source in status string | |
| Icon only | Small icon, minimal visual footprint | |

**User's choice:** Source field + badge

| Option | Description | Selected |
|--------|-------------|----------|
| In the list row | SO number visible at a glance | |
| Detail view only | SO number only in batch detail | ✓ |

**User's choice:** Detail view only — keeps list clean

| Option | Description | Selected |
|--------|-------------|----------|
| Always visible | Badge persists forever | |
| Only while pending | Badge disappears once batch goes active | ✓ |

**User's choice:** Only while pending

---

## Claude's Discretion

- Retry mechanism details (Redis key structure, retry interval, max attempts)
- How to detect Maker's Fee in sale line items (by SKU, name pattern, or item type)
- Exact placement and styling of the "Kiosk" badge

## Deferred Ideas

None — discussion stayed within phase scope.
