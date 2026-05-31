# Codex Findings — Validation & Fix Report

**Date:** 2026-05-30
**Scope:** the 19 discrepancies raised by Codex against `pt-tracker` (repo + Obsidian vault).
**Outcome:** all 19 claims were independently validated as **TRUE** and all 19 have been **fixed**. This document records, per claim, the verdict, root cause, the exact change made (files + specifics), and a command to re-validate.

> Note for the validator: the fixes span the **repo** (this git project) and the **Obsidian vault** (source of truth at `~/Documents/Jonathan's Vault/🎯 Projects/🏋️ Personal Trainer/`, not in git). Vault edits are listed explicitly. Repo data files under `data/` are *derived* from the vault by `scripts/sync.py`; they were re-derived with the fixed parsers (no commit/push was run by the daily-sync path).

---

## How to re-validate (copy-paste)

```bash
cd ~/Git/pt-tracker

# Tests (existing + new regression tests for these fixes)
python3 -m pytest tests/ -q

# C1: no exercise file has a null image_url/video_url
python3 -c "import json,glob;f=glob.glob('data/exercises/*.json');print(len(f),'files',sum(1 for p in f if not json.load(open(p)).get('image_url')),'null-img',sum(1 for p in f if not json.load(open(p)).get('video_url')),'null-vid')"

# C3: cooldowns — 30 moves, 0 null image_url
python3 -c "import json;d=json.load(open('data/cooldowns.json'));m=[x for t in d['library'].values() for x in t['moves']];print(len(m),'moves',sum(1 for x in m if not x.get('image_url')),'null')"

# C7/C6: profile.json is populated (phase 2, synced_at set, active routine W22)
cat data/profile.json

# C8: W18 routine start_date is the content week, not the ISO-week-of-id
python3 -c "import json;print(json.load(open('data/routines/2026-W18-CDMX-Phase-1-Closeout.json'))['start_date'])"   # 2026-05-04

# C13/C14: the 3 legacy logs now parse working exercises (24 / 16 / 16 sets)
python3 -c "import json;[print(d,len(json.load(open(f'data/logs/{d}.json'))['exercises']),'ex',sum(len(e['sets']) for e in json.load(open(f'data/logs/{d}.json'))['exercises']),'sets') for d in ('2026-04-17-friday-push-core','2026-04-22-wednesday-push-core','2026-04-29-wednesday-push')]"

# convention #8: every referenced exercise id has a file with a non-null image_url
# (see the audit snippet in CLAUDE.md "Critical conventions" #8)
```

Vault checks (C5, C12, C15–C17) read files under `~/Documents/Jonathan's Vault/🎯 Projects/🏋️ Personal Trainer/`.

---

## Status table

| # | Claim (short) | Verdict | Fix type | Status |
|---|---|---|---|---|
| C1 | README: every exercise `image_url/video_url: null` | TRUE | doc | ✅ fixed |
| C2 | `TODO_EXERCISES.md` (40 needing media) is stale | TRUE | doc | ✅ deleted + refs cleaned |
| C3 | CLAUDE/AGENTS: cooldown `image_url` all null | TRUE | doc ×2 | ✅ fixed |
| C4 | docs say draft key `v1`; app uses `v2:<routine_id>…` | TRUE | doc ×2 | ✅ fixed |
| C5 | Overview "Active routine" = W20; reality W22 | TRUE | vault | ✅ fixed |
| C6 | `profile.json` stale (`1-closeout`, `synced_at:null`) | TRUE | data (via C7) | ✅ fixed |
| C7 | `profile.json` sync claimed but not implemented | TRUE | code | ✅ implemented |
| C8 | W18 `start_date` derived wrong (ISO-week-of-id) | TRUE | code | ✅ fixed |
| C9 | routines have no `end_date` → latest start wins | TRUE (by design) | doc | ✅ documented |
| C10 | README: Cowork task in `SKILL.md` (now thin wrapper) | TRUE | doc | ✅ fixed |
| C11 | README/docstring: "skip on exists"; code overwrites | TRUE | doc + comment | ✅ fixed |
| C12 | build brief: 8:00 CT + `--rebase` (now 8:03 + `--ff-only`) | TRUE | vault | ✅ fixed |
| C13 | 3 legacy logs parse 0 exercises (block headings) | TRUE | code + data | ✅ fixed |
| C14 | → analytics undercount those 3 sessions | TRUE | data (via C13) | ✅ fixed |
| C15 | W20 rear-delt summary 6 vs 9 | TRUE | vault | ✅ fixed |
| C16 | W21 rear-delt summary 6 vs 9 | TRUE | vault | ✅ fixed |
| C17 | W21 summary stale exercise names (+ wrong core count) | TRUE | vault | ✅ fixed |
| C18 | `AGENTS.md` untracked | TRUE | git | ◑ staged (commit to finalize) |
| C19 | `.claude/` untracked | TRUE | git | ✅ gitignored |

