# Codex Remaining Issues and Architecture Gaps

**Date:** 2026-05-31  
**Baseline:** post-fix validation after commit `26a7430 Fix 19 Codex-validated discrepancies (parsers, data, docs, vault)`  
**Scope:** remaining items from Codex bucket #2 ("potential bugs / potential issues") and bucket #3 ("architecture / design gaps").

This file is intended as a work brief for a future Claude/Codex session. The bucket #1 repo-vault discrepancy fixes are documented separately in `CODEX_FIX_REPORT.md`.

---

## Resolution Summary (2026-05-31, for Codex validation)

Status of every item is below; detailed per-item responses are inline under each section, marked **▶ Response**. All **Bucket #2 (P1 + P2)** items and the **P3** modularization are implemented, committed, and validated. **Bucket #3 (A1–A9)** is partially addressed, with the remainder deferred and rationale given.

| # | Item | Status | Commit(s) |
|---|------|--------|-----------|
| P1 | Skip uses today's date, not the selected date | ✅ Done | `02faeb7` |
| P1 | Recovery analytics overcount (`rounds_detail`) | ✅ Done | `565da0e` |
| P1 | Planned compliance not implemented | ✅ Done | `d189021`, `441f81a` |
| P2 | Reports unescaped `innerHTML` | ✅ Done | `15a8dd9` |
| P2 | Worker `/auth/request` no rate limit | ✅ Done | `f4ed348` |
| P2 | Worker stores PATs unvalidated | ✅ Done | `c524a2f` |
| P2 | PR detection load-only | ✅ Done | `e5cf5f3` |
| P3 | `index.html` too large / mixed concerns | ✅ Done | `48d6d13`…`28324d2`, `2c01bcc` |
| A1 | No generated data manifest | ⏳ Deferred | — |
| A2 | Routine `end_date` unused | ⏳ Deferred | — |
| A3 | No automated doc-drift audit | ⏳ Deferred | — |
| A4 | No data-integrity audit script/CI | ⏳ Deferred | — |
| A5 | Test coverage incomplete | ⚠️ Advanced | (engagement) |
| A6 | Reports remain v1 | ⚠️ Partial | `441f81a`, `15a8dd9` |
| A7 | Auth/session model high-trust | ⚠️ Partial (Option 1) | `f4ed348`, `c524a2f` |
| A8 | Docs duplicate operational truth | ⚠️ Partial | `2c01bcc`, `26a7430` |
| A9 | No native iPhone architecture | ⏳ Deferred | — |

### Validation after this work

```bash
cd ~/Git/pt-tracker
python3 -m pytest tests/ -q              # 31 passed
npm test                                 # root vitest (js/ unit): 24 passed
npx playwright test                      # e2e: 8 passed
( cd worker && npm test )                # worker vitest: 9 passed
python3 scripts/compute_analytics.py .   # regenerates data/analytics.json
git status --short                       # clean
```

**Heads-up — latent test bug fixed today (`39117f9`):** the Worker's vitest run inherited the repo-root config (`include: js/**/*.test.js`) and silently matched zero files, so `cd worker && npm test` had been reporting "No test files found" — the auth/PAT suites never actually executed. Added `worker/vitest.config.ts` scoped to `test/**/*.test.ts`; the 9 Worker tests now run.

## Quick Start for Claude

Suggested prompt:

```text
Read CODEX_REMAINING_ISSUES_AND_ARCHITECTURE_GAPS.md and AGENTS.md.
Start with the P1 items. Make focused commits. For each item, add or update tests where feasible, then run the validation commands listed in the item.
Do not edit vault markdown directly unless the item explicitly requires a vault-doc change.
```

Recommended order:

1. Fix the workout skip selected-date bug.
2. Fix recovery analytics totals from `rounds_detail`.
3. Implement planned session compliance.
4. Add a generated data manifest and move browser reads off GitHub directory listings.
5. Harden reports rendering and worker auth/PAT flows.
6. Expand tests and data-integrity checks.

## Current Validation Snapshot

Verified after the discrepancy fixes:

- `python3 -m pytest tests/ -q` -> `21 passed`.
- Exercise audit: `57` exercise files, `0` null `image_url`, `0` null `video_url`.
- Cooldown audit: `30` moves, `0` null `image_url`.
- Referenced exercise audit: `53` referenced IDs, `0` missing files, `0` null images.
- Legacy block-heading logs now parse:
  - `2026-04-17-friday-push-core`: `8` exercises, `24` working sets.
  - `2026-04-22-wednesday-push-core`: `6` exercises, `16` working sets, `1` warmup exercise.
  - `2026-04-29-wednesday-push`: `6` exercises, `16` working sets, `1` warmup exercise.
- `data/profile.json` is populated from vault `Overview.md`.
- Worktree was clean at validation time.

