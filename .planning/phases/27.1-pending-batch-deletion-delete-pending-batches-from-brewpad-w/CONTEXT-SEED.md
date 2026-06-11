# Phase 27.1 Context Seed (from user, during phase 27 UAT, 2026-06-11)

**Problem:** Sometimes a pending batch gets created for something that was already made into a batch. Today the only way to remove these duplicates is deleting the row directly in the Google Sheet (Batches tab).

**Request:** A way to delete pending batches from the UI, with a confirmation step before deletion.

**Implementation notes for planning:**
- `apps-script/adminApi.gs` has full CRUD for batches but check whether a delete action exists — likely needs a new `delete_batch` action (staff Google-OAuth-authenticated path, NOT the public batch-token path).
- Scope question for discuss-phase: restrict deletion to `pending` status only (safest — matches the stated problem), or allow deleting any batch? Recommend pending-only to start; active/complete batches have schedules, tasks, plato readings, and vessel history rows that would orphan.
- Related sheet tabs: BatchTasks/FermSchedules/PlatoReadings/VesselHistory — pending batches may already have task rows if a schedule was attached; decide cascade vs block-if-children.
- UI surfaces: inline row action + batch detail modal in the admin Batches tab and/or BrewPad batch list (phase 27 just added pending rows pinned to top with Activate buttons — delete button belongs beside those).
- Confirmation: phase 27 used confirm dialogs for Activate; a custom dialog matching the existing min-qty dialog pattern is preferred over native confirm() per PROJECT_ASSESSMENT.md UX findings.
- Audit consideration: nightly Sheets backup (backup.gs) exists, so accidental deletions are recoverable from the Drive backup — worth noting in the confirmation copy.
