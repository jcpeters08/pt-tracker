"""Keyboard-open scrolling: does the dock stay on the visible bottom edge while the
user pans with the keyboard up? Usage: python3 scenario3.py <port> <tag>"""
import sim, json, time, sys
port, tag = sys.argv[1], sys.argv[2]
sim.BASE = f"http://localhost:{port}"
OUT = []

STRIP = 0 if sim.PWA else 58   # Safari keeps its collapsed URL pill between the page and the keyboard
def keys():
    vb = sim.CONTENT_TOP + sim.js("return visualViewport.height")
    return (68, vb + STRIP + 44 + 55), (360, vb + STRIP + 22)   # number-pad "1", accessory ✓
def M(step):
    m = sim.metrics(); m["step"] = step; OUT.append(m); print(step, json.dumps(m)); return m
sim.open_app(sim.BASE + "/index.html")
if sim.js("const p=document.querySelector('#signin-panel'); return p && !p.classList.contains('hidden')"):
    sim.sign_in()
sim.wait_js("return document.querySelectorAll('.ex-card').length>0", 40); time.sleep(0.5); sim.settle()
idx = 4
sim.js(f"document.querySelectorAll('.set-row input[data-field=reps]')[{idx}].scrollIntoView({{block:'center'}}); return 1"); time.sleep(0.5); sim.settle()
sim.tap_sel(".set-row input[data-field=reps]", idx); time.sleep(1.8); sim.settle()
m = M("1-kbd-open"); sim.check_keyboard_state(m, "1-kbd-open")
# pan up 150pt slowly with the keyboard up (finger within the visible content band)
sim.swipe(200, 330, 200, 180, duration=0.6); time.sleep(0.2)
m = M("2-mid-pan-immediate"); sim.shot(f"{tag}-kbd-pan"); sim.check_keyboard_state(m, "2-mid-pan", expect_input=False)
sim.settle(); m = M("3-after-pan-settled"); sim.check_keyboard_state(m, "3-after-pan", expect_input=False)
# pan back down
sim.swipe(200, 180, 200, 330, duration=0.6); sim.settle(); m = M("4-after-pan-back"); sim.check_keyboard_state(m, "4-after-pan-back", expect_input=False)
# dismiss
sim.tap(*keys()[1]); time.sleep(1.2); sim.settle(); m = M("5-dismissed"); sim.check_closed_state(m, "5-dismissed")
# momentum fling with keyboard closed, screenshot mid-flight
sim.swipe(200, 650, 200, 250, duration=0.08); sim.shot(f"{tag}-fling-mid"); m = M("6-fling-immediate"); sim.check_closed_state(m, "6-fling"); sim.settle(); m = M("7-fling-settled"); sim.check_closed_state(m, "7-fling-settled")
sim.finish(tag + "-pan", OUT)