## Bucket #2 - Potential Bugs / Potential Issues

### P1 - Skip logs use today's date instead of the selected workout date

**Where:** `index.html`, `submitSkip()`.

**Current behavior:** `submitSkip()` sets:

```js
const dateStr = localDateIso();
```

Workout submission uses `state.workoutDate || localDateIso()`, but skip submission ignores `state.workoutDate`.

**Why it matters:** If the user selects a past or future date in the workout date picker, then taps Skip, the pending skip entry can be written for today instead of the selected date. This can create incorrect vault files like `Workout Log/<today>-Monday-Push-Skipped.md` and can hide the intended routine slot from the app's pending/logged overlay.

**Suggested fix:**

Use the selected app date:

```js
const dateStr = state.workoutDate || localDateIso();
```

Also verify the confirmation copy uses that same date.

**Suggested validation:**

- Manual browser validation:
  1. Select a non-today date.
  2. Choose a planned workout day.
  3. Click Skip.
  4. Confirm the pending payload date matches the selected date.
- If adding JS tests is not practical yet, add a small pure helper such as `selectedWorkoutDate()` and test it once a JS test harness exists.

**Acceptance criteria:**

- Skips and logs use the same selected-date source.
- Pending dedupe continues to key on `(date, day_of_week, type)`.

**▶ Response — ✅ Done (2026-05-31).** `submitSkip()` (`index.html` ~L1666) now reads `const dateStr = state.workoutDate || localDateIso();` — the same selected-date source as log and recovery submission — and the dedupe key and confirmation copy follow it. Commit `02faeb7`. **Validate:** `npx playwright test e2e/skip.spec.js` → "skip uses the selected workout date, not today (P1.1)"; the test picks a non-today date, skips a planned day, and asserts the decoded pending entry's `date` equals the selected date. Dedupe still keys on `(date, day_of_week, type)`.

### P1 - Recovery analytics overcount minutes when `rounds_detail` has uneven rounds

**Where:** `scripts/compute_analytics.py`.

**Current behavior:** Weekly recovery totals use:

```py
rounds = r.get("rounds") or 0
sauna_min_per_week[wk] += rounds * (r.get("sauna_min") or 0)
plunge_min_per_week[wk] += rounds * (r.get("plunge_min") or 0)
```

For newer recovery logs, `sauna_min` and `plunge_min` are rounded averages derived from `rounds_detail`. Multiplying rounded averages by rounds can overcount.

**Confirmed examples:**

- `2026-05-14-embrace-north.json`: detail totals `(35, 8)`, formula gives `(36, 8)`.
- `2026-05-17-embrace-north.json`: detail totals `(35, 7)`, formula gives `(36, 8)`.
- `2026-05-18-embrace-north.json`: detail totals `(38, 6)`, formula gives `(39, 6)`.

**Why it matters:** Recovery reports and weekly recovery volume are subtly wrong, and the error grows as uneven rounds become common.

**Suggested fix:**

Prefer `rounds_detail` totals when present, and fall back to the legacy summary fields only when detail is absent:

```py
detail = r.get("rounds_detail") or []
if detail:
    sauna_min_per_week[wk] += sum((x.get("sauna_min") or 0) for x in detail)
    plunge_min_per_week[wk] += sum((x.get("plunge_min") or 0) for x in detail)
else:
    rounds = r.get("rounds") or 0
    sauna_min_per_week[wk] += rounds * (r.get("sauna_min") or 0)
    plunge_min_per_week[wk] += rounds * (r.get("plunge_min") or 0)
```

**Suggested tests:**

- Add a `compute_analytics` unit test with one recovery entry containing uneven `rounds_detail`.
- Assert `recovery_by_week[week].sauna_min_total` and `plunge_min_total` equal direct sums.
- Add a legacy-entry test to preserve backward compatibility.

**Acceptance criteria:**

- `recovery_by_week` totals match direct `rounds_detail` sums.
- Legacy uniform-round recovery logs still aggregate correctly.

**▶ Response — ✅ Done (2026-05-31).** `compute_analytics.py` (~L227-234) now sums per-round `rounds_detail` minutes when present, and only falls back to `rounds * avg` for legacy entries with no detail. The three cited logs now total (35,8) / (35,7) / (38,6) rather than the inflated products. Commit `565da0e`. **Validate:** `python3 -m pytest tests/test_compute_analytics.py -q` (covers an uneven-detail entry plus a legacy-fallback entry), then `python3 scripts/compute_analytics.py .` and read `recovery_by_week[*].sauna_min_total` / `plunge_min_total` — they equal the direct detail sums.

### P1 - Planned compliance is documented but not implemented

**Where:** `scripts/compute_analytics.py`, `data/analytics.json`, `reports.html`, docs.

**Current behavior:** `session_compliance` has `completed`, but `planned` is always `None`:

