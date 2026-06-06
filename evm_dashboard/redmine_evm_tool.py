"""
redmine_evm_tool.py - Redmine EVM 集計エンジン

Redmineのニュース日報コメントから進捗率・実績工数を自動インポートし、
EVM（Planned Value, Earned Value, Actual Cost）を算出する。
データはSQLiteに永続化され、ダッシュボードへはJSON APIで提供される。
"""

import urllib.request
import json
import re
import os
import sys
from datetime import datetime, timedelta

# 標準出力を強制的に UTF-8 に設定 (Windows環境での cp932 エンコーディングエラー対策)
if sys.platform.startswith('win') and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

import evm_database as db

# ========================================================
# 設定ファイル（.env）の読み込み
# ========================================================
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ENV_FILE = os.path.join(SCRIPT_DIR, ".env")


def load_env():
    """簡易 .env パーサー（python-dotenv 不要）。"""
    env = {}
    if os.path.exists(ENV_FILE):
        with open(ENV_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    key, value = line.split("=", 1)
                    env[key.strip()] = value.strip()
    return env


_env = load_env()

api_key = _env.get("REDMINE_API_KEY", "")
base_url = _env.get("REDMINE_BASE_URL", "http://localhost:3000")
project_identifier = _env.get("REDMINE_PROJECT_ID", "")
HOURS_PER_DAY = float(_env.get("HOURS_PER_DAY", "8.0"))

# EVMデータ出力先（後方互換用、API方式への移行後は不要）
output_file = os.path.join(SCRIPT_DIR, "evm_data.js")


# ========================================================
# Redmine API 通信
# ========================================================

def get_redmine_data(endpoint):
    url = f"{base_url}{endpoint}"
    req = urllib.request.Request(url)
    req.add_header("X-Redmine-API-Key", api_key)
    req.add_header("Accept", "application/json")
    try:
        with urllib.request.urlopen(req) as res:
            return json.loads(res.read().decode("utf-8"))
    except Exception as e:
        print(f"Error fetching {endpoint}: {e}")
        return None


def put_redmine_data(endpoint, data):
    url = f"{base_url}{endpoint}"
    body = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="PUT")
    req.add_header("Content-Type", "application/json; charset=utf-8")
    req.add_header("X-Redmine-API-Key", api_key)
    try:
        with urllib.request.urlopen(req) as res:
            return True
    except Exception as e:
        print(f"Error PUT to {endpoint}: {e}")
        if hasattr(e, "read"):
            print("Response:", e.read().decode("utf-8"))
        return False


def post_redmine_data(endpoint, data):
    url = f"{base_url}{endpoint}"
    body = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json; charset=utf-8")
    req.add_header("X-Redmine-API-Key", api_key)
    try:
        with urllib.request.urlopen(req) as res:
            return json.loads(res.read().decode("utf-8"))
    except Exception as e:
        print(f"Error POST to {endpoint}: {e}")
        if hasattr(e, "read"):
            print("Response:", e.read().decode("utf-8"))
        return None


# ========================================================
# ユーティリティ
# ========================================================

def get_working_days(start_str, end_str):
    """土日を除く営業日リストを取得する。"""
    start = datetime.strptime(start_str, "%Y-%m-%d")
    end = datetime.strptime(end_str, "%Y-%m-%d")
    curr = start
    days = []
    while curr <= end:
        if curr.weekday() < 5:  # 月〜金
            days.append(curr.strftime("%Y-%m-%d"))
        curr += timedelta(days=1)
    return days


def normalize_name(name):
    """Redmineの姓名を「姓 名」順に統一する。
    Redmine APIは「名 姓」で返すことがあるため、
    既知の名前パターンを検出して並びを修正する。"""
    if not name or " " not in name:
        return name or ""
    parts = name.split(" ")
    if len(parts) != 2:
        return name
    # 名前（ファーストネーム）のリスト
    first_names = {"悟史", "聡", "一郎", "花子", "敏行", "太郎", "次郎", "美咲", "健太"}
    if parts[0] in first_names:
        return f"{parts[1]} {parts[0]}"
    return name


def hours_to_mandays(hours):
    """時間を人日に変換する。"""
    if hours is None:
        return None
    return round(hours / HOURS_PER_DAY, 2)


# ========================================================
# 1. ニュースの取り込みと進捗更新処理
# ========================================================

