# 🏋️ PT Tracker

Personal workout tracker — static web app on GitHub Pages backed by JSON in this repo, with the Obsidian vault as source of truth and an on-demand sync script that closes the loop.

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

The web app reads `data/manifest.json` and same-origin JSON snapshots from GitHub Pages. Writes go to the auth Worker (`POST /pending/append`); the Worker holds the encrypted PAT and updates `data/pending.json` via the GitHub Contents API. An on-demand sync script drains pending → vault MD, re-derives all snapshots, recomputes analytics + manifest, then commits + pushes.

## How to log a session

1. Open https://jcpeters08.github.io/pt-tracker/ on your phone (Add to Home Screen for PWA).
2. Sign in (one-time): email → 6-digit code → paste GitHub PAT.
3. Tap the day pill (Mon / Tue / …). Today is highlighted.
4. Edit weight/reps per set, mark Done, repeat per exercise.
5. Tap **Submit session** when done. The app asks the Worker to append to `data/pending.json` immediately.
6. At the next requested sync, the script writes `Workout Log/YYYY-MM-DD-Day-Type.md` to your vault and refreshes analytics.

## How to add a new routine

1. Create a new `Weekly Plans/YYYY-WXX-name.md` in your vault (mirror the format of `2026-W18-CDMX-Phase-1-Closeout.md`).
2. Run the on-demand sync:
   ```bash
   python3 ~/Git/pt-tracker/scripts/sync.py
   ```
3. The web app picks up the new routine on next load through `data/manifest.json`. The latest routine by `start_date` becomes the default; you can switch via the routine pill in the header.

> **Dual-unit weights — the first unit wins.** In a Working-Weight cell the first authored unit is canonical (stored as `target_weight_kg`); the parenthetical is rounded display text. `25 lbs (11 kg)` means 25 lb is intended (stored `11.34 kg`); `16 kg (35 lbs) ea` means 16 kg is intended. For Planet Fitness, lead with the real PF pounds so set inputs seed a valid weight.

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
- **Programmed target met** — latest logs whose sets met that week's programmed weight/reps/sets; this is not automatically a load-increase signal.
- **Actual vs planned** — planned routine days vs logged sessions for a routine week (defaults to `data/profile.json.active_routine`).
- **Body-area target bands** — weekly set totals per body area vs pragmatic target ranges.
- **Stale lifts** — active-routine exercises not trained in 7+/14+/21+ days.
- **Recovery correlation** — weekly compliance, recovery minutes, and PR signals (descriptive only).

## Sync on demand

Ask the interactive session to **"sync"** or **"update the workout plan."** It follows `docs/COWORK_SYNC_TASK.md`, the authoritative spec for the sync's drain order, outputs and hard limits.

The high-level steps:

1. `git pull --ff-only` in `~/Git/pt-tracker`
2. `python3 scripts/sync.py` — drains `data/pending.json` into vault MD, re-derives routine/log/recovery/profile snapshots, recomputes analytics and manifest, resets pending, auto-commits and pushes
3. Verify the checkout is clean and pushed, then report a summary. If the push is rejected, reconcile the local sync commit with `origin/main`, preserving newer incoming pending entries, before another sync.

**Pre-conditions:** vault materialized locally at `~/Documents/Jonathan's Vault`, repo on `main` with its remote configured. The script targets `~/Git/pt-tracker` regardless of the current directory unless `PT_TRACKER_REPO_ROOT` overrides it.

The former `pt-tracker-daily-sync` Cowork schedule is documented as disabled since 2026-06-21. Its wrapper and Git bridge are retained for possible future use; submitted workouts remain in pending until the next requested sync.

Direct invocation:
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
- **Set inputs show an impossible PF weight (e.g. `24 lbs`)** — fixed: set inputs now seed from the authored pounds in the routine's Working-Weight cell, so `25 lbs (11 kg)` seeds `25` (and submits `11.34 kg`), not `24` from the rounded `11 kg`. If you still see an odd value, confirm the cell's **first** unit is the one you intend (the first unit is authoritative — see *How to add a new routine*), then run `python3 scripts/audit_data.py .`.

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