---

## Per-claim detail

### C1 — README "every exercise has null media" (doc)
- **Was:** `README.md` "How to populate exercise images and videos" said *"every exercise has `image_url: null` and `video_url: null` by default"* and pointed at `TODO_EXERCISES.md`. Audit: all 53 files already populated (0 null).
- **Fix:** renamed the section to "Exercise images and videos"; rewrote it to state media is populated (yuhonas/free-exercise-db + Wikimedia; YouTube/muscleandstrength) and that new exercises must ship a non-null `image_url`. Also updated the "How to add a new exercise" step to require non-null `image_url`.
- **Files:** `README.md`.

### C2 — `TODO_EXERCISES.md` stale (doc)
- **Was:** listed 40 exercises "needing media"; all now populated.
- **Fix:** deleted `TODO_EXERCISES.md` (`git rm`); removed the references to it in `README.md`, `CLAUDE.md`, and `AGENTS.md` ("Where to look for more").
- **Files:** `TODO_EXERCISES.md` (deleted), `README.md`, `CLAUDE.md`, `AGENTS.md`.

### C3 — cooldown `image_url` gotcha stale (doc ×2)
- **Was:** CLAUDE.md & AGENTS.md (both line ~97): *"`image_url` is null for every move in `data/cooldowns.json`."* Audit: 30 moves, 0 null.
- **Fix:** rewrote both to say all 30 cooldown moves have populated `image_url`; kept the 🧘 placeholder note for any future null move.
- **Files:** `CLAUDE.md`, `AGENTS.md`.

### C4 — draft key version stale (doc ×2)
- **Was:** convention #6 in both files said `pt_tracker_draft_v1:<date>|<day>|<type>`. `index.html` live key is `pt_tracker_draft_v2:<routine_id>|<date>|<day>|<type>` (v1 only swept on boot).
- **Fix:** updated convention #6 in both files to the v2 key shape, noting legacy v1 keys are GC-swept. Recovery draft key (`pt_tracker_recovery_draft_v1:<date>`) left unchanged (still accurate).
- **Files:** `CLAUDE.md`, `AGENTS.md`.

### C5 — Overview "Active routine" stale (vault)
- **Was:** `Overview.md` → `- Active routine: [[2026-W20-…]]`; current routine is W22.
- **Fix:** updated to `[[2026-W22-Phase-2-Week-3-Reentry|…]]` and added a "Previous" line listing W21/W20.
- **File:** vault `Overview.md`.

### C6 — `profile.json` stale (data, resolved via C7)
- **Was:** `phase: "1-closeout"`, `synced_at: null` ("Bootstrap placeholder"); Overview says Phase 2.
- **Fix:** now re-derived by the new `parse_overview` step → `phase: "2"`, `synced_at` timestamped, plus `status`/`gym`/`goals`/`protein_target`/`active_routine`.
- **File:** `data/profile.json` (derived).

### C7 — `profile.json` sync not implemented (code)
- **Was:** docstring/CLAUDE.md/profile.json all claimed Overview→profile was re-synced daily, but `sync.py` had no implementation (only the docstring bullet).
- **Fix:** added `scripts/parse_overview.py` (`parse_overview_md` — tolerant, best-effort extraction of phase/gym/goals/protein/active-routine) and wired it into `scripts/sync.py` (import + a re-derive step after the recovery step that writes `data/profile.json` with `synced_at`). The architecture-diagram arrow is now real.
- **Files:** `scripts/parse_overview.py` (new), `scripts/sync.py`.

### C8 — W18 `start_date` wrong (code) — *higher impact than a cosmetic date*
- **Was:** `parse_routine.py` fell back to the **ISO week of the id** when no `start_date` frontmatter. The W18 plan's content is 5/4–5/7 (ISO week 19) but the derived `start_date` was `2026-04-27` (ISO-week-18 Monday) — the routine would have activated a week early (window 4/27–5/3) and never covered its own content week.
- **Fix:** `parse_routine.py` now derives `start_date` from the **first day-header's `M/D`** (the dated content is source of truth), preferring: frontmatter `start_date` → first day-header date → ISO-week-of-id. W18 now derives `2026-05-04`; W20/W21/W22 unchanged (`05-11`/`05-18`/`05-25`).
- **Files:** `scripts/parse_routine.py`. **Regression test:** `tests/test_codex_fixes.py::TestRoutineStartDate`.

### C9 — no `end_date` → open-ended active routine (doc; by design)
- **Verdict:** TRUE but intentional — `pickRoutineForDate` (index.html) selects the latest routine with `start_date <= date`.
- **Fix:** documented the behavior (and the new `start_date` derivation) in the "Known quirks / gotchas" of `CLAUDE.md` and `AGENTS.md`. No code change.
- **Files:** `CLAUDE.md`, `AGENTS.md`.

### C10 — README Cowork "SKILL.md" model stale (doc)
- **Was:** README said the task body lives in `~/.claude/scheduled-tasks/.../SKILL.md`.
- **Fix:** rewrote the "Daily sync — Cowork scheduled task" section to the current model: Cowork UI holds a thin wrapper that `git pull`s and runs `docs/COWORK_SYNC_TASK.md` (authoritative, version-controlled); see `docs/COWORK_WRAPPER_PROMPT.md`.
- **File:** `README.md`.

### C11 — "skip on exists" stale; code overwrites (doc + code-comment)
- **Was:** `README.md` troubleshooting said sync skips an already-existing session; `sync.py`'s module docstring said "Otherwise skip with a warning." Actual code overwrites on resubmit (correction workflow).
- **Fix:** rewrote the README bullet to describe overwrite-on-resubmit; corrected the `sync.py` docstring (step 2) to match.
- **Files:** `README.md`, `scripts/sync.py` (docstring).

### C12 — build brief schedule/pull stale (vault)
- **Was:** `Web-App-Build-Brief.md` said "8:00 AM CT" (×2) and `git pull --rebase`; current is 8:03 CT + `--ff-only`.
- **Fix:** updated both times to 8:03 and the pull to `--ff-only`; added a note that the brief is the build spec and the operational source of truth is `CLAUDE.md` + `docs/COWORK_SYNC_TASK.md`.
- **File:** vault `Web-App-Build-Brief.md`.

