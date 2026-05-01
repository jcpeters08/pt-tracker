"""Shared helpers for the PT Tracker sync scripts.

Pure stdlib. Centralizes:
  - Exercise-name normalization + alias map
  - Markdown table parsing
  - YAML frontmatter parsing (minimal — we only need flat key:value)
  - Weight / reps / sets cell parsers

The vault MD is hand-authored, so parsers are tolerant: unknown exercises
are passed through with a slugified id and a stderr warning rather than
failing the run.
"""

from __future__ import annotations

import re
import sys
import unicodedata
from pathlib import Path

# ---------------------------------------------------------------------------
# Exercise alias map. Keys are lowercased, normalized exercise names; values
# are the canonical id used in data/exercises/<id>.json. New exercises that
# aren't in this map get slugified and reported to stderr so we can add them
# to the master library and back-fill the alias map.
# ---------------------------------------------------------------------------

EXERCISE_ALIASES: dict[str, str] = {
    # Push
    "flat db bench press":                   "flat-db-bench-press",
    "flat dumbbell bench press":             "flat-db-bench-press",
    "flat db bench":                         "flat-db-bench-press",
    "incline db bench press":                "incline-db-bench-press",
    "incline dumbbell bench press":          "incline-db-bench-press",
    "incline db bench":                      "incline-db-bench-press",
    "plate-loaded chest press":              "plate-loaded-chest-press",
    "plate loaded chest press":              "plate-loaded-chest-press",
    "seated db shoulder press":              "seated-db-shoulder-press",
    "seated dumbbell shoulder press":        "seated-db-shoulder-press",
    "plate-loaded shoulder press":           "plate-loaded-shoulder-press",
    "plate loaded shoulder press":           "plate-loaded-shoulder-press",
    "db lateral raise":                      "db-lateral-raise",
    "dumbbell lateral raise":                "db-lateral-raise",
    "seated db lateral raise":               "db-lateral-raise",
    "lateral raise":                         "db-lateral-raise",
    "front raise":                           "db-front-raise",
    "db front raise":                        "db-front-raise",
    "db skullcrusher":                       "db-skullcrusher",
    "dumbbell skullcrusher":                 "db-skullcrusher",
    "skullcrusher":                          "db-skullcrusher",
    "db tricep kickback":                    "db-tricep-kickback",
    "dumbbell tricep kickback":              "db-tricep-kickback",
    "dumbbell bent-over triceps kickback":   "db-tricep-kickback",
    "tricep kickback":                       "db-tricep-kickback",
    "overhead db tricep extension":          "overhead-db-tricep-extension",
    "overhead dumbbell tricep extension":    "overhead-db-tricep-extension",
    "overhead cable triceps extension":      "overhead-cable-tricep-extension",
    "overhead cable triceps ext":            "overhead-cable-tricep-extension",
    "overhead cable triceps extension (rope)": "overhead-cable-tricep-extension",
    "rope triceps pushdown":                 "rope-tricep-pushdown",
    "rope tricep pushdown":                  "rope-tricep-pushdown",
    "tricep pushdown":                       "rope-tricep-pushdown",

    # Pull
    "bent-over db row":                      "bent-over-db-row",
    "bent over db row":                      "bent-over-db-row",
    "single-arm db row":                     "single-arm-db-row",
    "single arm db row":                     "single-arm-db-row",
    "plate-loaded row":                      "plate-loaded-row",
    "plate loaded row":                      "plate-loaded-row",
    "iso-lateral high row":                  "iso-lateral-high-row",
    "iso lateral high row":                  "iso-lateral-high-row",
    "iso-lateral high row (plate)":          "iso-lateral-high-row",
    "lat pulldown":                          "lat-pulldown",
    "lat pulldown (cable)":                  "lat-pulldown",
    "dual-rope straight-arm pulldown":       "dual-rope-straight-arm-pulldown",
    "straight-arm pulldown":                 "dual-rope-straight-arm-pulldown",
    "inverted row":                          "inverted-row",
    "ring row":                              "inverted-row",
    "seated cable row":                      "seated-cable-row",
    "pull-up":                               "pull-up",
    "pull up":                               "pull-up",
    "band-assisted pull-up":                 "band-assisted-pull-up",
    "band assisted pull-up":                 "band-assisted-pull-up",
    "db reverse fly":                        "db-reverse-fly",
    "dumbbell reverse fly":                  "db-reverse-fly",
    "bent-over reverse fly":                 "db-reverse-fly",
    "reverse fly":                           "db-reverse-fly",
    "face pull":                             "cable-face-pull",
    "face pull (cable with rope)":           "cable-face-pull",
    "cable face pull":                       "cable-face-pull",
    "db curl":                               "db-curl",
    "standing db curl":                      "db-curl",
    "standing dumbbell curl":                "db-curl",
    "dumbbell biceps curl":                  "db-curl",
    "dumbbell curl":                         "db-curl",
    "barbell curl":                          "barbell-curl",
    "barbell curls":                         "barbell-curl",
    "barbell biceps curls":                  "barbell-curl",
    "standing straight-bar biceps curl":     "barbell-curl",
    "hammer curl":                           "hammer-curl",
    "hammer curls":                          "hammer-curl",
    "hammer curls (dumbbell)":               "hammer-curl",

    # Legs
    "db goblet squat":                       "db-goblet-squat",
    "dumbbell goblet squat":                 "db-goblet-squat",
    "goblet squat":                          "db-goblet-squat",
    "machine squat":                         "machine-squat",
    "smith machine squat":                   "smith-machine-squat",
    "smith squat":                           "smith-machine-squat",
    "db rdl":                                "db-rdl",
    "db romanian deadlift":                  "db-rdl",
    "dumbbell romanian deadlift":            "db-rdl",
    "deadlift machine":                      "plate-loaded-deadlift-machine",
    "plate-loaded deadlift machine":         "plate-loaded-deadlift-machine",
    "plate loaded deadlift machine":         "plate-loaded-deadlift-machine",
    "leg press":                             "leg-press",
    "45-degree incline leg press":           "leg-press",
    "45 degree incline leg press":           "leg-press",
    "db walking lunge":                      "db-walking-lunge",
    "dumbbell walking lunge":                "db-walking-lunge",
    "walking lunge":                         "db-walking-lunge",
    "single-leg calf raise":                 "single-leg-calf-raise",
    "single leg calf raise":                 "single-leg-calf-raise",
    "single-leg calf raise on step":         "single-leg-calf-raise",
    "single leg calf raise on step":         "single-leg-calf-raise",
    "calf raise":                            "calf-raise",
    "standing calf raise":                   "calf-raise",
    "wall sit":                              "wall-sit",
    "db glute bridge":                       "db-glute-bridge",
    "glute bridge":                          "db-glute-bridge",
    "glute bridge (db on hips)":             "db-glute-bridge",
    "seated leg curl":                       "seated-leg-curl",
    "leg curl":                              "seated-leg-curl",

    # Core
    "plank":                                 "plank",
    "butterfly crunch":                      "butterfly-crunch",
    "candlestick":                           "candlestick",
    "v-up":                                  "v-up",
    "v up":                                  "v-up",
}

