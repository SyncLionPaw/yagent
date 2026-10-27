#!/usr/bin/env python3
"""本地服务器：托管 new.html，并提供 selection.json 的读写接口。

用法：
    python3 server.py
然后浏览器打开 http://localhost:8000/new.html
"""
import json
import os
import re
from http.server import HTTPServer, SimpleHTTPRequestHandler

PORT = 8000
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SELECTION_FILE = os.path.join(BASE_DIR, 'selection.json')
THEME_FILE = os.path.join(BASE_DIR, 'theme.json')
CELL_ID_RE = re.compile(r'^[0-3]-[0-3]-[0-3]-[0-3]$')
COLOR_RE = re.compile(r'^#[0-9a-fA-F]{6}$')


class Handler(SimpleHTTPRequestHandler):
    def _send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == '/api/selection':
            try:
                with open(SELECTION_FILE, 'r', encoding='utf-8') as f:
                    data = json.load(f)
            except (OSError, json.JSONDecodeError):
                data = []
            self._send_json(data)
        elif self.path == '/api/theme':
            try:
                with open(THEME_FILE, 'r', encoding='utf-8') as f:
                    data = json.load(f)
            except (OSError, json.JSONDecodeError):
                data = {}
            self._send_json(data)
        else:
            super().do_GET()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_POST(self):
        if self.path == '/api/theme':
            try:
                length = int(self.headers.get('Content-Length', 0))
                data = json.loads(self.rfile.read(length) or b'{}')
                if not isinstance(data, dict):
                    raise ValueError('invalid theme')
                theme = {
                    'mode': data.get('mode') if data.get('mode') in ('solid', 'gradient') else 'solid',
                    'solid': data.get('solid') if COLOR_RE.match(str(data.get('solid', ''))) else '#ffffff',
                    'from': data.get('from') if COLOR_RE.match(str(data.get('from', ''))) else '#ff8a5c',
                    'to': data.get('to') if COLOR_RE.match(str(data.get('to', ''))) else '#5c8aff',
                }
                with open(THEME_FILE, 'w', encoding='utf-8') as f:
                    json.dump(theme, f, ensure_ascii=False, indent=2)
                self._send_json({'ok': True})
            except (ValueError, json.JSONDecodeError) as e:
                self._send_json({'error': str(e)}, 400)
            return
        if self.path != '/api/selection':
            self._send_json({'error': 'not found'}, 404)
            return
        try:
            length = int(self.headers.get('Content-Length', 0))
            data = json.loads(self.rfile.read(length) or b'[]')
            if not isinstance(data, list) or not all(isinstance(x, str) and CELL_ID_RE.match(x) for x in data):
                raise ValueError('invalid cell id list')
            data = sorted(set(data))
            with open(SELECTION_FILE, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            self._send_json({'ok': True, 'count': len(data)})
        except (ValueError, json.JSONDecodeError) as e:
            self._send_json({'error': str(e)}, 400)

    def log_message(self, fmt, *args):
        pass  # 保持终端干净


if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    print(f'服务已启动: http://localhost:{PORT}/new.html')
    print(f'坐标文件: {SELECTION_FILE}')
    print('按 Ctrl+C 停止')
    HTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
