import os
import re
import sys
from functools import partial
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))

MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".glsl": "text/plain; charset=utf-8",
    ".vert": "text/plain; charset=utf-8",
    ".frag": "text/plain; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ogg": "audio/ogg",
    ".oga": "audio/ogg",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".mp4": "video/mp4",
}

RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)")


class RequestHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _resolve(self):
        path = self.path.split("?", 1)[0].split("#", 1)[0]
        if path in ("/", "/index", "/index.html"):
            path = "/index.html"
        rel = os.path.normpath(path.lstrip("/")).replace("\\", "/")
        if rel.startswith("..") or os.path.isabs(rel):
            return None
        full = os.path.join(ROOT, rel)
        return full if os.path.isfile(full) else None

    def _ctype(self, full):
        return MIME.get(os.path.splitext(full)[1].lower(), "application/octet-stream")

    def _send_range(self, full, size):
        m = RANGE_RE.match(self.headers.get("Range", ""))
        start, end = 0, size - 1
        if m and (m.group(1) or m.group(2)):
            if m.group(1):
                start = int(m.group(1))
                end = int(m.group(2)) if m.group(2) else size - 1
            else:
                start = max(0, size - int(m.group(2)))
            end = min(end, size - 1)
            if start > end or start >= size:
                self.send_response(416)
                self.send_header("Content-Range", "bytes */%d" % size)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return

        length = end - start + 1
        with open(full, "rb") as f:
            f.seek(start)
            data = f.read(length)

        if start == 0 and end == size - 1:
            self.send_response(200)
        else:
            self.send_response(206)
            self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
        self.send_header("Content-Type", self._ctype(full))
        self.send_header("Content-Length", str(length))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_HEAD(self):
        full = self._resolve()
        if not full:
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", self._ctype(full))
        self.send_header("Content-Length", str(os.path.getsize(full)))
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()

    def do_GET(self):
        full = self._resolve()
        if not full:
            body = b"404 Not Found"
            self.send_response(404)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self._send_range(full, os.path.getsize(full))


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    httpd = ThreadingHTTPServer(("", port), RequestHandler)
    print("Serving %s on http://localhost:%d" % (ROOT, port))
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass