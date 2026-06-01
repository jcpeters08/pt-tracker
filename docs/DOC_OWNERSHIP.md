# PT Tracker Doc Ownership

Use this when a project fact changes and you need to decide where to update it.

| File | Owns | Does not own |
|---|---|---|
| `README.md` | Human-facing overview, usage, deploy, troubleshooting, and validation commands. | Agent operating rules or historical discrepancy notes. |
| `CLAUDE.md` | Claude-facing operating rules, architecture conventions, gotchas, schema notes. | Paste-once Cowork wrapper text. |
| `AGENTS.md` | Codex-facing operating rules, architecture conventions, gotchas, schema notes. | Paste-once Cowork wrapper text. |
| `docs/COWORK_SYNC_TASK.md` | What the daily scheduled sync does, expects, writes, skips, and reports. | General app usage or deploy instructions. |
| `docs/COWORK_WRAPPER_PROMPT.md` | The Cowork UI wrapper prompt only. | Daily sync behavior details. |
| `worker/README.md` | Auth Worker endpoints, deploy, local dev, secrets, and KV behavior. | Main app architecture beyond Worker boundaries. |
| `docs/IOS_APP_ARCHITECTURE.md` | Native iPhone app migration architecture and sequencing. | Current production PWA usage instructions. |
| Vault `Overview.md` | Current training/project status and active routine. | Web app operational source of truth. |
| Vault `Web-App-Build-Brief.md` | Historical/original build spec. | Current sync/auth/deploy truth. |

Run `python3 scripts/audit_docs.py .` before committing doc changes that touch duplicated operational facts.