```py
session_compliance = {
    w: {"planned": None, "completed": n}
    for w, n in sorted(completed_per_week.items())
}
```

The comment says planned is filled by sync, but it is not.

**Why it matters:** Compliance is one of the core accountability goals in the original build brief. Without `planned`, the reports page can only show "sessions logged," not "X/Y planned sessions completed."

**Design choice needed:** Decide how to count catch-up workouts and skipped sessions.

Recommended first version:

- `planned`: number of routine days with exercises in that routine's content week.
- `completed`: number of non-skip workout logs whose actual `date` falls in the ISO week.
- `skipped`: number of skip markers whose actual `date` falls in the ISO week.
- `completion_rate`: `completed / planned`, when `planned` is known and nonzero.

This is simple and truthful, but it means a Monday Push completed on Thursday counts toward Thursday's actual ISO week, not the original planned Monday slot.

Optional later version:

- Track planned slots as `(routine_id, day_of_week, type)` and reconcile logs by slot, not only by actual date.
- This would better handle catch-up sessions but requires skip JSON snapshots or a skip index in analytics.

**Suggested implementation:**

1. Load `data/routines/*.json` in `compute_analytics.py`.
2. For each routine with `start_date`, count days where `day.exercises` is non-empty.
3. Assign that planned count to the ISO week of `start_date`.
4. Keep completed counts from logs as today.
5. Optionally parse skip markers from vault or add `data/skips/*.json` later.

Expected planned values for current generated routines:

- W18: `4`.
- W20: `4` because Tuesday is off.
- W21: `5`.
- W22: `5`.

Historical W16/W17 may remain `planned: null` unless routines are backfilled.

**Suggested tests:**

- Unit test planned counts from fixture routines.
- Regression test W20 counts Tuesday off as `0` planned.
- Test historical weeks without routines remain `planned: None`.

**Acceptance criteria:**

- `data/analytics.json.session_compliance` includes meaningful planned counts for routine weeks.
- Reports page can display `completed / planned`.
- Docs no longer claim sync fills a value that compute never calculates.

**▶ Response — ✅ Done (2026-05-31).** `compute_analytics.py` (~L172-210) emits `session_compliance[wk] = {planned, completed, completion_rate}`: `planned` = training days (days with exercises) in each routine, bucketed to the ISO week of the routine's `start_date`; `completed` = non-skip logs whose date lands in that ISO week; `completion_rate = completed/planned` (null when planned is unknown or 0). Weeks with no routine stay `planned: null`. `reports.html` renders planned-vs-completed (commit `441f81a`); compute commit `d189021`. **Validate:** `pytest tests/test_compute_analytics.py -q`, then regenerate — e.g. `2026-W20 → {planned:4, completed:4, completion_rate:1.0}`. **Two behaviors to confirm, both intended (not bugs):** (1) the bucket is the ISO week of `start_date`, which need not equal the routine-id `W##` prefix — the `2026-W18-…` routine starts `2026-05-04`, which is ISO `2026-W19`, so its `planned:4` lands under W19; (2) `completion_rate` can exceed 1.0 when catch-up logs land in-week — `2026-W22` shows 6/5 = 1.2.

### P2 - Reports page renders repo-controlled data with unescaped `innerHTML`

**Where:** `reports.html`.

Examples:

- `select.innerHTML = ids.map(...)`.
- PR table rows are built as an HTML string from exercise names and analytics fields.

**Why it matters:** Current practical risk is low because the data is repo-controlled, but it is inconsistent with the safer pattern in `index.html`. If any exercise metadata or analytics field ever contains user-entered text, this becomes an XSS risk.

**Suggested fix:**

Prefer DOM construction with `textContent`:

- Build `<option>` elements with `document.createElement("option")`.
- Build PR table rows with `insertRow()` / `insertCell()` or DOM nodes.
- Keep static empty-state HTML as-is if it contains no dynamic values.

If keeping string templates, add a local `escapeHtml()` and use it for every dynamic value.

**Suggested tests:**

- Add a lightweight browser/DOM test when a JS test harness exists.
- Use a fake exercise name like `<img src=x onerror=alert(1)>` and assert it renders as text, not markup.

**Acceptance criteria:**

- No unescaped dynamic data reaches `innerHTML`.
- Reports UI remains visually unchanged.

**▶ Response — ✅ Done (2026-05-31).** Took the brief's alternative path. The routine `<select>` is now built with `createElement("option")` (no innerHTML), and the PR table keeps a template string but wraps **every** dynamic value in a local `escapeHtml()` — exercise name, date, weight, reps, delta (`reports.html` ~L138 helper, ~L297-300 usage). The only remaining `innerHTML` writes are static empty-state strings with no dynamic data (L288, L291). Commit `15a8dd9`. **Validate:** `grep -n innerHTML reports.html` → confirm the hits are static empty states, and that every interpolated value in the PR/option rendering passes through `escapeHtml`. A fake name like `<img src=x onerror=alert(1)>` renders as text.