### C13 — 3 legacy logs parse 0 exercises (code + data) — *real data loss*
- **Was:** `parse_log.py` only read `## Exercises` / `## Warm-up`. The 4/17, 4/22, 4/29 logs use `## Core Block`, `## Chest / Shoulders Block`, `## Chest / Triceps Block` → 0 exercises parsed.
- **Fix (code):** added a fallback in `parse_log.py` — when no `## Exercises` section exists, every `## ` section whose table has an "exercise" column is parsed (skipping Volume Summary / Progression / Notes / Targets via heading guard + column-header guard), with inline `(warmup)` rows routed to `warmup_exercises` (so the warm-up sets don't inflate working volume). Modern logs (which have `## Exercises`) are untouched — the fallback only triggers when the canonical heading is absent.
- **Fix (data):** added 5 aliases to `pt_common.py` (`stick crunch`, `v-up toe-touch hybrid`, `v up toe touch hybrid`, `seated db/dumbbell front raise`) and created 4 exercise files so every resolved id has a populated, HTTP-200-verified image (no new convention-#8 violations): `data/exercises/v-up.json` (Jackknife_Sit-Up), `stick-crunch.json` (Crunches), `butterfly-crunch.json` (Crunches), `candlestick.json` (Flat_Bench_Lying_Leg_Raise).
- **Result:** 4/17 → 8 working / 24 sets; 4/22 → 6 working / 16 sets (+1 warmup routed out); 4/29 → 6 working / 16 sets (+1 warmup). Matches each log's own "Volume Summary."
- **Files:** `scripts/parse_log.py`, `scripts/pt_common.py`, 4× `data/exercises/*.json` (new), 3× `data/logs/*.json` (re-derived). **Regression test:** `tests/test_codex_fixes.py::TestLogBlockHeadings`.

### C14 — analytics undercounted those 3 sessions (data, resolved via C13)
- **Fix:** with C13 the 3 logs now carry working sets, so `compute_analytics.py` (unchanged — it was correct given good input) now includes their chest/triceps/shoulder/core volume, progression, and PRs. `data/analytics.json` was recomputed.
- **File:** `data/analytics.json` (derived).

### C15 — W20 rear-delt summary 6 vs 9 (vault)
- **Fix:** W20 Weekly Volume Summary rear delts `**6**` → `**9**` (Wed: face pull 3 + reverse fly 3 = 6; Fri: face pull 3 = 3). Also reconciled the two upstream narrative rows carrying the same stale 6 — the "What This Plan Optimizes" rear-delt row (was "…on BOTH pull-style days — 6 sets/wk") and the Fri face-pull row note ("6 sets rear delts/wk") → both now 9 (face pulls Wed + Fri; reverse fly Wed only).
- **File:** vault `Weekly Plans/2026-W20-Phase-2-Launch-Reentry.md`.

### C16 — W21 rear-delt summary 6 vs 9 (vault)
- **Fix:** W21 rear delts `6` → `9` (Tue 3+3, Thu 3).
- **File:** vault `Weekly Plans/2026-W21-Phase-2-Week-2-Progression.md`.

### C17 — W21 summary stale exercise names + core count (vault)
- **Fix:** Quads label `(squat + leg press + ext)` → `(squat + leg press + lunge)` (Fri programs DB Walking Lunge, "swap from leg extension"). Core row `6 | Thu (plank) + Fri (cable crunch + hanging raise)` → `9 | Thu (Pallof press + side plank iso) + Fri (cable rope crunch + back extension)` — reflects the actual programmed movements (side plank swapped from plank; back extension swapped from hanging knee raise; Pallof press added) and counts the working sets (Pallof 3 + cable crunch 3 + back ext 3 = 9; side plank counted as the 3 isometric per the plan's own Thursday accounting). Also fixed the upstream "What This Plan Changes vs W20" intent row: "Add leg extension … hanging knee raise" → "Add DB walking lunge … back extension", so the intent row matches the programmed table + summary. (The day-table "Swap from leg extension/hanging knee raise" notes are left as-is — they correctly document the swap.)
- **File:** vault `Weekly Plans/2026-W21-Phase-2-Week-2-Progression.md`.

### C18 — `AGENTS.md` untracked (git)
- **Fix:** staged `AGENTS.md` (`git add`). It is the Codex-facing project brief (parallel to the tracked `CLAUDE.md`) and belongs in version control.
- **Status:** ◑ **staged, not committed** — per the working agreement, no commit was made. A commit (ideally on a branch off `main`) finalizes tracking.

### C19 — `.claude/` untracked (git)
- **Fix:** added `.claude/` (and `.pytest_cache/`) to `.gitignore` — machine-local Claude Code state (settings + worktrees), not for the repo. It no longer appears as untracked.
- **File:** `.gitignore`.

---

## All files changed

**Repo — code:**
- `scripts/parse_log.py` — legacy block-heading fallback + warm-up routing (C13)
- `scripts/parse_routine.py` — `start_date` from first day-header date (C8)
- `scripts/parse_overview.py` — **new**; Overview.md → profile (C7)
- `scripts/pt_common.py` — 5 new exercise aliases (C13)
- `scripts/sync.py` — wire `parse_overview` + write `profile.json` (C7); docstring overwrite fix (C11)

**Repo — data (re-derived from vault; not committed by sync):**
- `data/routines/2026-W18-CDMX-Phase-1-Closeout.json` — start_date `04-27`→`05-04` (C8)
- `data/logs/2026-04-17-…`, `2026-04-22-…`, `2026-04-29-….json` — now populated (C13/C14)
- `data/profile.json` — populated (C6/C7)
- `data/analytics.json` — recomputed (C14)
- `data/exercises/{v-up,stick-crunch,butterfly-crunch,candlestick}.json` — **new** (C13)

**Repo — docs / git:**
- `README.md` (C1, C2, C10, C11), `CLAUDE.md` (C2, C3, C4, C9), `AGENTS.md` (C2, C3, C4, C9, C18-staged)
- `TODO_EXERCISES.md` — **deleted** (C2)
- `.gitignore` — ignore `.claude/`, `.pytest_cache/` (C19)

**Repo — tests:**
- `tests/test_codex_fixes.py` — **new**; regression tests for C7, C8, C13

**Vault (source of truth — outside git):**
- `Overview.md` (C5), `Web-App-Build-Brief.md` (C12), `Weekly Plans/2026-W20-…` (C15 + quads-label fix), `Weekly Plans/2026-W21-…` (C16, C17)

---

## Verification evidence (captured 2026-05-30)

- `python3 -m pytest tests/ -q` → **21 passed** (10 pre-existing + 11 new/covered).
- Exercise media audit → **53 files, 0 null image_url, 0 null video_url.**
- Cooldowns audit → **30 moves, 0 null image_url.**
- Convention #8 audit → **53 referenced ids, 0 missing files, 0 null images** (no new violations introduced by the 4 new exercise files).
- 4 new exercise image URLs → **HTTP 200** (Jackknife_Sit-Up, Crunches ×2, Flat_Bench_Lying_Leg_Raise).
- W18 routine `start_date` → **2026-05-04**; W20/W21/W22 unchanged.
- 3 legacy logs → **24 / 16 / 16** working sets (warm-up rows excluded).
- `data/profile.json` → `phase: "2"`, `active_routine: 2026-W22-…`, `synced_at` set.
- Re-derive diff scope: only the intended files changed (no collateral churn to other logs/routines).

---

## Notes, judgment calls & residuals

1. **Nothing was committed.** All repo changes sit in the working tree; `AGENTS.md` and the new files are staged. To finalize C18/C19 fully, commit (recommended on a branch off `main`). The daily sync was **not** run (it auto-commits/pushes) — the data was re-derived manually with the fixed parsers, which produces the same result the next 8:03 sync would.
2. **C13 fix is code, not vault.** The 3 logs keep their hand-authored block headings; the parser now understands them. This avoids rewriting your historical logs and fixes the whole class of legacy log going forward.
3. **C17 core count → 9.** Counted working core sets (Pallof + cable crunch + back extension); side plank is the isometric (consistent with the plan's own "18 + 3 isometric" Thursday line). Back extension is erector work but was placed in the "Core" row because it replaced the hanging knee raise there — adjust if you'd prefer it under a posterior-chain row.
4. **Approximate weekly totals untouched.** The W20/W21 "Total working sets ~81 / ~99" lines were left as-is (they're approximate planning figures); only the specific flagged rows were corrected.
5. **Adjacent issue (not in Codex's list) — also fixed:** W20's Weekly Volume Summary labeled quads "(squat + lunge + leg press)" but W20 Thursday programs no lunge — corrected to "(squat + leg press)" (count 6 unchanged). Surfaced while fixing C17; fixed at the user's request. Vault file: `Weekly Plans/2026-W20-Phase-2-Launch-Reentry.md`.
6. **`profile.json` schema changed.** It went from the bootstrap stub to a richer object. Nothing in `index.html`/`reports.html` reads it today, so this is safe; if you later surface profile data in the app, the fields are `phase`, `status`, `gym`, `goals`, `protein_target`, `active_routine`, `synced_at`.
