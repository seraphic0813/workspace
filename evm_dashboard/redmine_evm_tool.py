import urllib.request
import json
import re
import os
from datetime import datetime, timedelta

# ========================================================
# 接続設定（接続先のRedmineに合わせて書き換えてください）
# ========================================================
api_key = "bfbf9f677c5e23db28d516d3119da9db6f536d44"
base_url = "http://localhost:3000"
project_identifier = "system_project_20260604"

# 状態ファイルのパス
state_file = os.path.join(os.path.dirname(__file__), "processed_news.json")
# EVMデータ出力先 (スクリプトと同じディレクトリ)
output_file = os.path.join(os.path.dirname(__file__), "evm_data.js")

# プロジェクト期間の定義 (2026-06-01 から 2026-07-10 まで)
project_start_str = "2026-06-01"
project_end_str = "2026-07-10"

def get_redmine_data(endpoint):
    url = f"{base_url}{endpoint}"
    req = urllib.request.Request(url)
    req.add_header("X-Redmine-API-Key", api_key)
    req.add_header("Accept", "application/json")
    try:
        with urllib.request.urlopen(req) as res:
            return json.loads(res.read().decode('utf-8'))
    except Exception as e:
        print(f"Error fetching {endpoint}: {e}")
        return None

def put_redmine_data(endpoint, data):
    url = f"{base_url}{endpoint}"
    body = json.dumps(data).encode('utf-8')
    req = urllib.request.Request(url, data=body, method='PUT')
    req.add_header("Content-Type", "application/json; charset=utf-8")
    req.add_header("X-Redmine-API-Key", api_key)
    try:
        with urllib.request.urlopen(req) as res:
            return True
    except Exception as e:
        print(f"Error PUT to {endpoint}: {e}")
        if hasattr(e, 'read'):
            print("Response:", e.read().decode('utf-8'))
        return False

def post_redmine_data(endpoint, data):
    url = f"{base_url}{endpoint}"
    body = json.dumps(data).encode('utf-8')
    req = urllib.request.Request(url, data=body, method='POST')
    req.add_header("Content-Type", "application/json; charset=utf-8")
    req.add_header("X-Redmine-API-Key", api_key)
    try:
        with urllib.request.urlopen(req) as res:
            return json.loads(res.read().decode('utf-8'))
    except Exception as e:
        print(f"Error POST to {endpoint}: {e}")
        if hasattr(e, 'read'):
            print("Response:", e.read().decode('utf-8'))
        return None

# 土日を除く営業日リストを取得する関数
def get_working_days(start_str, end_str):
    start = datetime.strptime(start_str, "%Y-%m-%d")
    end = datetime.strptime(end_str, "%Y-%m-%d")
    curr = start
    days = []
    while curr <= end:
        if curr.weekday() < 5:  # 月〜金
            days.append(curr.strftime("%Y-%m-%d"))
        curr += timedelta(days=1)
    return days

# 1. ニュースの取り込みと進捗更新処理
def process_news(target_date_str=None):
    print("=== ニュース（日報コメント）の取り込み処理を開始 ===")
    if target_date_str:
        print(f"対象日付フィルター: {target_date_str}")
        target_date_clean = target_date_str.replace("-", "")
    else:
        target_date_clean = None
    
    # 処理済みニュースIDのロード
    processed_ids = []
    if os.path.exists(state_file):
        try:
            with open(state_file, 'r', encoding='utf-8') as f:
                processed_ids = json.load(f)
        except Exception:
            pass

    # ニュース一覧を取得
    news_data = get_redmine_data(f"/projects/{project_identifier}/news.json")
    if not news_data or "news" not in news_data:
        print("ニュースデータが取得できませんでした。")
        return False

    # コメント本文の解析パターン
    pattern = re.compile(r'#(\d+)\s+(\d+)%\s*(?:(\d+(?:\.\d+)?)h)?')
    
    updated_any = False
    
    # 重複登録防止のため、すべてのタイムエントリーを取得
    existing_entries_resp = get_redmine_data(f"/time_entries.json?project_id={project_identifier}&limit=1000")
    existing_comments = set()
    if existing_entries_resp and "time_entries" in existing_entries_resp:
        for entry in existing_entries_resp["time_entries"]:
            if entry.get("comments"):
                existing_comments.add(entry["comments"])

    # ニュースを走査
    for item in news_data["news"]:
        news_id = item["id"]
        title = item.get("title", "")
        title_clean = title.replace("-", "")
        
        # 日付フィルターが適用されている場合
        if target_date_str:
            created_on_str = item.get("created_on", "").split("T")[0]
            if (target_date_clean != title_clean) and (target_date_str != created_on_str) and (target_date_str not in title):
                continue
        else:
            if news_id in processed_ids:
                continue

        print(f"\nニュースID {news_id} 「{title}」のコメントを取得中...")
        
        detail = get_redmine_data(f"/news/{news_id}.json?include=comments")
        if not detail or "news" not in detail or "comments" not in detail["news"]:
            print("  -> コメントデータが取得できませんでした。")
            if not target_date_str:
                processed_ids.append(news_id)
            continue
            
        comments = detail["news"]["comments"]
        if not comments:
            print("  -> コメントはありません。")
            if not target_date_str:
                processed_ids.append(news_id)
            continue
            
        # コメントを1件ずつ処理
        for comment in comments:
            comment_id = comment["id"]
            content = comment.get("content", "")
            commenter = comment.get("author", {})
            commenter_id = commenter.get("id")
            commenter_name = commenter.get("name", "Unknown")
            
            print(f"  -> コメントID {comment_id} (投稿者: {commenter_name}) を解析中...")
            
            matches = pattern.findall(content)
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
                
                # 実績工数の登録 (工数指定がある場合)
                if spent_hours_str:
                    spent_hours = float(spent_hours_str)
                    
                    # 使用する作業日は指定された日、無ければコメントの投稿日
                    if target_date_str:
                        spent_date = target_date_str
                    else:
                        # ニュースタイトルから日付をパース (例: 20260604 -> 2026-06-04)
                        date_match = re.search(r'(\d{4})(\d{2})(\d{2})', title)
                        if date_match:
                            spent_date = f"{date_match.group(1)}-{date_match.group(2)}-{date_match.group(3)}"
                        else:
                            spent_date = item.get("created_on", "").split("T")[0]
                    
                    comment_key = f"日報コメント#{comment_id}のチケット#{issue_id}より自動インポート"
                    
                    # 重複登録チェック
                    if comment_key in existing_comments:
                        print(f"     -> チケット #{issue_id}: コメント '{comment_key}' の実績は既に登録されているためスキップします。")
                        continue
                    
                    print(f"     -> チケット #{issue_id}: 実績工数 {spent_hours}h を登録中（作業日: {spent_date}, ユーザーID: {commenter_id}）...")
                    
                    # チケット情報から最適な作業分類(activity_id)を推測
                    issue_info = get_redmine_data(f"/issues/{issue_id}.json")
                    activity_id = 4 # デフォルト: 開発
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
                            "comments": comment_key
                        }
                    }
                    post_redmine_data("/time_entries.json", time_payload)
                    existing_comments.add(comment_key)
                    
                updated_any = True
                
        # 一括取り込み時は処理済みニュースIDとして保存
        if not target_date_str and news_id not in processed_ids:
            processed_ids.append(news_id)

    # 処理済みリストの保存
    if not target_date_str:
        with open(state_file, 'w', encoding='utf-8') as f:
            json.dump(processed_ids, f, indent=2)
        
    print("\n=== ニュース（日報コメント）の取り込み処理を完了 ===")
    return updated_any