# Volume-summary rows that aren't real exercises. Match by lowercase prefix.
VOLUME_SUMMARY_PREFIXES = (
    "chest", "back", "shoulders", "front delts", "lateral delts", "rear delts",
    "biceps", "triceps", "quads", "hamstrings", "glutes", "calves", "core",
    "lats", "lift", "muscle group",
)


def _strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def normalize_exercise_name(name: str) -> str:
    """Lowercase, strip accents/punctuation, collapse whitespace. Routine
    entries like 'Inverted Row (BW) OR Lat Pulldown if cable available' get
    truncated at the first ' OR ' so we match the primary movement."""
    s = _strip_accents(name).lower()
    s = re.sub(r"\([^)]*\)", "", s)         # drop parentheticals like "(warmup)"
    s = re.split(r"\s+\bor\b\s+", s, maxsplit=1)[0]  # take primary side of "X OR Y"
    s = re.sub(r"[—–\-]+", "-", s)
    s = s.replace("**", "")
    s = re.sub(r"[^a-z0-9\s\-]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def slugify(s: str) -> str:
    s = _strip_accents(s).lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s


def is_volume_summary_row(name: str) -> bool:
    n = name.strip().lower()
    return any(n.startswith(p) for p in VOLUME_SUMMARY_PREFIXES)


_unknown_reported: set[str] = set()


def resolve_exercise_id(raw_name: str, *, warn: bool = True) -> tuple[str, str] | None:
    """Map a free-text exercise name → canonical id. Returns (id, display_name)
    or None if the row should be skipped (volume-summary header, empty, etc.).
    Unknown but plausible exercises get a slugified id and a stderr warning
    once per name."""
    cleaned = raw_name.strip().lstrip("*").rstrip("*").strip()
    if not cleaned:
        return None
    if is_volume_summary_row(cleaned):
        return None
    norm = normalize_exercise_name(cleaned)
    norm_no_dashes = norm.replace("-", " ").strip()
    norm_collapsed = re.sub(r"\s+", " ", norm_no_dashes)
    for key in (norm, norm_collapsed):
        if key in EXERCISE_ALIASES:
            return EXERCISE_ALIASES[key], cleaned
    if warn and cleaned not in _unknown_reported:
        _unknown_reported.add(cleaned)
        print(f"  [unknown exercise — slugified] {cleaned!r}", file=sys.stderr)
    return slugify(cleaned), cleaned


# ---------------------------------------------------------------------------
# YAML frontmatter (minimal — flat key:value, list values as one-line YAML)
# ---------------------------------------------------------------------------

def parse_frontmatter(text: str) -> tuple[dict, str]:
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end < 0:
        return {}, text
    block = text[3:end].strip()
    body = text[end + 4:].lstrip("\n")
    fm: dict = {}
    cur_key: str | None = None
    for line in block.splitlines():
        if not line.strip():
            continue
        if line.startswith("  - ") and cur_key:
            fm[cur_key].append(line[4:].strip())
            continue
        m = re.match(r"^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$", line)
        if m:
            k, v = m.group(1), m.group(2).strip()
            if v == "":
                fm[k] = []
                cur_key = k
            else:
                fm[k] = v.strip("\"'")
                cur_key = None
    return fm, body


# ---------------------------------------------------------------------------
# Markdown table parsing
# ---------------------------------------------------------------------------

def split_table_row(line: str) -> list[str]:
    line = line.strip()
    if line.startswith("|"):
        line = line[1:]
    if line.endswith("|"):
        line = line[:-1]
    return [c.strip() for c in line.split("|")]


def find_table(lines: list[str], start: int) -> tuple[int, int] | None:
    """Find the next markdown table starting at or after `start`. Returns
    (header_idx, end_idx_exclusive) or None."""
    i = start
    while i < len(lines):
        if lines[i].lstrip().startswith("|") and i + 1 < len(lines) and re.match(r"^\s*\|[\s\-:|]+\|\s*$", lines[i + 1]):
            j = i + 2
            while j < len(lines) and lines[j].lstrip().startswith("|"):
                j += 1
            return i, j
        i += 1
    return None


def parse_table_rows(lines: list[str], header_idx: int, end_idx: int) -> list[dict]:
    headers = [h.lower() for h in split_table_row(lines[header_idx])]
    rows = []
    for k in range(header_idx + 2, end_idx):
        cells = split_table_row(lines[k])
        if len(cells) < len(headers):
            cells = cells + [""] * (len(headers) - len(cells))
        elif len(cells) > len(headers):
            cells = cells[: len(headers)]
        rows.append(dict(zip(headers, cells)))
    return rows


# ---------------------------------------------------------------------------
# Cell parsers
# ---------------------------------------------------------------------------

def parse_weight(cell: str) -> tuple[float | None, str]:
    """Return (kg, raw). Handles 'bodyweight', '16 kg (35 lbs) ea', '40 kg',
    '5 kg/arm', 'BW or 40 kg'. Always normalizes to kg (the primary unit in
    the vault). If only lbs is given, converts."""
    raw = cell.strip()
    if not raw:
        return None, raw
    low = raw.lower()
    if "bodyweight" in low or low.startswith("bw"):
        if re.search(r"\d", raw) and re.search(r"\bkg\b", low):
            m = re.search(r"(\d+(?:\.\d+)?)\s*kg", low)
            if m:
                return float(m.group(1)), raw
        return 0.0, raw
    m = re.search(r"(\d+(?:\.\d+)?)\s*kg", low)
    if m:
        return float(m.group(1)), raw
    m = re.search(r"(\d+(?:\.\d+)?)\s*lbs?", low)
    if m:
        return round(float(m.group(1)) * 0.4536, 2), raw
    m = re.search(r"(\d+(?:\.\d+)?)", raw)
    if m:
        return float(m.group(1)), raw
    return None, raw


def parse_reps(cell: str, sets_count: int) -> list[int]:
    """Return a list of `sets_count` rep counts. Handles '12' (uniform),
    '10/8/10' (per-set), '15 each leg' (uniform), '60 sec' (treated as 1)."""
    raw = cell.strip()
    if not raw:
        return [0] * sets_count
    if "/" in raw and re.search(r"\d+\s*/\s*\d+", raw):
        parts = re.findall(r"\d+", raw)
        if parts:
            ints = [int(p) for p in parts[:sets_count]]
            while len(ints) < sets_count:
                ints.append(ints[-1])
            return ints
    m = re.search(r"(\d+)", raw)
    if m:
        n = int(m.group(1))
        return [n] * sets_count
    return [0] * sets_count


def parse_sets(cell: str) -> int:
    raw = cell.strip()
    m = re.search(r"(\d+)", raw)
    return int(m.group(1)) if m else 1


# ---------------------------------------------------------------------------
# Filename parsing
# ---------------------------------------------------------------------------

LOG_FILENAME_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})-([A-Z][a-z]+)-(.+)\.md$")


def parse_log_filename(name: str) -> dict | None:
    """Parse `2026-05-04-Monday-Push.md` → date, day_of_week, type."""
    m = LOG_FILENAME_RE.match(name)
    if not m:
        return None
    date, day, type_part = m.group(1), m.group(2), m.group(3)
    type_slug = slugify(type_part)
    return {
        "date": date,
        "day_of_week": day.lower(),
        "type": type_slug,
        "id": f"{date}-{day.lower()}-{type_slug}",
    }


# ---------------------------------------------------------------------------
# Day-of-week canonicalization for routine sections
# ---------------------------------------------------------------------------

DAY_NAMES = {
    "mon": "monday", "monday": "monday",
    "tue": "tuesday", "tues": "tuesday", "tuesday": "tuesday",
    "wed": "wednesday", "wednesday": "wednesday",
    "thu": "thursday", "thur": "thursday", "thurs": "thursday", "thursday": "thursday",
    "fri": "friday", "friday": "friday",
    "sat": "saturday", "saturday": "saturday",
    "sun": "sunday", "sunday": "sunday",
}


def canonical_day(token: str) -> str | None:
    return DAY_NAMES.get(token.strip().lower().rstrip(":."))
