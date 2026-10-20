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
#    (PT_DEBUG=1 default injects a metrics overlay + JS command channel into index.html)

# 2. drive Safari in the simulator:
export SIM_UDID=<UDID> SIM_BASE=http://localhost:8790
python3 tools/ios-sim-harness/keyboard_dock_scenario.py 8790 fixed   # focus/type/dismiss, last-card case
python3 tools/ios-sim-harness/keyboard_pan_scenario.py 8790 fixed    # pan with the keyboard up, flings

# 3. home-screen PWA: add the URL to the home screen once (share sheet → View More →
#    Add to Home Screen), note the icon's screen position, then:
PWA=1 ICON=340,223 python3 tools/ios-sim-harness/keyboard_dock_scenario.py 8790 pwa
```

Each step prints a metrics line (`vvh`/`vvt` = visualViewport height/offsetTop,
`dock` = #submit-row rect, `act` = focused element rect, `ki` = --keyboard-inset)
and writes screenshots to `shots/`. The pass condition for the dock fix is
`dock.b == vvh` in every keyboard-open state and `act.b <= dock.t`.

To compare against an older build, serve it on a second port (e.g. a
`git archive` of the commit under test) and run the same scripts there.

Notes: tap coordinates are converted from client rects with a one-tap
calibration (`calibrate()`); iOS reports client rects relative to the visible
viewport while the keyboard is up, so no offsetTop correction is applied. The
accessory-bar ✓ and number-pad positions are derived from `visualViewport.height`
(Safari keeps a 58pt URL-pill strip between page and keyboard; the PWA has none).
