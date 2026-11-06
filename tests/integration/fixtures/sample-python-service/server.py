import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer

# 真实 Python HTTP 服务：供工作台「接入真实项目」演示（第二个技术栈）。
# 无第三方依赖，仅使用标准库。
PORT = int(os.environ.get("PORT", "8080"))


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok", "stack": "python"}).encode("utf-8"))
            return

        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        body = (
            "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">"
            "<title>示例 Python 服务</title></head><body>"
            "<h1>示例 Python 服务</h1>"
            "<p>这是一个由工作台托管运行的 Python 服务。</p>"
            "<p>端口：" + str(PORT) + "</p></body></html>"
        )
        self.wfile.write(body.encode("utf-8"))

    def log_message(self, *args):
        print("sample-python-service:", *args, flush=True)


server = HTTPServer(("127.0.0.1", PORT), Handler)
print("sample-python-service listening on http://127.0.0.1:" + str(PORT), flush=True)
server.serve_forever()
