# 🏋️ PT Tracker

Personal workout tracker — static web app on GitHub Pages backed by JSON in this repo, with the Obsidian vault as source of truth and a daily sync script that closes the loop.

**Live app:** https://jcpeters08.github.io/pt-tracker/
**Reports:** https://jcpeters08.github.io/pt-tracker/reports.html

## Architecture (four layers)

```
Vault (source of truth)             Repo (data + viewer)            Live web app           Auth Worker
────────────────────────            ─────────────────────           ───────────────         ─────────────────
Weekly Plans/*.md           ──→     data/routines/*.json     ──→    index.html       ──→    pt-tracker-auth
Workout Log/*.md            ←─→     data/logs/*.json         ←─→    reports.html
Overview.md                 ──→     data/profile.json
Log.md                      ←──     (appended by sync)
                                    data/manifest.json       ←──    (sync recomputes)
                                    data/pending.json        ←──    (Worker appends)
                                    data/analytics.json      ←──    (sync recomputes)
```

The web app reads `data/manifest.json` and same-origin JSON snapshots from GitHub Pages. Writes go to the auth Worker (`POST /pending/append`); the Worker holds the encrypted PAT and updates `data/pending.json` via the GitHub Contents API. A daily sync script drains pending → vault MD, re-derives all snapshots, recomputes analytics + manifest, then commits + pushes.

## How to log a session

1. Open https://jcpeters08.github.io/pt-tracker/ on your phone (Add to Home Screen for PWA).
2. Sign in (one-time): email → 6-digit code → paste GitHub PAT.
3. Tap the day pill (Mon / Tue / …). Today is highlighted.
4. Edit weight/reps per set, mark Done, repeat per exercise.
5. Tap **Submit session** when done. The app asks the Worker to append to `data/pending.json` immediately.
6. Overnight, the sync script writes `Workout Log/YYYY-MM-DD-Day-Type.md` to your vault.

## How to add a new routine

1. Create a new `Weekly Plans/YYYY-WXX-name.md` in your vault (mirror the format of `2026-W18-CDMX-Phase-1-Closeout.md`).
2. Wait for the next sync run, or run it manually:
   ```bash
   python3 ~/Git/pt-tracker/scripts/sync.py
   ```
3. The web app picks up the new routine on next load through `data/manifest.json`. The latest routine by `start_date` becomes the default; you can switch via the routine pill in the header.

## How to add a new exercise

1. Create `data/exercises/<id>.json` (see existing files for shape). Populate `image_url` (required — non-null) and `video_url` with verified URLs in the same commit, plus `image_source`/`image_match`.
2. If the exercise gets used in a routine MD or workout log MD, add an alias entry to the dict at the top of `scripts/pt_common.py` mapping the free-text name(s) → the canonical id.
3. Commit + push. The web app picks it up on next load.

## Exercise images and videos

All exercise files in `data/exercises/` currently have populated `image_url` (images from `yuhonas/free-exercise-db`, Wikimedia Commons fallback) and `video_url` (YouTube / muscleandstrength). When adding a new exercise, populate both with verified URLs in the same commit — a non-null `image_url` is required (see the "every exercise … must have a non-null `image_url`" convention in `CLAUDE.md` / `AGENTS.md`), and document the source in `image_source` + `image_match`.

## Reports

Open **Reports** from the day-view header (`reports.html`) — read-only; it reads the same same-origin JSON the app does (no sign-in needed). All weights display in **pounds** (storage stays kg). Available reports:

- **Weekly volume by muscle** — working sets per muscle, last 8 weeks.
- **Lift progression** — per-exercise top-set and total volume on *performed dates only* (point markers, not connected lines), in lbs.
- **Training calendar** — month grid with workout + recovery markers, plus a week drilldown.
- **Personal records** — load/rep/volume PRs in lbs, grouped by body area (filterable).
- **Ready to progress** — lifts whose latest logged sets met the programmed weight/reps/sets.
- **Actual vs planned** — planned routine days vs logged sessions for a routine week (defaults to `data/profile.json.active_routine`).
- **Body-area target bands** — weekly set totals per body area vs pragmatic target ranges.
- **Stale lifts** — active-routine exercises not trained in 7+/14+/21+ days.
- **Recovery correlation** — weekly compliance, recovery minutes, and PR signals (descriptive only).

