# Mobile workout flow — first-wave refactor

**Date:** 2026-08-29
**Status:** Approved for implementation

## Context

The iPhone PWA is the primary workout logger. Its main workout screen currently puts the rest timer at the start of the scrolling content, keeps the less-frequent Skip action inside the pinned submit area, and presents Replace token as a small inline link. The app also has three quieter correctness problems: Lower Hybrid receives the Upper Hybrid fallback cool-down, the Reports page describes meeting a programmed target as readiness to add load, and an active rest timer is lost on reload.

This first wave refactors the existing workout flow without changing the app's storage model, vault sync, workout payloads, or visual identity. The design follows the strongest repeated patterns from the researched workout apps: automatic rest timing near the primary logging controls, immediate prior-performance context, visible session progress, and low-frequency actions kept away from the primary completion action.

## Goals

1. Make one lower pinned dock the workout's control center: rest timer, presets, progress, Submit, and save/sync status.
2. Move Skip to the top of the scrolling workout content so it is available but never pinned beside Submit.
3. Make Reports and Replace token peer header actions; remove the redundant global exercise-database link.
4. Show the most relevant prior performance directly on each current/upcoming exercise card.
5. Describe programmed-target achievement accurately without implying that it automatically authorizes a load increase.
6. Give Lower Hybrid a lower-body cool-down.
7. Resume an active countdown after a page or PWA reload.

## Non-goals

- Exercise replacement or session-only swaps.
- Per-exercise rest-duration defaults.
- Collapsing completed cards or automatically scrolling to the next exercise.
- Adding a progression-gate field to routine or log schemas.
- Changing workout, skip, routine-edit, recovery, or vault-sync payloads.
- Changing kg-canonical storage, authored-lbs display behavior, or PF increment validation.
- A visual rebrand, social features, streaks, generated workouts, or mandatory RPE.

These are candidates for later waves, not hidden requirements for this one.

## Experience design

### Screen hierarchy

The existing warm editorial palette, serif headings, card shapes, and red accent remain. The distinctive element is a single compact **training console** at the bottom: the countdown's tabular numerals and the session completion state share one surface with the primary action.

```text
┌──────────────── sticky header ────────────────┐
│ PT Tracker  lbs/kg  Reports  Replace token  ⏻ │
│ Routine                                            │
│ Mon  Tue  Wed  Thu  Fri ...                        │
│ Workout date                         ✓ Logged      │
└────────────────────────────────────────────────────┘

  [mode or draft banner, when applicable]
  I didn't do this workout — mark as skipped
  Warm-up

  ┌ Exercise card ──────────────────────────────┐
  │ Exercise                                    │
  │ Today: 60 lbs × 10 × 3                      │
  │ Last Push · Aug 23: 55 lbs × 12/12/12       │
  │ sets ...                                    │
  └─────────────────────────────────────────────┘

  Cool-down
  Session notes

┌──────────────── sticky lower dock ─────────────┐
│  REST  1:27    [1:00] [1:30] [2:00] [3:00]   │
│  4/7 exercises · 14/21 sets                    │
│  [               Submit session              ]│
│  Saves to GitHub now. Syncs to your vault overnight.│
└────────────────────────────────────────────────┘
```

The dock is shown only for a current routine day that has exercises. Past and upcoming routine modes retain their existing no-submit behavior. Rest days do not show Skip or the dock.

### Lower pinned dock

The existing `#submit-row` remains the static visibility and behavior boundary, but becomes the unified dock. `#rest-bar-host` moves inside it above the existing Submit button. The dock renderer must not replace the row or the button because their click listeners are bound once at boot. This preserves existing selectors and prevents two independent bottom-pinned surfaces from stacking.

Dock order:

1. Rest countdown control and four duration presets.
2. Session progress text.
3. Full-width `Submit session` button.
4. `Saves to GitHub now. Syncs to your vault overnight.` microcopy.

The Reports and Replace token links are removed from the dock because they are persistent header actions. The dock handles bottom and landscape left/right safe-area insets and remains compact at a 390-pixel viewport. It must not cover the last editable workout control when the page is scrolled to the end. Toasts render above the dock instead of covering the countdown or Submit.

### Rest timer interaction