def process_news(target_date_str=None):
    print("=== ニュース（日報コメント）の取り込み処理を開始 ===")
    if target_date_str:
        print(f"対象日付フィルター: {target_date_str}")
        target_date_clean = target_date_str.replace("-", "")
    else:
        target_date_clean = None

    # ニュース一覧を取得
    news_data = get_redmine_data(f"/projects/{project_identifier}/news.json")
    if not news_data or "news" not in news_data:
        print("ニュースデータが取得できませんでした。")
        return False

    # コメント本文の解析パターン
    pattern = re.compile(r"#(\d+)\s+(\d+)%\s*(?:(\d+(?:\.\d+)?)h)?")

    updated_any = False

    # 重複登録防止および変更検知のため、すべてのタイムエントリーを取得
    existing_entries_resp = get_redmine_data(
        f"/time_entries.json?project_id={project_identifier}&limit=1000"
    )
    existing_comments_map = {}
    if existing_entries_resp and "time_entries" in existing_entries_resp:
        for entry in existing_entries_resp["time_entries"]:
            comments = entry.get("comments")
            if comments:
                existing_comments_map[comments] = {
                    "id": entry["id"],
                    "hours": float(entry.get("hours", 0.0)),
                    "spent_on": entry.get("spent_on"),
                    "user_id": entry.get("user", {}).get("id"),
                }

    # ニュースを古い順（作成日時昇順）に走査
    sorted_news = sorted(news_data["news"], key=lambda x: x.get("created_on", ""))
    for item in sorted_news:
        news_id = item["id"]
        title = item.get("title", "")
        title_clean = title.replace("-", "")

        # 日付フィルター
        if target_date_str:
            created_on_str = item.get("created_on", "").split("T")[0]
            if (
                target_date_clean not in title_clean
                and target_date_str != created_on_str
                and target_date_str not in title
            ):
                continue

        print(f"\nニュースID {news_id} 「{title}」のコメントを取得中...")

        detail = get_redmine_data(f"/news/{news_id}.json?include=comments")
        if not detail or "news" not in detail or "comments" not in detail["news"]:
            print("  -> コメントデータが取得できませんでした。")
            continue

        comments = detail["news"]["comments"]
        if not comments:
            print("  -> コメントはありません。")
            continue

        # ニュースタイトルから日付をパース（例: 20260604 -> 2026-06-04）
        date_match = re.search(r"(\d{4})(\d{2})(\d{2})", title)
        news_date = None
        if date_match:
            news_date = f"{date_match.group(1)}-{date_match.group(2)}-{date_match.group(3)}"

        # コメントを1件ずつ処理
        for comment in comments:
            comment_id = comment["id"]
            content = comment.get("content", "")
            commenter = comment.get("author", {})
            commenter_id = commenter.get("id")
            commenter_name = normalize_name(commenter.get("name", "Unknown"))
            created_on = comment.get("created_on", "").split("T")[0]

            print(f"  -> コメントID {comment_id} (投稿者: {commenter_name}) を解析中...")

            matches = pattern.findall(content)

            # ニュースコメントをDBに保存
            parsed_items = []
            for issue_id_str, done_ratio_str, spent_hours_str in matches:
                parsed_items.append({
                    "issue_id": int(issue_id_str),
                    "done_ratio": int(done_ratio_str),
                    "hours": float(spent_hours_str) if spent_hours_str else None,
                })

            db.upsert_news_comment({
                "news_id": news_id,
                "news_title": title,
                "comment_id": comment_id,
                "author_id": commenter_id,
                "author_name": commenter_name,
                "content": content,
                "created_on": created_on,
                "parsed_items": parsed_items,
            })

            if not matches:
                print("     -> 有効な進捗データが見つかりませんでした。")
                continue

            for issue_id_str, done_ratio_str, spent_hours_str in matches:
                issue_id = int(issue_id_str)
                done_ratio = int(done_ratio_str)

                # 進捗率の更新
                print(f"     -> チケット #{issue_id}: 進捗率 {done_ratio}% に更新中...")
                issue_payload = {"issue": {"done_ratio": done_ratio}}
                put_redmine_data(f"/issues/{issue_id}.json", issue_payload)

                # 進捗率履歴を作業日付でローカルDBに登録
                if target_date_str:
                    spent_date = target_date_str
                elif news_date:
                    spent_date = news_date
                else:
                    spent_date = created_on

                if spent_date:
                    db.upsert_journal(issue_id, spent_date, done_ratio)

                # 実績工数の登録
                if spent_hours_str:
                    spent_hours = float(spent_hours_str)

                    if target_date_str:
                        spent_date = target_date_str
                    elif news_date:
                        spent_date = news_date
                    else:
                        spent_date = created_on

                    comment_key = f"日報コメント#{comment_id}のチケット#{issue_id}より自動インポート"

                    # 重複チェック・差分更新
                    if comment_key in existing_comments_map:
                        existing = existing_comments_map[comment_key]
                        if (
                            existing["hours"] != spent_hours
                            or existing["spent_on"] != spent_date
                            or existing["user_id"] != commenter_id
                        ):
                            print(
                                f"     -> チケット #{issue_id}: 実績データ更新 "
                                f"({existing['hours']}h -> {spent_hours}h)"
                            )
                            update_payload = {
                                "time_entry": {
                                    "hours": spent_hours,
                                    "spent_on": spent_date,
                                    "user_id": commenter_id,
                                }
                            }
                            put_redmine_data(
                                f"/time_entries/{existing['id']}.json", update_payload
                            )
                        else:
                            print(
                                f"     -> チケット #{issue_id}: 変更なしスキップ"
                            )
                        continue

                    print(
                        f"     -> チケット #{issue_id}: 実績工数 {spent_hours}h 登録中 "
                        f"(作業日: {spent_date})"
                    )

                    # 作業分類の推測
                    issue_info = get_redmine_data(f"/issues/{issue_id}.json")
                    activity_id = 4  # デフォルト: 開発
                    if issue_info and "issue" in issue_info:
                        subj = issue_info["issue"].get("subject", "")
                        if "設計" in subj:
                            activity_id = 5
                        elif "テスト" in subj:
                            activity_id = 6

                    time_payload = {
                        "time_entry": {
                            "issue_id": issue_id,
                            "hours": spent_hours,
                            "spent_on": spent_date,
                            "user_id": commenter_id,
                            "activity_id": activity_id,
                            "comments": comment_key,
                        }
                    }
                    post_redmine_data("/time_entries.json", time_payload)
                    existing_comments_map[comment_key] = {
                        "id": None,
                        "hours": spent_hours,
                        "spent_on": spent_date,
                        "user_id": commenter_id,
                    }

                updated_any = True

    print("\n=== ニュース（日報コメント）の取り込み処理を完了 ===")
    return updated_any