## Daily sync — Cowork scheduled task

A Cowork scheduled task fires daily at 8:03 CT (mirrors the TV Concierge setup). It runs as Claude on your Mac, so it has access to the vault.

- **Task id:** `pt-tracker-daily-sync`
- **Cron:** `3 8 * * *` (local time)
- **Authoritative spec:** `docs/COWORK_SYNC_TASK.md` (version-controlled in this repo). Cowork's UI holds only a thin wrapper that does `git pull` then reads and runs that file — see `docs/COWORK_WRAPPER_PROMPT.md` for the paste-once wrapper text.
- **Manage:** the "Scheduled" section in the Claude sidebar — pause, disable, or run on demand from there

The high-level steps it runs:

1. `git pull --ff-only` in `~/Git/pt-tracker`
2. `python3 scripts/sync.py` — drains `data/pending.json` into vault MD, re-derives JSON snapshots from vault MD, recomputes `data/analytics.json` and `data/manifest.json`, resets pending, auto-commits and pushes
3. Reports a summary

**Pre-conditions:** Mac on, vault mounted at `~/Documents/Jonathan's Vault`, repo on `main`.

You can also run sync on demand:
```bash
python3 ~/Git/pt-tracker/scripts/sync.py
```

## One-time GitHub PAT setup

After the auth Worker is deployed and you sign in to the app for the first time, it'll prompt you to paste a fine-grained PAT. Steps:

1. Go to https://github.com/settings/tokens?type=beta → **Generate new token (fine-grained)**.
2. **Repository access:** Only select repositories → `jcpeters08/pt-tracker`.
3. **Permissions → Repository → Contents:** Read and write.
4. Set an expiration (1 year is reasonable). Generate.
5. Copy the `github_pat_...` value, paste into the app, click **Test & save**. The Worker validates against GitHub, then encrypts and stores it.

The PAT lives only in encrypted KV on the Worker. The browser never receives the decrypted PAT after setup; submits go through `POST /pending/append`. Sign in on a new device and the Worker can write for you without re-pasting the token.

## Rotating the encryption key

If `PAT_ENC_KEY` rotates, all existing `pat:<email>` ciphertexts become unreadable. Sign back in, re-paste the PAT, the new key encrypts it. See `worker/README.md`.

## Auth Worker

Lives at `worker/`. Deploy:

```bash
cd worker
npm install
npx wrangler login
npx wrangler kv namespace create pt_tracker_auth_kv
npx wrangler kv namespace create pt_tracker_auth_kv --preview
# Paste the returned IDs into wrangler.toml
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put PAT_ENC_KEY     # openssl rand -base64 32
npx wrangler deploy
```

Allowlist: `jcpeters08@gmail.com`. Update `ALLOWED_EMAILS` in `worker/wrangler.toml` and redeploy to add others.

## Troubleshooting

- **PAT 401 in submit** — your PAT expired or got revoked. Sign out (⏻ in the header), sign back in, paste a fresh PAT.
- **Day shows "Rest" but you have a workout planned** — the routine MD's day section header (`## Mon 5/4 — Push (...)`) didn't parse. Verify the format matches `2026-W18-CDMX-Phase-1-Closeout.md`.
- **Pages deploy stuck** — check the **Actions** tab on GitHub. The deploy workflow is in `.github/workflows/deploy.yml`.
- **Re-submitting a session** — a `log`/`skip`/`recovery` resubmit OVERWRITES the existing vault MD by design (correction/edit workflow); you no longer need to delete the MD to re-sync. The `Log.md` index line is appended only on the first write.
- **Unknown exercise in sync output** — add an entry to `EXERCISE_ALIASES` in `scripts/pt_common.py` and re-run sync.

## Validation

```bash
python3 -m pytest tests/ -q
npm test
npx playwright test
( cd worker && npm test )
python3 scripts/audit_data.py .
python3 scripts/audit_docs.py .
```

## See also

- Build brief (historical): `🎯 Projects/🏋️ Personal Trainer/Web-App-Build-Brief.md` in the vault
- Doc ownership: `docs/DOC_OWNERSHIP.md`
- iPhone app architecture: `docs/IOS_APP_ARCHITECTURE.md`
- Worker docs: `worker/README.md`
