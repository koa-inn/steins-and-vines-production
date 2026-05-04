# Requirements: Brewpad Reliability & Integration

**Defined:** 2026-04-29
**Core Value:** Staff can trust BrewPad to save their work and see the full journey from kit sale to finished batch.

## v1.1 Requirements

Requirements for this milestone. Each maps to roadmap phases.

### Auth Reliability

- [x] **AUTH-01**: Staff session persists for at least 7 days without re-login
- [x] **AUTH-02**: If a token expires mid-session, form data is preserved through the refresh flow
- [x] **AUTH-03**: Only one login prompt appears at a time (no stacked/duplicate auth dialogs)
- [x] **AUTH-04**: Staff sees a clear warning before session expires with option to extend

### Kiosk Integration

- [ ] **INTG-01**: When a kit is sold on the kiosk, a batch is auto-created in BrewPad with customer name, product, and SO reference
- [x] **INTG-02**: Auto-created batches appear in the BrewPad batch list with a "from kiosk" indicator
- [x] **INTG-03**: Batch detail view shows the linked sales order number with a reference back to Zoho

### Zoho Audit Trail

- [ ] **ZOHO-01**: Batch stores its originating Zoho SO number and customer ID
- [ ] **ZOHO-02**: Zoho sales order shows linked batch status (active/complete) via custom field or note
- [ ] **ZOHO-03**: Staff can view the full audit trail: sale → batch → fermentation progress → completion

### First-Batch Promo

- [ ] **PROMO-01**: Homepage displays a prominent banner advertising 20% off first batch with promo code FIRSTBATCH
- [ ] **PROMO-02**: Checkout flow accepts a promo code input field and applies 20% discount to kit line items when valid
- [ ] **PROMO-03**: Middleware validates promo code and enforces one redemption per email address via Redis

### Content & SEO Push

- [ ] **SEO-01**: Ferment-in-store and ingredients/supplies product pages have unique landing page copy with SEO-targeted content
- [ ] **SEO-02**: Professional facility/process photos are added to key pages (homepage, product pages)
- [ ] **SEO-03**: Google Review testimonials displayed on the site with links back to original reviews for authenticity

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
| AUTH-01 | Phase 5 | Complete (05-01) |
| AUTH-02 | Phase 5 | Complete (05-02) |
| AUTH-03 | Phase 5 | Complete (05-01) |
| AUTH-04 | Phase 5 | Complete (05-01) |
| INTG-01 | Phase 6 | Pending |
| INTG-02 | Phase 6 | Complete (06-03) |
| INTG-03 | Phase 6 | Complete (06-03) |
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
