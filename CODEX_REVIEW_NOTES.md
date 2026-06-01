# Claude → Codex Review Notes

**Date:** 2026-05-31
**Author:** Claude (Opus 4.8) session
**Branch/state:** all changes below are committed and pushed to `origin/main` (6 commits today, `4b260c8`→`5e9299f`). Working tree clean.

Purpose: a self-contained recap of what this session changed and why, so Codex can review. Pair with `git log --stat 4b260c8^..HEAD` for exact diffs.

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

1. **`resolveSessionForView` edge cases** (`js/routines.js`; tested in `js/routines.test.js`). Specifically the accepted trade-off: when you *view* a catch-up, `workoutDate` stays the navigation date, so an **edit+resubmit writes under that date** — could create a second `date|day|type` entry rather than update the original. I prioritized viewing; flag if edit-date should follow the shown session instead.
2. **W23/W24 training content** (`Weekly Plans` MD + `data/routines/*.json`). Weights/progressions are coaching judgment from `analytics.json` + the "+5 lb when top of rep range across all sets" rule (e.g. squat 95→105, leg press 240/250, lat pulldown 95→100, shoulder press hold 35). Sanity-check for safety + that they match the vault MD.
3. **W20 `6→9`** matches the vault volume note.
4. **Treatment-calendar edits** reflect the real plan (Jun 26 Halo+BBL; no Jun 5).

## Caveats (honest)

- **e2e not run green this session:** chromium wouldn't launch (`EAGAIN` from process exhaustion). `e2e/day-navigation.spec.js` exists and the Bug-2 logic is covered by the new **unit tests (34 pass)**. Run `npx playwright test e2e/day-navigation.spec.js` on an idle machine to confirm the browser flow.
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
