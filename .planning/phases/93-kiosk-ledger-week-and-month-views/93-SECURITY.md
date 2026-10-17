---
phase: 93
slug: kiosk-ledger-week-and-month-views
status: verified
threats_open: 0
asvs_level: 1
created: 2026-10-17
---

# Phase 93 — Security

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| kiosk client -> /api/kiosk/past-sales/range | Query params type/date/bust, gated by requireTiers | Sales counts and totals per day |
| middleware -> Zoho Books | Read-only GET, hard page caps | Invoices, customer payments |
| server JSON -> kiosk DOM | Server strings rendered via innerHTML | Date and amount strings |

## Threat Register

| Threat ID | Disposition | Evidence | Status |
|-----------|-------------|----------|--------|
| T-93-01 | mitigate | lib/kiosk-history.js:307 needsPaymentNotes derived from classify | closed |
| T-93-02 | mitigate | lib/kiosk-history.js:301,312 invoiceBelongsToDay and paymentInDayWindow filters in ledgerRowsForDay | closed |
| T-93-03 | accept | route validates date before periodBounds (routes/kiosk-history.js range handler) | closed |
| T-93-04 | mitigate | routes/kiosk-history.js gate() uses requireTiers; authTiers.js:71 exact KIOSK_ROUTES entry. Staging smoke 401/403 | closed |
| T-93-05 | mitigate | RANGE_MAX_*_PAGES = 5 constants; handler reads only type, date, bust | closed |
| T-93-06 | mitigate | BUST_MIN_INTERVAL_MS throttle, inflight dedupe, key uses bounds.start | closed |
| T-93-07 | mitigate | buildRange returns only day count/total/partial and aggregates, no invoice rows | closed |
| T-93-08 | mitigate | key = RANGE_PREFIX + whitelisted type + ':' + server-derived bounds.start | closed |
| T-93-09 | mitigate | only router.get in file, no Zoho write calls (grep clean) | closed |
| T-93-10 | mitigate | log.error uses errMessage(err) only | closed |
| T-93-SC | accept | no packages installed | closed |
| T-93-11 | mitigate | kiosk-core.js:4758-4783 escapeHTML on all range output; XSS test range.test.js:289 | closed |
| T-93-12 | mitigate | kioskPastSalesClear (4525) resets _kioskPsRange/_kioskPsOrigin, bumps _kioskPsGen | closed |
| T-93-13 | mitigate | shared _kioskPsLedgerSeq checked at 4723, 4862 | closed |
| T-93-14 | accept | existing fetch/auth path | closed |
| T-93-15 | mitigate | kioskPastSalesClear resets origin and hides backlink | closed |
| T-93-16 | mitigate | seq bumped in kioskPsBackToRange (4826) and drill-in loader (4856) | closed |
| T-93-17 | mitigate | fixed back-link text (4817), data-date escaped (4775) | closed |
| T-93-18 | accept | refresh spam bounded by server bust throttle | closed |
| T-93-19 | mitigate | 93-05-SUMMARY staging smoke: range week/month 401 no credential, 403 wrong token | closed |
| T-93-20 | mitigate | 93-05-SUMMARY: no real device token used | closed |
| T-93-21 | mitigate | production/main still ff3239cf (git log) | closed |
| T-93-22 | mitigate | git diff 9ba208ef..HEAD on *.html shows no content-security-policy change | closed |
| T-93-06-01 | mitigate | only --zero boolean class; escaping intact; XSS test present | closed |
| T-93-06-02 | accept | partial-day drill-in uses existing gated /ledger | closed |
| T-93-06-03 | mitigate | kiosk-core.js:4699-4710 disables prev/next while no valid payload; drill test A | closed |
| T-93-06-04 | mitigate | origin/main 003342e0, production/main ff3239cf | closed |
| T-93-06-05 | mitigate | links.html modified but unstaged (git diff --cached empty); SUMMARY cmp check | closed |

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-93-01 | T-93-03 | periodBounds malformed input unreachable; route validates first | plan 93-01 | 2026-10-17 |
| AR-93-02 | T-93-SC | no packages installed | plan 93-02 | 2026-10-17 |
| AR-93-03 | T-93-14 | reuses existing fetch/auth path | plan 93-03 | 2026-10-17 |
| AR-93-04 | T-93-18 | refresh spam bounded by server bust throttle | plan 93-04 | 2026-10-17 |
| AR-93-05 | T-93-06-02 | drill-in uses existing gated /ledger | plan 93-06 | 2026-10-17 |

## Unregistered Flags

None (no Threat Flags sections with unmapped surface).

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-10-17 | 27 | 27 | 0 | gsd-security-auditor |

## Sign-Off

- [x] All threats have a disposition
- [x] Accepted risks documented
- [x] threats_open: 0 confirmed
- [x] status: verified

**Approval:** verified 2026-10-17
