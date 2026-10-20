#!/usr/bin/env python3
"""Local harness: serves the worktree's static app with WORKER_URL rewritten to
this server, and mocks the auth Worker endpoints the app calls (same-origin, so
no CORS). Pending appends are logged to appended.jsonl in this directory.

Usage: python3 mock_server.py <repo-root> <port>   (PT_DEBUG=0 disables the metrics overlay)
"""
import json
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(sys.argv[1]).resolve()
PORT = int(sys.argv[2])
HERE = Path(__file__).resolve().parent
APPEND_LOG = HERE / "appended.jsonl"
EMAIL = "jcpeters08@gmail.com"
METRICS_LOG = HERE / "metrics.jsonl"
import threading
CMD_LOCK = threading.Lock()
CMD_QUEUE = []
CMD_RESULTS = {}

DEBUG_SCRIPT = """
<script>
(function(){
  const box=document.createElement('div');
  box.id='__dbg';
  box.style.cssText='position:fixed;top:0;left:0;right:0;z-index:99999;background:rgba(0,0,0,.72);color:#0f0;font:11px/1.25 Menlo,monospace;padding:2px 4px;pointer-events:none;white-space:pre;';
  document.documentElement.appendChild(box);
  const log=[];
  function snap(ev){
    const d=document.querySelector('#submit-row');
    const r=d?d.getBoundingClientRect():null;
    const vv=window.visualViewport;
    const a=document.activeElement;
    const ar=(a&&a.getBoundingClientRect)?a.getBoundingClientRect():null;
    const h=document.querySelector('header.app');
    const hr=h?h.getBoundingClientRect():null;
    const m={t:Date.now(),ev,ih:innerHeight,iw:innerWidth,sy:Math.round(scrollY),dh:document.documentElement.scrollHeight,
      vvh:vv?Math.round(vv.height):null,vvt:vv?Math.round(vv.offsetTop):null,vvs:vv?+vv.scale.toFixed(2):null,
      dock:r?{t:Math.round(r.top),b:Math.round(r.bottom),h:Math.round(r.height),pos:getComputedStyle(d).position}:null,
      hdr:hr?{t:Math.round(hr.top),b:Math.round(hr.bottom)}:null,
      strip:(function(){const s=document.querySelector('#day-toggle');if(!s)return null;const q=s.getBoundingClientRect();return {t:Math.round(q.top),b:Math.round(q.bottom),pos:getComputedStyle(s).position};})(),
      act:a?{tag:a.tagName,f:a.dataset?a.dataset.field:null,t:ar&&Math.round(ar.top),b:ar&&Math.round(ar.bottom)}:null,
      cls:document.body.className,ki:getComputedStyle(document.documentElement).getPropertyValue('--keyboard-inset').trim(),
      dof:getComputedStyle(document.documentElement).getPropertyValue('--workout-dock-offset').trim()};
    box.textContent=ev+' ih='+m.ih+' sy='+m.sy+' dh='+m.dh+' vv='+m.vvh+'/'+m.vvt+'/'+m.vvs+'\\n'+
      'dock '+(m.dock?m.dock.pos+' t='+m.dock.t+' b='+m.dock.b+' h='+m.dock.h:'-')+' ki='+m.ki+' dof='+m.dof+'\\n'+
      'act '+(m.act?m.act.tag+'/'+m.act.f+' t='+m.act.t+' b='+m.act.b:'-')+' cls='+m.cls;
    log.push(m);
    try{navigator.sendBeacon('/__metrics',JSON.stringify(m));}catch(e){}
  }
  ['focusin','focusout','scroll','scrollend','resize'].forEach(e=>window.addEventListener(e,()=>snap(e),{passive:true,capture:true}));
  if(window.visualViewport){['resize','scroll'].forEach(e=>visualViewport.addEventListener(e,()=>snap('vv.'+e)));}
  window.__snap=snap; window.__log=log;
  setInterval(()=>snap('tick'),1000);
  async function poll(){
    try{
      const r=await fetch('/__cmd?client='+(navigator.standalone?'pwa':'safari'),{cache:'no-store'}); const c=await r.json();
      if(c&&c.id){
        let out;
        try{ out={id:c.id,value:await (new Function(c.js))()}; }catch(e){ out={id:c.id,error:String(e)}; }
        await fetch('/__result',{method:'POST',body:JSON.stringify(out)});
      }
    }catch(e){}
    setTimeout(poll,150);
  }
  poll();
  snap('init');
})();
</script>
"""


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    def log_message(self, fmt, *args):  # quieter
        if "/data/" in (args[0] if args else ""):
            return
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _json(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

    def do_POST(self):
        path = self.path.split("?")[0]
        body = self._read_body()
        if path == "/auth/request":
            return self._json({"ok": True})
        if path == "/auth/verify-code":
            return self._json({"sid": "sim-sid"})
        if path == "/auth/logout":
            return self._json({"ok": True})
        if path == "/__enqueue":
            cmd = json.loads(body)
            with CMD_LOCK:
                CMD_QUEUE.append(cmd)
            return self._json({"ok": True})
        if path == "/__result":
            res = json.loads(body)
            with CMD_LOCK:
                CMD_RESULTS[res["id"]] = res
            return self._json({"ok": True})
        if path == "/__metrics":
            with METRICS_LOG.open("a") as f:
                f.write(body.decode() + "\n")
            return self._json({"ok": True})
        if path == "/pending/append":
            try:
                entry = json.loads(body or b"{}").get("entry")
            except Exception:
                entry = None
            with APPEND_LOG.open("a") as f:
                f.write(json.dumps(entry) + "\n")
            return self._json({"ok": True})
        return self._json({"error": "unknown " + path}, 404)

    def do_PUT(self):
        path = self.path.split("?")[0]
        self._read_body()
        if path == "/pat":
            return self._json({"ok": True})
        return self._json({"error": "unknown " + path}, 404)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/__cmd":
            client = self.path.split("client=")[-1] if "client=" in self.path else ""
            cmd = None
            with CMD_LOCK:
                for i, c in enumerate(CMD_QUEUE):
                    if not c.get("client") or c.get("client") == client:
                        cmd = CMD_QUEUE.pop(i)
                        break
            return self._json(cmd or {})
        if path == "/__result":
            qid = self.path.split("id=")[-1]
            with CMD_LOCK:
                res = CMD_RESULTS.pop(qid, None)
            return self._json(res or {})
        if path == "/auth/me":
            return self._json({"email": EMAIL})
        if path == "/pat":
            return self._json({"has_pat": True})
        if path in ("/index.html", "/", "/reports.html"):
            name = "index.html" if path in ("/", "/index.html") else "reports.html"
            text = (ROOT / name).read_text()
            text = text.replace(
                'const WORKER_URL   = "https://pt-tracker-auth.ositodelnorte.workers.dev"',
                f'const WORKER_URL   = "http://localhost:{PORT}"',
            )
            text = text.replace(
                'const WORKER_URL = "https://pt-tracker-auth.ositodelnorte.workers.dev"',
                f'const WORKER_URL = "http://localhost:{PORT}"',
            )
            if name == "index.html" and os.environ.get("PT_DEBUG", "1") == "1":
                text = text.replace("</body>", DEBUG_SCRIPT + "</body>")
            data = text.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)
            return
        return super().do_GET()

    def end_headers(self):
        # Never let Safari cache module scripts while we iterate on the fix.
        if self.path.endswith(".js") or self.path.endswith(".json"):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    print(f"serving {ROOT} on http://127.0.0.1:{PORT} (loopback only)", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()  # loopback only: the simulator shares the host network stack, and the debug command channel runs page JS
