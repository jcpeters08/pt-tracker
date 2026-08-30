# Task 1 report: Persist only a valid active rest countdown

## Implementation

- Added `REST_TIMER_KEY` (`pt_tracker_rest_timer_v1`) and the pure persistence boundary in `js/rest-timer.js`:
  - `saveRunningTimer` stores only numeric `endsAtMs` and a known preset `durationSec`.
  - `loadRunningTimer` parses and validates stored state, rejects expired, malformed, unknown-preset, far-future, and structurally invalid values, clears rejected state, and restores the selected duration.
  - `clearRunningTimer` removes persisted active timer state.
- Added the requested running-timer persistence tests in `js/rest-timer.test.js`.
- Added `restDurationSec`, `restTimer`, and `restTimerHydrated` to shared state in `js/app-context.js`.

## Files

- `js/rest-timer.js`
- `js/rest-timer.test.js`
- `js/app-context.js`

## Self-review

The implementation is limited to the requested persistence/state foundation. Storage remains defensive and optional, only active countdown metadata is serialized, duration values are constrained to `REST_PRESETS`, and load validation enforces a live countdown no longer than its selected duration. Existing kg, payload, and vault interfaces were not changed.

## Concerns

None identified for Task 1. Countdown UI integration is intentionally left to later tasks.

## TDD evidence

RED command:

```text
npm test -- --run js/rest-timer.test.js
```

Result before implementation: 1 test file failed, 8 tests failed / 12 passed. The expected missing-export failures were reported (`saveRunningTimer is not a function`, `loadRunningTimer is not a function`, and `clearRunningTimer is not a function`).

GREEN focused command:

```text
npm test -- --run js/rest-timer.test.js
```

Result: 1 test file passed, 20 tests passed.

Full unit command:

```text
npm test -- --run
```

Result: 8 test files passed, 64 tests passed, zero failures.
