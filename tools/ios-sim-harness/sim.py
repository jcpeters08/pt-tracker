"""Drive the real app in iOS Simulator Safari: real touches via idb, JS eval via
the harness command channel, screenshots via simctl (keyboard included)."""
import json
import os
import subprocess
import time
import urllib.request
import uuid
from pathlib import Path

UDID = os.environ.get("SIM_UDID", "")  # booted iPhone simulator (xcrun simctl list devices booted)
BASE = os.environ.get("SIM_BASE", "http://localhost:8790")
IDB = os.path.expanduser("~/.local/bin/idb")
SHOTS = Path(os.environ.get("SIM_SHOTS", Path(__file__).resolve().parent / "shots"))
SHOTS.mkdir(exist_ok=True)
PWA = os.environ.get("PWA") == "1"
CONTENT_TOP = None  # screen-point y where the layout viewport's y=0 sits (calibrated)


def idb(*args, timeout=60):
    r = subprocess.run([IDB, *args, "--udid", UDID], capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError(f"idb {' '.join(args)} failed: {r.stderr.strip()[:300]}")
    return r.stdout


def tap(x, y, duration=None):
    args = ["ui", "tap", str(round(x)), str(round(y))]
    if duration:
        args += ["--duration", str(duration)]
    idb(*args)


def swipe(x1, y1, x2, y2, duration=0.3, delta=None):
    args = ["ui", "swipe", str(x1), str(y1), str(x2), str(y2), "--duration", str(duration)]
    if delta:
        args += ["--delta", str(delta)]
    idb(*args)


def text(s):
    idb("ui", "text", s)


def key(code):
    idb("ui", "key", str(code))


def shot(name):
    out = SHOTS / f"{name}.png"
    subprocess.run(["xcrun", "simctl", "io", UDID, "screenshot", str(out)], check=True, capture_output=True)
    return out


def _post(path, obj):
    req = urllib.request.Request(BASE + path, data=json.dumps(obj).encode(), method="POST",
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read() or b"{}")


def _get(path):
    with urllib.request.urlopen(BASE + path, timeout=10) as r:
        return json.loads(r.read() or b"{}")


def js(code, timeout=10):
    """Evaluate JS in the page (function body; use `return`)."""
    qid = uuid.uuid4().hex
    _post("/__enqueue", {"id": qid, "js": code, "client": "pwa" if PWA else "safari"})
    t0 = time.time()
    while time.time() - t0 < timeout:
        res = _get(f"/__result?id={qid}")
        if res.get("id") == qid:
            if "error" in res:
                raise RuntimeError(res["error"])
            return res.get("value")
        time.sleep(0.1)
    raise TimeoutError(code[:80])


def wait_js(code, timeout=20):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            if js(code):
                return True
        except Exception:
            pass
        time.sleep(0.3)
    raise TimeoutError(code[:80])


def rect(sel, index=0):
    return js(f"""const els=document.querySelectorAll({json.dumps(sel)}); const e=els[{index}]; if(!e) return null;
const r=e.getBoundingClientRect(); return {{x:r.left,y:r.top,w:r.width,h:r.height,cx:r.left+r.width/2,cy:r.top+r.height/2}};""")


def vv():
    return js("const v=visualViewport; return {h:v.height,t:v.offsetTop,l:v.offsetLeft,s:v.scale,ih:innerHeight,sy:scrollY,dh:document.documentElement.scrollHeight};")


def metrics():
    return js("""const d=document.querySelector('#submit-row'); const r=d?d.getBoundingClientRect():null; const v=visualViewport;
const a=document.activeElement; const ar=(a&&a.getBoundingClientRect)?a.getBoundingClientRect():null;
const h=document.querySelector('header.app'); const hr=h?h.getBoundingClientRect():null;
return {ih:innerHeight, sy:Math.round(scrollY), dh:document.documentElement.scrollHeight, vvh:Math.round(v.height), vvt:Math.round(v.offsetTop), vvs:+v.scale.toFixed(2),
 dock:r?{t:Math.round(r.top),b:Math.round(r.bottom),h:Math.round(r.height),pos:getComputedStyle(d).position,vis:getComputedStyle(d).display!=='none'}:null,
 hdr:hr?{t:Math.round(hr.top),b:Math.round(hr.bottom),pos:getComputedStyle(h).position}:null,
 act:a?{tag:a.tagName,f:a.dataset?a.dataset.field:null,t:ar&&Math.round(ar.top),b:ar&&Math.round(ar.bottom)}:null,
 cls:document.body.className, ki:getComputedStyle(document.documentElement).getPropertyValue('--keyboard-inset').trim(), dof:getComputedStyle(document.documentElement).getPropertyValue('--workout-dock-offset').trim()};""")


def calibrate():
    """Tap a neutral spot and read back the page's clientY: content_top is the
    exact screen-point offset of the layout viewport (Safari chrome height)."""
    global CONTENT_TOP
    js("window.__lastTap=null; if(!window.__tapHook){window.__tapHook=1; document.addEventListener('pointerdown',e=>{window.__lastTap={x:e.clientX,y:e.clientY,t:visualViewport.offsetTop};},true);} return 1")
    tap(390, 500)  # right edge, mid-screen: no controls there
    time.sleep(0.4)
    t = js("return window.__lastTap")
    if not t:
        raise RuntimeError("calibration tap not seen by the page")
    CONTENT_TOP = 500 - (t["y"] - t["t"])
    return CONTENT_TOP


def to_screen(x, y):
    """Layout-viewport coords → screen points (accounts for visual viewport offset)."""
    # iOS reports client rects relative to the *visible* viewport while the
    # keyboard is up (measured on iOS 27: fixed dock bottom == visualViewport.height),
    # so no offsetTop correction is needed in either state.
    return x, y + CONTENT_TOP


def tap_sel(sel, index=0, dy=0):
    r = rect(sel, index)
    if not r:
        raise RuntimeError(f"no element {sel}[{index}]")
    sx, sy = to_screen(r["cx"], r["cy"] + dy)
    tap(sx, sy)
    return r


def open_app(url=None):
    url = url or BASE + "/index.html"
    subprocess.run(["xcrun", "simctl", "openurl", UDID, url], check=True, capture_output=True)
    wait_js("return !!document.querySelector('#__dbg')", 30)
    time.sleep(0.5)
    calibrate()


def sign_in():
    wait_js("const p=document.querySelector('#signin-panel'); return p && !p.classList.contains('hidden')")
    tap_sel("#email-input")
    time.sleep(0.6)
    text("jcpeters08@gmail.com")
    tap_sel("#email-send")
    wait_js("const r=document.querySelector('#code-row'); return r && getComputedStyle(r).display!=='none'")
    tap_sel("#code-input")
    time.sleep(0.6)
    text("123456")
    tap_sel("#code-verify")
    wait_js("const a=document.querySelector('#app'); return a && !a.classList.contains('hidden') && document.querySelectorAll('.ex-card').length>0", 40)
    time.sleep(0.5)


def settle(timeout=5):
    """Wait until window.scrollY and visualViewport stop changing (momentum done)."""
    last = None
    stable = 0
    t0 = time.time()
    while time.time() - t0 < timeout:
        cur = js("return [Math.round(scrollY), Math.round(visualViewport.height), Math.round(visualViewport.offsetTop)]")
        if cur == last:
            stable += 1
            if stable >= 2:
                return cur
        else:
            stable = 0
        last = cur
        time.sleep(0.15)
    return last


def visible_inputs(field="reps"):
    return js(f"""const hb=document.querySelector('header.app').getBoundingClientRect().bottom; const dt=document.querySelector('#submit-row').getBoundingClientRect().top;
const out=[]; document.querySelectorAll('.set-row input[data-field={field}]').forEach((e,i)=>{{const r=e.getBoundingClientRect(); if(r.top>hb&&r.bottom<dt) out.push(i);}}); return out;""")


def ax_all():
    out = idb("ui", "describe-all")
    return json.loads(out)


def ax_find(substr, typ=None):
    """Find accessibility elements whose label/title contains substr → list of (label, center)."""
    hits = []
    def walk(n):
        if isinstance(n, dict):
            lab = str(n.get("AXLabel") or n.get("title") or "")
            t = n.get("type") or n.get("role") or ""
            fr = n.get("frame") or {}
            if substr.lower() in lab.lower() and (typ is None or typ == t) and fr:
                hits.append((lab, t, fr["x"] + fr["width"] / 2, fr["y"] + fr["height"] / 2))
            for c in n.get("children", []) or []:
                walk(c)
        elif isinstance(n, list):
            for c in n:
                walk(c)
    walk(ax_all())
    return hits


def ax_tap(substr, typ=None, index=0):
    hits = ax_find(substr, typ)
    if not hits:
        raise RuntimeError(f"no accessibility element matching {substr!r}")
    lab, t, x, y = hits[index]
    tap(x, y)
    return hits[index]


ICON = tuple(int(v) for v in os.environ.get("ICON", "340,223").split(","))  # web clip icon on home-screen page 2


def open_pwa():
    idb("ui", "button", "HOME"); time.sleep(1.2)
    idb("ui", "button", "HOME"); time.sleep(0.8)          # ensure page 1
    swipe(350, 500, 50, 500, duration=0.25); time.sleep(1.0)  # → page 2
    tap(*ICON); time.sleep(4.0)
    wait_js("return !!document.querySelector('#__dbg')", 30)
    time.sleep(0.5)
    calibrate()


_open_app_safari = open_app


def open_app(url=None):
    url = url or BASE + "/index.html"
    if not PWA:
        return _open_app_safari(url)
    alive = False
    try:
        alive = bool(js("return 1", timeout=3))
    except Exception:
        alive = False
    if alive:
        try:
            js("setTimeout(()=>location.reload(),50); return 1", timeout=3)
        except Exception:
            pass
        time.sleep(2.5)
        wait_js("return !!document.querySelector('#__dbg')", 30)
        time.sleep(0.5)
        calibrate()
    else:
        open_pwa()
