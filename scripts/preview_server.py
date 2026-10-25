#!/usr/bin/env python3
"""Serve synthetic UI previews on loopback, including their demo game routes."""
import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import shutil
import subprocess
import threading
import time
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parents[1]
CARD_CODE = re.compile(r'(?:GD\d{2,3}|ST\d{2,3}|EB\d{2,3}|SC\d{2,3}|SLB\d{2,3}|PR|P|R|T|EXB|EXR)-\d{3}')
CARD_SLOTS = threading.BoundedSemaphore(2)
CARD_CACHE = {}
CARD_LOCK = threading.Lock()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def json_response(self, value, status=200):
        data = json.dumps(value, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if urlsplit(self.path).path != '/__msa_preview/card':
            return super().do_GET()
        allowed_hosts = {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}
        host = self.headers.get('Host', '')
        origin = self.headers.get('Origin')
        if host not in allowed_hosts or (origin and origin not in {f'http://{item}' for item in allowed_hosts}):
            return self.json_response({'status':'error','reason':'只允許本機預覽來源。'},403)
        query = parse_qs(urlsplit(self.path).query, keep_blank_values=True)
        if set(query) != {'cardCode','locale'} or any(len(value) != 1 for value in query.values()):
            return self.json_response({'status':'error','reason':'只接受單一卡號與語言。'},400)
        code, locale = query['cardCode'][0], query['locale'][0]
        if not CARD_CODE.fullmatch(code) or locale not in {'zh-tw','en'}:
            return self.json_response({'status':'error','reason':'卡號或語言格式不符。'},400)
        cache_key = (code,locale)
        with CARD_LOCK:
            cached = CARD_CACHE.get(cache_key)
            if cached and time.monotonic()-cached[0] < 600:
                return self.json_response(cached[1])
        if not CARD_SLOTS.acquire(blocking=False):
            return self.json_response({'status':'error','reason':'預覽查卡忙碌中，請稍候重試。'},429)
        try:
            node = shutil.which('node')
            if not node:
                return self.json_response({'status':'error','reason':'找不到 Node.js；請安裝 Node 22 以上後重啟預覽。'},503)
            result = subprocess.run([node,str(ROOT/'scripts/preview_card.cjs'),code,locale],
                                    cwd=ROOT,capture_output=True,text=True,timeout=25,check=False)
            value = json.loads(result.stdout)
            if not isinstance(value,dict) or result.returncode:
                raise ValueError('Invalid provider response')
            if value.get('status') != 'error':
                with CARD_LOCK:
                    if len(CARD_CACHE) >= 16:
                        CARD_CACHE.pop(next(iter(CARD_CACHE)))
                    CARD_CACHE[cache_key] = (time.monotonic(),value)
            return self.json_response(value)
        except subprocess.TimeoutExpired:
            return self.json_response({'status':'error','reason':'官方卡片查詢逾時，請稍後重試。'},504)
        except (ValueError,OSError):
            return self.json_response({'status':'error','reason':'預覽查卡服務未能回應。'},502)
        finally:
            CARD_SLOTS.release()

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
