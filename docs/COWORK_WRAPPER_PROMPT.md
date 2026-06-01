# Cowork wrapper prompt — paste-once into the Cowork task UI

This is the **only** thing that lives inside the Cowork task definition itself. It's a thin wrapper: prepare a disposable Git checkout under `/tmp`, then read `docs/COWORK_SYNC_TASK.md` from that checkout and execute. Everything else lives in the repo, version-controlled, and edits land automatically on the next run.

**Paste the contents of the fenced block below into the Cowork task `pt-tracker-daily-sync`. After that, never paste again unless this file itself changes** (e.g. mounted source path moves, disposable checkout path changes, bridge invocation changes, or you want to point Cowork at a different instructions file).

---

```
Daily PT Tracker sync — wrapper.

MOUNTED SOURCE CHECKOUT: /Users/jonathanpeters/Git/pt-tracker
DISPOSABLE GIT CHECKOUT: /tmp/pt-tracker-cowork-git
VAULT PROJECT: /Users/jonathanpeters/Documents/Jonathan's Vault/🎯 Projects/🏋️ Personal Trainer

1. cd to the mounted source checkout. Do **not** run `git pull`, `git add`, `git commit`, `git push`, or lock cleanup in this mounted checkout. Cowork's sandbox mount can leave undeletable `.git/*.lock` files there. Instead, prepare a disposable Git checkout:
   `python3 scripts/cowork_git_bridge.py --prepare-only --workdir /tmp/pt-tracker-cowork-git`
   If this fails, report stderr verbatim and abort. Do not force-push, reset, or skip.

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

3. cd to `/tmp/pt-tracker-cowork-git`. Read `docs/COWORK_SYNC_TASK.md` there. That file is the authoritative spec for this scheduled task. Follow its steps verbatim, including its failure-recovery and hard-limits sections. Do not improvise beyond what it says.

Pre-conditions: Mac is on; repo is on `main` with a remote.
```

---

## Why this design

- **Single source of truth in git.** Updates to what the task does flow through a normal repo commit. No more "I updated the local SKILL.md but Cowork still shows the old prompt."
- **Git writes avoid the sandbox-mounted checkout.** Cowork reads the mounted checkout only to run the bridge. The bridge reads `remote.origin.url` from `.git/config` without invoking Git there, then all pull/add/commit/push work happens in `/tmp/pt-tracker-cowork-git`.
- **No drift between local Claude Code MCP and Cowork.** Anything either tool writes to `docs/COWORK_SYNC_TASK.md` is picked up by both on the next read.
- **`CLAUDE.md` wrap-up checkpoint catches schema/feature changes.** New entry types, new MD sections, new vault paths — when those land, the same commit that ships the feature also edits `docs/COWORK_SYNC_TASK.md`. The next 8:03 AM run sees both.
- **The wrapper prompt itself is short and stable.** It rarely needs to change — only the three things that *must* happen before the doc can be read live in here: disposable checkout preparation, vault materialization (iCloud Drive can evict content), and the pointer to the doc file. Deeper recovery and the actual sync logic live in `docs/COWORK_SYNC_TASK.md`.
