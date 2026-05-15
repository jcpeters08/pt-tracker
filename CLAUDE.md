# CLAUDE.md — PT Tracker

If you're a new Claude session opening this repo, read this first.

## What this is

Personal workout tracker. Static web app on GitHub Pages, JSON in this repo, Obsidian vault as source of truth, daily sync script closes the loop. PWA on iPhone home screen is the primary input device.

Live app: https://jcpeters08.github.io/pt-tracker/ · Reports: https://jcpeters08.github.io/pt-tracker/reports.html

## 4-layer architecture

```
Vault (source of truth)             Repo (data + viewer)            Live web app        Auth Worker
────────────────────────            ─────────────────────           ───────────────     ─────────────────
Weekly Plans/*.md           ──→     data/routines/*.json     ──→    index.html     ──→  pt-tracker-auth
Workout Log/*.md            ←─→     data/logs/*.json         ←─→    reports.html
Recovery Log/*.md           ←─→     data/recovery_logs/*.json
Overview.md                 ──→     data/profile.json
Log.md                      ←──     (appended by sync)
Recovery Log.md             ←──     (appended by sync)
                                    data/pending.json        ←──    (web app appends)
                                    data/analytics.json      ←──    (sync recomputes)
```

The web app appends to `data/pending.json` via the GitHub Contents API using a PAT vaulted in the auth Worker. The daily scheduled task at 8:03 CT drains pending → vault MD, re-derives JSON from MD, recomputes analytics, commits + pushes.

See `README.md` for deploy and how-to-log details.

## Critical conventions — DON'T BREAK

1. **Storage canonical = kg. Display = lbs (user preference, kg toggle available).** Every `weight_kg` field is the truth. lbs is derived at render time. Don't refactor to lbs-canonical — analytics, parsers, and sync all depend on kg.

2. **Vault MD is source of truth.** `scripts/sync.py` re-derives `data/routines/*.json`, `data/logs/*.json`, `data/recovery_logs/*.json` from vault MD every morning. Editing a JSON in the repo without also updating the corresponding vault MD gets reverted on the next sync. To make a routine change permanent, edit the Weekly Plan MD via the Cowork pattern (below).

3. **Routine MDs use a fixed day-header format**: `## Mon 5/4 — Push (Chest / Shoulders / Triceps)` — day name (short or long), date `M/D`, em-dash separator, label. Parsed by `scripts/parse_routine.py`.

4. **Routine MDs support optional `**Warm-up:**` and `**Cool-down:**` lines** per day. When `Cool-down` is absent, the app falls back to the curated library in `data/cooldowns.json` keyed by muscle group.

5. **Pre-dedupe on append**: the web app's `appendPending()` removes any existing pending entry for the same slot before pushing a new one. Workouts dedupe by `(date, day_of_week, type)`; recovery by `(date, location)`.

6. **localStorage drafts auto-save** on every Done click, weight input, rep edit, exercise note, session note, cooldown completion, and recovery round change. Keyed by `pt_tracker_draft_v1:<date>|<day>|<type>` (workout) or `pt_tracker_recovery_draft_v1:<date>` (recovery). Cleared on successful submit. GC'd at 5 days.

7. **Identical-payload re-submission is refused.** Each submitter compares the current payload's signature against the last successful submission; identical payloads get a toast ("Already submitted — change something to log again") instead of silently writing a duplicate.

## Glossary

- **W18 / W20** — ISO week number prefix on routine ids (e.g. `2026-W18-CDMX-Phase-1-Closeout`, `2026-W20-Phase-2-Launch-Reentry`)
- **Phase 1** — Mexico City era (CDMX), dumbbell-focused, with personal trainer. Capped 2026-05-10.
- **Phase 2** — Minneapolis Planet Fitness, solo, barbell-capable. Active.
- **PF** — Planet Fitness (Minneapolis). DBs in 5-lb increments (5/10/.../80 lb), real barbell with 2.5/5/10/25/35/45-lb plates, cable stacks usually 5-lb increments. **No 22-lb dumbbells exist** — round to nearest 5-lb when picking defaults.
- **CDMX** — Ciudad de México; the user lived there during Phase 1
- **Embrace North** — sauna + cold plunge studio in Minneapolis. Typical pattern: 2–3 rounds, 15 min sauna + 3–5 min plunge per round
- **Thermocycling** — sauna + cold-plunge contrast therapy
- **"Hold X ceiling"** — routine note meaning "don't push past prior limit this week"
- **"Hold 5/1 PR"** — held the personal record set on May 1 specifically; don't push past it

## Schema highlights

