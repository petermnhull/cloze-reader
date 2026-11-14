# Local dev server: like `python3 -m http.server`, but tells the browser not to cache, so an edited
# styles.css or src/*.js is never mixed with a stale copy of the other files.
import http.server
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f"Serving on http://localhost:{port}")
    http.server.ThreadingHTTPServer(("", port), NoCacheHandler).serve_forever()
