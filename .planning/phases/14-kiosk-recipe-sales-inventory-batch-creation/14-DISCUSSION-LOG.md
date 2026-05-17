# Phase 14 Discussion Log

**Date:** 2026-05-17
**Areas discussed:** 4

## Area 1: Kiosk Recipe Selection UX

**Options presented:**
- A) New "Recipes" tab alongside product grid — recipe cards with name, style, ABV, price
- B) Recipes mixed into existing product grid
- C) Simple list/dropdown

**User selected:** A — dedicated Recipes tab with cards

## Area 2: Ingredient Reservation & Race Conditions

**Options presented:**
- A) Simple mutex — one recipe sale at a time (Redis lock, ~30 sec TTL)
- B) Per-ingredient atomic decrement via Redis
- C) No reservation — rely on Zoho stock check at confirm time

**User selected:** A — simple mutex fits single-location reality

## Area 3: Invoice Line Item Structure

**Options presented:**
- A) One line item per ingredient + one for brewing fee
- B) Single "recipe" line item at locked_price + separate fee
- C) Hybrid grouped display

**User selected:** A — per-ingredient lines for natural stock deduction

**Follow-up decision:** User added in-store vs take-out prompt:
- In-store: brewing fee + materials fee, batch created
- Take-out: no brewing/materials fee, optional milling fee (existing Zoho service), no batch
- Locked_price is customer-facing total, invoice itemizes at ingredient rates + fee

## Area 4: Batch Auto-Creation Timing

**Options presented:**
- A) Fire-and-forget after payment
- B) Synchronous before confirming
- C) Queue with retry

**User selected:** A — same pattern as existing kit batch detection

**Follow-up:** Customer info comes from existing kiosk customer linkage. No extra input needed.
