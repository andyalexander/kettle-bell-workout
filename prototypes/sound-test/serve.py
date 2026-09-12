#!/usr/bin/env python3
"""Serve the sound test with caching disabled, and collect its log.

A copy of the workout-screen prototype's server (no-store, threaded, so Safari
neither shows a stale page nor wedges it on an idle keep-alive), plus one thing:
the page POSTs every event to `/log`, which lands in `results.log` beside this
file, so the phone's findings reach the Mac without being read out.
"""

import http.server
from datetime import datetime
from pathlib import Path

PORT = 8000
ROOT = Path(__file__).parent
RESULTS = ROOT / "results.log"


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    """Static handler that forbids caching, and appends POSTed lines to the log."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_POST(self) -> None:
        if self.path != "/log":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", 0))
        line = self.rfile.read(length).decode("utf-8", "replace")
        stamped = f"{datetime.now():%H:%M:%S} {line}"
        with RESULTS.open("a", encoding="utf-8") as results:
            results.write(stamped + "\n")
        print(stamped, flush=True)
        self.send_response(204)
        self.end_headers()

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def send_header(self, keyword: str, value: str) -> None:
        # Drop the validator that lets Safari ask for a 304 in the first place.
        if keyword == "Last-Modified":
            return
        super().send_header(keyword, value)

    def log_message(self, format: str, *args) -> None:
        pass  # the POSTed lines are the interesting output


if __name__ == "__main__":
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    http.server.ThreadingHTTPServer.daemon_threads = True
    with http.server.ThreadingHTTPServer(("0.0.0.0", PORT), NoCacheHandler) as httpd:
        print(f"serving {ROOT} on http://0.0.0.0:{PORT} (no-cache, threaded)", flush=True)
        httpd.serve_forever()
