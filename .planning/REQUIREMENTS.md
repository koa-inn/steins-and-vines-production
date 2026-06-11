# Requirements — v4.1 BrewPad Batch Lifecycle & Zoho Sync

## v1 Requirements

### Batch Activation

- [x] **BATCH-01**: Staff can see pending batches in the admin batch list, including a "Pending" option in the status filter
- [x] **BATCH-02**: Staff can activate a pending batch with one click — quick flip to Primary with start date set to today
- [x] **BATCH-03**: Staff can activate a pending batch via a guided flow that sets a fermentation schedule template, start date, and vessel/location before promoting to Primary

### Zoho Sync

- [ ] **ZSYNC-01**: Staff can refresh a batch's customer info (name, email, contact) from its linked Zoho sales order/invoice via a button in the batch detail modal
- [ ] **ZSYNC-02**: When a batch has no Zoho link (`zoho_so_number`), the refresh action is clearly unavailable rather than erroring

## Future Requirements

- Manual SO/contact linking for batches that carry no `zoho_so_number` (attach by SO# or Zoho contact search)
- Automatic/background re-sync of linked batches from Zoho
- Auto-promotion of a pending batch to Primary when a schedule is assigned

## Out of Scope

- Pre-made recipes browsable on public site — deferred to a later milestone
- Custom recipe request flow for customers — deferred
- New batch analytics, refunds, or advanced reporting — out of scope this milestone
- Two-way field-level conflict resolution between BrewPad and Zoho — refresh is Zoho → BrewPad pull only

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| BATCH-01 | Phase 27 | Complete |
| BATCH-02 | Phase 27 | Complete |
| BATCH-03 | Phase 27 | Complete |
| ZSYNC-01 | Phase 29 | Pending |
| ZSYNC-02 | Phase 29 | Pending |

_Phase 28 (Zoho Customer Read-Back Path) is an infrastructure prerequisite for ZSYNC-01/ZSYNC-02; it closes no requirement on its own but is required before Phase 29 can be built._

**Coverage:** 5/5 v4.1 requirements mapped ✓
