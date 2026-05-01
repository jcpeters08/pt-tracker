# TODO — populate exercise images and videos

The seed exercise library at `data/exercises/*.json` has `image_url: null` and `video_url: null` for every exercise. The web app falls back to a placeholder image and hides the video link when these are null, so the app works without them — but populating them is what makes the day view actually useful at the gym.

## How to populate

For each entry below, edit the corresponding `data/exercises/<id>.json` file:

- **`image_url`**: prefer Wikimedia Commons (`https://upload.wikimedia.org/wikipedia/commons/...`) for licensing reasons. Fall back to a placeholder you control.
- **`video_url`**: Athlean-X or Jeff Nippard YouTube URLs are good defaults. Use the canonical `https://www.youtube.com/watch?v=VIDEO_ID` form.

## Exercises needing media

| ID | Name |
|---|---|
| `band-assisted-pull-up` | Band-Assisted Pull-Up |
| `barbell-curl` | Barbell Biceps Curl |
| `bent-over-db-row` | Bent-Over Dumbbell Row |
| `cable-face-pull` | Cable Face Pull |
| `calf-raise` | Standing Calf Raise (Machine) |
| `db-curl` | Standing Dumbbell Curl |
| `db-front-raise` | Dumbbell Front Raise |
| `db-glute-bridge` | Dumbbell Glute Bridge |
| `db-goblet-squat` | Dumbbell Goblet Squat |
| `db-lateral-raise` | Dumbbell Lateral Raise |
| `db-rdl` | Dumbbell Romanian Deadlift |
| `db-reverse-fly` | Dumbbell Reverse Fly |
| `db-skullcrusher` | Dumbbell Skullcrusher |
| `db-tricep-kickback` | Dumbbell Tricep Kickback |
| `db-walking-lunge` | Dumbbell Walking Lunge |
| `dual-rope-straight-arm-pulldown` | Dual-Rope Straight-Arm Pulldown |
| `flat-db-bench-press` | Flat Dumbbell Bench Press |
| `hammer-curl` | Hammer Curl |
| `incline-db-bench-press` | Incline Dumbbell Bench Press |
| `inverted-row` | Inverted Row |
| `iso-lateral-high-row` | Iso-Lateral High Row |
| `lat-pulldown` | Lat Pulldown |
| `leg-press` | 45-Degree Incline Leg Press |
| `machine-squat` | Machine Squat |
| `overhead-cable-tricep-extension` | Overhead Cable Tricep Extension (Rope) |
| `overhead-db-tricep-extension` | Overhead Dumbbell Tricep Extension |
| `plank` | Plank |
| `plate-loaded-chest-press` | Plate-Loaded Chest Press |
| `plate-loaded-deadlift-machine` | Plate-Loaded Deadlift Machine |
| `plate-loaded-row` | Plate-Loaded Row |
| `plate-loaded-shoulder-press` | Plate-Loaded Shoulder Press |
| `pull-up` | Pull-Up |
| `rope-tricep-pushdown` | Rope Tricep Pushdown (Cable) |
| `seated-cable-row` | Seated Cable Row |
| `seated-db-shoulder-press` | Seated Dumbbell Shoulder Press |
| `seated-leg-curl` | Seated Leg Curl |
| `single-arm-db-row` | Single-Arm Dumbbell Row |
| `single-leg-calf-raise` | Single-Leg Calf Raise (on Step) |
| `smith-machine-squat` | Smith Machine Squat |
| `wall-sit` | Wall Sit |

40 total. Once a row is populated, delete it from this table.

> Note: Claude deliberately did not invent URLs. Plausible-looking-but-wrong YouTube IDs and Wikimedia paths cause silent 404s in the app, and verifying every URL in a build run wasn't tractable. Better to leave these as null and let you populate them with one batch session.
