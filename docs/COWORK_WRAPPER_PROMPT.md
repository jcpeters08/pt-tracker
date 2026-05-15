# Cowork wrapper prompt — paste-once into the Cowork task UI

This is the **only** thing that lives inside the Cowork task definition itself. It's a thin wrapper: pull latest, then read `docs/COWORK_SYNC_TASK.md` and execute. Everything else lives in the repo, version-controlled, and edits land automatically on the next run.

**Paste the contents of the fenced block below into the Cowork task `pt-tracker-daily-sync`. After that, never paste again unless this file itself changes** (e.g. working directory moves, lock-recovery logic changes, or you want to point Cowork at a different instructions file).

---

```
Daily PT Tracker sync — wrapper.

WORKING DIRECTORY: /Users/jonathanpeters/Git/pt-tracker

1. cd to the working directory. Run `git pull --ff-only`. If it fails because of a stale lock file (`.git/index.lock`, `.git/ORIG_HEAD.lock`, `.git/objects/maintenance.lock`), remove the offending locks and retry once. Otherwise abort and report stderr verbatim — do not force-push, reset, or skip.

2. Read `docs/COWORK_SYNC_TASK.md` in the working directory. That file is the authoritative spec for this scheduled task. Follow its steps verbatim, including its failure-recovery, pre-conditions, and hard-limits sections. Do not improvise beyond what it says.

Pre-conditions: Mac is on, vault is mounted at `~/Documents/Jonathan's Vault`, repo is on `main` with a remote.
```

---

## Why this design

- **Single source of truth in git.** Updates to what the task does flow through a normal repo commit. No more "I updated the local SKILL.md but Cowork still shows the old prompt."
- **No drift between local Claude Code MCP and Cowork.** Anything either tool writes to `docs/COWORK_SYNC_TASK.md` is picked up by both on the next read.
- **`CLAUDE.md` wrap-up checkpoint catches schema/feature changes.** New entry types, new MD sections, new vault paths — when those land, the same commit that ships the feature also edits `docs/COWORK_SYNC_TASK.md`. The next 8:03 AM run sees both.
- **The wrapper prompt itself is short and stable.** It rarely needs to change. Only step 1 (pull + lock recovery) and the pointer to the doc file live there.
