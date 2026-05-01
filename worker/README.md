# pt-tracker-auth

Cloudflare Worker that handles email-code sign-in and vaults the GitHub PAT for the PT Tracker web app, so any device that signs in inherits the same token without re-running setup.

## Architecture

- `POST /auth/request {email}` — emails a 6-digit code via Resend (allowlist-protected).
- `POST /auth/verify-code {email, code}` — verifies the code, mints a session, returns `{sid}` as JSON. Code-based (not magic-link) so the iOS PWA flow stays in one tab.
- `GET  /auth/me` — returns the signed-in email or 401.
- `POST /auth/logout` — invalidates the current session.
- `GET  /pat` — returns the decrypted PAT (or `null` if not yet stored).
- `PUT  /pat {pat}` — encrypts and stores the PAT (AES-GCM with a Worker secret key).

Sessions, codes, and the encrypted PAT live in a single Cloudflare KV namespace:

| Key | Value | TTL |
|---|---|---|
| `code:<email>` | `{code, attempts}` | 15 min |
| `session:<sid>` | `{email}` | 30 days |
| `pat:<email>` | base64(IV ‖ AES-GCM ciphertext) | none |

The frontend uses the session id as a Bearer token. We do **not** use cookies — that avoids cross-origin cookie complications between GitHub Pages and `*.workers.dev`.

## One-time deploy

Run from this directory.

```bash
npm install

# 1. Authenticate to Cloudflare (browser OAuth).
npx wrangler login

# 2. Create the KV namespaces and paste the returned IDs into wrangler.toml.
npx wrangler kv namespace create pt_tracker_auth_kv
npx wrangler kv namespace create pt_tracker_auth_kv --preview

# 3. Set secrets (you'll be prompted for each value).
npx wrangler secret put RESEND_API_KEY     # paste your Resend API key
npx wrangler secret put PAT_ENC_KEY        # paste a base64'd 32-byte key

# Generate PAT_ENC_KEY locally:
openssl rand -base64 32

# 4. Deploy.
npx wrangler deploy
```

Wrangler will print the worker URL (e.g. `https://pt-tracker-auth.<subdomain>.workers.dev`). Update the frontend's `WORKER_URL` constant with that value.

## Local dev

```bash
npx wrangler dev
```

Wrangler dev uses the `preview_id` KV namespace and prompts for any missing secrets. Hit `http://localhost:8787/auth/me` with a Bearer token to smoke-test.

## Rotating the encryption key

If `PAT_ENC_KEY` rotates, all existing `pat:<email>` ciphertexts become unreadable. Sign in fresh on any device, re-enter the PAT, and the new key encrypts it.

## Updating the allowlist

Edit `ALLOWED_EMAILS` in `wrangler.toml` (comma-separated) and redeploy.
