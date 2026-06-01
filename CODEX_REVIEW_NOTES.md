# Claude → Codex Review Notes

**Date:** 2026-05-31
**Author:** Claude (Opus 4.8) session
**Branch/state:** all changes below are committed and pushed to `origin/main` (6 commits today, `4b260c8`→`5e9299f`). Working tree clean.

Purpose: a self-contained recap of what this session changed and why, so Codex can review. Pair with `git log --stat 4b260c8^..HEAD` for exact diffs.

---

## Codex follow-up fixes (2026-05-31)

Codex reviewed Claude's latest updates and found two real remaining failures plus one now-stale browser fixture. These are fixed in the follow-up commit after `8b76b56`.

### Claude failures Codex found

1. **Bug 2 was only fixed for display, not for submit identity.** `resolveSessionForView()` showed the W22 Monday catch-up log correctly, but it returned only the entry object. `buildSessionPayload()` still wrote `session.date` from `state.workoutDate`. That meant viewing nominal Monday `2026-05-25`, seeing the real catch-up log from `2026-05-28`, editing it, and submitting would queue a new `2026-05-25|monday|push` payload instead of updating the actual logged session identity. Because pending workout dedupe keys on `(date, day_of_week, type)`, this could create a duplicate planned workout and double-count analytics.
2. **W24 still had an impossible PF dumbbell target.** Hammer Curl was written as `22.5 lbs (10 kg) ea`, but PF dumbbells are 5-lb increments only. This violated the convention already documented in AGENTS.md/CLAUDE.md.
3. **The generic workout E2E fixture had gone stale.** It used W22 Monday as a blank logging case, but Claude's own catch-up fallback now correctly hydrates that day from the `2026-05-28` logged session. Clicking `Done` toggled an already-done set off. The test was no longer testing a blank workout path.

### What Codex changed and why

- `js/routines.js`: `resolveSessionForView()` now returns the resolved session metadata with the entry: `resolvedDate` and `isFallback`. Exact matches get `isFallback: false`; catch-up matches get the actual logged date and `isFallback: true`. This keeps the UI navigation date stable while carrying the storage identity forward.
- `js/payloads.js`: workout payloads now use the resolved logged date when editing an existing log. New logs and skips still use the selected workout date. This was the smallest fix that preserves the intended catch-up viewing behavior without converting a day-pill tap into a hidden date jump.
- `js/routines.test.js`, `js/payloads.test.js`, `e2e/day-navigation.spec.js`: added regression coverage proving fallback sessions expose the actual date and that submitting the fallback view queues `2026-05-28`, not the nominal `2026-05-25`.
- Vault source + repo snapshot: changed W24 Hammer Curl from `22.5 lbs (10 kg) ea` to `25 lbs (11 kg) ea` with the note `+5 from 20 if last week was clean`. The vault file was edited first because it is the source of truth; the generated JSON was updated to match.
- `scripts/audit_data.py` + `tests/test_manifest_and_audits.py`: added an executable Phase 2/PF audit for each-hand dumbbell targets, so non-5-lb PF dumbbell values such as `22.5 lbs ... ea` fail CI/local audits instead of relying on prose reminders.
- `e2e/workout.spec.js`: changed the generic submit test to a current-window W22 Tuesday log-update fixture. Past routines intentionally hide submit, and W22 Monday is now correctly covered by the catch-up-specific regression test.

### Codex validation

```bash
python3 -m pytest -q                                      # 39 passed
npm test                                                  # 35 passed
( cd worker && npm test )                                 # 14 passed
python3 scripts/audit_docs.py . && python3 scripts/audit_data.py .  # pass/pass
tmpdir=$(mktemp -d); python3 scripts/parse_routine.py ".../Weekly Plans" "$tmpdir"; diff -ru data/routines "$tmpdir"  # no diff
npx playwright test                                       # 11 passed
```

Note: Playwright initially failed before app code ran because the Mac was over its process limit. The culprit was hundreds of stale `@upstash/context7-mcp` helper processes. Codex killed only those stale MCP helpers, reran Playwright, and got a clean 11/11 browser pass.

---

## Context

Started from a "why are these `data/*.json` staged but uncommitted / what happened last night" question, then expanded into: validate the `30eb345` Hardening pass, reconcile docs, deploy the Worker, program two weeks of training, and fix two reported app bugs.

The app model (unchanged): vault = source of truth → `data/*.json` snapshots → static GitHub Pages app → auth Worker; the 8:03 daily sync drains pending → vault MD, re-derives JSON, recomputes analytics + manifest, commits + pushes.

## Root-cause finding (no code change)

The staged `analytics.json` / `profile.json` were **not** last-night leftovers. The **8:03 daily sync had been sleep-killed**: it ran `git pull` and `sync.py` (regenerated those files at 08:05) but the Mac returned to sleep before the commit step — leaving regenerated files staged-but-uncommitted plus stale `.git/index.lock` / `ORIG_HEAD.lock`. Last night's real work was already committed + pushed. I cleared the stale locks and discarded the timestamp churn. (Gotcha documented in CLAUDE.md/AGENTS.md.)

## Commits (all pushed)

