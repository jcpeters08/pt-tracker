# Cowork scheduled task — daily PT Tracker sync

This file is the **authoritative spec** for the `pt-tracker-daily-sync` Cowork scheduled task. The Cowork task prompt itself is a thin wrapper that does `git pull` then reads this file and executes the steps below. Keep this file current — Cowork picks up changes on the next run automatically (no need to paste into the Cowork UI again).

If you're editing this file, the rule of thumb: anything that describes *what the task does, what it expects, how to recover from common failures* belongs here. Anything that describes *where to find this file* belongs in the Cowork prompt itself.

---

## Steps

1. **Pre-flight.** You are running inside the Cowork task. The wrapper prompt already did `git pull --ff-only` on the working directory before reading this file. If you suspect that pull didn't happen (e.g. you can't see recent commits), abort and report — don't try to re-run pull from here.

2. **Drain pending + re-derive snapshots.** Run `python3 scripts/sync.py` from the working directory `/Users/jonathanpeters/Git/pt-tracker`. The script does the following in order:

   - Drains `data/pending.json`:
     - **Workout log entries** (`type: "log"`) → `~/Documents/Jonathan's Vault/🎯 Projects/🏋️ Personal Trainer/Workout Log/YYYY-MM-DD-Day-Type.md` (one file per session, dual-unit weights: `95 lbs (43 kg)`). When the session captured cooldown completion data, the MD also includes a **Cool-down** section (type: library or fitnessplus, source_key, optional fitnessplus_name, completed_at).
     - **Skip entries** (`type: "skip"`) → `Workout Log/YYYY-MM-DD-Day-Type-Skipped.md`.
     - **Recovery entries** (`type: "recovery"`, sauna/cold plunge sessions) → `Recovery Log/YYYY-MM-DD-Location.md`. These can land on any day, including rest days. When `rounds_detail` is present, the MD renders a per-round breakdown (sauna/plunge minutes per round).
   - Appends a one-line entry to vault `Log.md` per workout session.
   - Appends a one-line entry to vault `Recovery Log.md` per recovery session.
   - Re-derives `data/routines/*.json` from vault `Weekly Plans/*.md` (reads optional `**Cool-down:**` line per day in addition to `**Warm-up:**`).
   - Re-derives `data/logs/*.json` from vault `Workout Log/*.md` (idempotent).
   - Re-derives `data/recovery_logs/*.json` from vault `Recovery Log/*.md` (idempotent).
   - Recomputes `data/analytics.json` (weekly volume, lift progression, PRs, compliance, plus `recovery_count` and `recovery_by_week`).
   - Resets `data/pending.json` to `{entries: []}` if anything was drained.
   - Auto-commits with message `sync: drain N pending entries (YYYY-MM-DD)` and pushes if anything changed.

   If the script exits non-zero, capture stderr and abort. Do not swallow errors silently. If the vault project folder is missing, the script's own error message (`ERROR: vault project folder missing`) is sufficient — surface it verbatim.

3. **Verify.** Run `git log -1 --oneline data/` and report the latest commit. Run `git status` to confirm there are no leftover staged changes.

4. **Summary.** Print a brief summary: pending entries drained (with filenames, broken out by type — workout / skip / recovery), total logs aggregated, recovery sessions aggregated, PRs detected since the last run, latest commit hash if pushed. Keep it under 10 lines.

---

## Common failure recovery

- **`git pull` lock files:** If the wrapper's pull reported a stale lock (`.git/index.lock`, `.git/ORIG_HEAD.lock`, `.git/objects/maintenance.lock`), the wrapper handles its own retry. If a lock appears mid-run from this file, run `rm -f .git/index.lock .git/ORIG_HEAD.lock .git/objects/maintenance.lock` and retry the offending command once.
- **"Unknown exercise" stderr warnings from sync.py:** Informational — the script slugifies the name and continues. Surface the names so they can be added to the `EXERCISE_ALIASES` dict in `scripts/pt_common.py` later (manual edit, not part of this task).

---

## Pre-conditions you can assume

- Mac is on (Cowork only fires when local).
- Vault is mounted at `~/Documents/Jonathan's Vault`.
- The `pt-tracker` repo has a remote and is on the `main` branch.
- If you need codebase context (purpose, architecture, conventions), `CLAUDE.md` at the repo root is the project brief for fresh Claude sessions.

---

## Hard limits — do NOT do these

- Do not touch the worker, secrets, or anything outside `~/Git/pt-tracker/data/` and the vault Personal Trainer folder.
- Do not refresh exercise images/videos — that is manual maintenance, not part of the daily routine.
- Do not modify Weekly Plans MD or hand-author Workout Log / Recovery Log MD — those are authored by Jonathan and parsed by sync.py.

---

## How to update this file

This file is the source of truth. Edit it in a normal commit; the next scheduled run picks up the change automatically (because step 1 of the wrapper prompt is `git pull`). **You do not need to paste anything into the Cowork UI** unless you're changing the wrapper prompt itself (e.g. changing the working directory, changing how step 1 pull works, or pointing to a different file).

If you need to change the wrapper prompt (rare), edit `docs/COWORK_WRAPPER_PROMPT.md` in this repo and then paste its contents into the Cowork task UI — that's the only manual step left.
