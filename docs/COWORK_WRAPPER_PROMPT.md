# Cowork wrapper prompt — paste-once into the Cowork task UI

This is the **only** thing that lives inside the Cowork task definition itself. It's a thin wrapper: pull latest, then read `docs/COWORK_SYNC_TASK.md` and execute. Everything else lives in the repo, version-controlled, and edits land automatically on the next run.

**Paste the contents of the fenced block below into the Cowork task `pt-tracker-daily-sync`. After that, never paste again unless this file itself changes** (e.g. working directory moves, lock-recovery logic changes, or you want to point Cowork at a different instructions file).

---

```
Daily PT Tracker sync — wrapper.

WORKING DIRECTORY: /Users/jonathanpeters/Git/pt-tracker
VAULT PROJECT: /Users/jonathanpeters/Documents/Jonathan's Vault/🎯 Projects/🏋️ Personal Trainer

1. cd to the working directory. Run `git pull --ff-only`. If it fails because of a stale lock file (`.git/index.lock`, `.git/ORIG_HEAD.lock`, `.git/objects/maintenance.lock`), remove the offending locks and retry once. Otherwise abort and report stderr verbatim — do not force-push, reset, or skip.

2. Make sure the vault is materialized locally. ~/Documents/ is iCloud Drive–synced on this Mac, so the vault folder can exist as `.icloud` placeholders that the sync script can't read. Run:
   `ls "/Users/jonathanpeters/Documents/Jonathan's Vault/🎯 Projects/🏋️ Personal Trainer/Workout Log/" 2>&1 | head -5`
   Three cases:
   - **Real `.md` files listed** → vault is live, continue to step 3.
   - **Filenames ending in `.icloud`** (e.g. `.2026-05-14-Friday-Upper-Hybrid.md.icloud`) → iCloud evicted the content. Materialize it:
     `brctl download "/Users/jonathanpeters/Documents/Jonathan's Vault/🎯 Projects/🏋️ Personal Trainer"`
     Wait ~30 seconds, then re-run the `ls` above. If `brctl` errors or content still shows `.icloud`, fall back to:
     `open "/Users/jonathanpeters/Documents/Jonathan's Vault/🎯 Projects/🏋️ Personal Trainer"`
     (a Finder visit forces iCloud to download). Wait another 30s, recheck. If it's still not materialized, abort and report.
   - **"No such file or directory"** → vault folder is missing entirely. Abort and report — do NOT create the folder, that would silently erase the source of truth. `docs/COWORK_SYNC_TASK.md` "Vault not mounted / missing" section has deeper diagnostics (iCloud sign-in check, etc.) if needed.

3. Read `docs/COWORK_SYNC_TASK.md` in the working directory. That file is the authoritative spec for this scheduled task. Follow its steps verbatim, including its failure-recovery and hard-limits sections. Do not improvise beyond what it says.

Pre-conditions: Mac is on; repo is on `main` with a remote.
```

---

## Why this design

- **Single source of truth in git.** Updates to what the task does flow through a normal repo commit. No more "I updated the local SKILL.md but Cowork still shows the old prompt."
- **No drift between local Claude Code MCP and Cowork.** Anything either tool writes to `docs/COWORK_SYNC_TASK.md` is picked up by both on the next read.
- **`CLAUDE.md` wrap-up checkpoint catches schema/feature changes.** New entry types, new MD sections, new vault paths — when those land, the same commit that ships the feature also edits `docs/COWORK_SYNC_TASK.md`. The next 8:03 AM run sees both.
- **The wrapper prompt itself is short and stable.** It rarely needs to change — only the three things that *must* happen before the doc can be read live in here: git pull (gets latest doc + sync.py), vault materialization (iCloud Drive can evict content), and the pointer to the doc file. Deeper recovery and the actual sync logic live in `docs/COWORK_SYNC_TASK.md`.
