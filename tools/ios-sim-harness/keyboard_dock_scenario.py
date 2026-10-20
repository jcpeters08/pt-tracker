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
sim.tap_sel(".set-row input[data-field=reps]", idx); time.sleep(1.8); sim.settle()
m = M("1-kbd-open"); S("1-kbd-open"); sim.check_keyboard_state(m, "1-kbd-open")

# 2. type "1" via number pad, confirm value + no jump
before = sim.js("return scrollY")
KEY_1, KEY_DONE = keys(); sim.tap(*KEY_1); time.sleep(0.6)
m = M("2-typed"); val = sim.js(f"return document.querySelectorAll('.set-row input[data-field=reps]')[{idx}].value")
sim.check("2-typed: digit reached the focused input", str(val).endswith("1"), f"value={val}")
sim.check("2-typed: no scroll jump while typing", m["sy"] == before, f"delta={m['sy'] - before}")
sim.check_keyboard_state(m, "2-typed")

# 3. tap the next row's reps input while keyboard is up
sim.tap_sel(".set-row input[data-field=reps]", idx + 1); time.sleep(1.2); sim.settle()
m = M("3-next-row"); S("3-next-row"); sim.check_keyboard_state(m, "3-next-row")

# 4. tap a reps input two cards down (requires Safari to scroll with keyboard up)
sim.tap_sel(".set-row input[data-field=reps]", idx + 6); time.sleep(1.5); sim.settle()
m = M("4-two-cards-down"); S("4-two-cards-down"); sim.check_keyboard_state(m, "4-two-cards-down")

# 5. the "jump to bottom" case: the LAST card's last weight input, focused by a
#    real tap while it sits at the very bottom of the clear band (just above the
#    dock) — iOS must reposition it itself; nothing pre-clears it.
n = sim.js("return document.querySelectorAll('.set-row input[data-field=weight]').length")
sim.js(f"""const e=document.querySelectorAll('.set-row input[data-field=weight]')[{n-1}]; const d=document.querySelector('#submit-row').getBoundingClientRect();
const r=e.getBoundingClientRect(); window.scrollBy(0, r.bottom - (d.top - 6)); return 1"""); time.sleep(0.6); sim.settle()
m = M("5a-before-last-tap")
gap = sim.js(f"""const e=document.querySelectorAll('.set-row input[data-field=weight]')[{n-1}]; return Math.round(document.querySelector('#submit-row').getBoundingClientRect().top - e.getBoundingClientRect().bottom)""")
sim.check("5a: last input sits just above the dock before the tap", 0 <= gap <= 40, f"gap={gap}")
sim.tap_sel(".set-row input[data-field=weight]", n - 1); time.sleep(1.5); sim.settle()
m = M("5b-last-input-focused"); S("5b-last-input"); sim.check_keyboard_state(m, "5b-last-input")
sim.check("5b: the focused input is the last weight input", bool(m["act"]) and m["act"].get("f") == "weight", m["act"])

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
