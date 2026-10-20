"""Before/after keyboard + dock scenario. Usage: python3 scenario2.py <port> <tag>"""
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
def S(name): return sim.shot(f"{tag}-{name}")

sim.open_app(sim.BASE + "/index.html")
if sim.js("const p=document.querySelector('#signin-panel'); return p && !p.classList.contains('hidden')"):
    sim.sign_in()
sim.wait_js("const a=document.querySelector('#app'); return a && !a.classList.contains('hidden') && document.querySelectorAll('.ex-card').length>0", 40)
# clean slate: drop drafts for this view and re-render
sim.js("Object.keys(localStorage).filter(k=>k.startsWith('pt_tracker_draft')).forEach(k=>localStorage.removeItem(k)); return 1")
sim.open_app(sim.BASE + "/index.html")
sim.wait_js("return document.querySelectorAll('.ex-card').length>0", 40); time.sleep(0.5); sim.settle()
M("0-top"); S("0-top")

# 1. scroll a bit, tap first visible reps input → keyboard
sim.swipe(200, 600, 200, 250, duration=0.25); sim.settle()
vis = sim.visible_inputs(); idx = vis[0]
sim.tap_focus(".set-row input[data-field=reps]", idx, "1-kbd-open")
m = M("1-kbd-open"); S("1-kbd-open"); sim.check_keyboard_state(m, "1-kbd-open")

# 2. type "1" via number pad, confirm value + no jump
before = sim.js("return scrollY")
KEY_1, KEY_DONE = keys(); sim.tap(*KEY_1); time.sleep(0.6)
m = M("2-typed"); val = sim.js(f"return document.querySelectorAll('.set-row input[data-field=reps]')[{idx}].value")
sim.check("2-typed: digit reached the focused input", str(val).endswith("1"), f"value={val}")
sim.check("2-typed: no scroll jump while typing", m["sy"] == before, f"delta={m['sy'] - before}")
sim.check_keyboard_state(m, "2-typed")

# 3. tap the next row's reps input while the keyboard is up (exact identity)
sim.tap_focus(".set-row input[data-field=reps]", idx + 1, "3-next-row")
m = M("3-next-row"); S("3-next-row"); sim.check_keyboard_state(m, "3-next-row")

# 4. a reps input two cards down: bring it into the band with REAL swipes while
#    the keyboard stays up, then tap it; the focus must move to exactly that input.
sim.check("4: swiped the two-cards-down input into the band with the keyboard up", sim.swipe_until_in_band(".set-row input[data-field=reps]", idx + 6))
sim.tap_focus(".set-row input[data-field=reps]", idx + 6, "4-two-cards-down")
m = M("4-two-cards-down"); S("4-two-cards-down"); sim.check_keyboard_state(m, "4-two-cards-down")
print("   note: keyboard", "stayed up" if m["vvh"] < m["ih"] - 80 else "was closed by iOS", "across the swipe + retarget (platform behaviour, not asserted)")

# 5. the "jump to bottom" case: dismiss, then reach the LAST card's last weight
#    input with real swipes only, tap it (exact identity), and let iOS do the
#    repositioning — nothing pre-clears it with page JavaScript.
sim.tap(*keys()[1]); time.sleep(1.2); sim.settle()
n = sim.js("return document.querySelectorAll('.set-row input[data-field=weight]').length")
LAST = ".set-row input[data-field=weight]"
sim.check("5a: swiped the last weight input into the band (no page JS scrolling)", sim.swipe_until_in_band(LAST, n - 1, max_swipes=40, step=420))
m = M("5a-before-last-tap")
sim.tap_focus(LAST, n - 1, "5b-last-input")
m = M("5b-last-input-focused"); S("5b-last-input"); sim.check_keyboard_state(m, "5b-last-input")
sim.check("5b: the focused element is exactly the last weight input", sim.is_focused(LAST, n - 1))

# 6. dismiss with the accessory ✓ → dock must return to the bottom, no float
sy_before = sim.js("return scrollY")
sim.tap(*keys()[1]); time.sleep(1.5); sim.settle()
m = M("6-dismissed"); S("6-dismissed"); sim.check_closed_state(m, "6-dismissed")
sim.check("6-dismissed: no scroll jump on dismiss", m["sy"] == sy_before, f"delta={m['sy'] - sy_before}")

# 7. rubber-band at top and bottom with keyboard closed
sim.js("window.scrollTo(0,0); return 1"); time.sleep(0.4); sim.settle()
sim.swipe(200, 300, 200, 820, duration=0.12); S("7-rubberband-top"); time.sleep(1.0); sim.settle(); m = M("7-after-top-rubberband")
if sim.PWA: sim.check_closed_state(m, "7-top-rubberband")   # Safari tabs pull-to-refresh here; only meaningful in the PWA
sim.js("window.scrollTo(0, document.documentElement.scrollHeight); return 1"); time.sleep(0.4); sim.settle()
sim.swipe(200, 700, 200, 150, duration=0.12); S("8-rubberband-bottom"); time.sleep(1.0); sim.settle(); m = M("8-after-bottom-rubberband"); sim.check_closed_state(m, "8-bottom-rubberband")
sim.finish(tag, OUT)