- **Pending entry types**: `log` (workout), `skip` (didn't do the workout), `recovery` (sauna/plunge)
- **Recovery has `rounds_detail`** — array of `{round, sauna_min, plunge_min}`. Summary fields (`rounds`, `sauna_min`, `plunge_min`, `total_min`) are derived from it. Backward-compatible with old uniform-round entries.
- **Workout logs have an optional `cooldown` field**: `{type: "library"|"fitnessplus", source_key, fitnessplus_name, completed_at}` — populated when user clicks "Mark cool-down complete" in the app. Renders as a `## Cool-down` section in vault MD.
- **Weight rendering in vault MD**: `_format_weight` in `sync.py` outputs `"<lbs> lbs (<kg> kg)"` (lbs primary, integer-rounded). Routine MDs use the same format.

## Operational pointers

- **Daily sync**: Cowork scheduled task `pt-tracker-daily-sync`. Cron `3 8 * * *` (8:03 CT local). The task's authoritative spec is `docs/COWORK_SYNC_TASK.md` (this repo, version-controlled) — Cowork's UI holds only a thin wrapper that pulls latest and reads that file. See `docs/COWORK_WRAPPER_PROMPT.md` for the paste-once wrapper text. Pre-conditions: Mac on, vault mounted, repo on `main`.
- **Auth Worker**: `worker/` directory. Live at `https://pt-tracker-auth.ositodelnorte.workers.dev`. Cloudflare KV stores encrypted PAT keyed by email. Allowlist: `jcpeters08@gmail.com`.
- **Vault path**: `~/Documents/Jonathan's Vault/🎯 Projects/🏋️ Personal Trainer/`
- **Vault MD edits via Cowork**: direct filesystem access to the vault is sandboxed from a Claude Code session in this repo. Use a separate Cowork session (which has full vault access) for MD updates. Pattern:
  1. Specify the exact file path
  2. List the precise edits to make (use `Edit`, not `Write`, to preserve hand-edits)
  3. Provide a verification command (parser invocation)
  4. Tell Cowork "Do NOT commit. The 8:03 sync will pick it up."

## Known quirks / gotchas

- **`~/Documents/` is iCloud Drive–synced on this Mac** (firmlinked to `~/Library/Mobile Documents/com~apple~CloudDocs/Documents/` via macOS's "Desktop & Documents Folders" feature). The vault lives inside it, so iCloud can evict file content and leave `.icloud` placeholder files that look like real files to `ls` but can't actually be read. The Cowork wrapper has a materialization step (`brctl download` with `open` fallback) before running sync, but ad-hoc scripts that touch the vault should also account for this. Detection: if `ls ~/Documents/Jonathan\'s\ Vault/` shows files starting with `.` and ending in `.icloud`, the content isn't local.
- **"Back Squat" alone resolves to a volume-summary row** in `scripts/parse_log.py` because `pt_common.VOLUME_SUMMARY_PREFIXES` includes `"back"` (intended to match rows like "Back: 12 sets"). Workaround: always write "Barbell Back Squat" in routine MD. Pre-existing bug, low priority.
- **`image_url` is null for every move in `data/cooldowns.json`.** The cooldown card shows a 🧘 emoji placeholder. Populate over time using stable URLs (same pattern as `data/exercises/*.json image_url`).
- **PF doesn't have 22-lb dumbbells.** When picking default weights, use real PF increments (5/10/15/20/25/30/35/40/45/50/55/60/65/70/75/80 lb DBs). Straight kg→lb conversion gives nonsense values.
- **Routine JSON edits without matching vault MD get reverted by the next 8:03 sync.** Always edit the vault MD too (via Cowork) when changing a routine.

## Where to look for more

- `README.md` — full architecture, deploy, sign-in flow, how to add routine/exercise
- `git log --oneline -30` — every recent change with rationale in the commit message
- `TODO_EXERCISES.md` — exercise image/video population tracker
- `worker/README.md` — auth Worker deploy
- Vault `Web-App-Build-Brief.md` — original build brief (referenced but not yet ingested into this brief)

## Wrap-up checkpoints (proactive offers at session end)

When something material lands (new feature, new convention, new gotcha, schema change), the active Claude session **proactively offers** updates at session wrap-up. The user can also explicitly say "update CLAUDE.md" or "check the task doc" at any time. Trivial bug fixes / wording tweaks don't trigger an offer.

1. **CLAUDE.md** — does anything new (feature, convention, gotcha, schema change) need to be reflected here?
2. **`docs/COWORK_SYNC_TASK.md`** — this file is the authoritative spec for the daily Cowork scheduled task. Cowork's UI holds only a thin wrapper that pulls latest and reads this file, so any change that affects what the daily sync sees, writes, or skips needs to be reflected here. Common triggers:
   - New `pending.json` entry type (currently: `log`, `skip`, `recovery`)
   - New vault output path or filename convention
   - New section in a vault MD that `sync.py` renders (e.g. Cool-down completion)
   - New `data/<dir>/` snapshot generated or new analytics field
   - Change to the "hard limits" / "don't touch" list
   When updating this file, no Cowork UI paste is needed — the next 8:03 AM run picks up the change automatically. If the **wrapper prompt itself** changes (rare — see `docs/COWORK_WRAPPER_PROMPT.md`), the user has to paste the new wrapper into the Cowork UI once.

Don't commit speculative refactors. User vets architectural moves before they're written.
