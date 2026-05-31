# Cowork scheduled task — daily PT Tracker sync

This file is the **authoritative spec** for the `pt-tracker-daily-sync` Cowork scheduled task. The Cowork task prompt itself is a thin wrapper that does `git pull` then reads this file and executes the steps below. Keep this file current — Cowork picks up changes on the next run automatically (no need to paste into the Cowork UI again).

If you're editing this file, the rule of thumb: anything that describes *what the task does, what it expects, how to recover from common failures* belongs here. Anything that describes *where to find this file* belongs in the Cowork prompt itself.

---

## Steps

1. **Pre-flight.** You are running inside the Cowork task. The wrapper prompt already did `git pull --ff-only` on the working directory before reading this file. If you suspect that pull didn't happen (e.g. you can't see recent commits), abort and report — don't try to re-run pull from here.

2. **Drain pending + re-derive snapshots.** Run `python3 scripts/sync.py` from the working directory `/Users/jonathanpeters/Git/pt-tracker`. The script does the following in order:

   - Drains `data/pending.json`. **Drain order matters**: `routine_edit` entries are applied first so the re-derive step that follows picks up any edited Weekly Plan MDs.
     - **Routine edit entries** (`type: "routine_edit"`, in-app target tweaks) — applied before log/skip/recovery. For each entry, `sync.py` opens `Weekly Plans/{routine_id}.md`, locates the matching day section and exercise row, and rewrites the `working weight`, `reps`, and/or `sets` cells for whichever fields appear in `changes`. The `notes` column is never touched. Failures (missing file, day-not-found, exercise-not-found, malformed table) are non-fatal: the entry is recorded to `data/failed_routine_edits.json` and sync continues. Successfully applied edits are recorded to `data/applied_routine_edits.json` for audit. Both audit files are committed by the daily sync.
     - **Workout log entries** (`type: "log"`) → `~/Documents/Jonathan's Vault/🎯 Projects/🏋️ Personal Trainer/Workout Log/YYYY-MM-DD-Day-Type.md` (one file per session, dual-unit weights: `95 lbs (43 kg)`). When the session captured cooldown completion data, the MD also includes a **Cool-down** section (type: library or fitnessplus, source_key, optional fitnessplus_name, completed_at).
     - **Skip entries** (`type: "skip"`) → `Workout Log/YYYY-MM-DD-Day-Type-Skipped.md`.
     - **Recovery entries** (`type: "recovery"`, sauna/cold plunge sessions) → `Recovery Log/YYYY-MM-DD-Location.md`. These can land on any day, including rest days. When `rounds_detail` is present, the MD renders a per-round breakdown (sauna/plunge minutes per round).
   - Appends a one-line entry to vault `Log.md` per workout session.
   - Appends a one-line entry to vault `Recovery Log.md` per recovery session.
   - Re-derives `data/routines/*.json` from vault `Weekly Plans/*.md` (reads optional `**Cool-down:**` line per day in addition to `**Warm-up:**`).
   - Re-derives `data/logs/*.json` from vault `Workout Log/*.md` (idempotent).
   - Re-derives `data/recovery_logs/*.json` from vault `Recovery Log/*.md` (idempotent).
   - Recomputes `data/analytics.json` (weekly volume, lift progression, legacy `prs` plus the richer `personal_records` load/rep/volume PRs, `session_compliance` with planned-vs-completed, `recovery_count`, and `recovery_by_week`).
   - Resets `data/pending.json` to `{entries: []}` if anything was drained.
   - Auto-commits with message `sync: drain N pending entries (YYYY-MM-DD)` and pushes if anything changed.

   If the script exits non-zero, capture stderr and abort. Do not swallow errors silently. If the vault project folder is missing, the script's own error message (`ERROR: vault project folder missing`) is sufficient — surface it verbatim.

3. **Verify.** Run `git log -1 --oneline data/` and report the latest commit. Run `git status` to confirm there are no leftover staged changes.

4. **Summary.** Print a brief summary: pending entries drained (with filenames, broken out by type — workout / skip / recovery), total logs aggregated, recovery sessions aggregated, PRs detected since the last run, latest commit hash if pushed. Keep it under 10 lines.

---

## Common failure recovery