| Commit | What | Why | Files |
|---|---|---|---|
| `4b260c8` | W20 routine rear-delt note `6→9`; sleep-kill gotcha → AGENTS.md | Repo JSON had drifted from the vault MD (vault says **9** sets); re-derived via `parse_routine.py`. | `data/routines/2026-W20…json`, `AGENTS.md` |
| `208bf1c` | New `W23` + `W24` routines + manifest; W22 `end_date`→`2026-05-31` | First cut of the 2-week plan, built (incorrectly — see `150e91b`) around a **June 5 BBL+PDL**. | `data/routines/W23,W24`, `data/manifest.json`, W22 json |
| `150e91b` | Reworked W23/W24 → full 5-day progression weeks; **renamed** W24 `BBL-Recovery`→`Progression` | User corrected the treatment plan: **no June 5 procedure**; only **Halo+BBL on Fri June 26**. So both weeks are ordinary progression weeks. | `data/routines/W23,W24` (+ delete old W24), `data/manifest.json` |
| `15e96ad` | Persistent Reports link; Bug-1 regression test; **Bug-2 first fix (nominal-date)** + e2e | ⚠️ **The Bug-2 fix here was wrong** (didn't handle catch-ups) and was reverted in `2fa2c62`. The Reports link + Bug-1 test are good. | `index.html`, `js/workout.js`, `e2e/day-navigation.spec.js` |
| `2fa2c62` | **Bug-2 done right**: `resolveSessionForView()` (day-of-week within week); reverted the nominal-date approach | Catch-ups (a day's workout performed on a different date) must still surface. | `index.html`, `js/workout.js`, `js/routines.js`, `js/routines.test.js`, `e2e/day-navigation.spec.js` |
| `5e9299f` | e2e resource-exhaustion gotcha → CLAUDE.md + AGENTS.md | Re-running Playwright without killing browsers exhausted the process table this session. | `CLAUDE.md`, `AGENTS.md` |

**Validated (and pre-existing):** Codex's `30eb345` "Harden" + `fbc77ee` handoff. I re-ran the suite (not just trusted it): pytest 38, root vitest 27 (→34 after my tests), worker vitest 14, `audit_data` + `audit_docs` pass.

## Non-git changes (saved to disk, not in the repo)

- **Worker deploy** — `pt-tracker-auth` v`5450de79` (`wrangler deploy`). The live frontend (`30eb345`) calls `POST /pending/append`, but the **deployed Worker was the old version → 404 → live logging was broken**. Now `/pending/append`→401, `GET /pat`→401. **Review: confirm the deployed Worker matches `worker/src/index.ts` @ HEAD.**
- **Vault (source of truth):** `🏋️ Personal Trainer/Weekly Plans/2026-W23…md` + `…W24…md`; `Web-App-Build-Brief.md` "Current State" updated (manifest + Worker write-proxy + corrected test counts).
- **life-maxxing skill refs:** `treatment-calendar.md` + `weekly-schedule.md` — June 26 = Halo+BBL (face+neck), nothing before, possible July PDL — synced across the 3 copies (running skill + vault `.claude/` + `.agents/`).

## The two bugs

- **Bug 1 (routine-switch loses in-progress edits):** validated **already fixed** by the P3 refactor — `selectRoutine` clears `hydratedKeys` + reloads the draft. No code change; added a passing e2e regression test.
- **Bug 2 (prior day shows defaults, not the logged session):** **real.** Root cause: the day-pill changed `selectedDay` while `refreshActiveSession`/`sessionLookup` key on `workoutDate|day|type`, so a prior day never matched its log. **Fix:** `js/routines.js → resolveSessionForView(lookup, {date,day,type,weekStart,weekEnd})` — exact-date match first, else the latest **logged** session for the same day-of-week within `[start_date,end_date]`. So tapping "Monday" shows the real session even if performed Tuesday (catch-up). `index.html` `refreshActiveSession` calls it; `js/workout.js` day-pill reverted to `selectedDay` + re-render (no date jump).

## What to scrutinize hardest

1. **`resolveSessionForView` edge cases** (`js/routines.js`; tested in `js/routines.test.js`). Codex fixed the original accepted trade-off: catch-up views now keep `workoutDate` as the navigation date but submit edits under the resolved logged date.
2. **W23/W24 training content** (`Weekly Plans` MD + `data/routines/*.json`). Weights/progressions are coaching judgment from `analytics.json` + the "+5 lb when top of rep range across all sets" rule (e.g. squat 95→105, leg press 240/250, lat pulldown 95→100, shoulder press hold 35). Sanity-check for safety + that they match the vault MD.
3. **W20 `6→9`** matches the vault volume note.
4. **Treatment-calendar edits** reflect the real plan (Jun 26 Halo+BBL; no Jun 5).

## Caveats (honest)

- **Superseded by Codex follow-up:** e2e now runs green after clearing stale `@upstash/context7-mcp` helper processes; `npx playwright test` passes 11/11.
- **First Bug-2 fix (`15e96ad`, nominal-date) was insufficient** — review HEAD, not that commit in isolation.

## Validate

```bash
cd ~/Git/pt-tracker
python3 -m pytest -q                 # 38
npm test                             # 34 (incl. resolveSessionForView)
( cd worker && npm test )            # 14
python3 scripts/audit_data.py .      # pass
python3 scripts/audit_docs.py .      # pass
npx playwright test                  # run ONCE on an idle machine (chromium-heavy)
git log --stat 4b260c8^..HEAD        # exact diffs
```