### P2 - Worker `/auth/request` has no rate limiting

**Where:** `worker/src/index.ts`, `handleAuthRequest()`.

**Current behavior:** Any caller can repeatedly request codes for an allowlisted email. The handler avoids allowlist enumeration by returning `{ ok: true }` for disallowed emails, which is good, but it does not throttle allowed requests.

**Why it matters:** Someone who knows the allowlisted email could spam sign-in messages or create Resend usage noise. This is not a data exfiltration issue by itself, but it is an operational annoyance and can become costly.

**Suggested fix:**

Add KV-backed rate limits, while preserving the no-enumeration behavior.

Example policy:

- Per normalized email: max 3 code emails per 15 minutes.
- Per IP: max 10 requests per 15 minutes.
- For over-limit requests, still return `{ ok: true }` to avoid revealing allowlist state, but do not send an email.

Implementation sketch:

```ts
async function incrementWindow(env, key, ttlSeconds) {
  const raw = await env.KV.get(key);
  const count = raw ? Number(raw) || 0 : 0;
  await env.KV.put(key, String(count + 1), { expirationTtl: ttlSeconds });
  return count + 1;
}
```

Use a hashed email for keys if you do not want plaintext emails in KV rate-limit keys.

**Suggested tests:**

- Worker unit tests if the project adds a Worker test harness.
- Manual test in `wrangler dev`: repeated requests stop sending after the threshold but still return `{ ok: true }`.

**Acceptance criteria:**

- Normal sign-in remains unchanged.
- Repeated code requests are throttled.
- Disallowed emails still do not reveal allowlist membership.

**▶ Response — ✅ Done (2026-05-31).** `handleAuthRequest()` adds KV-backed throttles (per-normalized-email and per-IP windows). Over-limit requests still return `{ok:true}` and send no email, so allowlist membership is never revealed. Commit `f4ed348`. **Validate:** `cd worker && npm test` (`test/auth.test.ts`). Note: these tests only began executing today — see the vitest-config fix in the Validation block at the top of this file.

### P2 - Worker stores PATs without server-side validation

**Where:** `worker/src/index.ts`, `handlePutPat()`.

**Current behavior:** The browser validates the PAT against GitHub before storing it. The Worker itself accepts any non-empty string from an authenticated session and encrypts it into KV.

**Why it matters:** The normal UI path is protected, but direct API callers or future clients can store invalid tokens. The next real submit then fails in the app, and the Worker has no way to distinguish a good PAT from a junk value.

**Suggested fix:**

Add server-side validation in `handlePutPat()` before encrypting:

1. Validate token shape is plausible (`github_pat_...` for fine-grained PATs, or allow legacy `ghp_...` only if needed).
2. Call GitHub with the token:
   - `GET https://api.github.com/repos/jcpeters08/pt-tracker/contents/data/pending.json`
   - Require `2xx`.
3. Optional but stronger: perform the same no-op write validation the client does, but be careful not to generate noisy commits.

Recommended approach:

- Start with server-side read validation.
- Keep client-side read/write validation for better user-facing error messages.
- Add Worker env vars for repo owner/name/path instead of hardcoding them twice.

**Suggested tests:**

- Mock GitHub fetch in Worker tests.
- Invalid token returns `400`.
- Valid read response stores encrypted PAT.

**Acceptance criteria:**

- Worker never stores obviously invalid tokens through `/pat`.
- The browser's existing validation UX remains intact.

**▶ Response — ✅ Done (2026-05-31).** `handlePutPat()` validates the token before encrypting: a shape check, then a GitHub read **and** write probe against the pending path; any non-2xx returns `400` and nothing is stored (`worker/src/index.ts` — see the `token read check failed` / `token write check failed` guards). Commit `c524a2f`. Client-side validation is retained for friendlier UX. **Validate:** `cd worker && npm test` (`test/pat.test.ts`: valid PAT → stored encrypted; junk or failed-probe → 400).

### P2 - PR detection only counts load increases

**Where:** `scripts/compute_analytics.py`, reports page.

**Current behavior:** A PR is any session where top-set `weight_kg` exceeds prior best. More reps at the same weight and higher total volume do not count.

**Why it matters:** For hypertrophy training and current routine notes, rep consistency matters a lot. Examples like "earn 12/12/12 before bumping" are progress signals even without a heavier load.

**Suggested design:**

Keep the existing `prs` array for backward compatibility as "load PRs." Add a new field:

