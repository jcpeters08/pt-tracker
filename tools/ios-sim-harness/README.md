# iOS Simulator harness (real WebKit, real software keyboard)

Drives the actual app in an iPhone Simulator — Safari tab or home-screen PWA —
with real touches, and measures the workout dock against the visual viewport.
This is how the 2026-10-20 dock fix was proven (see `git log -- index.html`).

Playwright/Chromium cannot open a software keyboard, so the keyboard-vs-dock
behaviour (`position: fixed` + `--keyboard-inset`) can only be verified here.

## One-time setup

```bash
brew trust facebook/fb && brew install idb-companion   # HID touch injection
pip3 install --user fb-idb                              # idb CLI (~/.local/bin/idb)
xcrun simctl boot "iPhone 17"                           # any iPhone, iOS 17+
idb_companion --udid <UDID> --grpc-port 10882 &         # keep running
idb connect localhost 10882
idb set hardware-keyboard disable --udid <UDID>         # else no software keyboard
```

## Run

```bash
# 1. serve the checkout with a mock auth Worker (same origin, no CORS):
python3 tools/ios-sim-harness/mock_server.py <repo-root> 8790 &
#    binds 127.0.0.1 only; PT_DEBUG=1 (default) injects a metrics overlay + JS command
#    channel that evaluates page JS — never expose this server beyond loopback

# 2. drive Safari in the simulator:
export SIM_UDID=<UDID> SIM_BASE=http://localhost:8790
python3 tools/ios-sim-harness/keyboard_dock_scenario.py 8790 fixed   # focus/type/dismiss, last-card case
python3 tools/ios-sim-harness/keyboard_pan_scenario.py 8790 fixed    # pan with the keyboard up, flings

# 3. home-screen PWA: add the URL to the home screen once (share sheet → View More →
#    Add to Home Screen), note the icon's screen position, then:
PWA=1 ICON=340,223 python3 tools/ios-sim-harness/keyboard_dock_scenario.py 8790 pwa
```

Each step prints a metrics line (`vvh`/`vvt` = visualViewport height/offsetTop,
`dock` = #submit-row rect, `act` = focused element rect, `ki` = --keyboard-inset),
writes screenshots to `shots/` (or `$SIM_SHOTS`), and **asserts** the pass conditions
(`sim.check_keyboard_state` / `sim.check_closed_state`): with the keyboard up an input
must have focus, `dock.b == vvh` (±2), the dock must be compact (≤120px), and the
focused input must clear both the dock top and the pinned top chrome (`topb` = the lower edge of
the in-flow header near the top of the page or the sticky day strip further down — 0 once both
have scrolled away; since 2026-10-20 the strip un-pins while typing, which is asserted); after
dismissal `dock.b == innerHeight` with the full dock back; typing and dismissing must
not change `scrollY`. Any failed check makes the script exit 1 and the per-step metrics
are written to `metrics-<tag>.json` — run from `evidence/<date>/` to keep them.
The last-card case taps the last weight input by a real touch while it sits just above
the dock, so iOS (not the script) has to reposition it. `evidence/2026-10-20/` holds the
runs behind the dock fix: fixed build PASS, pre-fix build FAIL, Safari and PWA.
One run in three of the PWA pan scenario (`metrics-pwa-fixed-pan.flake-1-of-3.json`)
saw iOS not scroll a freshly tapped input above the keyboard (input bottom 548 vs
visible edge 442, dock untouched); the two re-runs revealed it to y=198 as usual.
Treat a single "focused input clears the dock" failure as an iOS reveal race and
re-run before blaming the dock.
`metrics-safari-header*.json` are the header-compaction runs (static header, sticky day strip):
this build PASS, base build FAIL on the no-sticky-top-chrome-while-typing check, Safari only.

To compare against an older build, serve it on a second port (e.g. a
`git archive` of the commit under test) and run the same scripts there.

Notes: tap coordinates are converted from client rects with a one-tap
calibration (`calibrate()`); iOS reports client rects relative to the visible
viewport while the keyboard is up (verified against screenshots, including
mid-pan), so no offsetTop correction is applied. Every targeted tap goes through
`tap_focus()`: the target must be inside the on-screen band between header and
dock, measured twice 0.4 s apart until nothing moves (iOS keeps nudging the
visual viewport briefly after a pan), and afterwards `document.activeElement`
must be exactly that element — a missed tap is a recorded failure, never a pass.
Distant fields are reached with real swipes (`swipe_until_in_band`), never page
JavaScript. The simulator silently reverts to "hardware keyboard connected"
(no on-screen keys) after apps are terminated; `ensure_software_keyboard()`
re-asserts `idb set hardware-keyboard disable` once per process. The
accessory-bar ✓ and number-pad positions are derived from `visualViewport.height`
(Safari keeps a 58pt URL-pill strip between page and keyboard; the PWA has none).
