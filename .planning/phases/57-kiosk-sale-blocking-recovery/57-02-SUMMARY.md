---
phase: 57-kiosk-sale-blocking-recovery
plan: 02
status: complete
completed: 2026-07-15
requirements: [REVIEW-01]
commits: [012ed5f6]
---

# 57-02 Summary — Live diagnosis of the "refresh to sell" kiosk error

## What this plan delivered

The blocking diagnosis gate that unblocks the whole fix half of the phase.
`57-DIAGNOSIS.md` (committed `012ed5f6`) records the **confirmed, evidence-backed
root cause** of the recurring kiosk sale-blocker, written before a single line of fix —
satisfying Phase 57 SC#2 (real cause diagnosed from a captured occurrence, not inferred).

**Confirmed cause (one line):** the kiosk client holds a STALE catalog containing a
phantom item (`1099000000000109115`) that no longer exists in Zoho; the server's
price-anchoring guard (`zoho-middleware/routes/pos.js:325-332`) correctly hard-rejects
the sale with `400 "Item not found in current catalog… Refresh the product list"`; the
only recovery today is a manual product-list refresh. This is **none of the four planned
hypotheses** (h1-auth / h2-wake / h3-surface / h4-server) — it is a fifth branch,
**h5-stale-catalog**.

## How the occurrence was captured

- 57-01 was deployed to the prod middleware + live kiosk (STATE: 57-01 live on prod).
- The occurrence was captured by the **owner reproducing the failure live at the shop
  and photographing the exact error** — an observed real-world occurrence (SC#2 permits
  "forced on the iPad OR observed in the wild"), traced end-to-end against source + live
  Zoho (`get_item` returns `1002 "not available"` for the offending id).

## Deviation from plan (honest note)

The plan's must_haves anticipated the **beacon** would capture the occurrence. It did
NOT, for two independent reasons the diagnosis documents and feeds forward:

1. **Wrong code path.** The error is a server 400 handled in the sale-result `.then`
   branch (`kiosk-core.js:2745`), not the network-`.catch` sites 57-01 wired. 57-01
   explicitly deferred the non-ok-HTTP-on-sale case.
2. **PAN-redaction collision.** The beacon redacts any 13–19-digit run as `[REDACTED]`;
   the 19-digit item_id would have been destroyed had the beacon fired — losing the one
   field that made the diagnosis possible.

Both findings are explicit remediation items carried into Wave 3: 57-03 extends the
beacon to the sale server-error branch, and 57-04 stores a validated item_id
un-redacted. So the beacon miss is captured as fix work, not lost.

## Prescribed fix (hands off to Wave 3)

- **57-03 (client):** stale-catalog self-heal on wake/staleness + pre-checkout phantom
  guard + beacon the sale server-error branch with a readable item_id.
- **57-04 (server):** bounded catalog auto-reconcile on a sale catalog-miss (variant 1 —
  an item that still exists in Zoho but is missing from the stale server cache), forcing
  ONE `?bust` rebuild + re-check before rejecting; keeps price-anchoring intact; a
  genuinely-invalid/phantom item still (correctly) rejects.

## Close-out note

This SUMMARY was authored during `/gsd-execute-phase` to formally close the checkpoint:
the diagnosis work and its commit were completed in a prior session, but the plan's
SUMMARY.md was never written, leaving the plan flagged incomplete and blocking Wave 3.
No new investigation was performed here — this records the already-committed outcome.
SC#4 (live-iPad verification of the FIX) remains 57-05's job, unchanged.
