#!/usr/bin/env python3
"""Serve the prototype with caching disabled.

Two things the stock `python3 -m http.server` gets wrong for this job:

1. It honours If-Modified-Since, so Safari on the iPad happily serves a stale
   index.html after an edit — silently hiding the change you were asked to
   look at. This sends no-store and drops the validator.

2. Nothing — it already threads. This file must too: Safari holds keep-alive
   connections open, and a single-threaded server wedges permanently on the
   first idle one.
"""

import http.server
from pathlib import Path

PORT = 8000
ROOT = Path(__file__).parent


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    """Static handler that forbids caching of every response."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

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


if __name__ == "__main__":
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    http.server.ThreadingHTTPServer.daemon_threads = True
    with http.server.ThreadingHTTPServer(("0.0.0.0", PORT), NoCacheHandler) as httpd:
        print(f"serving {ROOT} on http://0.0.0.0:{PORT} (no-cache, threaded)")
        httpd.serve_forever()