- **`git pull` lock files:** If the wrapper's pull reported a stale lock (`.git/index.lock`, `.git/ORIG_HEAD.lock`, `.git/objects/maintenance.lock`), the wrapper handles its own retry. If a lock appears mid-run from this file, run `rm -f .git/index.lock .git/ORIG_HEAD.lock .git/objects/maintenance.lock` and retry the offending command once.
- **"Unknown exercise" stderr warnings from sync.py:** Informational — the script slugifies the name and continues. Surface the names so they can be added to the `EXERCISE_ALIASES` dict in `scripts/pt_common.py` later (manual edit, not part of this task).
- **Vault folder missing or empty** (sync.py reports `ERROR: vault project folder missing`, or `~/Documents/Jonathan's Vault/🎯 Projects/🏋️ Personal Trainer/` doesn't list expected subfolders like `Workout Log/`, `Weekly Plans/`): see the "Vault not mounted / missing" section below. The default rule is **abort and report** — never create the folder, never write empty stand-in MDs. Auto-recreating the vault would silently destroy the source of truth.

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
- Do not hand-author or free-edit any vault MD yourself. Weekly Plans, Workout Log, and Recovery Log are authored by Jonathan or written by `sync.py` (the latter rewrites specific Weekly Plan cells for `routine_edit` pending entries, and writes Workout/Recovery Log files for `log`/`skip`/`recovery` entries). You only invoke `sync.py` — never edit the MDs directly from this task.

---

## Vault not mounted / missing

The vault lives at `~/Documents/Jonathan's Vault/🎯 Projects/🏋️ Personal Trainer/`. `~/Documents/` on this Mac is iCloud Drive–synced, so "mounted" really means "iCloud has the content materialized locally." When sync.py reports the project folder missing, run through these checks in order. **Stop at the first one that matches and report what you did.**

### 1. Check what's actually there
```
ls -la "/Users/jonathanpeters/Documents/Jonathan's Vault/🎯 Projects/🏋️ Personal Trainer/"
```
Three outcomes:
- **Folder lists real files** (`Workout Log/`, `Weekly Plans/`, `Log.md`, etc., with non-zero sizes): the vault is fine. Sync.py's "missing" error is misleading — re-read its stderr, the real problem is elsewhere (a permission denial, a file-system encoding issue, etc.). Report and abort.
- **Folder lists files ending in `.icloud`** (e.g. `.Log.md.icloud`, `.Workout Log/.DS_Store.icloud`): iCloud has metadata but hasn't downloaded the content. Run step 2.
- **Folder doesn't exist at all** (parent `~/Documents/Jonathan's Vault/` is empty or missing too): run step 3.

### 2. Trigger iCloud download
The OS-level fix is to make a Finder window visit the folder — that nudges iCloud to materialize. From the CLI, this is the supported equivalent:
```
brctl download "/Users/jonathanpeters/Documents/Jonathan's Vault/🎯 Projects/🏋️ Personal Trainer"
```
Wait ~30 seconds (longer for first-time download of a large vault). Re-run `ls` from step 1 to verify content is now local, then retry `python3 scripts/sync.py`.

If `brctl` isn't available or fails, fall back to: open the Finder app via `open "/Users/jonathanpeters/Documents/Jonathan's Vault/🎯 Projects/🏋️ Personal Trainer"`, then wait 30s. Even a passive Finder visit triggers the download.

### 3. Vault truly absent
If `~/Documents/Jonathan's Vault/` itself doesn't exist:
- Check iCloud sign-in status: `defaults read MobileMeAccounts Accounts 2>/dev/null | grep AccountID` should print at least one account. If empty, iCloud is signed out — this is a user-action problem; abort and report with that detail.
- If iCloud is signed in but the folder is still missing, the vault has been moved, renamed, or deleted. Abort and report. Do NOT create the folder.

### 4. Different sync mechanism (rare)
If Jonathan has re-pointed the vault to a different location (external drive, Dropbox, Syncthing, etc.), the path in `scripts/sync.py`'s `DEFAULT_VAULT` constant or in the `PT_TRACKER_VAULT_ROOT` env var needs to be updated. **Don't change paths from this scheduled task** — report the mismatch and let Jonathan update it in a normal commit.

---

## How to update this file

This file is the source of truth. Edit it in a normal commit; the next scheduled run picks up the change automatically (because step 1 of the wrapper prompt is `git pull`). **You do not need to paste anything into the Cowork UI** unless you're changing the wrapper prompt itself (e.g. changing the working directory, changing how step 1 pull works, or pointing to a different file).

If you need to change the wrapper prompt (rare), edit `docs/COWORK_WRAPPER_PROMPT.md` in this repo and then paste its contents into the Cowork task UI — that's the only manual step left.
