#!/usr/bin/env python3
"""Bidirectional vault ↔ repo sync for PT Tracker.

Pure stdlib. Vault MD is source of truth. The web app appends entries to
data/pending.json; this script drains them into Workout Log/*.md, then
re-derives JSON snapshots from the vault, resets pending, and commits +
pushes if anything changed.

Run from anywhere — paths resolve from env or sensible defaults.

Algorithm:
  1. git pull --ff-only
  2. Drain data/pending.json. For each "log" entry:
       - Write Workout Log/YYYY-MM-DD-Day-Type.md (canonical template) iff
         no MD file exists for that id. Otherwise skip with a warning.
       - Append a one-line entry to vault Log.md.
  3. Re-derive snapshots:
       - Parse Weekly Plans/*.md → data/routines/*.json
       - Parse Workout Log/*.md → data/logs/*.json
       - Parse Overview.md → data/profile.json (light)
  4. Recompute data/analytics.json
  5. Reset pending.json → {entries: []}
  6. git add data/ → commit + push if anything changed.

Env overrides:
  PT_TRACKER_VAULT_ROOT   path to "Jonathan's Vault" (default: ~/Documents/Jonathan's Vault)
  PT_TRACKER_REPO_ROOT    path to repo (default: ~/Git/pt-tracker)
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

import pt_common as pc                       # noqa: E402
import parse_routine as pr                   # noqa: E402
import parse_log as pl                       # noqa: E402
import compute_analytics as ca               # noqa: E402

DEFAULT_VAULT = Path.home() / "Documents" / "Jonathan's Vault"
DEFAULT_REPO = Path.home() / "Git" / "pt-tracker"
PROJECT_REL = Path("\U0001f3af Projects") / "\U0001f3cb️ Personal Trainer"


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def run(cmd: list[str], cwd: Path, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=str(cwd), check=check, capture_output=True, text=True)


def read_json(path: Path) -> dict:
    return json.loads(path.read_text())


def write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


# ---------------------------------------------------------------------------
# Render a session-log JSON object as the canonical Workout Log markdown.
# Matches the format of 2026-05-01-Friday-Pull-Shoulders.md.
# ---------------------------------------------------------------------------

def _filename_for_session(session: dict) -> str:
    date = session["date"]
    day = (session.get("day_of_week") or "").capitalize()
    type_part = "-".join(w.capitalize() for w in (session.get("type") or "").split("-"))
    return f"{date}-{day}-{type_part}.md"


def _exercise_display(ex: dict, exercises_index: dict[str, dict]) -> str:
    if "display_name" in ex:
        return ex["display_name"]
    meta = exercises_index.get(ex["exercise_id"], {})
    return meta.get("name") or ex["exercise_id"].replace("-", " ").title()


def _format_weight(ex: dict) -> str:
    if ex.get("weight_raw"):
        return ex["weight_raw"]
    sets = ex.get("sets", [])
    if not sets:
        return ""
    w = sets[0].get("weight_kg")
    if w is None or w == 0:
        return "bodyweight"
    return f"{int(w) if w == int(w) else w} kg"


def _format_reps(ex: dict) -> str:
    sets = ex.get("sets", [])
    if not sets:
        return ""
    reps = [s.get("reps", 0) for s in sets]
    if len(set(reps)) == 1:
        return str(reps[0])
    return "/".join(str(r) for r in reps)


def render_log_md(session: dict, exercises_index: dict[str, dict]) -> str:
    date = session["date"]
    day = (session.get("day_of_week") or "").capitalize()
    type_label = (session.get("type") or "").replace("-", " ").title()
    muscle_groups = session.get("muscle_groups") or []
    tags = ["fitness", "workout-log"]
    type_tag = (session.get("type") or "").replace(" ", "-").lower()
    if type_tag:
        tags.append(f"{type_tag}-day")
    for mg in muscle_groups:
        tags.append(mg)
    if session.get("phase"):
        tags.append(f"phase-{session['phase']}")

    fm_lines = ["---", "type: log", "status: completed", "tags:"]
    for t in tags:
        fm_lines.append(f"  - {t}")
    fm_lines.append("aliases:")
    fm_lines.append(f"  - {day} {type_label} {date}")
    fm_lines.append("---")

    head = [
        f"# 🏋️ {date} — {day} · {type_label}",
        "",
        "→ Back to: [[🏋️ Personal Trainer/Overview|Overview]] · [[🏋️ Personal Trainer/Log|Session Log]]",
        "",
    ]

    meta_lines = []
    if session.get("location"):
        meta_lines.append(f"**Location:** {session['location']}")
    if session.get("trainer"):
        meta_lines.append(f"**Trainer:** {session['trainer']}")
    if session.get("phase"):
        meta_lines.append(f"**Phase:** {session['phase']}")
    if session.get("training_partner"):
        meta_lines.append(f"**Training partner:** {session['training_partner']}")
    if session.get("fasted"):
        meta_lines.append("**Time:** Fasted (eating window opens noon)")
    meta_lines.append(f"**Thermocycling post-workout:** {'Yes' if session.get('thermocycling') else 'No'}")
    meta_lines.append(f"**Logged via:** PT Tracker web app — submitted {session.get('submitted_at', now_iso())}")

    body = []
    body.extend(head)
    body.extend(meta_lines)
    body.append("")
    body.append("---")
    body.append("")
    body.append("## Exercises")
    body.append("")
    body.append("| Exercise | Weight | Reps | Sets | Notes |")
    body.append("|---|---|---|---|---|")
    for ex in session.get("exercises", []):
        name = _exercise_display(ex, exercises_index)
        weight = _format_weight(ex)
        reps = _format_reps(ex)
        sets_n = len(ex.get("sets", [])) or "-"
        notes = (ex.get("notes") or "").replace("\n", " ").replace("|", "\\|")
        body.append(f"| {name} | {weight} | {reps} | {sets_n} | {notes} |")

    if session.get("session_notes"):
        body.append("")
        body.append("---")
        body.append("")
        body.append("## Session Notes")
        body.append("")
        for line in session["session_notes"].splitlines():
            line = line.strip()
            if line:
                body.append(f"- {line}")

    body.append("")
    body.append("---")
    body.append("")
    body.append("## See Also")
    body.append("")
    body.append("- Project: [[🏋️ Personal Trainer/Overview|Personal Trainer Overview]]")
    body.append("- Session log: [[🏋️ Personal Trainer/Log|Log]]")
    body.append("")

    return "\n".join(fm_lines) + "\n\n" + "\n".join(body)


# ---------------------------------------------------------------------------
# Skip-session helpers — write a vault MD that records "didn't work out today"
# ---------------------------------------------------------------------------

def _filename_for_skip(session: dict) -> str:
    date = session["date"]
    day = (session.get("day_of_week") or "").capitalize()
    type_part = "-".join(w.capitalize() for w in (session.get("type") or "").split("-"))
    return f"{date}-{day}-{type_part}-Skipped.md"


def render_skip_md(session: dict) -> str:
    date = session["date"]
    day = (session.get("day_of_week") or "").capitalize()
    type_label = (session.get("type") or "").replace("-", " ").title()
    reason = (session.get("reason") or "").strip()

    fm_lines = ["---", "type: log", "status: skipped", "tags:",
                "  - fitness", "  - workout-log", "  - skipped"]
    if session.get("phase"):
        fm_lines.append(f"  - phase-{session['phase']}")
    fm_lines.append("aliases:")
    fm_lines.append(f"  - {day} {type_label} {date} skipped")
    fm_lines.append("---")

    body = ["", f"# 🏋️ {date} — {day} · {type_label} · SKIPPED", "",
            "→ Back to: [[🏋️ Personal Trainer/Overview|Overview]] · [[🏋️ Personal Trainer/Log|Session Log]]",
            "",
            "**Status:** Skipped",
            f"**Logged via:** PT Tracker web app — submitted {session.get('submitted_at', now_iso())}"]
    if reason:
        body.extend(["", "---", "", "## Reason", "", reason])
    body.extend(["", "---", "",
                 "## See Also", "",
                 "- Project: [[🏋️ Personal Trainer/Overview|Personal Trainer Overview]]",
                 "- Session log: [[🏋️ Personal Trainer/Log|Log]]", ""])
    return "\n".join(fm_lines) + "\n" + "\n".join(body)


def append_skip_index_line(log_md_path: Path, session: dict) -> None:
    date = session["date"]
    day = (session.get("day_of_week") or "").capitalize()
    type_label = (session.get("type") or "").replace("-", " ").title()
    reason = (session.get("reason") or "").strip()
    fname = _filename_for_skip(session)
    link = fname[:-3]
    suffix = f" — _{reason}_" if reason else ""
    line = f"- {date} · [[{link}|{day} {type_label}]] — **skipped**{suffix}"

    existing = log_md_path.read_text(encoding="utf-8") if log_md_path.exists() else ""
    if link in existing:
        return
    if existing and not existing.endswith("\n"):
        existing += "\n"
    if not existing.strip():
        existing = "# 🏋️ Session Log\n\n"
    log_md_path.write_text(existing + line + "\n", encoding="utf-8")


# ---------------------------------------------------------------------------
# Append-to-Log.md helper
# ---------------------------------------------------------------------------

def append_log_index_line(log_md_path: Path, session: dict) -> None:
    """Append a one-line entry pointing at the new session note."""
    date = session["date"]
    day = (session.get("day_of_week") or "").capitalize()
    type_label = (session.get("type") or "").replace("-", " ").title()
    fname = _filename_for_session(session)
    link = fname[:-3]  # strip .md
    line = f"- {date} · [[{link}|{day} {type_label}]] — {len(session.get('exercises', []))} exercises"

    existing = log_md_path.read_text(encoding="utf-8") if log_md_path.exists() else ""
    if link in existing:
        return
    if existing and not existing.endswith("\n"):
        existing += "\n"
    if not existing.strip():
        existing = "# 🏋️ Session Log\n\n"
    log_md_path.write_text(existing + line + "\n", encoding="utf-8")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    vault_root = Path(os.environ.get("PT_TRACKER_VAULT_ROOT", str(DEFAULT_VAULT)))
    repo_root = Path(os.environ.get("PT_TRACKER_REPO_ROOT", str(DEFAULT_REPO)))
    project_dir = vault_root / PROJECT_REL

    if not project_dir.exists():
        print(f"ERROR: vault project folder missing: {project_dir}", file=sys.stderr)
        return 2
    if not (repo_root / "data").exists():
        print(f"ERROR: repo data dir missing: {repo_root}/data", file=sys.stderr)
        return 2

    plans_dir = project_dir / "Weekly Plans"
    workout_logs_md_dir = project_dir / "Workout Log"
    workout_logs_md_dir.mkdir(parents=True, exist_ok=True)
    log_md = project_dir / "Log.md"

    # Step 1: git pull
    in_git = (repo_root / ".git").exists()
    has_remote = False
    if in_git:
        try:
            res = run(["git", "remote"], cwd=repo_root, check=False)
            has_remote = bool(res.stdout.strip())
        except Exception:
            pass
    if has_remote:
        try:
            run(["git", "pull", "--ff-only"], cwd=repo_root)
        except subprocess.CalledProcessError as e:
            print(f"WARN: git pull failed (continuing): {e.stderr}", file=sys.stderr)

    # Step 2: drain pending
    pending_path = repo_root / "data" / "pending.json"
    pending = read_json(pending_path)
    entries = sorted(pending.get("entries", []), key=lambda e: e.get("submitted_at", ""))

    # Build exercise index for rendering
    exercises_index: dict[str, dict] = {}
    ex_dir = repo_root / "data" / "exercises"
    if ex_dir.exists():
        for f in sorted(ex_dir.glob("*.json")):
            try:
                ex = json.loads(f.read_text())
                exercises_index[ex["id"]] = ex
            except Exception:
                pass

    drained: list[str] = []
    skipped: list[str] = []

    for entry in entries:
        kind = entry.get("type")
        session = entry.get("session") or {}
        if not session.get("date") or not session.get("day_of_week"):
            skipped.append(f"{kind or 'entry'} missing date or day_of_week")
            continue
        session.setdefault("submitted_at", entry.get("submitted_at", now_iso()))
        if kind == "log":
            fname = _filename_for_session(session)
            target = workout_logs_md_dir / fname
            if target.exists():
                skipped.append(f"already exists: {fname}")
                continue
            target.write_text(render_log_md(session, exercises_index), encoding="utf-8")
            append_log_index_line(log_md, session)
            drained.append(f"log: {fname}")
        elif kind == "skip":
            fname = _filename_for_skip(session)
            target = workout_logs_md_dir / fname
            if target.exists():
                skipped.append(f"already exists: {fname}")
                continue
            target.write_text(render_skip_md(session), encoding="utf-8")
            append_skip_index_line(log_md, session)
            drained.append(f"skip: {fname}")
        else:
            skipped.append(f"unknown entry type: {kind!r}")

    # Step 3: re-derive routine + log JSONs
    routines_out = repo_root / "data" / "routines"
    routines_out.mkdir(parents=True, exist_ok=True)
    if plans_dir.exists():
        for f in sorted(plans_dir.glob("*.md")):
            try:
                routine = pr.parse_routine_md(f.read_text(encoding="utf-8"), routine_id=f.stem)
                (routines_out / (f.stem + ".json")).write_text(
                    json.dumps(routine, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
                )
            except Exception as e:
                print(f"  WARN: bad routine MD {f.name}: {e}", file=sys.stderr)

    logs_out = repo_root / "data" / "logs"
    logs_out.mkdir(parents=True, exist_ok=True)
    for f in sorted(workout_logs_md_dir.glob("*.md")):
        try:
            log = pl.parse_log_md(f.read_text(encoding="utf-8"), filename=f.name)
            if log is None:
                # status: skipped marker — no JSON snapshot, by design.
                continue
            (logs_out / (log["id"] + ".json")).write_text(
                json.dumps(log, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
            )
        except Exception as e:
            print(f"  WARN: bad log MD {f.name}: {e}", file=sys.stderr)

    # Step 4: recompute analytics
    analytics = ca.compute(repo_root)
    write_json(repo_root / "data" / "analytics.json", analytics)

    # Step 5: reset pending if it had entries
    if entries:
        write_json(pending_path, {
            "format_note": pending.get(
                "format_note",
                "Append-only inbox written by the web app. Daily scheduled task drains entries[] into vault MD files at Workout Log/YYYY-MM-DD-day-type.md and into data/logs/*.json, then resets to []. Schema: {type: 'log', submitted_at: ISO8601, session: {…full log object…}}",
            ),
            "entries": [],
        })

    # Step 6: git status / commit / push
    if in_git:
        status = run(["git", "status", "--porcelain", "data/"], cwd=repo_root)
        dirty = bool(status.stdout.strip())
        if dirty:
            run(["git", "add", "data/"], cwd=repo_root)
            n = len(drained)
            commit_msg = f"sync: drain {n} pending entries ({datetime.now().date().isoformat()})"
            run(["git", "commit", "-m", commit_msg], cwd=repo_root)
            if has_remote:
                try:
                    run(["git", "push"], cwd=repo_root)
                except subprocess.CalledProcessError as e:
                    print(f"WARN: git push failed (commit was made locally): {e.stderr}", file=sys.stderr)

    print(f"Synced {len(drained)} session(s) to vault; {analytics['log_count']} total logs, {len(analytics['prs'])} PRs.")
    for d in drained:
        print(f"  + {d}")
    for s in skipped:
        print(f"  ~ skipped: {s}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