# ========================================================
# 2. Redmine → SQLite 同期
# ========================================================

def sync_redmine_to_db(target_date_str=None):
    """Redmineからチケット・タイムエントリー・ジャーナルを取得しDBに格納する。"""
    print("\n=== Redmine → DB 同期を開始 ===")

    # 2.1 全チケットを取得
    issues_resp = get_redmine_data(
        f"/issues.json?project_id={project_identifier}&status_id=*&limit=100"
    )
    if not issues_resp or "issues" not in issues_resp:
        print("チケット情報の取得に失敗しました。")
        db.add_sync_log("sync_issues", "error", "チケット取得失敗")
        return False

    issues = issues_resp["issues"]
    print(f"取得チケット数: {len(issues)}件")

    # 末端チケット判定: 親IDとして参照されているチケットIDを特定
    all_issue_ids = set(i["id"] for i in issues)
    parent_ids = set(
        i.get("parent", {}).get("id")
        for i in issues
        if "parent" in i and i["parent"]
    )

    # チケットをDB用の辞書に変換してUPSERT
    issue_dicts = []
    for issue in issues:
        assignee = issue.get("assigned_to", {})
        raw_name = assignee.get("name", "") if assignee else ""
        status = issue.get("status", {})
        tracker = issue.get("tracker", {})

        issue_dicts.append({
            "id": issue["id"],
            "subject": issue.get("subject", ""),
            "assigned_to_id": assignee.get("id") if assignee else None,
            "assigned_to_name": normalize_name(raw_name),
            "estimated_hours": issue.get("estimated_hours"),
            "done_ratio": issue.get("done_ratio", 0),
            "start_date": issue.get("start_date"),
            "due_date": issue.get("due_date"),
            "parent_id": issue.get("parent", {}).get("id") if issue.get("parent") else None,
            "status_id": status.get("id"),
            "status_name": status.get("name", ""),
            "tracker_id": tracker.get("id"),
            "tracker_name": tracker.get("name", ""),
            "updated_on": issue.get("updated_on"),
            "is_leaf": 1 if issue["id"] not in parent_ids else 0,
        })

    db.upsert_issues_bulk(issue_dicts)
    print(f"  -> {len(issue_dicts)}件のチケットをDBに同期しました。")

    # 2.2 各チケットのジャーナル（進捗率変更履歴）を取得
    journals_bulk = []
    for issue in issues:
        issue_id = issue["id"]
        details_resp = get_redmine_data(f"/issues/{issue_id}.json?include=journals")
        if details_resp and "issue" in details_resp and "journals" in details_resp["issue"]:
            for journal in details_resp["issue"]["journals"]:
                journal_date = journal.get("created_on", "").split("T")[0]
                # 手動同期で指定した日付より未来のジャーナルは無視する
                if target_date_str and journal_date > target_date_str:
                    continue
                # Redmine Admin（ID: 1）によるテストリセットなどの操作は履歴汚染を防ぐため無視する
                journal_user = journal.get("user", {})
                if journal_user.get("id") == 1:
                    continue
                for detail in journal.get("details", []):
                    if detail.get("property") == "attr" and detail.get("name") == "done_ratio":
                        new_val = int(detail.get("new_value", 0))
                        journals_bulk.append((issue_id, journal_date, new_val))

    if journals_bulk:
        db.upsert_journals_bulk(journals_bulk)
        print(f"  -> {len(journals_bulk)}件の進捗率変更履歴をDBに同期しました。")

    # 2.3 タイムエントリーを取得
    time_resp = get_redmine_data(
        f"/time_entries.json?project_id={project_identifier}&limit=1000"
    )
    time_entries = time_resp.get("time_entries", []) if time_resp else []

    entry_dicts = []
    for entry in time_entries:
        user = entry.get("user", {})
        entry_dicts.append({
            "id": entry["id"],
            "issue_id": entry.get("issue", {}).get("id") if entry.get("issue") else None,
            "user_id": user.get("id") if user else None,
            "user_name": normalize_name(user.get("name", "")) if user else "",
            "hours": float(entry.get("hours", 0.0)),
            "spent_on": entry.get("spent_on"),
            "activity_id": entry.get("activity", {}).get("id") if entry.get("activity") else None,
            "comments": entry.get("comments", ""),
            "updated_on": entry.get("updated_on"),
        })

    if entry_dicts:
        db.upsert_time_entries_bulk(entry_dicts)
        print(f"  -> {len(entry_dicts)}件のタイムエントリーをDBに同期しました。")

    # 2.4 ニュースコメントの収集
    news_resp = get_redmine_data(f"/projects/{project_identifier}/news.json")
    news_list = news_resp.get("news", []) if news_resp else []
    pattern = re.compile(r"#(\d+)\s+(\d+)%\s*(?:(\d+(?:\.\d+)?)h)?")
    comment_count = 0

    # ニュースを古い順（作成日時昇順）に走査
    sorted_news = sorted(news_list, key=lambda x: x.get("created_on", ""))
    for item in sorted_news:
        news_id = item["id"]
        news_title = item.get("title", "")
        detail = get_redmine_data(f"/news/{news_id}.json?include=comments")
        if not detail or "news" not in detail or "comments" not in detail["news"]:
            continue

        # ニュースタイトルから日付をパース（例: 20260604 -> 2026-06-04）
        date_match = re.search(r"(\d{4})(\d{2})(\d{2})", news_title)
        news_date = None
        if date_match:
            news_date = f"{date_match.group(1)}-{date_match.group(2)}-{date_match.group(3)}"

        # 基準日フィルター: ニュースの対象日付が target_date_str より未来なら同期をスキップ
        if target_date_str:
            created_on_str = item.get("created_on", "").split("T")[0] if item.get("created_on") else ""
            news_ref_date = news_date if news_date else created_on_str
            if news_ref_date and news_ref_date > target_date_str:
                continue

        for comment in detail["news"]["comments"]:
            content = comment.get("content", "")
            matches = pattern.findall(content)
            parsed_items = []
            created_on = comment.get("created_on", "").split("T")[0] if comment.get("created_on") else ""

            # 作業日の決定
            spent_date = news_date if news_date else created_on

            for issue_id_str, done_ratio_str, spent_hours_str in matches:
                issue_id = int(issue_id_str)
                done_ratio = int(done_ratio_str)
                parsed_items.append({
                    "issue_id": issue_id,
                    "done_ratio": done_ratio,
                    "hours": float(spent_hours_str) if spent_hours_str else None,
                })
                # 進捗率履歴を作業日付でローカルDBに登録
                if spent_date:
                    db.upsert_journal(issue_id, spent_date, done_ratio)

            author = comment.get("author", {})
            db.upsert_news_comment({
                "news_id": news_id,
                "news_title": news_title,
                "comment_id": comment["id"],
                "author_id": author.get("id"),
                "author_name": normalize_name(author.get("name", "")),
                "content": content,
                "created_on": comment.get("created_on", "").split("T")[0],
                "parsed_items": parsed_items,
            })
            comment_count += 1

    print(f"  -> {comment_count}件のニュースコメントをDBに同期しました。")

    db.add_sync_log("full_sync", "success", f"issues={len(issue_dicts)}, time_entries={len(entry_dicts)}")
    print("=== Redmine → DB 同期を完了 ===")
    return True