# 2. EVMデータの計算と出力処理
def calculate_evm(target_date_str=None):
    print("\n=== EVM指標の集計処理を開始 ===")
    
    # 2.1 全チケットを取得
    issues_resp = get_redmine_data(f"/issues.json?project_id={project_identifier}&status_id=*&limit=100")
    if not issues_resp or "issues" not in issues_resp:
        print("チケット情報の取得に失敗しました。")
        return
        
    issues = issues_resp["issues"]
    
    # 子チケットのみを対象にする
    child_issues = [i for i in issues if "parent" in i]
    if not child_issues:
        child_issues = issues
        
    print(f"対象子チケット数: {len(child_issues)}件")
    
    # 各チケットの履歴（ジャーナル）を取得して、過去の進捗率の遷移マップを作る
    issue_history = {}
    for issue in child_issues:
        issue_id = issue["id"]
        issue_history[issue_id] = {}
        
        details = get_redmine_data(f"/issues/{issue_id}.json?include=journals")
        if details and "issue" in details and "journals" in details["issue"]:
            journals = details["issue"]["journals"]
            for journal in journals:
                created_date = journal.get("created_on", "").split("T")[0]
                details_list = journal.get("details", [])
                for detail in details_list:
                    if detail.get("property") == "attr" and detail.get("name") == "done_ratio":
                        new_val = int(detail.get("new_value", 0))
                        issue_history[issue_id][created_date] = new_val

    # 2.2 全タイムエントリーを取得
    time_resp = get_redmine_data(f"/time_entries.json?project_id={project_identifier}&limit=1000")
    time_entries = time_resp.get("time_entries", []) if time_resp else []
    
    # 2.3 日別EVM系列データの計算
    start_date = datetime.strptime(project_start_str, "%Y-%m-%d")
    end_date = datetime.strptime(project_end_str, "%Y-%m-%d")
    today = datetime.now()
    
    all_dates = []
    curr = start_date
    while curr <= end_date:
        all_dates.append(curr.strftime("%Y-%m-%d"))
        curr += timedelta(days=1)
        
    daily_pv = {d: 0.0 for d in all_dates}
    daily_ev = {d: 0.0 for d in all_dates}
    daily_ac = {d: 0.0 for d in all_dates}

    # 各チケットのPVを各営業日に割り振る
    for issue in child_issues:
        est = issue.get("estimated_hours")
        if not est:
            continue
        est = float(est)
        
        start_str = issue.get("start_date") or project_start_str
        due_str = issue.get("due_date") or project_end_str
        
        issue_work_days = get_working_days(start_str, due_str)
        if not issue_work_days:
            daily_pv[start_str] = daily_pv.get(start_str, 0.0) + est
            continue
            
        hours_per_day = est / len(issue_work_days)
        for day in issue_work_days:
            if day in daily_pv:
                daily_pv[day] += hours_per_day

    # 各日付時点でのEVを計算
    for day in all_dates:
        for issue in child_issues:
            est = issue.get("estimated_hours")
            if not est:
                continue
            est = float(est)
            
            issue_id = issue["id"]
            history = issue_history.get(issue_id, {})
            
            done_ratio = 0
            final_ratio = int(issue.get("done_ratio", 0))
            
            sorted_history_dates = sorted(history.keys())
            found = False
            for h_date in reversed(sorted_history_dates):
                if h_date <= day:
                    done_ratio = history[h_date]
                    found = True
                    break
            
            if not found:
                start_str = issue.get("start_date") or project_start_str
                if day >= start_str:
                    if sorted_history_dates and day < sorted_history_dates[0]:
                        done_ratio = 0
                    else:
                        done_ratio = final_ratio
                else:
                    done_ratio = 0
            
            daily_ev[day] += est * (done_ratio / 100.0)

    # 各日付時点でのACを計算
    for entry in time_entries:
        spent_on = entry.get("spent_on")
        hours = float(entry.get("hours", 0.0))
        if spent_on in daily_ac:
            daily_ac[spent_on] += hours

    # 累積値に変換
    cum_pv = 0.0
    cum_ev = 0.0
    cum_ac = 0.0
    
    time_series = []
    
    current_date_str = target_date_str if target_date_str else today.strftime("%Y-%m-%d")
    if current_date_str > project_end_str:
        current_date_str = project_end_str
        
    print(f"EVM集計基準日: {current_date_str}")
    
    for day in all_dates:
        cum_pv += daily_pv[day]
        
        if day <= current_date_str:
            cum_ev = sum([float(i.get("estimated_hours", 0)) * (daily_ev_ratio_at_day(i["id"], day, i.get("done_ratio", 0), issue_history) / 100.0) for i in child_issues])
            cum_ac += daily_ac[day]
            time_series.append({
                "date": day,
                "pv": round(cum_pv, 1),
                "ev": round(cum_ev, 1),
                "ac": round(cum_ac, 1)
            })
        else:
            time_series.append({
                "date": day,
                "pv": round(cum_pv, 1),
                "ev": None,
                "ac": None
            })

    # 2.4 メンバーごとのEVM統計の計算
    member_data = {}
    
    for issue in child_issues:
        assignee = issue.get("assigned_to")
        if not assignee:
            continue
        m_id = assignee["id"]
        m_name = assignee["name"]
        est = float(issue.get("estimated_hours") or 0.0)
        done = float(issue.get("done_ratio") or 0.0)
        
        if m_id not in member_data:
            member_data[m_id] = {"name": m_name, "pv": 0.0, "ev": 0.0, "ac": 0.0}
            
        start_str = issue.get("start_date") or project_start_str
        due_str = issue.get("due_date") or project_end_str
        all_working_days = get_working_days(start_str, due_str)
        passed_working_days = [d for d in all_working_days if d <= current_date_str]
        
        if all_working_days:
            member_pv = est * (len(passed_working_days) / len(all_working_days))
        else:
            member_pv = est if (current_date_str >= start_str) else 0.0
            
        member_data[m_id]["pv"] += member_pv
        member_data[m_id]["ev"] += est * (daily_ev_ratio_at_day(issue["id"], current_date_str, done, issue_history) / 100.0)

    for entry in time_entries:
        spent_on = entry.get("spent_on")
        if spent_on > current_date_str:
            continue
        user = entry.get("user")
        if not user:
            continue
        u_id = user["id"]
        u_name = user["name"]
        hours = float(entry.get("hours", 0.0))
        
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
            "pv": round(pv, 1),
            "ev": round(ev, 1),
            "ac": round(ac, 1),
            "sv": round(sv, 1),
            "cv": round(cv, 1),
            "spi": round(spi, 2),
            "cpi": round(cpi, 2)
        })

    # プロジェクト全体の基準日時点のサマリー
    total_est_hours = sum([float(i.get("estimated_hours") or 0.0) for i in child_issues])
    
    current_pv = sum([d["pv"] for d in time_series if d["date"] == current_date_str])
    current_ev = sum([float(i.get("estimated_hours", 0)) * (daily_ev_ratio_at_day(i["id"], current_date_str, i.get("done_ratio", 0), issue_history) / 100.0) for i in child_issues])
    current_ac = sum([d["ac"] for d in time_series if d["date"] == current_date_str])
    
    total_sv = current_ev - current_pv
    total_cv = current_ev - current_ac
    total_spi = current_ev / current_pv if current_pv > 0 else 1.0
    total_cpi = current_ev / current_ac if current_ac > 0 else 1.0
    
    project_progress = (current_ev / total_est_hours * 100.0) if total_est_hours > 0 else 0.0

    # 2.5 メンバー別 日別実績工数の集計
    passed_dates = [d for d in all_dates if d <= current_date_str]
    core_members = ["永瀬 聡", "田中 敏行", "佐藤 花子", "鈴木 一郎"]
    all_member_names = list(set([m["name"] for m in member_stats] + core_members))
    
    member_daily_ac = {}
    for d in passed_dates:
        member_daily_ac[d] = {name: 0.0 for name in all_member_names}
        
    for entry in time_entries:
        spent_on = entry.get("spent_on")
        if spent_on not in member_daily_ac:
            continue
            
        # ニュース日報から自動インポートされたものに限定
        comments = entry.get("comments") or ""
        if "インポート" not in comments:
            continue
            
        user = entry.get("user")
        if not user:
            continue
        user_name = user["name"]
        hours = float(entry.get("hours", 0.0))
        
        if user_name in member_daily_ac[spent_on]:
            member_daily_ac[spent_on][user_name] += hours
        else:
            member_daily_ac[spent_on][user_name] = hours

    member_work_logs = []
    for d in passed_dates:
        day_hours = {name: round(hrs, 1) for name, hrs in member_daily_ac[d].items()}
        member_work_logs.append({
            "date": d,
            "hours": day_hours
        })

    # 2.6 日報履歴（ニュースコメント）の取得とパース
    report_history = []
    news_resp = get_redmine_data(f"/projects/{project_identifier}/news.json")
    news_list = news_resp.get("news", []) if news_resp else []
    
    pattern_comment = re.compile(r'#(\d+)\s+(\d+)%\s*(?:(\d+(?:\.\d+)?)h)?')
    for item in news_list:
        news_id = item["id"]
        news_title = item.get("title", "")
        
        detail = get_redmine_data(f"/news/{news_id}.json?include=comments")
        if not detail or "news" not in detail or "comments" not in detail["news"]:
            continue
            
        for comment in detail["news"]["comments"]:
            content = comment.get("content", "")
            matches = pattern_comment.findall(content)
            
            parsed_items = []
            for issue_id_str, done_ratio_str, spent_hours_str in matches:
                parsed_items.append({
                    "issue_id": int(issue_id_str),
                    "done_ratio": int(done_ratio_str),
                    "hours": float(spent_hours_str) if spent_hours_str else None
                })
                
            created_on_str = comment.get("created_on", "").split("T")[0]
            if created_on_str <= current_date_str:
                report_history.append({
                    "news_title": news_title,
                    "comment_id": comment["id"],
                    "date": created_on_str,
                    "author": comment.get("author", {}).get("name", "Unknown"),
                    "content": content,
                    "parsed_items": parsed_items
                })
                
    report_history.sort(key=lambda x: (x["date"], x["comment_id"]), reverse=True)

    # 2.7 メンバーごとのチケット日別進捗率の集計 (ニュースコメントに記載された実績のみ)
    progress_records = {} # member_id -> {issue_id: {date_str: done_ratio}}
    
    for item in news_list:
        news_title = item.get("title", "")
        date_match = re.search(r'(\d{4})(\d{2})(\d{2})', news_title)
        if date_match:
            news_date = f"{date_match.group(1)}-{date_match.group(2)}-{date_match.group(3)}"
        else:
            news_date = item.get("created_on", "").split("T")[0]
            
        detail = get_redmine_data(f"/news/{item['id']}.json?include=comments")
        if not detail or "news" not in detail or "comments" not in detail["news"]:
            continue
            
        for comment in detail["news"]["comments"]:
            author = comment.get("author", {})
            author_id = author.get("id")
            if not author_id:
                continue
                
            content = comment.get("content", "")
            matches = pattern_comment.findall(content)
            if not matches:
                continue
                
            if author_id not in progress_records:
                progress_records[author_id] = {}
                
            for issue_id_str, done_ratio_str, _ in matches:
                issue_id = int(issue_id_str)
                done_ratio = int(done_ratio_str)
                
                if issue_id not in progress_records[author_id]:
                    progress_records[author_id][issue_id] = {}
                
                progress_records[author_id][issue_id][news_date] = done_ratio

    member_issue_progress = []
    for m_stats in member_stats:
        m_name = m_stats["name"]
        m_id = m_stats["id"]
        
        m_records = progress_records.get(m_id, {})
        
        assigned_issues = [i for i in child_issues if i.get("assigned_to", {}).get("id") == m_id]
        
        issue_ids = set([i["id"] for i in assigned_issues])
        for issue_id in m_records.keys():
            issue_ids.add(issue_id)
            
        m_issues = []
        for issue_id in sorted(issue_ids):
            subject = ""
            found_issue = next((i for i in child_issues if i["id"] == issue_id), None)
            if found_issue:
                subject = found_issue.get("subject", "")
            else:
                issue_info = get_redmine_data(f"/issues/{issue_id}.json")
                if issue_info and "issue" in issue_info:
                    subject = issue_info["issue"].get("subject", "")
            
            prog_by_date = {}
            for day in passed_dates:
                ratio = m_records.get(issue_id, {}).get(day, None)
                prog_by_date[day] = ratio
                
            m_issues.append({
                "issue_id": issue_id,
                "subject": subject,
                "progress_by_date": prog_by_date
            })
            
        if m_issues:
            member_issue_progress.append({
                "member_id": m_id,
                "member_name": m_name,
                "issues": m_issues
            })

    output_data = {
        "project_summary": {
            "pv": round(current_pv, 1),
            "ev": round(current_ev, 1),
            "ac": round(current_ac, 1),
            "sv": round(total_sv, 1),
            "cv": round(total_cv, 1),
            "spi": round(total_spi, 2),
            "cpi": round(total_cpi, 2),
            "progress": round(project_progress, 1),
            "total_budget": round(total_est_hours, 1)
        },
        "time_series": time_series,
        "member_stats": member_stats,
        "member_work_logs": member_work_logs,
        "report_history": report_history,
        "member_issue_progress": member_issue_progress
    }

    # JSオブジェクトとして出力
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write("window.EVM_DATA = ")
        json.dump(output_data, f, indent=2, ensure_ascii=False)
        f.write(";")
        
    print(f"EVMデータを {output_file} に出力しました。")
    print("=== EVM指標の集計処理を完了 ===")

def daily_ev_ratio_at_day(issue_id, day, current_ratio, issue_history):
    history = issue_history.get(issue_id, {})
    if not history:
        return current_ratio
    sorted_dates = sorted(history.keys())
    for h_date in reversed(sorted_dates):
        if h_date <= day:
            return history[h_date]
    return 0

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Redmine EVM Tool")
    parser.add_argument("--date", type=str, help="取り込み・集計対象の日付 (YYYY-MM-DD)", default=None)
    args = parser.parse_args()
    
    process_news(args.date)
    calculate_evm(args.date)
