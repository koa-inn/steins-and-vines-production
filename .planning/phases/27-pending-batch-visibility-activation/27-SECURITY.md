---
phase: 27
slug: pending-batch-visibility-activation
status: verified
threats_open: 0
asvs_level: 1
created: 2026-06-11
---

# Phase 27 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Admin browser → adminApi.gs (token-auth) | Authenticated staff issue batch reads and status-flip mutations; existing Apps Script token auth + allowedFields whitelist + sanitizeInput enforce the boundary | Batch records (customer name, product, dates) — internal business data |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-27-01 (p01) | Information Disclosure | getBatches active filter returns pending rows | accept | Pending rows already accessible to authenticated admins via existing filters | closed |
| T-27-02 (p01) | Tampering | #batch-status-filter option value | mitigate | Fixed lowercase literal `pending` client-side; backend exact-matches `status.toLowerCase()` (adminApi.gs:1322-1324) | closed |
| T-27-03 (p02) | Elevation of Privilege | Activate action → update_batch status flip | accept | Reuses existing update_batch action already exposed to authenticated admins; no new endpoint/privilege | closed |
| T-27-04 (p02) | Tampering | Concurrent edit / stale version on Activate | mitigate | expectedVersion passed from inline (admin.js:5734) and modal (admin.js:5924); optimistic lock rejects stale writes with version_conflict (adminApi.gs:2090-2098); conflict surfaced via showToast (admin.js:5742, 5933) | closed |
| T-27-05 (p02) | Tampering | data-version attribute in row HTML | mitigate | Rendered via escapeHTML (admin.js:5686); backend re-validates against sheet — tampered value yields only version_conflict | closed |
| T-27-06 (p03) | Tampering | 'start_date' allowedField in update_batch | mitigate | In allowedFields (adminApi.gs:2164), written via sanitizeInput (adminApi.gs:2170), normalized via toDateOnly (adminApi.gs:2334) | closed |
| T-27-07 (p03) | Tampering | Two-step promote chained version | mitigate | Step-1 lock adminApi.gs:2090-2098; step-2 lock adminApi.gs:2297-2304; frontend chains batch.last_updated (admin.js:7241) then newVersion (admin.js:7250) | closed |
| T-27-08 (p03) | DoS / data integrity | Step 1 succeeds, step 2 schedule fails | accept | Operator-surfaced via explicit toast (admin.js:7270); resulting state identical to supported one-click activation | closed |
| T-27-09 (p03) | Input validation | schedule_snapshot built client-side | mitigate | Sourced from server-provided fermSchedulesData templates (admin.js:7221); backend sanitizeInput on each step title/description (adminApi.gs:2352-2353) | closed |
| T-27-01 (p04) | Tampering | start_date in one-click Activate payload | accept | Field already in server allowlist + sanitizer; todayPacific() is a trusted helper, no new user-input surface (admin.js:5735, 5925) | closed |
| T-27-02 (p04) | Elevation of Privilege | Guided two-step catch reorder | accept | Pure client-side error routing; expectedVersion locking unchanged on both steps; step1Done never relaxes a concurrency check | closed |
| T-27-03 (p04) | Repudiation / Info Disclosure | Partial-success toast copy | accept | Truthful state reporting, no PII, no internal error detail | closed |
| T-27-SC (all) | Tampering | Supply chain / package installs | accept | No new packages installed across all four plans | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-27-01 | T-27-01 (p01) | Pending batches visible in default Active view — same admin trust boundary as existing pending/all filters | plan 27-01 threat model | 2026-06-11 |
| AR-27-02 | T-27-03 (p02) | Activate reuses existing update_batch mutation; no privilege change | plan 27-02 threat model | 2026-06-11 |
| AR-27-03 | T-27-08 (p03) | Active-with-no-schedule partial state is operator-surfaced and identical to supported one-click activation | plan 27-03 threat model | 2026-06-11 |
| AR-27-04 | T-27-01/02/03 (p04) | Gap-closure changes: allowlisted trusted-helper date stamp, lock-preserving error routing, PII-free toast | plan 27-04 threat model | 2026-06-11 |
| AR-27-05 | T-27-SC | No new package installs in any plan | all plans | 2026-06-11 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-06-11 | 13 | 13 | 0 | gsd-security-auditor (sonnet) |

Note: plan 27-04's automated verify expected ≥3 occurrences of `start_date: todayPacific()`; actual correct count is 2 (one per one-click handler, admin.js:5735 and :5925) — plan copy-paste error acknowledged in 27-04-SUMMARY.md, no gap.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-06-11
