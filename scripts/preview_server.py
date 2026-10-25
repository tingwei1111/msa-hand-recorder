#!/usr/bin/env python3
"""Serve synthetic UI previews on loopback, including their demo game routes."""
import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_head(self):
        original = self.path
        if urlsplit(self.path).path == '/' or re.fullmatch(r'/game/[a-fA-F0-9-]{36}/?', urlsplit(self.path).path):
            self.path = '/demo/index.html'
        try:
            return super().send_head()
        finally:
            self.path = original


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8768)
    args = parser.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    print(f'Synthetic previews: http://127.0.0.1:{args.port}/demo/index.html', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