- Marking a set Done continues to start the selected timer automatically.
- The countdown itself becomes a real `<button type="button">`; tapping it starts an idle timer or stops an active timer.
- Presets remain `1:00`, `1:30`, `2:00`, and `3:00`. Tapping one selects and immediately starts that duration, matching current behavior.
- Countdown digits remain tabular. Completion keeps the existing green `GO` state and reduced-motion behavior.
- The countdown button, presets, Submit, Skip, Reports, Replace token, unit toggles, and Sign out each have a minimum 44-by-44 CSS-pixel touch region and visible keyboard focus.
- A screen-reader-only polite status announces state transitions (`Rest started`, `Rest complete`, `Rest stopped`) without announcing every second.
- Timer and preset actions update stable control nodes (or explicitly restore focus), so tapping or keyboard-activating them does not discard focus.
- The timer button's accessible name reflects its state and remaining time. Presets expose selection through `aria-pressed`; the changing digits themselves are not a per-second live region.

### Session progress

Progress is calculated from the current in-memory `state.log`, not from submitted analytics:

- A completed set is a set whose `done` value is `true`.
- Total sets are all current set rows, including a user-added set.
- An exercise is complete when it has at least one set and all its current set rows are Done.
- Total exercises are the exercises programmed for the selected day.

The visible text format is exactly `<done>/<total> exercises · <done>/<total> sets`. Its accessible label spells this out as `<done> of <total> exercises; <done> of <total> sets complete`. It updates immediately when Done is toggled and after a set is added. It is informational only; Submit validation and payload construction do not change.

### Skip placement and behavior

`I didn't do this workout — mark as skipped` moves to a non-sticky row immediately after the mode-banner host and before the warm-up. It is visually secondary, has a 44-CSS-pixel touch region, and is hidden on rest days, past routines, and upcoming routines.

Only placement changes. `submitSkip()` must continue to use the selected workout date and the existing `(date, day_of_week, type)` identity. It must still deduplicate against a log or skip for the same slot and must not adopt the resolved catch-up date used by workout submissions.

### Header actions

- Keep the existing Reports anchor.
- Replace the inline `Replace token` link with a semantic button styled as the same outlined pill and placed beside Reports. Its action remains `showPanel("pat")`.
- Remove the global `M&S ↗` header link. Exercise cards retain their contextual M&S links.
- On narrow screens, the visible token label may shorten to `🔑 Token`; its accessible name remains `Replace GitHub token`.
- Header navigation and unit controls remain operable in past mode. Past-mode read-only rules apply to workout editing controls, not global navigation.
- The unit-toggle buttons expose their selected state through `aria-pressed`, and the icon-only sign-out button has the accessible name `Sign out`.
- Opening Replace token moves focus to the token input. Cancel or successful save returns focus to the header button.

### Prior-performance context

Current and upcoming exercise cards add one muted line below today's target:

`Last <session label> · <short date>: <performance>`

Selection rules:

1. Use `state.sessionLookup`, so both synced logs and the latest pending overlay are eligible.
2. Consider only entries whose kind is `log`, whose workout `type` exactly matches the selected day type, and which contain the current exercise.
3. Exclude the current session. Compare candidates before `state.activeSession.resolvedDate` when editing an existing or catch-up log; otherwise compare before `state.workoutDate`.
4. Pick the latest remaining performed date. Do not fall back to a different workout type merely because it used the same exercise.
5. Omit the line if no matching earlier performance exists. Past mode keeps its existing `actual:` overlay and does not add a `Last` line.

Formatting uses the active lbs/kg preference. If every set used one weight, compact it as `55 lbs × 12/10/10`; if weights varied, show each weight/reps pair separated by ` · `. Bodyweight remains `bodyweight`. The session label is the selected day's label without its parenthetical detail, such as `Push` or `Lower Hybrid`.

Today's existing `Target:` label becomes `Today:` so the programmed prescription and historical performance are unambiguous. Target editing behavior and authored-lbs formatting remain unchanged.

### Reports semantics

The current calculation is useful: it finds latest logs that met that routine week's programmed weight, reps, and set count. The misleading claim is that this necessarily means `Ready to progress`, because the current rep ladder may program 8 or 10 reps while the separate load-increase gate is 12/12/12 (15/15/15 for high-rep work, 30 seconds for carries).

Rename the user-facing section to **Programmed target met**. Its description must state that the rows met that week's programmed prescription and that this does not automatically mean add weight. Row signals use `Programmed target met`, and the empty state says `No latest logs met every programmed target.`

