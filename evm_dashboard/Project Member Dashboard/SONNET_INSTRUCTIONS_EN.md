# Sonnet Implementation Instructions — EVM Work Logs & Daily Reports UI

Purpose
-------
This document is a ready-to-copy instruction set for an implementation model (Sonnet). Its goal is to migrate the existing DOM-based EVM "Work Logs & Daily Reports" page to the Figma-generated React UI found in `src/app/components/MemberDashboard.tsx`, without changing the server API. The adapter should transform the server payload into the React component's expected data model, preserve pixel-accurate Gantt alignment, and implement the unsubmitted (orange dot) logic.

Files to reuse (recommended)
--------------------------------
- `src/app/components/MemberDashboard.tsx` — primary Figma output; use as the implementation base.
- `src/app/components/figma/ImageWithFallback.tsx` — avatar/image fallback.
- `src/app/components/ui/*` — reuse primitives: `button.tsx`, `input.tsx`, `label.tsx`, `avatar.tsx`, `badge.tsx`, `progress.tsx`, `scroll-area.tsx`, `tooltip.tsx`, `utils.ts`, `use-mobile.ts`.
- `app.js` — reference only; migrate data logic into an adapter rather than copying DOM code.
- `evm_data.js` — sample API fixture for testing.

API contract (unchanged)
------------------------
GET `/api/evm-data` returns a JSON object with at least the following keys (see `evm_data.js` sample):
- `project_summary`
- `time_series`, `forecast_series`
- `member_stats`
- `member_work_logs` (array of `{ date: 'YYYY-MM-DD', hours: { '<name>': number } }`)
- `member_issue_progress` (array of `{ member_id, member_name, issues: [ { issue_id, subject, progress_by_date: { 'YYYY-MM-DD': pct|null }, planned_start_date?, planned_end_date?, forecast_end_date? } ] }`)

Target UI model
---------------
Implement `transformApiToMembers(apiData, displayDates, baseDateIso)` that returns `Member[]` where each `Member` has `tasks[]`, and each `task` has `logs[]` (one log per `displayDates` entry) with:
- `hours: number|null`
- `progress: number|null`
- `submitted: boolean` (used to show orange dot when false and date < baseDate)

Data transformation rules (concise)
----------------------------------
- Normalize member names (trim, collapse whitespace) before matching `member_work_logs` keys.
- `displayDates` is an array of ISO dates (`YYYY-MM-DD`) used for columns.
- For each issue, build `logs = displayDates.map(date => { hours, progress, submitted })`:
  - `hours` from `member_work_logs` for that date and member name, or `null`.
  - `progress` from `issue.progress_by_date[date]` or `null`.
  - `submitted`: prefer `apiData.daily_submissions[memberId][date]` if present; otherwise `submitted = Boolean(hours !== null || progress !== null)`.
- Orange-dot (unsubmitted) condition: `!submitted && date < baseDateIso` (i.e., past date before base/today).
- `completionPct`: latest non-null `progress` in the display window; fallback to 0.

Gantt pixel alignment (formula)
--------------------------------
Shared constants (must be single source of truth):
- `DATE_COL_W = 72` (px)
- `CELL_GAP = 4` (px)
- `colStep = DATE_COL_W + CELL_GAP`

Index → pixel mapping:
- `pxStart = startIndex * colStep`
- `pxWidth = Math.max(Math.round(cols * colStep - CELL_GAP), minVisiblePx)` where `cols = endIndexExclusive - startIndex`
- Forecast width: `pxForecast = Math.max(Math.round((forecastIndex - startIndex) * colStep - CELL_GAP), 0)`

Implementation tasks (patch-level deliverables)
---------------------------------------------
1. Add adapter module
   - File: `src/lib/evmAdapter.ts`
   - Export: `transformApiToMembers(apiData, displayDates, baseDateIso): Member[]`
   - Responsibilities:
     - Normalize names, map `member_work_logs` and `member_issue_progress` into `Member.tasks[].logs[]`.
     - Convert `planned_start_date`/`planned_end_date`/`forecast_end_date` into column indices relative to `displayDates[0]`.
     - Compute `submitted` and `completionPct` as described above.

2. Integrate adapter into React
   - Modify `src/app/components/MemberDashboard.tsx`:
     - Remove the static `MEMBERS` fixture.
     - Use `useEffect` to fetch `/api/evm-data`, then call `transformApiToMembers` with `displayDates` and `data.project_summary.base_date`.
     - Store the result in state and render with existing `MemberSection`, `DayCell`, and `GanttBar` components.
     - Ensure `DayCell` receives `submitted` and shows the orange dot if necessary.
     - Make `DATE_COL_W` and `CELL_GAP` shared constants (import from `src/lib/constants.ts`).

3. Mounting / routing
   - Mount the React app in the existing host, or add a new route to preview the new UI. Keep `app.js` intact until QA completes.

4. Tests
   - Add unit tests for `evmAdapter` with these cases:
     1. Unsubmitted past date → orange dot
     2. Task spanning partially outside the display window → clipped indices
     3. Forecast extends beyond planned → forecast width computed
     4. Name normalization mismatch → matching still works
     5. Latest progress extraction → `completionPct` correctness

Commands & environment
----------------------
Project uses pnpm (preferred). Example commands:

```bash
pnpm install
pnpm dev
```

Run adapter smoke test (example using ts-node):

```bash
pnpm add -D ts-node typescript @types/node
pnpm ts-node src/lib/__tests__/evmAdapter.test.ts
```

PR checklist for submission
--------------------------
- Include changed files and short rationale in PR body.
- Attach before/after screenshots using `evm_data.js` fixture.
- Include test results for `evmAdapter`.
- Keep `app.js` available for side-by-side verification until final cutover.

Notes for Sonnet implementer
----------------------------
- Keep constants single-sourced; do not hardcode widths in multiple places.
- Use UTC midnight when computing date differences to avoid timezone drift.
- Round pixel values with `Math.round()` and use `transform: translateX()` for performant positioning on animation.
- If server introduces `daily_submissions` later, use it (adapter prefers server flag over heuristic).

Acceptance criteria
-------------------
1. New React page renders and aligns Gantt bars exactly with date columns at 100% zoom.
2. Orange-dot appears for past unsubmitted dates only.
3. Tasks that extend beyond the visible date range are clipped and still visually meaningful.
4. All changes are covered by unit tests for the adapter.

---
You can copy-paste this file directly into Sonnet. If you want, I can also generate a concise PR body and a one-line commit message for the patch set.
