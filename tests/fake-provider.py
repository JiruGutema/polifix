import http.server, json, sys, threading, time

PORT = int(sys.argv[1])

# CRLF, because that is what real providers send — Gemini among them. A
# fake that speaks bare LF hides a whole class of framing bug.
BODY = [
    'data: {"choices":[{"delta":{"content":"Hello"}}]}\r\n\r\n',
    'data: {"choices":[{"delta":{"content":", world"}}]}\r\n\r\n',
    'data: [DONE]\r\n\r\n',
]

class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get('content-length', 0))
        req = json.loads(self.rfile.read(n) or b'{}')
        if req.get('model') == 'boom':
            payload = json.dumps({"error": {"message": "invalid api key"}}).encode()
            self.send_response(401)
            self.send_header('content-type', 'application/json')
            self.send_header('content-length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        self.send_response(200)
        self.send_header('content-type', 'text/event-stream')
        self.end_headers()
        for chunk in BODY:
            self.wfile.write(chunk.encode())
            self.wfile.flush()
            time.sleep(0.02)

    def log_message(self, *a):
        pass

http.server.HTTPServer(('127.0.0.1', PORT), H).serve_forever()
