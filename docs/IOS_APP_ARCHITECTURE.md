# PT Tracker iPhone App Architecture

**Status:** Proposed  
**Date:** 2026-05-31  
**Decision:** Build the first native iPhone version as a Capacitor shell around the existing static app, after keeping GitHub writes behind the Worker.

## Context

The current app is a GitHub Pages PWA with the Obsidian vault as source of truth. The daily sync remains the durable backend: pending entries drain into vault Markdown, JSON snapshots are re-derived, analytics and manifest are regenerated, then the repo is pushed.

The iPhone app should preserve that backend instead of inventing a new database. The main native-app risks are token exposure, offline behavior, and duplicating UI logic.

## Decision

Use a phased native path:

1. **PWA hardening, now complete enough to proceed:** `data/manifest.json` removes read-time GitHub Contents listings; `POST /pending/append` moves GitHub writes behind the Worker; frontend logic is split into ES modules.
2. **Capacitor app shell:** wrap the existing app assets, use native secure storage for the session id, add haptics around Done/Submit, and define offline behavior.
3. **Selective native screens later:** only rewrite high-value flows in SwiftUI if the web shell feels constrained.

## Options Considered

| Option | Assessment |
|---|---|
| PWA only | Lowest cost, already works, but no App Store/TestFlight, limited native storage/haptics. |
| Capacitor shell | Best first native step. Reuses the current web app while allowing secure storage, haptics, TestFlight, and later native plugins. |
| Full SwiftUI rewrite | Best native feel, highest duplication and highest risk because workout/recovery/report logic would be reimplemented. |

## Target Architecture

```
iPhone app (Capacitor)
  ├─ bundled HTML/CSS/JS assets
  ├─ native secure storage for sid
  ├─ haptics around Done/Submit
  └─ HTTPS
      ├─ GitHub Pages data reads (manifest + JSON)
      └─ Auth Worker writes (POST /pending/append)

Auth Worker
  ├─ email-code auth
  ├─ encrypted PAT in KV
  └─ GitHub Contents write to data/pending.json

Daily sync
  └─ pending → vault MD → generated JSON/analytics/manifest → commit/push
```

## Offline Policy

First native version should be **read-mostly offline**:

- Cached assets and last-fetched JSON may render without network.
- Submitting while offline should queue locally only after a visible "queued locally" state exists.
- The first release may disable submit offline if queue/retry is not implemented yet.

## Acceptance Criteria For The First Native Build

- Existing PWA behavior still passes Playwright tests.
- The app never receives a decrypted PAT from the Worker.
- App reads use `data/manifest.json` and same-origin JSON files.
- App writes use `POST /pending/append`.
- Session id is stored in native secure storage once Capacitor is added.
- Offline submit behavior is explicit: either disabled with a clear message or queued with retry/status.
