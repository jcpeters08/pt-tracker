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
                                    data/pending.json        ←──    (web app appends)
                                    data/analytics.json      ←──    (sync recomputes)
```

The web app reads JSON same-origin, fetches a GitHub PAT from the auth Worker, and writes new sessions to `data/pending.json` via the GitHub Contents API. A daily sync script drains pending → vault MD, re-derives all snapshots, recomputes analytics, then commits + pushes.

## How to log a session

1. Open https://jcpeters08.github.io/pt-tracker/ on your phone (Add to Home Screen for PWA).
2. Sign in (one-time): email → 6-digit code → paste GitHub PAT.
3. Tap the day pill (Mon / Tue / …). Today is highlighted.
4. Edit weight/reps per set, mark Done, repeat per exercise.
5. Tap **Submit session** when done. The app writes to `data/pending.json` immediately.
6. Overnight, the sync script writes `Workout Log/YYYY-MM-DD-Day-Type.md` to your vault.

## How to add a new routine

1. Create a new `Weekly Plans/YYYY-WXX-name.md` in your vault (mirror the format of `2026-W18-CDMX-Phase-1-Closeout.md`).
2. Wait for the next sync run, or run it manually:
   ```bash
   python3 ~/Git/pt-tracker/scripts/sync.py
   ```
3. The web app picks up the new routine on next load. The most-recent routine (by id) becomes the default; you can switch via the routine pill in the header.

## How to add a new exercise

1. Create `data/exercises/<id>.json` (see existing files for shape). Fill in `image_url` and `video_url` if you have stable URLs.
2. If the exercise gets used in a routine MD or workout log MD, add an alias entry to the dict at the top of `scripts/pt_common.py` mapping the free-text name(s) → the canonical id.
3. Commit + push. The web app picks it up on next load.

## How to populate exercise images and videos

See `TODO_EXERCISES.md` — every exercise has `image_url: null` and `video_url: null` by default. Populate them with verified URLs (Wikimedia Commons for images; Athlean-X / Jeff Nippard YouTube for videos) and the day-view cards become much more useful.

## Daily sync — Cowork scheduled task

The sync script runs at 8:00 CT daily. Set up via Cowork:

- **Title:** PT Tracker daily sync
- **Schedule:** `0 8 * * *` (Central time)
- **Command:** `python3 ~/Git/pt-tracker/scripts/sync.py`

Or as a launchd job locally — see `scripts/sync.py` for env vars (`PT_TRACKER_VAULT_ROOT`, `PT_TRACKER_REPO_ROOT`).

You can also run it on demand:
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

The PAT lives only in encrypted KV on the Worker, never in your browser, never on your laptop. Sign in on a new device and it's already there.

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
- **Sync skipped a session as "already exists"** — the vault MD for that date already exists, by design. To re-sync, delete the MD and re-run.
- **Unknown exercise in sync output** — add an entry to `EXERCISE_ALIASES` in `scripts/pt_common.py` and re-run sync.

## See also

- Build brief: `🎯 Projects/🏋️ Personal Trainer/Web-App-Build-Brief.md` in the vault
- Worker docs: `worker/README.md`