Internal helper and render names should use `targetAchievement` rather than `readiness` so future code does not accidentally treat the result as a load-progression gate. The matching algorithm itself remains unchanged. No progression-gate inference is added in this wave.

### Lower Hybrid cool-down

Make cool-down routing a tested pure function and resolve labels in this order:

1. Push → `push`
2. Pull → `pull`
3. Legs → `legs`
4. Lower Hybrid (or another lower label) → `legs`
5. Upper Hybrid (or another upper label) → `upper-hybrid`
6. Generic Hybrid → `upper-hybrid` for backward compatibility
7. Anything else → `default`

This deliberately reuses the complete lower-body `legs` library. Adding a distinct `lower-hybrid` data library is a later content decision.

### Reload-safe timer

Persist only the active countdown, separate from the already-persisted selected duration:

```json
{
  "endsAtMs": 1788051720000,
  "durationSec": 120
}
```

- New key: `pt_tracker_rest_timer_v1`.
- Starting or restarting a timer writes the absolute end timestamp and selected preset.
- Stopping the timer clears the key.
- On first timer render after boot, a structurally valid, still-live timer is restored and counted down from the absolute timestamp.
- Invalid, non-preset, or expired data is cleared and the timer renders idle at the selected duration.
- Re-rendering, changing workout days, or temporarily viewing a rest day must not restart or discard an active countdown.
- When the timer reaches `GO`, clear persisted running state so a later reload cannot show a stale completed timer. The in-memory `GO` state remains until stopped or restarted, matching current behavior.

## Code boundaries

### `index.html`

- Move the timer host into the existing submit-row dock.
- Add the top, non-sticky Skip host.
- Update header markup, dock microcopy, safe-area/focus/touch styling, and responsive token label.
- Keep the current mode visibility rules, with explicit exceptions for global header controls.
- Keep orchestration in `renderApp()` and existing event handlers.
- Keep `#submit-row`, `#submit-btn`, and `#skip-btn` as stable DOM nodes so boot-time event handlers survive re-renders.

### `js/rest-timer.js` and `js/rest-bar.js`

- `rest-timer.js` owns pure validation and storage helpers for running-timer persistence.
- `rest-bar.js` owns one-time hydration, persistence calls, DOM semantics, ticking, and transition announcements.
- `state.restTimer` remains independent of `workoutHydrationKey`; timer state is global to the active workout UI, not a per-day draft.

### `js/workout-progress.js`

A new pure helper summarizes exercise/set completion from a routine day plus `state.log`. The workout renderer uses the result to paint the dock progress text. The Done handler refreshes that text without forcing a full card re-render.

### `js/workout-history.js`

A new pure helper selects the last same-type exercise performance. It receives the lookup and explicit selection criteria; it does not read DOM or global state. `js/workout.js` remains responsible for unit-aware display formatting and placing the line in a card.

### `js/workout.js`

- Export and use the corrected cool-down key resolver.
- Render `Today:` and the optional prior-performance line.
- Refresh session progress after Done changes and full exercise renders.
- Preserve `ensureLogState`, target editing, authored-lbs defaults, draft saves, and auto-start timer behavior.

### `js/reports.js` and `reports.html`

Rename readiness-oriented helper/render identifiers and all user-facing claims while preserving the existing target-achievement calculation.

### `README.md`, `AGENTS.md`, and `CLAUDE.md`

Replace their existing `ready-to-progress` descriptions with `programmed-target achievement` so the documentation does not reintroduce the false load-readiness claim. `docs/COWORK_SYNC_TASK.md` does not change because this wave adds no pending type, vault path, rendered Markdown section, or analytics field.

## State and data flow

```text
set Done ──→ state.log ──→ save workout draft
   │              └─────→ recompute dock progress
   └──────→ start rest timer ──→ state.restTimer + localStorage end timestamp

sessionLookup + selected type + comparison date
   └──────→ pure previous-performance selector
                └──────→ unit-aware card line
```

No new network request is required. All historical data needed for the card is already loaded into `state.sessionLookup`.

## Error and edge behavior

- Missing or malformed previous-session data omits the Last line; the exercise card still renders.
- Mixed or incomplete historical set fields render available values without blocking today's logger.
- Bad running-timer storage is removed without a toast; selected duration still loads normally.
- Existing submit failure, duplicate-submit, skip confirmation, PAT replacement, and toast copy/timing are unchanged; only toast placement adjusts to clear the dock.
- Switching days must continue to null `state.workoutHydrationKey` so the selected day's draft rehydrates correctly.
- Workout submissions must continue to use `state.activeSession.resolvedDate` for catch-up edits; Skip continues to use the selected date.
- The dock must not be visible in sign-in, PAT setup, recovery-only, past-routine, upcoming-routine, or rest-day states.

