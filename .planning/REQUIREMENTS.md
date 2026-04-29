# Requirements: Brewpad Reliability & Integration

**Defined:** 2026-04-29
**Core Value:** Staff can trust BrewPad to save their work and see the full journey from kit sale to finished batch.

## v1.1 Requirements

Requirements for this milestone. Each maps to roadmap phases.

### Auth Reliability

- [ ] **AUTH-01**: Staff session persists for at least 7 days without re-login
- [ ] **AUTH-02**: If a token expires mid-session, form data is preserved through the refresh flow
- [ ] **AUTH-03**: Only one login prompt appears at a time (no stacked/duplicate auth dialogs)
- [ ] **AUTH-04**: Staff sees a clear warning before session expires with option to extend

### Kiosk Integration

- [ ] **INTG-01**: When a kit is sold on the kiosk, a batch is auto-created in BrewPad with customer name, product, and SO reference
- [ ] **INTG-02**: Auto-created batches appear in the BrewPad batch list with a "from kiosk" indicator
- [ ] **INTG-03**: Batch detail view shows the linked sales order number with a reference back to Zoho

### Zoho Audit Trail

- [ ] **ZOHO-01**: Batch stores its originating Zoho SO number and customer ID
- [ ] **ZOHO-02**: Zoho sales order shows linked batch status (active/complete) via custom field or note
- [ ] **ZOHO-03**: Staff can view the full audit trail: sale → batch → fermentation progress → completion

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Batch Workflow Enhancements

- **BWF-01**: Batch completion triggers inventory adjustment in Zoho
- **BWF-02**: Automated notifications when batches need attention (overdue tasks, stale readings)
- **BWF-03**: Batch templates pre-populated from fermentation schedules

## Out of Scope

| Feature | Reason |
|---------|--------|
| Brewpad UI redesign | Current UI works; focus is reliability and integration only |
| Online checkout → batch creation | Kiosk-only for now; online checkout is a separate system |
| Refund/void handling in batch context | Future milestone |
| New brewpad tabs or views | Not needed for reliability + integration goals |
| Kiosk UI changes beyond batch handoff | Kiosk milestone is paused pending Helcim webhook fix |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUTH-01 | Phase 5 | Pending |
| AUTH-02 | Phase 5 | Pending |
| AUTH-03 | Phase 5 | Pending |
| AUTH-04 | Phase 5 | Pending |
| INTG-01 | Phase 6 | Pending |
| INTG-02 | Phase 6 | Pending |
| INTG-03 | Phase 6 | Pending |
| ZOHO-01 | Phase 7 | Pending |
| ZOHO-02 | Phase 7 | Pending |
| ZOHO-03 | Phase 7 | Pending |

**Coverage:**
- v1.1 requirements: 10 total
- Mapped to phases: 10
- Unmapped: 0

---
*Requirements defined: 2026-04-29*
*Last updated: 2026-04-29 after roadmap creation*
