# Task 7 Report — Unified mobile workout flow

## Status

Implemented the unified current-workout dock, top-level Skip action, accessible/reflowing header controls, live workout progress, prior-performance context, and reload-safe absolute-time rest timer. Past, upcoming, and rest views hide both workout action surfaces. Payload, vault, and sync schemas were not changed.

## Files

- `e2e/workout-card.spec.js`
  - Removed the obsolete fixed-document-position rest-bar test.
  - Added `openFirstWaveDay` and the four approved first-wave browser contracts.
- `index.html`
  - Moved the existing static `#skip-btn` to `#workout-top-actions` near the top of the workout flow.
  - Moved the existing static `#submit-row`, `#submit-btn`, and `#rest-bar-host` to the end of `<main>` as one sticky dock.
  - Replaced the global M&S header link with the boot-bound `#replace-token-btn`; exercise cards retain their individual M&S links.
  - Added live progress, sync copy, accessible unit/sign-out semantics, focus return for token replacement, dock-height measurement, safe-area spacing, focus rings, and approved responsive behavior.
- `js/rest-bar.js`
  - Rebuilt the rest-bar UI once and retained its DOM across paints and view switches.
  - Hydrates/saves the absolute `endsAtMs` timer, clears it on stop/expiry, restores its preset after reload, and exposes button/pressed/live-region semantics.
- `js/workout.js`
  - Added current-only action visibility, progress painting, Done-time progress updates, prior-performance context, and the `Today:` target prefix.
- `AGENTS.md`
  - Added the static-node and active-timer persistence convention.
- `CLAUDE.md`
  - Added `workout-history`/`workout-progress` to the pure module map, updated final workout/timer module responsibilities, and added the dock/timer convention.
- `.superpowers/sdd/2026-08-29-mobile-workout-first-wave/task-7-report.md`
  - This execution record.

## Implementation and decisions

- Preserved all four boot-bound nodes rather than recreating them: `#submit-row`, `#submit-btn`, `#skip-btn`, and `#rest-bar-host` each appear once in the static HTML.
- `renderExercises()` computes `canLog` from both exercise presence and current routine mode. Session notes remain visible for exercise days in past/upcoming modes, while both workout action surfaces remain hidden.
- `renderApp()` starts/repaints the timer only for a current exercise day. `renderRestBar(false)` stops only the interval; it intentionally leaves timer state, persistent absolute end, selected preset, and stable DOM intact.
- Progress is calculated by the Task 3 pure helper and repainted immediately on Done. Add-set uses the existing full renderer, increasing the total-set denominator.
- History is selected with the Task 2 helper using the resolved logged date when editing a log, otherwise the selected workout date. Past mode keeps the existing historical `actual-line` and does not add `previous-line`.
- The submit and Skip handlers were not changed. Workout submission therefore continues to use `activeSession.resolvedDate`, while Skip continues to use the selected `workoutDate`.
- The hydration path was not changed: `workoutHydrationKey` remains the active gate; `hydratedKeys` was not introduced as a render gate.
- The completed CSS follows the exact approved responsive contract. At 195 CSS pixels the dock becomes static and timer/set layouts stack; supported mobile viewports keep the dock bottom-pinned.

## RED

Command:

```text
npx playwright test e2e/workout-card.spec.js --grep "first wave:" --workers=1
```

Exit: `1`

Exact result summary and failure causes:

```text
Running 4 tests using 1 worker

1) first wave: workout controls form one accessible mobile flow
   Locator: locator('#submit-row > #rest-bar-host .rest-bar')
   Expected: visible
   Error: element(s) not found

2) first wave: a live rest timer resumes from its stored end after reload
   Error: page.evaluate: TypeError: Cannot set properties of null (setting 'endsAtMs')

3) first wave: history context respects routine mode
   Locator: locator('.ex-card .previous-line').first()
   Expected pattern: /Last Push · Aug \d+:/
   Error: element(s) not found

4) first wave: the dock and header reflow across supported mobile viewports
   Expected: <= 320
   Received:    393

4 failed
  e2e/workout-card.spec.js:75:1 › first wave: workout controls form one accessible mobile flow
  e2e/workout-card.spec.js:201:1 › first wave: a live rest timer resumes from its stored end after reload
  e2e/workout-card.spec.js:224:1 › first wave: history context respects routine mode
  e2e/workout-card.spec.js:251:1 › first wave: the dock and header reflow across supported mobile viewports
```