## Testing strategy

Implementation follows red-green-refactor for each behavior.

### Unit tests

- Running timer storage: live restore, expired removal, malformed JSON, invalid duration, save, and clear.
- Progress summary: untouched workout, partial completion, complete exercise, toggled-off set, and added set changing the denominator.
- Previous performance: exact type only, latest earlier date, current session excluded, pending log eligible, skip ignored, catch-up comparison date, exercise missing, and no result.
- Cool-down routing: Lower Hybrid → `legs`, Upper Hybrid → `upper-hybrid`, plus existing push/pull/legs/default behavior.
- Reports: target-achievement rows retain the same inclusion behavior but return the non-readiness signal.

### Browser tests

Run the full browser suite once after unit tests pass. Update the old assertion that the rest timer stays at a fixed document position; the new assertion verifies that the unified dock stays at the viewport bottom while scrolling. Cover one 390-by-700 mobile flow:

1. Timer and Submit share the dock.
2. Skip appears above the warm-up and scrolls away.
3. Progress changes after Done and after Add set.
4. Starting a timer, reloading, and returning to the workout resumes a lower remaining value.
5. Reports and Replace token are peer header controls; the redundant global M&S link is absent.
6. A prior same-type performance is visible and a different-type performance is not selected.
7. Past/upcoming/rest views remove the dock and Skip from both the visual layout and accessibility tree.
8. Replace token moves focus into and back out of the PAT panel as specified.

### Repository checks

- `npm test -- --run`
- `python3 scripts/audit_data.py .`
- One `npm run e2e` execution only, with orphaned Playwright processes cleaned only if needed.
- Responsive checks at `320×568`, `390×844`, `430×932`, and `667×375`: no horizontal page scroll, clipped dock controls, or header/dock overlap. At 200% zoom, controls reflow without losing content or function.
- Manual mobile screenshot inspection for the top header, a mid-workout card, and the pinned dock at 390 pixels wide.

## Acceptance criteria

The first wave is complete when all of the following are true:

- The timer is no longer at the top of workout content and is inside the one pinned Submit dock.
- Skip is at the top of scrolling workout content and is not pinned.
- Replace token is a Reports-style header button and still opens PAT replacement.
- The header has no global M&S link; card-level M&S links remain.
- The dock shows accurate live exercise/set progress.
- Current/upcoming cards show the latest earlier same-type performance when one exists.
- Reports never call meeting today's programmed target `ready to progress`.
- Lower Hybrid uses the lower-body cool-down.
- A live rest timer resumes after reload and expired timer data does not.
- All controls in scope are usable at 390 pixels, have visible focus, and meet the 44-CSS-pixel target.
- Presets wrap when necessary at 320 pixels rather than shrinking below the 44-point target; the dock respects portrait and landscape safe areas, and toasts remain above it.
- Catch-up submission identity, Skip identity, draft hydration, duplicate protection, kg storage, and vault-sync behavior pass their existing regression tests.

## Research basis

- Strong and Hevy automatically start a rest timer after a completed set and keep timer controls close to workout logging.
- HeavySet uses a bottom workout panel, supporting one consolidated lower control surface.
- Hevy exposes previous workout values during logging, supporting in-card last-performance context.
- Fitbod and Peloton make exercise replacement easy, but that capability is intentionally deferred because this app's vault-backed plans and exercise metadata make it a separate data-flow project.
- Apple recommends 44-by-44-point touch targets; WCAG 2.2 requires at least 24-by-24 CSS pixels (with spacing exceptions) and identifies 44-by-44 as the enhanced target.

Official references:

- https://help.strongapp.io/article/231-rest-timer
- https://www.hevyapp.com/features/workout-rest-timer/
- https://www.hevyapp.com/features/track-workouts/
- https://heavyset.app/help/logging-workouts/rest-timer
- https://heavyset.app/help/logging-workouts/workout-logger
- https://help.fitbod.me/hc/en-us/articles/360006335593-Editing-Workouts-in-Fitbod
- https://www.onepeloton.com/strength-plus-app?locale=en-us
- https://developer.apple.com/design/human-interface-guidelines/buttons
- https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
