# Phase 83: Postgres Infrastructure - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-30
**Phase:** 83-postgres-infrastructure
**Areas discussed:** Database-down behaviour, How the store switch flips, Backfill source & staging data, Local testing & setup

---

## Database-down behaviour

| Option | Description | Selected |
|--------|-------------|----------|
| Required in prod only | validateEnv REQUIRED_IN_PROD; dev/CI can run without | ✓ |
| Required everywhere | Roadmap wording; every dev/CI run needs a DB | |
| Warn only until Phase 84 | Start anyway until gift cards depend on it | |

| Option | Description | Selected |
|--------|-------------|----------|
| Report it, stay 'ok' | /health database:false, status ok, no restart | ✓ |
| Fail /health | Error status; DB blip could fail deploys | |

| Option | Description | Selected |
|--------|-------------|----------|
| Abort deploy, keep old version | Railway pre-deploy migration step | ✓ |
| Migrate at app startup | Crash-loop risk on failure | |
| You decide | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Additive only on deploy | Drops/rewrites manual, backup first | ✓ |
| Allow anything | Rely on review + staging | |

**User's choice:** all recommended options.

---

## How the store switch flips

| Option | Description | Selected |
|--------|-------------|----------|
| Railway env var | Flip = edit variable, ~1 min restart | ✓ |
| Runtime toggle in admin | Instant, but new screen + security review | |

| Option | Description | Selected |
|--------|-------------|----------|
| Refuse to start | Typo never silently misroutes writes | ✓ |
| Fall back to sheets + warn | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Hard-coded, can't be overridden | Mirror no-ops outside production | ✓ |
| Off by default, env override | Allows deliberate staging mirror tests | |

| Option | Description | Selected |
|--------|-------------|----------|
| Generic helper now | Shared compare + Sentry discrepancy reporter | ✓ |
| Per store, when needed | | |
| You decide | | |

**User's choice:** all recommended options.
**Notes:** Claude flagged that staging and prod both run NODE_ENV=production, so the production check needs a reliable Railway environment signal (researcher to verify).

---

## Backfill source & staging data

| Option | Description | Selected |
|--------|-------------|----------|
| You download an .xlsx | Frozen, repeatable; no new credentials | ✓ |
| Pulled automatically via API | Live, can change mid-run; needs credentials | |
| Both | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Your Mac, via a command | npm script against a chosen DATABASE_URL | ✓ |
| One-off Railway job | | |
| You decide | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, full real copy | Fidelity; staging behind Cloudflare Access | ✓ |
| Real copy, PII scrubbed | | |
| Synthetic only | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Reject + report, block promote | | ✓ |
| Reject + report, load the rest | | |

**User's choice:** all recommended options.
**Notes:** Claude added D-13: snapshot/rejects files contain PII — keep out of the repo.

---

## Local testing & setup

| Option | Description | Selected |
|--------|-------------|----------|
| Docker, DB tests skip if it's off | CI always runs them | ✓ |
| Docker required for npm test | | |
| Homebrew Postgres instead | | |

| Option | Description | Selected |
|--------|-------------|----------|
| You, in the dashboard, guided | Paid add-on, owner's call; checklist step | ✓ |
| Scripted via Railway CLI | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Confirm now, drill in Phase 88 | | ✓ |
| Leave it all to Phase 88 | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Ship when done | Empty DB/health/migrations live early | ✓ |
| Hold for Phase 84 | | |

**User's choice:** all recommended options.

---

## Claude's Discretion

- Module/file layout, scratch schema and migration naming, normalisation order details, backfill CLI shape.

## Deferred Ideas

- Fail /health on DB outage — revisit in Phase 84.
- Backup restore drill — Phase 88.
