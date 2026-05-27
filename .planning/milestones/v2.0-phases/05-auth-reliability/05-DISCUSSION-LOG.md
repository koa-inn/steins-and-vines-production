# Phase 5: Auth Reliability - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-29
**Phase:** 05-auth-reliability
**Areas discussed:** Session persistence strategy, Form protection scope, Session warning & extend UX

---

## Session Persistence Strategy

### Q1: Wake-from-sleep behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Invisible silent refresh | App stays visible, silent token refresh in background. Brief spinner only during 1-3s refresh. If fails after retries, then show sign-in. | ✓ |
| "Welcome back" tap-to-resume | Show overlay with tap to continue. Gives staff a clear re-entry moment. | |
| Always show sign-in after overnight | Don't attempt silent refresh if token is hours old. Simpler but requires daily sign-in. | |

**User's choice:** Invisible silent refresh
**Notes:** None

### Q2: Wake detection mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Visibility + timestamp | Use Page Visibility API. When tab becomes visible, check time since last refresh. If >45 min, trigger immediate silent refresh. | ✓ |
| Heartbeat polling | setInterval every 30s checking a timestamp. Detects timer suspension by gap size. | |
| You decide | Let Claude pick. | |

**User's choice:** Visibility + timestamp
**Notes:** None

### Q3: Silent refresh failure fallback

| Option | Description | Selected |
|--------|-------------|----------|
| Show sign-in immediately | If silent refresh fails after 2-3 retries, show sign-in screen. Form data preserved. | ✓ |
| Retry with backoff, then sign-in | Progressive retries (1s, 3s, 10s) up to ~30s before giving up. | |
| You decide | Let Claude pick retry strategy. | |

**User's choice:** Show sign-in immediately
**Notes:** None

### Q4: Refresh window interactivity

| Option | Description | Selected |
|--------|-------------|----------|
| Interactive with subtle indicator | Staff can see and scroll. API calls queue during refresh. | |
| Brief overlay | Translucent overlay prevents interaction for 1-3s. | |
| You decide | Let Claude pick. | ✓ |

**User's choice:** You decide
**Notes:** None

---

## Form Protection Scope

### Q1: Which forms and what mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| All forms, save-on-interrupt | Extend current create-batch pattern to all forms. State saved only when auth fails. No ongoing writes. | ✓ |
| All forms, live auto-save | Continuously save all form state as staff types (debounced 2-3s). Survives auth + crashes. | |
| Create-batch + plato, save-on-interrupt | Only protect the two forms in AUTH-02 success criteria. | |
| You decide | Let Claude pick scope and mechanism. | |

**User's choice:** All forms, save-on-interrupt
**Notes:** User initially asked whether "all forms" meant live auto-save. Clarified that save-on-interrupt means data is captured only when auth fails, not continuously during typing.

### Q2: Restore feedback

| Option | Description | Selected |
|--------|-------------|----------|
| Toast notification | Brief "Your in-progress work has been restored" toast. Matches existing pattern. | ✓ |
| Silent restore, no notification | Put data back silently. Staff never knows anything happened. | |
| You decide | Let Claude pick. | |

**User's choice:** Toast notification
**Notes:** None

---

## Session Warning & Extend UX

### Q1: Extend action

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-extend, toast confirms | Warning fires → immediate silent refresh → "Session extended" toast on success. No user action needed. | ✓ |
| Tap-to-extend button in toast | Warning toast with "Stay signed in" button. Ignoring it lets session expire. | |
| You decide | Let Claude pick. | |

**User's choice:** Auto-extend, toast confirms
**Notes:** None

### Q2: Success notification policy

| Option | Description | Selected |
|--------|-------------|----------|
| Always show brief success toast | "Session extended" toast every ~50 min during active use. | |
| Silent success, toast on failure only | No toast if auto-extend works. Only notify on failure. | ✓ |
| You decide | Let Claude pick. | |

**User's choice:** Silent success, toast on failure only
**Notes:** None

### Q3: Failure alert style

| Option | Description | Selected |
|--------|-------------|----------|
| Warning toast + auth dot change | Amber toast with retry attempt, then sign-in if retry also fails. Non-blocking. | |
| Blocking overlay | Centered overlay: "Session expired. Sign in to continue." Prevents stale data interaction. | ✓ |
| You decide | Let Claude pick. | |

**User's choice:** Blocking overlay
**Notes:** None

---

## Claude's Discretion

- Refresh window interactivity (interactive with queued calls vs. brief overlay)
- Timer intervals and retry counts for visibility-based refresh
- Auth dot color state transitions during refresh lifecycle
- Concurrent `requestAccessToken` deduplication strategy

## Deferred Ideas

None — discussion stayed within phase scope