These were the intended pre-implementation failures: dock nesting/top actions were absent, Done did not persist a running timer, prior-performance DOM was absent, and the old header overflowed the 320-pixel viewport.

## GREEN

Full unit command:

```text
npm test -- --run
```

Output:

```text
Test Files  11 passed (11)
     Tests  88 passed (88)
  Duration  414ms
```

Focused browser command:

```text
npx playwright test e2e/workout-card.spec.js --grep "first wave:" --workers=1
```

Output:

```text
Running 4 tests using 1 worker
4 passed (5.8s)
```

No focused corrective rerun was needed.

Fresh pre-commit unit verification repeated the same totals:

```text
Test Files  11 passed (11)
     Tests  88 passed (88)
  Duration  338ms
```

## Screenshot paths and inspection

The repository uses Playwright's list-only reporter, which executes `testInfo.attach(...)` but does not retain successful in-memory attachment bodies on disk. To make the required inspection possible without rerunning the tests, I captured the same mocked/authenticated page states in a separate browser session:

- `/tmp/pt-tracker-task7-screenshots/320x568-header.png`
- `/tmp/pt-tracker-task7-screenshots/320x568-dock.png`
- `/tmp/pt-tracker-task7-screenshots/390x844-header.png`
- `/tmp/pt-tracker-task7-screenshots/390x844-dock.png`
- `/tmp/pt-tracker-task7-screenshots/430x932-header.png`
- `/tmp/pt-tracker-task7-screenshots/430x932-dock.png`
- `/tmp/pt-tracker-task7-screenshots/667x375-header.png`
- `/tmp/pt-tracker-task7-screenshots/667x375-dock.png`
- `/tmp/pt-tracker-task7-screenshots/195x422-header.png`
- `/tmp/pt-tracker-task7-screenshots/195x422-dock.png`

Inspection results:

- 320×568: header controls wrap into two compact rows without horizontal page overflow; the dock remains bottom-pinned, timer presets wrap to preserve 44-pixel targets, and scrolling exposes exercise content above the dock.
- 390×844 and 430×932: header, workout content, prior context, set controls, and dock remain simultaneously legible; no set, notes, or card content is clipped by the dock.
- 667×375: the short-height rule makes the header static; the dock stays bottom-pinned with one-row presets and visible set content above it.
- 195×422 effective 200% viewport: no horizontal page overflow; header controls and date picker reflow; the intentionally static dock stacks timer controls and leaves Submit/sync copy operable.
- No visual correction was needed after inspection.

## Self-review

- `git diff --check` reports no whitespace errors.
- Static ID scan confirms one HTML instance each of `#submit-row`, `#submit-btn`, `#skip-btn`, and `#rest-bar-host`; the obsolete `#replace-token-link` no longer exists.
- No payload builder, submit identity, pending schema, vault interface, recovery schema, or sync task behavior was changed.
- Timer transition behavior is explicit: start persists; day/mode switches pause only painting; reload hydrates; explicit stop and expiry clear the running key.
- Accessibility checks cover semantic timer button/labels, live announcements, pressed states, focus return, sign-out label, focus visibility, and 44×44 minimum hit targets.
- Current/upcoming/past/rest visibility and prior-history behavior are covered by the focused browser contract.

## Concerns

- The `/tmp` inspection images are intentionally uncommitted and may disappear after OS cleanup. The durable evidence is the four-case browser contract; future runs that need retained successful attachments should use an HTML/blob reporter or explicit screenshot paths.
- No full Playwright suite was run, per the Task 7 constraint.
