import http.server
import socketserver
import subprocess
import os
import json

PORT = 8000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class EVMHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_POST(self):
        if self.path.startswith('/api/sync'):
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length).decode('utf-8')
            
            try:
                params = json.loads(post_data)
                target_date = params.get('date')
            except Exception:
                target_date = None

            print(f"Sync requested for date: {target_date}")
            
            # サーバーと同じディレクトリのスクリプトパス
            script_path = os.path.join(DIRECTORY, "redmine_evm_tool.py")
            
            cmd = ["python", script_path]
            if target_date:
                cmd.extend(["--date", target_date])
                
            try:
                # 同期スクリプトを実行
                result = subprocess.run(cmd, capture_output=True, text=True, check=True)
                print("STDOUT:", result.stdout)
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                response = {
                    "status": "success",
                    "message": f"{target_date if target_date else '直近'}の日報データを取り込み、EVMを集計しました。",
                    "output": result.stdout
                }
                self.wfile.write(json.dumps(response, ensure_ascii=False).encode('utf-8'))
            except subprocess.CalledProcessError as e:
                print("Process Error STDOUT:", e.stdout)
                print("Process Error STDERR:", e.stderr)
                self.send_response(500)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                response = {
                    "status": "error",
                    "message": "同期スクリプトの実行に失敗しました。",
                    "error": e.stderr if e.stderr else e.stdout
                }
                self.wfile.write(json.dumps(response, ensure_ascii=False).encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()

def run():
    os.chdir(DIRECTORY)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), EVMHTTPRequestHandler) as httpd:
        print(f"EVM Dashboard Server is running at http://localhost:{PORT}")
        print(f"Serving files from: {DIRECTORY}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server.")

if __name__ == '__main__':
    run()
