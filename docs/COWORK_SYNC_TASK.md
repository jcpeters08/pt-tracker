# PT Tracker sync — authoritative spec for what `sync.py` does

This file is the **authoritative spec** for the PT Tracker sync: what `scripts/sync.py` drains, writes, re-derives, and skips.

As of **2026-06-21 the sync runs on-demand**, executed by the **interactive Claude session** (it has direct vault read/write and `git push` to `main`), triggered when Jonathan says *"sync"* or *"update the workout plan."* The old `pt-tracker-daily-sync` **Cowork scheduled task** that used to run these steps at 8:03 CT is **disabled** — this file keeps its `COWORK_` filename only for link stability (`CLAUDE.md` and memory point here). The Cowork wrapper in `docs/COWORK_WRAPPER_PROMPT.md` + `scripts/cowork_git_bridge.py` are retained solely for the case where that scheduled task is ever re-enabled.

Quick how-to lives in repo `CLAUDE.md` → **"Syncing & updating the plan (on-demand)."** This file is the detailed reference for the sync internals.

---

## Steps

1. **Pre-flight.** `git pull --ff-only` from `/Users/jonathanpeters/Git/pt-tracker`. The local checkout often trails `origin/main` (the auth Worker and prior syncs push *remotely*), so always pull/fetch first and trust `origin/main`, not the local working copy. If the pull can't fast-forward, stop and report — don't force it.

2. **Drain pending + re-derive snapshots.** Run `python3 scripts/sync.py` from the working directory. The script does the following in order:

   - Drains `data/pending.json`. **Drain order matters**: `routine_edit` entries are applied first so the re-derive step that follows picks up any edited Weekly Plan MDs.
     - **Routine edit entries** (`type: "routine_edit"`, in-app target tweaks) — applied before log/skip/recovery. For each entry, `sync.py` opens `Weekly Plans/{routine_id}.md`, locates the matching day section and exercise row, and rewrites the `working weight`, `reps`, and/or `sets` cells for whichever fields appear in `changes`. The `notes` column is never touched. Failures (missing file, day-not-found, exercise-not-found, malformed table) are non-fatal: the entry is recorded to `data/failed_routine_edits.json` and sync continues. Successfully applied edits are recorded to `data/applied_routine_edits.json` for audit. Both audit files are committed by the sync.
     - **Workout log entries** (`type: "log"`) → `~/Documents/Jonathan's Vault/🎯 Projects/🏋️ Personal Trainer/Workout Log/YYYY-MM-DD-Day-Type.md` (one file per session, dual-unit weights: `95 lbs (43 kg)`). When the session captured cooldown completion data, the MD also includes a **Cool-down** section (type: library or fitnessplus, source_key, optional fitnessplus_name, completed_at).
     - **Skip entries** (`type: "skip"`) → `Workout Log/YYYY-MM-DD-Day-Type-Skipped.md`.
     - **Recovery entries** (`type: "recovery"`, sauna/cold plunge sessions) → `Recovery Log/YYYY-MM-DD-Location.md`. These can land on any day, including rest days. When `rounds_detail` is present, the MD renders a per-round breakdown (sauna/plunge minutes per round).
   - Appends a one-line entry to vault `Log.md` per workout session.
   - Appends a one-line entry to vault `Recovery Log.md` per recovery session.
   - Re-derives `data/routines/*.json` from vault `Weekly Plans/*.md` (reads optional `**Cool-down:**` line per day in addition to `**Warm-up:**`). Missing routine `end_date` values are generated as the day before the next routine's `start_date`; the latest routine remains open-ended. Weight parsing (`scripts/pt_common.parse_weight`) treats the **first authored unit** in a Working-Weight cell as canonical for `target_weight_kg`; parenthetical secondary units are rounded display text — so `25 lbs (11 kg)` re-derives to `11.34 kg` (not `11 kg`) and is never shown back as an impossible `24 lbs`.
   - Re-derives `data/logs/*.json` from vault `Workout Log/*.md` (idempotent).
   - Re-derives `data/recovery_logs/*.json` from vault `Recovery Log/*.md` (idempotent).
   - Recomputes `data/analytics.json` (weekly volume, lift progression, legacy `prs` plus the richer `personal_records` load/rep/volume PRs, `session_compliance` with planned-vs-completed, `recovery_count`, and `recovery_by_week`).
   - Regenerates `data/manifest.json` so the app and reports can discover routines/logs/recovery/exercises from same-origin static JSON instead of GitHub Contents directory listings.
   - Resets `data/pending.json` to `{entries: []}` if anything was drained.
   - Auto-commits with message `sync: drain N pending entries (YYYY-MM-DD)` and pushes if anything changed.

   If the script exits non-zero, capture stderr and stop. Do not swallow errors silently. If the vault project folder is missing, the script's own error message (`ERROR: vault project folder missing`) is sufficient — surface it verbatim.

