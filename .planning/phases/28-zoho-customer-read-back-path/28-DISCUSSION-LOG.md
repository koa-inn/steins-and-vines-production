# Phase 28: Zoho Customer Read-Back Path - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-11
**Phase:** 28-Zoho Customer Read-Back Path
**Areas discussed:** Refreshed field set, Lookup & email source, Write-back architecture, Not-found/error contract

---

## Refreshed field set

| Option | Description | Selected |
|--------|-------------|----------|
| Name + email + phone (Recommended) | customer_name, customer_email, customer_phone — matches roadmap wording and the columns BrewPad already displays | ✓ |
| Also first/last name | Plus customer_firstname/customer_lastname for consistency with separate sheet columns | |
| Also customer_id | Plus re-stamping customer_id in case the invoice was reassigned in Zoho | |

**User's choice:** Name + email + phone

| Option | Description | Selected |
|--------|-------------|----------|
| Preserve existing (Recommended) | Blank Zoho values are skipped — refresh never erases existing batch data | ✓ |
| Overwrite with blank | Zoho mirrored exactly, including clearing fields | |
| You decide | Claude picks during planning | |

**User's choice:** Preserve existing

| Option | Description | Selected |
|--------|-------------|----------|
| Lean payload (Recommended) | Writable fields plus customer_id and resolved number for traceability | ✓ |
| Rich payload | Also invoice status, date, total for richer Phase 29 preview | |
| You decide | Planner picks based on Phase 29 modal needs | |

**User's choice:** Lean payload

| Option | Description | Selected |
|--------|-------------|----------|
| Phone, fallback mobile (Recommended) | Contact's phone field, mobile when blank | ✓ |
| Mobile, fallback phone | Prefer mobile for reachability | |
| You decide | Claude checks what kiosk/checkout populate today | |

**User's choice:** Phone, fallback mobile

---

## Lookup & email source

| Option | Description | Selected |
|--------|-------------|----------|
| Both, by prefix (Recommended) | INV- → /invoices, SO- → /salesorders | ✓ |
| Invoices only | Simplest, but SO-linked batches get not-found | |
| Try invoice, fallback SO | Tolerant but costs an extra Zoho call | |

**User's choice:** Both, by prefix

| Option | Description | Selected |
|--------|-------------|----------|
| Contact, fallback persons (Recommended) | Top-level email, fall back to primary contact_persons email (INV-000078 pattern) | ✓ |
| Top-level contact only | Simpler but misses contact_persons-only emails | |
| Persons first | Prefer contact_person email, fall back to top-level | |

**User's choice:** Contact, fallback persons

| Option | Description | Selected |
|--------|-------------|----------|
| Exact number filter (Recommended) | invoice_number= / salesorder_number= exact-match query | ✓ |
| search_text like Phase 7 | Fuzzy search with client-side exact filtering | |
| You decide | Planner verifies Zoho param support | |

**User's choice:** Exact number filter

| Option | Description | Selected |
|--------|-------------|----------|
| Invoice customer_name (Recommended) | Straight off the resolved document, consistent with kiosk stamping | ✓ |
| Contact person name | Built from contact first+last, more parsing edge cases | |
| You decide | Planner keeps consistent with kiosk flow | |

**User's choice:** Invoice customer_name

---

## Write-back architecture

| Option | Description | Selected |
|--------|-------------|----------|
| Extend update_batch (Recommended) | Add customer_email + customer_phone to allowedFields — mirrors Phase 27 start_date | ✓ |
| Dedicated refresh action | New refresh_customer action, tighter but duplicative | |
| You decide | Planner picks after reviewing Phase 29 call shape | |

**User's choice:** Extend update_batch

| Option | Description | Selected |
|--------|-------------|----------|
| Frontend two-call (Recommended) | Browser calls middleware read, then Apps Script update — matches existing patterns | ✓ |
| Middleware orchestrates | One endpoint reads Zoho and posts to Apps Script server-side | |
| You decide | Planner weighs preview-before-apply needs | |

**User's choice:** Frontend two-call

| Option | Description | Selected |
|--------|-------------|----------|
| Always live + rate limit (Recommended) | No caching; guard quota with existing rl:* rate-limit pattern | ✓ |
| Short cache (1–5 min) | Absorbs double-clicks but stale right after a Zoho edit | |
| You decide | Planner does the quota math | |

**User's choice:** Always live + rate limit

| Option | Description | Selected |
|--------|-------------|----------|
| Manual curl/console (Recommended) | Verify staging loop by hand for one known linked batch | ✓ |
| Small verify script | Repeatable one-off script like Phase 20's | |
| You decide | Executor picks at verification time | |

**User's choice:** Manual curl/console

---

## Not-found/error contract

| Option | Description | Selected |
|--------|-------------|----------|
| Three states (Recommended) | 404 not_found, 502 zoho_error, 200 partial when contact details incomplete | ✓ |
| Two states | Found vs not — can't distinguish wrong number from Zoho down | |
| Four+ states | Also voided/multiple-match as distinct codes | |

**User's choice:** Three states

| Option | Description | Selected |
|--------|-------------|----------|
| Return with status flag (Recommended) | Voided docs still return details + Zoho status in payload | ✓ |
| Treat as not-found | Stricter; blocks refresh for voided-and-reissued sales | |
| You decide | Planner checks how Zoho reports voided invoices | |

**User's choice:** Return with status flag

| Option | Description | Selected |
|--------|-------------|----------|
| Partial 200 (Recommended) | Name from document, email/phone null, contact_unavailable flag | ✓ |
| Fail whole request | All-or-nothing 502; deleted contact would block name refresh forever | |
| You decide | Planner checks withRetry behavior | |

**User's choice:** Partial 200

| Option | Description | Selected |
|--------|-------------|----------|
| Validate format (Recommended) | 400 invalid_number for non-INV-/SO- inputs, fail fast | ✓ |
| Pass anything through | Let Zoho decide, tolerant of future formats | |
| You decide | Planner checks formats present in the Batches sheet | |

**User's choice:** Validate format

---

## Claude's Discretion

- Endpoint route name/shape and routes-file placement (follow `/api/batch/*` conventions in pos.js)
- Auth via existing `x-api-key` pattern; exact rate-limit threshold
- Exact number-validation regex (check formats actually in the Batches sheet)
- Response JSON field names within the agreed semantics
- Test structure/fixtures per existing middleware Jest patterns

## Deferred Ideas

None — discussion stayed within phase scope. Manual SO-linking and background re-sync were already deferred in REQUIREMENTS.md; customer reassignment is Phase 29.1.