# ========================================================
# 3. EVM計算（DBからデータを読み出して計算）
# ========================================================

def calculate_evm_from_db(target_date_str=None):
    """DBに格納されたデータからEVM指標を算出し、JSON形式で返す。"""
    print("\n=== EVM指標の集計処理を開始 ===")

    # 末端チケットのみを対象にする（BAC不整合の修正: A-4）
    leaf_issues = db.get_leaf_issues()

    if not leaf_issues:
        print("対象チケットがありません。")
        last_synced = db.get_last_sync_time() if hasattr(db, "get_last_sync_time") else None
        last_synced_display = "未同期"
        if last_synced:
            try:
                sync_dt = datetime.fromisoformat(last_synced)
                last_synced_display = sync_dt.strftime("%Y-%m-%d %H:%M")
            except (ValueError, TypeError):
                last_synced_display = last_synced
        return {
            "project_summary": {
                "pv": 0.0,
                "ev": 0.0,
                "ac": 0.0,
                "sv": 0.0,
                "cv": 0.0,
                "spi": 1.0,
                "cpi": 1.0,
                "progress": 0.0,
                "total_budget": 0.0,
                "unit": "人日",
                "last_synced": last_synced_display,
                "base_date": "",
                "bac": 0.0,
                "etc": 0.0,
                "eac": 0.0,
                "vac": 0.0,
                "planned_end_date": "-",
                "forecast_end_date": "-"
            },
            "time_series": [],
            "forecast_series": [],
            "member_stats": [],
            "member_work_logs": [],
            "member_issue_progress": []
        }

    print(f"対象末端チケット数: {len(leaf_issues)}件")

    # BAC内訳のログ出力（検算用）
    print("\n--- BAC 内訳 ---")
    total_est = 0.0
    for issue in leaf_issues:
        est = issue.get("estimated_hours") or 0.0
        total_est += est
        print(f"  #{issue['id']} {issue['subject']}: {est}h ({hours_to_mandays(est)}人日)")
        if est == 0:
            print(f"    [警告] 予定工数が未設定です！")
    print(f"  合計 BAC = {total_est}h ({hours_to_mandays(total_est)}人日)")
    print("--- BAC 内訳 ここまで ---\n")

    # プロジェクト期間の動的算出
    start_dates = [i["start_date"] for i in leaf_issues if i.get("start_date")]
    due_dates = [i["due_date"] for i in leaf_issues if i.get("due_date")]

    if not start_dates or not due_dates:
        print("エラー: チケットに開始日または期日が設定されていません。")
        return None

    calc_start_date = min(start_dates)
    calc_end_date = max(due_dates)

    print(f"プロジェクト期間: {calc_start_date} 〜 {calc_end_date}")

    # 進捗率変更履歴を取得
    issue_history = db.get_issue_history()

    # タイムエントリーを取得
    time_entries = db.get_all_time_entries()

    # 営業日リストを作成（B-6修正: 土日を除外）
    working_dates = get_working_days(calc_start_date, calc_end_date)

    if not working_dates:
        print("エラー: 営業日が0日です。")
        return None

    today = datetime.now()
    current_date_str = target_date_str if target_date_str else today.strftime("%Y-%m-%d")
    if current_date_str > calc_end_date:
        current_date_str = calc_end_date

    # 休日バグの修正: current_date_str が営業日リストに含まれていない場合、直近の過去の営業日を採用する
    if working_dates and current_date_str not in working_dates:
        past_working_dates = [d for d in working_dates if d <= current_date_str]
        if past_working_dates:
            current_date_str = max(past_working_dates)
        else:
            # プロジェクト開始前の場合は最初の営業日とする
            current_date_str = working_dates[0]

    print(f"EVM集計基準日: {current_date_str}")

    # === PV計算: 各チケットの予定工数を営業日に均等分配 ===
    daily_pv = {d: 0.0 for d in working_dates}
    for issue in leaf_issues:
        est = issue.get("estimated_hours")
        if not est:
            continue
        est = float(est)
        start_str = issue.get("start_date") or calc_start_date
        due_str = issue.get("due_date") or calc_end_date
        issue_work_days = get_working_days(start_str, due_str)
        if not issue_work_days:
            if start_str in daily_pv:
                daily_pv[start_str] += est
            continue
        hours_per_day = est / len(issue_work_days)
        for day in issue_work_days:
            if day in daily_pv:
                daily_pv[day] += hours_per_day

    # === AC計算: タイムエントリーの日別集計 ===
    daily_ac = {d: 0.0 for d in working_dates}
    for entry in time_entries:
        spent_on = entry.get("spent_on")
        hours = float(entry.get("hours", 0.0))
        if spent_on in daily_ac:
            daily_ac[spent_on] += hours

    # === 累積値に変換して時系列データ生成 ===
    cum_pv = 0.0
    cum_ac = 0.0
    time_series = []

    for day in working_dates:
        cum_pv += daily_pv[day]

        if day <= current_date_str:
            # EV: その日時点での各チケットの進捗率 × 予定工数の合計
            cum_ev = sum(
                float(i.get("estimated_hours") or 0)
                * (_get_ratio_at_day(i["id"], day, i.get("done_ratio", 0), issue_history) / 100.0)
                for i in leaf_issues
            )
            cum_ac += daily_ac[day]
            time_series.append({
                "date": day,
                "pv": round(hours_to_mandays(cum_pv), 2),
                "ev": round(hours_to_mandays(cum_ev), 2),
                "ac": round(hours_to_mandays(cum_ac), 2),
            })
        else:
            time_series.append({
                "date": day,
                "pv": round(hours_to_mandays(cum_pv), 2),
                "ev": None,
                "ac": None,
            })

    # === メンバー別EVM統計 ===
    member_data = {}
    for issue in leaf_issues:
        m_id = issue.get("assigned_to_id")
        m_name = issue.get("assigned_to_name", "")
        if not m_id:
            continue
        est = float(issue.get("estimated_hours") or 0.0)
        done = float(issue.get("done_ratio") or 0.0)

        if m_id not in member_data:
            member_data[m_id] = {"name": m_name, "pv": 0.0, "ev": 0.0, "ac": 0.0}

        start_str = issue.get("start_date") or calc_start_date
        due_str = issue.get("due_date") or calc_end_date
        all_working = get_working_days(start_str, due_str)
        passed_working = [d for d in all_working if d <= current_date_str]

        if all_working:
            member_pv = est * (len(passed_working) / len(all_working))
        else:
            member_pv = est if current_date_str >= start_str else 0.0

        member_data[m_id]["pv"] += member_pv
        member_data[m_id]["ev"] += est * (
            _get_ratio_at_day(issue["id"], current_date_str, done, issue_history) / 100.0
        )

    for entry in time_entries:
        spent_on = entry.get("spent_on")
        if not spent_on or spent_on > current_date_str:
            continue
        u_id = entry.get("user_id")
        u_name = entry.get("user_name", "")
        hours = float(entry.get("hours", 0.0))
        if not u_id:
            continue
        if u_id not in member_data:
            member_data[u_id] = {"name": u_name, "pv": 0.0, "ev": 0.0, "ac": 0.0}
        member_data[u_id]["ac"] += hours

    member_stats = []
    for m_id, stats in member_data.items():
        pv = stats["pv"]
        ev = stats["ev"]
        ac = stats["ac"]
        sv = ev - pv
        cv = ev - ac
        spi = ev / pv if pv > 0 else (1.0 if ev == 0 else 99.9)
        cpi = ev / ac if ac > 0 else (1.0 if ev == 0 else 99.9)

        member_stats.append({
            "id": m_id,
            "name": stats["name"],
            "pv": round(hours_to_mandays(pv), 2),
            "ev": round(hours_to_mandays(ev), 2),
            "ac": round(hours_to_mandays(ac), 2),
            "sv": round(hours_to_mandays(sv), 2),
            "cv": round(hours_to_mandays(cv), 2),
            "spi": round(spi, 2),
            "cpi": round(cpi, 2),
        })

    # === プロジェクトサマリー ===
    total_est_hours = sum(float(i.get("estimated_hours") or 0.0) for i in leaf_issues)
    bac_md = hours_to_mandays(total_est_hours)

    # 基準日時点の累積PV（最後に追加されたtime_seriesの値を使用）
    current_ts = [t for t in time_series if t["date"] == current_date_str]
    current_pv_md = current_ts[0]["pv"] if current_ts else 0.0

    current_ev_hours = sum(
        float(i.get("estimated_hours") or 0)
        * (_get_ratio_at_day(i["id"], current_date_str, i.get("done_ratio", 0), issue_history) / 100.0)
        for i in leaf_issues
    )
    current_ev_md = hours_to_mandays(current_ev_hours)

    current_ac_md = current_ts[0]["ac"] if current_ts else 0.0

    total_sv_md = current_ev_md - current_pv_md
    total_cv_md = current_ev_md - current_ac_md
    total_spi = current_ev_md / current_pv_md if current_pv_md > 0 else 1.0
    total_cpi = current_ev_md / current_ac_md if current_ac_md > 0 else 1.0
    project_progress = (current_ev_hours / total_est_hours * 100.0) if total_est_hours > 0 else 0.0

    # === EVM予測指標の計算 ===
    # ETC (Estimate To Complete): 残作業コスト見積もり
    if total_cpi > 0:
        etc_md = (bac_md - current_ev_md) / total_cpi
    else:
        etc_md = bac_md - current_ev_md

    # EAC (Estimate At Completion): 完了時総コスト見積もり
    eac_md = current_ac_md + etc_md

    # VAC (Variance At Completion): 完了時コスト差異
    vac_md = bac_md - eac_md

    # === 完了予定日・完了予測日の計算 ===
    planned_end_date = calc_end_date  # 本来の計画完了日

    # 完了予測日: SPI ベースで算出（土日を除く営業日カレンダーで計算）
    forecast_end_date = None
    d_total = len(working_dates)  # 計画総営業日数
    d_passed = len([d for d in working_dates if d <= current_date_str])  # 経過営業日数

    if total_spi > 0.01 and current_ev_md > 0:
        d_pred_total = d_total / total_spi  # 予測総営業日数
        d_remain = max(0, d_pred_total - d_passed)  # 残り予測営業日数
        d_remain_int = int(round(d_remain))

        # 基準日から営業日で d_remain 日後の日付を算出
        if d_remain_int > 0:
            cursor = datetime.strptime(current_date_str, "%Y-%m-%d")
            days_added = 0
            while days_added < d_remain_int:
                cursor += timedelta(days=1)
                if cursor.weekday() < 5:  # 月〜金
                    days_added += 1
            forecast_end_date = cursor.strftime("%Y-%m-%d")
        else:
            forecast_end_date = current_date_str
    else:
        # 進捗がない場合は計画完了日を表示
        forecast_end_date = planned_end_date

    print(f"完了予定日（計画）: {planned_end_date}")
    print(f"完了予測日（見込み）: {forecast_end_date}")

    # === 未来予測時系列データ（S字カーブの予測線用） ===
    # 基準日から完了予測日（または計画完了日の遅い方）までの未来営業日を生成
    forecast_target_date = max(planned_end_date, forecast_end_date) if forecast_end_date else planned_end_date
    future_working_dates = get_working_days(current_date_str, forecast_target_date)
    # 基準日自体は既に time_series に含まれているので除外
    future_working_dates = [d for d in future_working_dates if d > current_date_str]

    # 予測EV: 基準日のEVから BAC まで、未来の営業日数に均等割で到達
    # 予測AC: 基準日のACから EAC まで、未来の営業日数に均等割で到達
    forecast_series = []
    if future_working_dates and current_ev_md < bac_md:
        n_future = len(future_working_dates)
        ev_remaining = bac_md - current_ev_md
        ac_remaining = eac_md - current_ac_md
        for idx, day in enumerate(future_working_dates):
            frac = (idx + 1) / n_future
            forecast_ev = round(current_ev_md + ev_remaining * frac, 2)
            forecast_ac = round(current_ac_md + ac_remaining * frac, 2)
            # PVは既存のtime_series に含まれる日付分はそちらから取得、含まれなければ BAC
            existing_ts = next((t for t in time_series if t["date"] == day), None)
            forecast_pv = existing_ts["pv"] if existing_ts else round(bac_md, 2)
            forecast_series.append({
                "date": day,
                "pv": forecast_pv,
                "ev": forecast_ev,
                "ac": forecast_ac,
            })

    # === メンバー別日別実績工数 ===
    passed_dates = [d for d in working_dates if d <= current_date_str]
    all_member_names = list(set(m["name"] for m in member_stats))

    member_daily_ac = {}
    for d in passed_dates:
        member_daily_ac[d] = {name: 0.0 for name in all_member_names}

    for entry in time_entries:
        spent_on = entry.get("spent_on")
        if spent_on not in member_daily_ac:
            continue
        comments_text = entry.get("comments") or ""
        if "インポート" not in comments_text:
            continue
        user_name = entry.get("user_name", "")
        hours = float(entry.get("hours", 0.0))
        if user_name in member_daily_ac[spent_on]:
            member_daily_ac[spent_on][user_name] += hours
        else:
            member_daily_ac[spent_on][user_name] = hours

    # 実績工数は時間(h)単位で出力（人日変換しない）
    member_work_logs = []
    for d in passed_dates:
        day_hours = {
            name: round(hrs, 1)
            for name, hrs in member_daily_ac[d].items()
        }
        member_work_logs.append({"date": d, "hours": day_hours})

    # === メンバーごとのチケット日別進捗率 ===
    news_comments = db.get_all_news_comments()
    progress_records = {}  # member_id -> {issue_id: {date_str: done_ratio}}
    pattern = re.compile(r"#(\d+)\s+(\d+)%\s*(?:(\d+(?:\.\d+)?)h)?")

    for nc in news_comments:
        author_id = nc.get("author_id")
        if not author_id:
            continue
        # ニュースタイトルから日付を取得
        news_title = nc.get("news_title", "")
        dm = re.search(r"(\d{4})(\d{2})(\d{2})", news_title)
        if dm:
            nc_date = f"{dm.group(1)}-{dm.group(2)}-{dm.group(3)}"
        else:
            nc_date = nc.get("created_on", "")

        for pi in nc.get("parsed_items", []):
            issue_id = pi.get("issue_id")
            done_ratio = pi.get("done_ratio")
            if issue_id is None or done_ratio is None:
                continue
            if author_id not in progress_records:
                progress_records[author_id] = {}
            if issue_id not in progress_records[author_id]:
                progress_records[author_id][issue_id] = {}
            progress_records[author_id][issue_id][nc_date] = done_ratio

    member_issue_progress = []
    for m_stats in member_stats:
        m_name = m_stats["name"]
        m_id = m_stats["id"]
        m_records = progress_records.get(m_id, {})

        assigned_issues = [i for i in leaf_issues if i.get("assigned_to_id") == m_id]
        issue_ids = set(i["id"] for i in assigned_issues)
        for iid in m_records.keys():
            issue_ids.add(iid)

        m_issues = []
        for issue_id in sorted(issue_ids):
            subject = ""
            found = next((i for i in leaf_issues if i["id"] == issue_id), None)
            if found:
                subject = found.get("subject", "")

            prog_by_date = {}
            for day in passed_dates:
                ratio = m_records.get(issue_id, {}).get(day, None)
                prog_by_date[day] = ratio

            m_issues.append({
                "issue_id": issue_id,
                "subject": subject,
                "progress_by_date": prog_by_date,
            })

        if m_issues:
            member_issue_progress.append({
                "member_id": m_id,
                "member_name": m_name,
                "issues": m_issues,
            })

    # === 最終同期日時 ===
    last_synced = db.get_last_sync_time()
    if last_synced:
        try:
            sync_dt = datetime.fromisoformat(last_synced)
            last_synced_display = sync_dt.strftime("%Y-%m-%d %H:%M")
        except (ValueError, TypeError):
            last_synced_display = last_synced
    else:
        last_synced_display = "未同期"

    # === 出力データ構築 ===
    output_data = {
        "project_summary": {
            "pv": round(current_pv_md, 2),
            "ev": round(current_ev_md, 2),
            "ac": round(current_ac_md, 2),
            "sv": round(total_sv_md, 2),
            "cv": round(total_cv_md, 2),
            "spi": round(total_spi, 2),
            "cpi": round(total_cpi, 2),
            "progress": round(project_progress, 1),
            "total_budget": round(bac_md, 2),
            "unit": "人日",
            "last_synced": last_synced_display,
            "base_date": current_date_str,
            "bac": round(bac_md, 2),
            "etc": round(etc_md, 2),
            "eac": round(eac_md, 2),
            "vac": round(vac_md, 2),
            "planned_end_date": planned_end_date,
            "forecast_end_date": forecast_end_date,
        },
        "time_series": time_series,
        "forecast_series": forecast_series,
        "member_stats": member_stats,
        "member_work_logs": member_work_logs,
        "member_issue_progress": member_issue_progress,
    }

    # 後方互換: evm_data.js にも出力
    with open(output_file, "w", encoding="utf-8") as f:
        f.write("window.EVM_DATA = ")
        json.dump(output_data, f, indent=2, ensure_ascii=False)
        f.write(";")

    print(f"EVMデータを {output_file} に出力しました。")
    print("=== EVM指標の集計処理を完了 ===")

    return output_data


def _get_ratio_at_day(issue_id, day, current_ratio, issue_history):
    """指定日時点でのチケットの進捗率を、ジャーナル履歴から取得する。"""
    history = issue_history.get(issue_id, {})
    if not history:
        return current_ratio
    sorted_dates = sorted(history.keys())
    for h_date in reversed(sorted_dates):
        if h_date <= day:
            return history[h_date]
    return 0


# ========================================================
# メインエントリーポイント
# ========================================================

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Redmine EVM Tool")
    parser.add_argument(
        "--date", type=str, help="取り込み・集計対象の日付 (YYYY-MM-DD)", default=None
    )
    args = parser.parse_args()

    process_news(args.date)
    sync_redmine_to_db(args.date)
    calculate_evm_from_db(args.date)