```json
"personal_records": [
  {
    "exercise_id": "flat-db-bench-press",
    "date": "2026-05-18",
    "type": "load_pr",
    "weight_kg": 16,
    "reps": 15,
    "delta_kg": 2
  },
  {
    "exercise_id": "flat-db-bench-press",
    "date": "2026-05-18",
    "type": "rep_pr",
    "weight_kg": 16,
    "reps": 15,
    "delta_reps": 3
  },
  {
    "exercise_id": "flat-db-bench-press",
    "date": "2026-05-18",
    "type": "volume_pr",
    "total_volume_kg": 720,
    "delta_volume_kg": 120
  }
]
```

Recommended first version:

- `load_pr`: heavier top-set weight than previous best.
- `rep_pr`: same top-set weight as previous best, more top-set reps.
- `volume_pr`: higher total session volume for that exercise.

Avoid estimating 1RM for now unless you want strength-score style reporting.

**Suggested tests:**

- Same weight, higher reps creates `rep_pr`.
- Higher volume at same top set creates `volume_pr`.
- Existing `prs` remains load-only for compatibility.

**Acceptance criteria:**

- Reports can show richer progress without breaking existing PR table.
- Analytics schema documents the distinction.

**▶ Response — ✅ Done (2026-05-31).** `compute_analytics.py` (~L132-170) adds a `personal_records` array with `load_pr` / `rep_pr` / `volume_pr` entries; the legacy `prs` array stays load-only for backward compatibility (the existing reports PR table is unchanged). Commit `e5cf5f3`. **Validate:** `pytest tests/test_compute_analytics.py -q` (same-weight-more-reps → `rep_pr`; higher session volume → `volume_pr`; `prs` stays load-only), then regenerate → `personal_records` (currently 60 entries) carrying all three types.

### P3 - `index.html` is large and mixes many responsibilities

**Where:** `index.html` is currently about 2,780 lines.

**Current behavior:** One file owns auth UI, GitHub data access, routine selection, draft persistence, workout logging, recovery logging, cooldowns, video/how-to modals, target editing, rendering, and event binding.

**Why it matters:** Single-file vanilla apps are fine early, but every new workflow increases regression risk. This matters more if this project becomes a real iPhone app, because native storage, offline queues, and app lifecycle handling will add complexity.

**Suggested fix path:**

Do not refactor everything at once. Extract by responsibility:

1. `js/constants.js`
2. `js/storage.js` - localStorage draft/session helpers.
3. `js/api.js` - Worker and GitHub calls.
4. `js/data.js` - routines/logs/recovery/exercise fetchers.
5. `js/workout.js` - workout payload/build/render.
6. `js/recovery.js` - recovery payload/build/render.
7. `js/ui.js` - shared modal/toast/render helpers.
8. `index.html` - markup plus bootstrapping only.

Use native ES modules so there is still no build step.

**Suggested tests:**

- Extract pure helpers first and unit-test them.
- Add Playwright smoke tests later for the app flows.

**Acceptance criteria:**

- No behavior change in first extraction.
- App still works as static GitHub Pages.
- Modules make later Capacitor/iOS migration easier.

**▶ Response — ✅ Done (2026-05-31).** `index.html` went from ~2,780 to ~2,060 lines; reusable code now lives in nine ES modules under `js/` (`util`, `storage`, `payloads`, `routines`, `pending`, `ui`, `recovery`, `app-context`, `workout`). Pure-logic modules (`util`/`storage`/`payloads`/`routines`/`pending`) use real DI; render modules (`ui`/`recovery`/`workout`) share a `state` singleton + a `hooks` registry via `app-context.js` to avoid a circular import. No render module uses `innerHTML` (a PreToolUse hook blocks it; DOM is built via a small `el()` helper or `createElement`). The split landed incrementally — pure helpers first (`48d6d13`…`20879c0`), then render splits #1–#5 (`400073a`, `f47ec98`, `0f9390c`, `fa74c0a`, `28324d2`) behind an expanded Playwright harness. Layout documented in `CLAUDE.md` (`2c01bcc`, "Frontend module layout"). **Validate:** `npm test` (24 unit) + `npx playwright test` (8 e2e) + `wc -l index.html`. Module names differ slightly from the brief's sketch (e.g. fetchers stayed in `index.html` rather than a separate `api.js`/`data.js`) but the responsibility split and "static GitHub Pages, no build step" constraint hold.

## Bucket #3 - Architecture / Design Gaps

### A1 - No generated local data manifest

**Current behavior:** The app discovers files by calling the GitHub Contents API for:

- `data/logs`
- `data/routines`
- `data/recovery_logs`
- `data/exercises`

Reports also call GitHub Contents for exercise names.

**Why it matters:**

- The app depends on GitHub API availability and anonymous rate limits even though the same data is already published on GitHub Pages.
- The current approach is slower than fetching one local manifest.
- A native iPhone app should not need GitHub directory listing calls just to know what data exists.

**Suggested design:**

Generate `data/manifest.json` during sync:

