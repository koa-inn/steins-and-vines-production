# Phase 53: Discussion Log

**Date:** 2026-07-03
Human-reference record of the discuss-phase session. Not consumed by downstream agents (see 53-CONTEXT.md for the canonical decisions).

## Areas selected for discussion
All four presented gray areas: Lint gate (L12), npm ci + Node pin (L1/L2), Sentry capture scope (M17), Sentry event hygiene (M17).

## Q&A

### Lint gate rollout (L12)
- Options: clear all 60 + gate globally / scope to changed files / ratchet count down.
- **Chosen:** Clear all 60 warnings (own commit), then `--max-warnings 0` globally (frontend + middleware). ES5-only rule targets frontend `js/` only (middleware uses ES2020/await).

### npm ci + Node pin (L1/L2)
- Options: commit lockfiles + pin Node 20 / pin Node 22 LTS / confirm Railway's version first.
- **Chosen:** Commit lockfiles (root + middleware), pin Node 20 via `engines` + `.nvmrc`, switch CI + Railway to `npm ci`. No runtime bump.

### Sentry capture scope (M17)
- Options: money-movement catches + reqId middleware / money-movement + reuse idempotency_key / all catches in money-path files.
- **Chosen:** Money-movement catches only + a request-id middleware for `reqId`.

### Sentry event hygiene (M17)
- Options: scrub PII + fingerprint by error type / scrub PII no fingerprint / scrub PII + void failures as fatal.
- **Chosen:** `beforeSend` PII scrub + fingerprint by error type; safe ids only in tags; `level=error` uniform (void already pages via staff email).

## Deferred
- BL-M22 (dual-cart overcharge durable manual-review record) — v2 backlog, "best done with OBS-01" per audit but not in scope.
- Sentry coverage of non-money-path catches — out of scope.

## Claude's discretion (noted in CONTEXT.md)
Exact eslint ES5 mechanism; request-id middleware impl; Sentry fingerprint keys; exact pos.js floor value.
