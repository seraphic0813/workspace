"""
server.py - EVM Dashboard バックエンドサーバー

静的ファイルの配信と、Redmine同期APIおよびEVMデータAPIを提供する。
タスクスケジューラまたはbatファイルから常駐起動されることを想定。
"""

import http.server
import socketserver
import subprocess
import os
import sys
import json
import logging

# 標準出力を強制的に UTF-8 に設定 (Windows環境での cp932 エンコーディングエラー対策)
if sys.platform.startswith('win') and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

PORT = 8000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))
PID_FILE = os.path.join(DIRECTORY, "server.pid")
LOG_FILE = os.path.join(DIRECTORY, "server.log")

# ログ設定（コンソール＆ファイル）
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
    ],
)
logger = logging.getLogger(__name__)


class EVMHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    # Content-Type に charset=utf-8 を明示してブラウザでの文字化け・JS構文エラーを防止
    extensions_map = http.server.SimpleHTTPRequestHandler.extensions_map.copy()
    extensions_map.update({
        ".js": "application/javascript; charset=utf-8",
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json; charset=utf-8",
    })

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):

        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, format, *args):
        """標準のログ出力をloggingモジュール経由に置き換え。"""
        logger.info(f"{self.client_address[0]} - {format % args}")

    def do_GET(self):
        """GET: /api/evm-data は DB からEVMデータをJSON返却。それ以外は静的ファイル。"""
        if self.path.startswith("/api/evm-data"):
            self._handle_evm_data()
        else:
            super().do_GET()

    def do_POST(self):
        """POST: /api/sync はRedmine同期を実行。"""
        if self.path.startswith("/api/sync"):
            self._handle_sync()
        else:
            self._send_json_error(404, "Not Found")

    def _handle_evm_data(self):
        """DBからEVM計算結果をJSON形式で返す。"""
        try:
            # クエリパラメータの解析
            from urllib.parse import urlparse, parse_qs
            parsed_url = urlparse(self.path)
            query_params = parse_qs(parsed_url.query)
            target_date = query_params.get("date", [None])[0]

            # redmine_evm_tool のインポートと実行
            sys.path.insert(0, DIRECTORY)
            import importlib
            import redmine_evm_tool
            importlib.reload(redmine_evm_tool)

            evm_data = redmine_evm_tool.calculate_evm_from_db(target_date)

            if evm_data is None:
                self._send_json_error(500, "EVM計算に失敗しました。チケットデータがDBにない可能性があります。")
                return

            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.end_headers()
            self.wfile.write(json.dumps(evm_data, ensure_ascii=False).encode("utf-8"))

        except Exception as e:
            logger.error(f"EVM data API error: {e}", exc_info=True)
            self._send_json_error(500, f"EVM計算中にエラーが発生しました: {str(e)}")

    def _handle_sync(self):
        """Redmine同期を実行する。"""
        content_length = int(self.headers.get("Content-Length", "0"))

        target_date = None
        if content_length > 0:
            try:
                post_data = self.rfile.read(content_length).decode("utf-8")
                params = json.loads(post_data)
                target_date = params.get("date")
            except Exception:
                target_date = None

        logger.info(f"Sync requested for date: {target_date}")

        script_path = os.path.join(DIRECTORY, "redmine_evm_tool.py")
        cmd = [sys.executable, script_path]
        if target_date:
            cmd.extend(["--date", target_date])

        # 子プロセスでの文字化け・エンコーディングエラー防止のための環境変数設定
        env = os.environ.copy()
        env["PYTHONIOENCODING"] = "utf-8"

        try:
            result = subprocess.run(
                cmd, capture_output=True, text=True, encoding="utf-8", env=env, check=True, timeout=120
            )
            logger.info(f"Sync completed successfully")

            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            response = {
                "status": "success",
                "message": f"{target_date if target_date else '直近'}の日報データを取り込み、EVMを集計しました。",
                "output": result.stdout,
            }
            self.wfile.write(json.dumps(response, ensure_ascii=False).encode("utf-8"))

        except subprocess.TimeoutExpired:
            logger.error("Sync script timed out")
            self._send_json_error(504, "同期スクリプトがタイムアウトしました。")

        except subprocess.CalledProcessError as e:
            logger.error(f"Sync script error: {e.stderr}")
            self.send_response(500)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            response = {
                "status": "error",
                "message": "同期スクリプトの実行に失敗しました。",
                "error": e.stderr if e.stderr else e.stdout,
            }
            self.wfile.write(json.dumps(response, ensure_ascii=False).encode("utf-8"))

        except Exception as e:
            logger.error(f"Unexpected sync error: {e}", exc_info=True)
            self._send_json_error(500, f"同期中に予期しないエラーが発生しました: {str(e)}")

    def _send_json_error(self, status_code, message):
        """エラーレスポンスをJSON形式で送信。"""
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        response = {"status": "error", "message": message}
        self.wfile.write(json.dumps(response, ensure_ascii=False).encode("utf-8"))


def is_server_running():
    """PIDファイルを確認してサーバーが既に稼働中かチェック。"""
    if not os.path.exists(PID_FILE):
        return False
    try:
        with open(PID_FILE, "r") as f:
            pid = int(f.read().strip())
        # プロセスが存在するか確認（Windows）
        import ctypes
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(0x0001, False, pid)  # PROCESS_TERMINATE
        if handle:
            kernel32.CloseHandle(handle)
            return True
        return False
    except (ValueError, OSError, AttributeError):
        return False


def write_pid():
    """現在のPIDをファイルに書き出す。"""
    with open(PID_FILE, "w") as f:
        f.write(str(os.getpid()))


def remove_pid():
    """PIDファイルを削除する。"""
    try:
        os.remove(PID_FILE)
    except OSError:
        pass


def run():
    os.chdir(DIRECTORY)

    if is_server_running():
        logger.warning(f"サーバーは既にポート {PORT} で稼働中です。二重起動を防止しました。")
        sys.exit(0)

    write_pid()
    socketserver.ThreadingTCPServer.allow_reuse_address = True

    try:
        with socketserver.ThreadingTCPServer(("", PORT), EVMHTTPRequestHandler) as httpd:
            logger.info(f"EVM Dashboard Server is running at http://localhost:{PORT}")
            logger.info(f"Serving files from: {DIRECTORY}")
            logger.info(f"PID: {os.getpid()}")
            try:
                httpd.serve_forever()
            except KeyboardInterrupt:
                logger.info("Shutting down server.")
    finally:
        remove_pid()


if __name__ == "__main__":
    run()