3. **Verify.** Run `git status` (expect clean) and confirm `HEAD == origin/main` (it pushed). `git log -1 --oneline data/` shows the sync commit.

4. **Summary.** Print a brief summary: pending entries drained (with filenames, broken out by type — workout / skip / recovery), total logs aggregated, recovery sessions aggregated, PRs detected since the last run, latest commit hash if pushed. Keep it under 10 lines.

---

## Common failure recovery

- **"Unknown exercise" stderr warnings from sync.py:** Informational — the script slugifies the name and continues. Surface the names so they can be added to the `EXERCISE_ALIASES` dict in `scripts/pt_common.py` later (manual edit, not part of the sync itself).
- **Vault folder missing or empty** (sync.py reports `ERROR: vault project folder missing`, or `~/Documents/Jonathan's Vault/🎯 Projects/🏋️ Personal Trainer/` doesn't list expected subfolders like `Workout Log/`, `Weekly Plans/`): see the "Vault not materialized / missing" section below. The default rule is **abort and report** — never create the folder, never write empty stand-in MDs. Auto-recreating the vault would silently destroy the source of truth.
- **Git lock files** (`.git/index.lock`, etc.): rare for a live interactive session (it commits directly in the real checkout — no Cowork sandbox / disposable-clone bridge). If one appears and `lsof` confirms no live process holds it, `rm -f .git/index.lock` and retry the offending command once.

---

## Pre-conditions you can assume

- The vault is **materialized** at `~/Documents/Jonathan's Vault` (iCloud content downloaded locally, not `.icloud` placeholders — see below).
- The `pt-tracker` repo has a remote and is on the `main` branch.
- If you need codebase context (purpose, architecture, conventions), `CLAUDE.md` at the repo root is the project brief for fresh Claude sessions.

---

## Hard limits — do NOT do these

- Do not touch the worker, secrets, or anything outside `~/Git/pt-tracker/data/` and the vault Personal Trainer folder **during a sync run**.
- Do not refresh exercise images/videos — that is manual maintenance, not part of the sync.
- **During the sync run itself, do not hand-author or free-edit vault MD — just invoke `sync.py`.** The script writes the `Workout Log/` and `Recovery Log/` files and rewrites specific Weekly Plan cells for `routine_edit` pending entries. Authoring a **Weekly Plan** MD is a *separate, deliberate* step that happens when Jonathan asks to update the plan (see `CLAUDE.md` → "Syncing & updating the plan") — that is allowed for the interactive session because Jonathan directs the change. `Workout Log/` and `Recovery Log/` MDs are always `sync.py`-owned; never hand-edit those.

---

## Vault not materialized / missing

The vault lives at `~/Documents/Jonathan's Vault/🎯 Projects/🏋️ Personal Trainer/`. `~/Documents/` on this Mac is iCloud Drive–synced, so "available" really means "iCloud has the content materialized locally." When sync.py reports the project folder missing, run through these checks in order. **Stop at the first one that matches and report what you did.**

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

If `brctl` isn't available or fails, fall back to: `open "/Users/jonathanpeters/Documents/Jonathan's Vault/🎯 Projects/🏋️ Personal Trainer"`, then wait 30s. Even a passive Finder visit triggers the download.

### 3. Vault truly absent
If `~/Documents/Jonathan's Vault/` itself doesn't exist:
- Check iCloud sign-in status: `defaults read MobileMeAccounts Accounts 2>/dev/null | grep AccountID` should print at least one account. If empty, iCloud is signed out — this is a user-action problem; abort and report with that detail.
- If iCloud is signed in but the folder is still missing, the vault has been moved, renamed, or deleted. Abort and report. Do NOT create the folder.

### 4. Different vault location (rare)
If Jonathan has re-pointed the vault to a different location (external drive, Dropbox, Syncthing, etc.), update the path in `scripts/sync.py`'s `DEFAULT_VAULT` constant or set the `PT_TRACKER_VAULT_ROOT` env var. Surface the mismatch and confirm with Jonathan before changing a committed path.

---

## How to update this file

This is the source-of-truth reference for the sync internals. Edit it in a normal commit; the interactive session reads it at sync time — no Cowork UI paste is needed (that path is retired). Update it whenever something changes what the sync sees, writes, or skips:
- New `pending.json` entry type (currently: `log`, `skip`, `recovery`, `routine_edit`)
- New vault output path or filename convention
- New section in a vault MD that `sync.py` renders (e.g. Cool-down completion)
- New `data/<dir>/` snapshot generated or new analytics field
- Change to the "hard limits" / "don't touch" list