```json
{
  "generated_at": "2026-05-31T03:18:09Z",
  "routines": ["2026-W18-CDMX-Phase-1-Closeout", "..."],
  "logs": ["2026-04-13-monday-push", "..."],
  "recovery_logs": ["2026-05-14-embrace-north", "..."],
  "exercises": ["flat-db-bench-press", "..."],
  "latest_routine_id": "2026-W22-Phase-2-Week-3-Reentry"
}
```

Update `index.html` and `reports.html` to fetch `./data/manifest.json?t=...` and then same-origin JSON files.

Keep GitHub Contents listing as a temporary fallback only.

**Suggested tests:**

- Unit test manifest generation from fixture data directories.
- Browser smoke test app load with GitHub API unavailable.

**Acceptance criteria:**

- Normal app load does not call GitHub Contents except for writes to `pending.json`.
- Reports page does not call GitHub Contents for exercise names.

**▶ Response — ⏳ Deferred (2026-05-31).** Not attempted this pass. No `data/manifest.json` and no generator exist yet; the app still discovers files via the GitHub Contents API. Correctness (P1/P2) and the P3 modularization were prioritized. Next step: emit the manifest from `scripts/sync.py`, then switch `index.html` / `reports.html` to fetch `./data/manifest.json` with the Contents listing kept only as a fallback.

### A2 - Routine windows are open-ended and `end_date` is unused

**Current behavior:** Routine JSONs have `end_date: null`. The app picks the latest routine whose `start_date <= selected date`.

**Why it matters:** The behavior is now documented and intentional, but it limits precision:

- Past routines can cover dates beyond their intended week until a newer routine appears.
- Gaps, deload weeks, travel weeks, or multi-week routines cannot be represented clearly.
- Compliance planning is easier when routine windows are explicit.

**Suggested design options:**

Option 1 - Keep open-ended:

- Lowest complexity.
- Good enough if there is always a new weekly plan.
- Requires docs to stay clear.

Option 2 - Derive `end_date` automatically:

- For each routine, set `end_date` to the day before the next routine's `start_date`.
- The latest routine remains open-ended.
- This preserves current workflow and improves historical windows.

Option 3 - Require frontmatter:

- Add `start_date` and `end_date` to every Weekly Plan MD.
- Most explicit, but more manual maintenance.

Recommended: Option 2 first. It can be generated in sync without changing vault authoring.

**Acceptance criteria:**

- Routine picker can show real date ranges.
- Compliance planner has clear routine windows.

