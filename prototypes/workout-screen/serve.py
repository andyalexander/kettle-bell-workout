#!/usr/bin/env python3
"""Serve the prototype with caching disabled.

`python3 -m http.server` honours If-Modified-Since, so Safari on the iPad
happily serves a stale index.html after an edit — which silently hides
changes you have been asked to look at. This says no-store on everything.
"""

import http.server
import socketserver
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
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("0.0.0.0", PORT), NoCacheHandler) as httpd:
        print(f"serving {ROOT} on http://0.0.0.0:{PORT} (no-cache)")
        httpd.serve_forever()
