#!/usr/bin/env python3
"""Mock of Jarvis gateway action_request channel for the spike.
POST /permission  {tool_name,tool_input}  Bearer <jst token>  -> blocks until decision or 150s, returns {decision}.
The "user" resolves via POST /resolve {id,status}. Mirrors ConfirmationRegistry: 150s timeout, fail-closed to deny."""
import json, threading, time, sys, os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VALID_TOKEN = os.environ.get("MOCK_JST", "jst_demo")
TIMEOUT_S = float(os.environ.get("MOCK_TIMEOUT_S", "150"))
pending = {}   # id -> {"status": None|"confirmed"|"rejected", "ev": Event}
lock = threading.Lock()
_seq = [0]

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _json(self, code, obj):
        b=json.dumps(obj).encode(); self.send_response(code)
        self.send_header("Content-Type","application/json"); self.send_header("Content-Length",str(len(b)))
        self.end_headers(); self.wfile.write(b)
    def _body(self):
        n=int(self.headers.get("Content-Length",0)); return json.loads(self.rfile.read(n) or b"{}")
    def do_POST(self):
        if self.path=="/permission":
            auth=self.headers.get("Authorization","")
            if auth!=f"Bearer {VALID_TOKEN}":     # identity ONLY from bearer, never agent input
                return self._json(401, {"error":"invalid session token"})
            req=self._body()
            with lock:
                _seq[0]+=1; rid=f"act_{_seq[0]}"
                ev=threading.Event(); pending[rid]={"status":None,"ev":ev}
            sys.stderr.write(f"[gateway] action_request {rid} tool={req.get('tool_name')} -> emitted to drawer\n")
            ok = ev.wait(TIMEOUT_S)                # BLOCK like awaitResolution()
            with lock:
                st = pending.pop(rid,{}).get("status")
            if not ok or st!="confirmed":          # timeout OR reject => fail closed
                return self._json(200, {"decision":"deny","actionRequestId":rid,"reason": st or "timeout"})
            return self._json(200, {"decision":"allow","actionRequestId":rid})
        if self.path=="/resolve":                  # the human clicking the card
            req=self._body(); rid=req.get("id"); st=req.get("status")
            with lock:
                w=pending.get(rid)
                if w: w["status"]=st; w["ev"].set()
            return self._json(200, {"ok": bool(w)})
        self._json(404,{})

if __name__=="__main__":
    port=int(sys.argv[1]) if len(sys.argv)>1 else 8799
    ThreadingHTTPServer(("127.0.0.1",port), H).serve_forever()