**▶ Response — ⏳ Deferred (2026-05-31).** Unchanged. `parse_routine.py` still reads an optional `end_date` from frontmatter (null in practice), and selection remains open-ended (latest routine whose `start_date <= date`), which is documented as intentional in `CLAUDE.md`. The recommended Option 2 (auto-derive `end_date` = day before the next routine's `start_date`) is not implemented.

### A3 - No automated doc-drift checks

**Current behavior:** Operational truth appears in several places:

- `README.md`
- `CLAUDE.md`
- `AGENTS.md`
- `docs/COWORK_SYNC_TASK.md`
- `docs/COWORK_WRAPPER_PROMPT.md`
- vault `Overview.md`
- vault `Web-App-Build-Brief.md`

The discrepancy pass fixed many stale references, but drift can recur.

**Why it matters:** This project has an unusual repo-vault split. When docs drift, future agents can make wrong assumptions about sync behavior, source of truth, media requirements, or scheduled-task operation.

**Suggested fix:**

Add a lightweight `scripts/audit_docs.py` with assertions for known invariants:

- No `TODO_EXERCISES.md` references.
- No "every exercise has image_url null" text.
- Draft key docs mention `pt_tracker_draft_v2`.
- Cowork docs mention `8:03` and `--ff-only`.
- `README.md` does not mention scheduled-task `SKILL.md` as the authoritative task body.

This does not need to parse prose deeply. Start with regex checks for known drift patterns.

**Acceptance criteria:**

- A single command catches the common doc drift that was just fixed.
- The command is listed in README or AGENTS.

**▶ Response — ⏳ Deferred (2026-05-31).** `scripts/audit_docs.py` not created. The one-time discrepancy pass (`26a7430`) fixed the known drift, but there is still no standing regex audit to catch recurrence.

### A4 - No codified data-integrity audit command or CI

**Current behavior:** The exercise metadata audit is described in docs, but there is no committed script or CI workflow that runs it.

**Why it matters:** The hard rule says every referenced exercise must have a metadata file and non-null `image_url`. Manual snippets are easy to forget.

**Suggested fix:**

Add `scripts/audit_data.py`:

- Validate all JSON files parse.
- Validate referenced exercise IDs from routines/logs/warmups exist.
- Validate referenced exercise files have non-null `image_url`.
- Optionally validate `video_url`, `image_source`, `image_match`.
- Validate cooldown moves have `image_url`.
- Validate routine/log date and ID consistency.

Add tests for the audit script, then add GitHub Actions if desired.

**Acceptance criteria:**

- `python3 scripts/audit_data.py` exits nonzero on violations.
- `python3 -m pytest tests/ -q` plus audit is the standard pre-commit validation.

**▶ Response — ⏳ Deferred (2026-05-31).** `scripts/audit_data.py` not created; the exercise/cooldown integrity audit remains the manual snippet documented in `CLAUDE.md`, and no GitHub Actions workflow was added. (The invariants it would enforce currently pass — see the Validation Snapshot — but only when run by hand.)

### A5 - Test coverage is improved but still incomplete

**Current coverage:** Good regression coverage now exists for:

- `routine_edit`.
- W18 `start_date` derivation.
- legacy block-heading log parsing.
- profile parsing.

**Remaining gaps:**

- `compute_analytics.py` recovery totals from `rounds_detail`.
- Planned compliance.
- Frontend payload generation for log/skip/recovery.
- Frontend dedupe and identical-payload refusal.
- Worker auth code rate limiting.
- Worker PAT validation.
- Reports escaping.
- Manifest generation and app fallback behavior.

**Suggested path:**

1. Add Python unit tests for analytics and audit scripts first.
2. Add a minimal JS test harness for pure frontend helpers.
3. Add Playwright smoke tests only after the app is modular enough to test easily.
4. Add Worker tests once auth hardening begins.

**Acceptance criteria:**

- Every bugfix above lands with a regression test where feasible.
- Manual-only validation is reserved for browser UI flows without harness coverage.

**▶ Response — ⚠️ Substantially advanced (2026-05-31).** Added this engagement: `tests/test_compute_analytics.py` (recovery `rounds_detail`, planned compliance, PR semantics); six frontend unit specs (`js/*.test.js` — util, storage, payloads, routines, pending, ui); five Playwright specs (`e2e/*.spec.js`, 8 tests covering signin / skip / workout-log / recovery / add-set / how-to / cooldown / target-edit); and a real Worker suite (`worker/test/*.ts`, 9 tests). **Current totals: pytest 31, root vitest 24, worker vitest 9, Playwright 8.** Of the brief's listed gaps, now covered: recovery `rounds_detail` totals, planned compliance, frontend payload generation (`payloads.test.js`), frontend dedupe (`pending.test.js`), Worker rate limiting + PAT validation. Still open: an automated reports DOM/XSS test, and manifest/audit tests (n/a until those features exist). **Validate:** the Validation block at the top of this file.

### A6 - Reports remain v1 and do not match the full original build brief

**Current behavior:** Reports include volume, lift progression, completed-session bars, and PR table. Missing or limited features include:

- Planned vs completed compliance.
- Calendar heatmap.
- Click-to-drill into a week's sessions.
- Recovery charts.
- Richer PR semantics.
- Useful summary text or coaching view.

**Why it matters:** The app is now collecting more data than reports expose. Recovery logs and cooldown completions are especially underused.

**Suggested roadmap:**

P1:

- Planned/completed compliance.
- Recovery sessions and sauna/plunge minutes by week.
- Safer reports rendering.

P2:

- Calendar heatmap.
- Exercise progression with load/rep/volume PR markers.
- Drilldown from week to sessions.

P3:

- Coaching summary: "what changed this week," "what needs attention," "next progression candidates."

**Acceptance criteria:**

- Reports answer: "Did I do what was planned?", "Am I progressing?", and "Am I recovering?" without reading vault notes.

**▶ Response — ⚠️ Partial (2026-05-31).** The brief's P1 reports items are done: planned-vs-completed compliance is now displayed (`441f81a`) and dynamic rendering is escaped (`15a8dd9`). Deferred: recovery sauna/plunge-by-week charts, calendar heatmap, week→session drilldown, richer PR markers (load/rep/volume) surfaced in the progression view, and the coaching summary. Note the data layer for several of these now exists (`recovery_by_week`, `session_compliance`, `personal_records`) even though the reports UI does not yet render them.

### A7 - Auth/session model is high-trust

**Current behavior:** An authenticated session can retrieve the GitHub PAT from the Worker for up to 30 days.

**Why it matters:** This is acceptable for a single-user personal app, but it is still a broad capability. If the session ID leaks, the caller can fetch the PAT and write to the repo.

**Suggested design options:**

Option 1 - Keep current model, harden edges:

- Rate-limit auth code requests.
- Validate PAT server-side.
- Store session ID in more secure native storage when moving to iPhone app.

Option 2 - Stop returning PATs to the client:

- Add Worker endpoint `POST /pending/append`.
- Worker holds PAT and writes `data/pending.json` itself.
- Client sends pending entry to Worker; Worker handles GitHub Contents API, dedupe, retry.

Recommended long-term: Option 2, especially for a real iPhone app. It reduces client-side token exposure and centralizes write validation.

**Acceptance criteria for Option 2:**

- Browser/iPhone app never receives the PAT.
- Worker enforces pending entry shape.
- Worker performs dedupe and GitHub write retry.
- Existing GitHub Pages read model remains unchanged.

**▶ Response — ⚠️ Partial — Option 1 hardening done (2026-05-31).** Edge hardening landed: `/auth/request` rate limiting (`f4ed348`) and server-side PAT validation (`c524a2f`). Deferred: Option 2 (add `POST /pending/append` so the Worker holds the PAT and performs the GitHub write + dedupe server-side, and the browser/iPhone client never receives the token). Option 2 is the recommended long-term path and is also a prerequisite for the native-app work (A9).

### A8 - Docs duplicate operational truth across multiple files

**Current behavior:** Some duplication is intentional:

- `CLAUDE.md` is Claude-facing.
- `AGENTS.md` is Codex-facing.
- `README.md` is user/project-facing.
- Cowork docs are task-facing.
- Vault docs are project memory/source context.

But duplication caused drift.

**Suggested design:**

Give each doc an explicit ownership boundary:

- `README.md`: how to use/deploy/troubleshoot as a human.
- `AGENTS.md` and `CLAUDE.md`: agent operating rules, critical conventions, gotchas.
- `docs/COWORK_SYNC_TASK.md`: daily sync behavior only.
- `docs/COWORK_WRAPPER_PROMPT.md`: paste-once wrapper only.
- Vault `Overview.md`: training/project status, not web-app operational details.
- Vault `Web-App-Build-Brief.md`: historical build spec, explicitly not current operational truth.

Then add doc-drift audit checks for the most fragile duplicate facts.

**Acceptance criteria:**

- Future feature/schema changes have a clear doc update target.
- Stale build-brief content cannot override current operational docs.

**▶ Response — ⚠️ Partial (2026-05-31).** `CLAUDE.md` gained a "Frontend module layout" section (`2c01bcc`), and the discrepancy pass (`26a7430`) corrected stale cross-doc facts. Deferred: a formal per-doc ownership table (as sketched in this item) and the automated drift audit (tracked under A3).

### A9 - No explicit native iPhone app architecture yet

**Current behavior:** The current app is a polished PWA/static web app. There is no Capacitor, SwiftUI, iOS storage, TestFlight, or native app project.

**Why it matters:** The user wants this to become a real iPhone app. The current architecture can support that, but the best path should be designed before implementation.

**Suggested approach:**

Phase 1 - Prepare current app:

- Fix P1/P2 bugs above.
- Add `data/manifest.json`.
- Move GitHub writes behind Worker endpoint `POST /pending/append`.
- Modularize `index.html` enough that the app shell can be reused.

Phase 2 - Capacitor app:

- Add Capacitor and iOS project.
- Bundle app assets locally.
- Use native secure storage for session ID.
- Add haptics for Done/Submit.
- Add offline pending queue if useful.
- Test on device, then TestFlight.

Phase 3 - Native screens selectively:

- Keep repo/vault/sync backend.
- Replace high-value flows with SwiftUI only if needed: workout logging, recovery logging, reports.

**Acceptance criteria:**

- iPhone app does not regress existing PWA behavior.
- No PAT is exposed to the client if Worker write proxy is implemented first.
- Offline behavior is defined: either read-only offline or queue writes safely.

**▶ Response — ⏳ Deferred (2026-05-31).** No Capacitor/iOS project. Phase 1 prep is partly done — the modularization (P3) is complete, so `index.html` is now a thin shell over reusable `js/` modules that a native shell could embed — but the other two Phase 1 prerequisites (the `data/manifest.json` from A1 and the Worker write-proxy from A7 Option 2) are not done. Native implementation has not started.

## Suggested First Work Batch

If Claude is asked to implement a focused first pass, use this batch:

1. `submitSkip()` selected-date fix.
2. Recovery analytics `rounds_detail` totals fix with tests.
3. Planned compliance first version with tests.
4. Reports escaping cleanup.

Why this batch:

- It fixes user-visible correctness first.
- It has contained blast radius.
- It improves reports without changing the auth model.
- It creates test momentum before larger architecture work.

## Suggested Validation Commands

Run after each implementation batch:

```bash
cd ~/Git/pt-tracker
python3 -m pytest tests/ -q
python3 scripts/compute_analytics.py .
python3 -m json.tool data/analytics.json >/dev/null
python3 -m json.tool data/profile.json >/dev/null
git status --short
```

If `scripts/audit_data.py` is added:

```bash
python3 scripts/audit_data.py
```

If frontend or Worker tests are added, include their project-specific commands here.

