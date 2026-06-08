#!/usr/bin/env python3
"""
setup_3months.py  -  3か月分シミュレーションデータ投入 v2

変更点:
- SPI/CPI を独立してメンバー別に設定（個人差の表現）
- estimated_hours を並行タスク数・稼働日数から自動計算（容量超過警告を解消）
- 実績工数 = 計画工数 × SPI / CPI（EV/AC 比率が目標 CPI に収束）
"""
import os, sys, json, subprocess
import urllib.request
from datetime import date, timedelta

if sys.platform.startswith("win") and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

# ============================================================
# 設定
# ============================================================
API_KEY      = "bfbf9f677c5e23db28d516d3119da9db6f536d44"
BASE_URL     = "http://localhost:3000"
PROJECT_ID   = "system_project_20260604"
PROJECT_PK   = 1
DB_CONTAINER = "redmine-test-db-1"
DB_NAME      = "redmine"
DB_USER      = "redmine"
ACTIVITY_ID  = 4
REPORT_END   = "2026-07-31"   # この日まで日報データを生成（デモ用に未来も含む）

# ============================================================
# メンバー定義
# spi: スケジュール効率（進捗速度）
# cpi: コスト効率（生産性）  ← 今回新設
# ============================================================
MEMBERS = [
    # PM: ほぼ計画通り、コスト微超過
    {"login": "yamada",    "fn": "健二",   "ln": "山田", "role": "PM",   "spi": 0.98, "cpi": 0.97, "has_client_mtg": True},
    # TL1: スケジュール・コストともに優秀
    {"login": "suzuki",    "fn": "一郎",   "ln": "鈴木", "role": "TL1",  "spi": 1.05, "cpi": 1.08, "has_client_mtg": True},
    # TL2: 進捗遅れ気味、コスト効率も低い
    {"login": "tanaka_m",  "fn": "美咲",   "ln": "田中", "role": "TL2",  "spi": 0.87, "cpi": 0.84, "has_client_mtg": True},
    # 実務: 若干先行、生産性高め
    {"login": "sato_s",    "fn": "翔太",   "ln": "佐藤", "role": "実務", "spi": 1.03, "cpi": 1.06, "has_client_mtg": False},
    # 実務: チーム最優秀メンバー
    {"login": "nakamura",  "fn": "あかり", "ln": "中村", "role": "実務", "spi": 1.10, "cpi": 1.12, "has_client_mtg": False},
    # 実務: 進捗・コストとも厳しい
    {"login": "takahashi", "fn": "大輔",   "ln": "高橋", "role": "実務", "spi": 0.84, "cpi": 0.79, "has_client_mtg": False},
    # 実務: やや遅れ、コストは概ね許容範囲
    {"login": "ito_a",     "fn": "彩",     "ln": "伊藤", "role": "実務", "spi": 0.95, "cpi": 0.93, "has_client_mtg": False},
    # 実務: インフラ担当、最も苦戦
    {"login": "watanabe",  "fn": "健",     "ln": "渡辺", "role": "実務", "spi": 0.74, "cpi": 0.68, "has_client_mtg": False},
]

PARENT_ISSUES = [
    {"key": "admin",  "subject": "管理・会議",           "start": "2026-06-01", "end": "2026-08-31"},
    {"key": "spec",   "subject": "仕様検討",             "start": "2026-06-01", "end": "2026-06-12"},
    {"key": "basic",  "subject": "基本設計",             "start": "2026-06-15", "end": "2026-06-26"},
    {"key": "detail", "subject": "詳細設計",             "start": "2026-06-29", "end": "2026-07-10"},
    {"key": "impl",   "subject": "実装",                 "start": "2026-07-13", "end": "2026-08-07"},
    {"key": "ut",     "subject": "UT（単体テスト）",     "start": "2026-07-27", "end": "2026-08-14"},
    {"key": "it",     "subject": "IT（結合テスト）",     "start": "2026-08-03", "end": "2026-08-21"},
    {"key": "st",     "subject": "ST（システムテスト）", "start": "2026-08-17", "end": "2026-08-28"},
    {"key": "uat",    "subject": "UAT（受け入れテスト）","start": "2026-08-24", "end": "2026-08-31"},
]

# estimated_hours は後で自動計算して上書きするため 0 で初期化
ISSUE_TEMPLATES = [
    # --- 管理・会議（全期間）---
    {"key": "mtg_yamada",    "subject": "社内MTG 山田",   "member": "yamada",    "start": "2026-06-01", "end": "2026-08-31", "hours": 0, "parent_key": "admin", "type": "mtg"},
    {"key": "mtg_suzuki",    "subject": "社内MTG 鈴木",   "member": "suzuki",    "start": "2026-06-01", "end": "2026-08-31", "hours": 0, "parent_key": "admin", "type": "mtg"},
    {"key": "mtg_tanaka_m",  "subject": "社内MTG 田中",   "member": "tanaka_m",  "start": "2026-06-01", "end": "2026-08-31", "hours": 0, "parent_key": "admin", "type": "mtg"},
    {"key": "mtg_sato_s",    "subject": "社内MTG 佐藤",   "member": "sato_s",    "start": "2026-06-01", "end": "2026-08-31", "hours": 0, "parent_key": "admin", "type": "mtg"},
    {"key": "mtg_nakamura",  "subject": "社内MTG 中村",   "member": "nakamura",  "start": "2026-06-01", "end": "2026-08-31", "hours": 0, "parent_key": "admin", "type": "mtg"},
    {"key": "mtg_takahashi", "subject": "社内MTG 高橋",   "member": "takahashi", "start": "2026-06-01", "end": "2026-08-31", "hours": 0, "parent_key": "admin", "type": "mtg"},
    {"key": "mtg_ito_a",     "subject": "社内MTG 伊藤",   "member": "ito_a",     "start": "2026-06-01", "end": "2026-08-31", "hours": 0, "parent_key": "admin", "type": "mtg"},
    {"key": "mtg_watanabe",  "subject": "社内MTG 渡辺",   "member": "watanabe",  "start": "2026-06-01", "end": "2026-08-31", "hours": 0, "parent_key": "admin", "type": "mtg"},
    {"key": "cmtg_yamada",   "subject": "客先MTG 山田",   "member": "yamada",    "start": "2026-06-01", "end": "2026-08-31", "hours": 0, "parent_key": "admin", "type": "cmtg"},
    {"key": "cmtg_suzuki",   "subject": "客先MTG 鈴木",   "member": "suzuki",    "start": "2026-06-01", "end": "2026-08-31", "hours": 0, "parent_key": "admin", "type": "cmtg"},
    {"key": "cmtg_tanaka_m", "subject": "客先MTG 田中",   "member": "tanaka_m",  "start": "2026-06-01", "end": "2026-08-31", "hours": 0, "parent_key": "admin", "type": "cmtg"},
    {"key": "pm_mgmt",       "subject": "PM管理業務",      "member": "yamada",    "start": "2026-06-01", "end": "2026-08-31", "hours": 0, "parent_key": "admin", "type": "pmgmt"},
    # --- 仕様検討 (6/1-6/12, 10日) ---
    {"key": "spec_yamada",    "subject": "要件定義・仕様整理書作成",       "member": "yamada",    "start": "2026-06-01", "end": "2026-06-12", "hours": 0, "parent_key": "spec", "type": "dev"},
    {"key": "spec_suzuki",    "subject": "仕様レビュー・技術検討",         "member": "suzuki",    "start": "2026-06-01", "end": "2026-06-12", "hours": 0, "parent_key": "spec", "type": "dev"},
    {"key": "spec_tanaka_m",  "subject": "仕様レビュー・DB方式検討",       "member": "tanaka_m",  "start": "2026-06-01", "end": "2026-06-12", "hours": 0, "parent_key": "spec", "type": "dev"},
    {"key": "spec_sato_s",    "subject": "画面仕様検討（一覧・詳細画面）", "member": "sato_s",    "start": "2026-06-01", "end": "2026-06-12", "hours": 0, "parent_key": "spec", "type": "dev"},
    {"key": "spec_nakamura",  "subject": "画面仕様検討（検索画面）",       "member": "nakamura",  "start": "2026-06-01", "end": "2026-06-12", "hours": 0, "parent_key": "spec", "type": "dev"},
    {"key": "spec_takahashi", "subject": "画面仕様検討（登録画面）",       "member": "takahashi", "start": "2026-06-01", "end": "2026-06-12", "hours": 0, "parent_key": "spec", "type": "dev"},
    {"key": "spec_ito_a",     "subject": "画面仕様検討（管理画面）",       "member": "ito_a",     "start": "2026-06-01", "end": "2026-06-12", "hours": 0, "parent_key": "spec", "type": "dev"},
    {"key": "spec_watanabe",  "subject": "非機能要件整理",                 "member": "watanabe",  "start": "2026-06-01", "end": "2026-06-12", "hours": 0, "parent_key": "spec", "type": "dev"},
    # --- 基本設計 (6/15-6/26, 10日) ---
    {"key": "basic_suzuki",    "subject": "アーキテクチャ設計",           "member": "suzuki",    "start": "2026-06-15", "end": "2026-06-26", "hours": 0, "parent_key": "basic", "type": "dev"},
    {"key": "basic_tanaka_m",  "subject": "DB設計・ER図作成",             "member": "tanaka_m",  "start": "2026-06-15", "end": "2026-06-26", "hours": 0, "parent_key": "basic", "type": "dev"},
    {"key": "basic_sato_s",    "subject": "基本設計書（一覧・詳細画面）", "member": "sato_s",    "start": "2026-06-15", "end": "2026-06-26", "hours": 0, "parent_key": "basic", "type": "dev"},
    {"key": "basic_nakamura",  "subject": "基本設計書（検索画面）",       "member": "nakamura",  "start": "2026-06-15", "end": "2026-06-26", "hours": 0, "parent_key": "basic", "type": "dev"},
    {"key": "basic_takahashi", "subject": "基本設計書（登録画面）",       "member": "takahashi", "start": "2026-06-15", "end": "2026-06-26", "hours": 0, "parent_key": "basic", "type": "dev"},
    {"key": "basic_ito_a",     "subject": "基本設計書（管理画面）",       "member": "ito_a",     "start": "2026-06-15", "end": "2026-06-26", "hours": 0, "parent_key": "basic", "type": "dev"},
    {"key": "basic_watanabe",  "subject": "インフラ・環境設計",           "member": "watanabe",  "start": "2026-06-15", "end": "2026-06-26", "hours": 0, "parent_key": "basic", "type": "dev"},
    # --- 詳細設計 (6/29-7/10, 10日) ---
    {"key": "detail_suzuki",    "subject": "詳細設計レビュー・品質管理",  "member": "suzuki",    "start": "2026-06-29", "end": "2026-07-10", "hours": 0, "parent_key": "detail", "type": "dev"},
    {"key": "detail_tanaka_m",  "subject": "DB詳細設計・テーブル定義書",  "member": "tanaka_m",  "start": "2026-06-29", "end": "2026-07-10", "hours": 0, "parent_key": "detail", "type": "dev"},
    {"key": "detail_sato_s",    "subject": "詳細設計書（一覧・詳細）",    "member": "sato_s",    "start": "2026-06-29", "end": "2026-07-10", "hours": 0, "parent_key": "detail", "type": "dev"},
    {"key": "detail_nakamura",  "subject": "詳細設計書（検索画面）",      "member": "nakamura",  "start": "2026-06-29", "end": "2026-07-10", "hours": 0, "parent_key": "detail", "type": "dev"},
    {"key": "detail_takahashi", "subject": "詳細設計書（登録画面）",      "member": "takahashi", "start": "2026-06-29", "end": "2026-07-10", "hours": 0, "parent_key": "detail", "type": "dev"},
    {"key": "detail_ito_a",     "subject": "API仕様書（一覧・詳細）",     "member": "ito_a",     "start": "2026-06-29", "end": "2026-07-10", "hours": 0, "parent_key": "detail", "type": "dev"},
    {"key": "detail_watanabe",  "subject": "API仕様書（検索・登録）",     "member": "watanabe",  "start": "2026-06-29", "end": "2026-07-10", "hours": 0, "parent_key": "detail", "type": "dev"},
    # --- 実装 (7/13-8/7, 20日) ---
    {"key": "impl_suzuki",    "subject": "バックエンドAPI実装（一覧・詳細）",    "member": "suzuki",    "start": "2026-07-13", "end": "2026-08-07", "hours": 0, "parent_key": "impl", "type": "dev"},
    {"key": "impl_tanaka_m",  "subject": "バックエンドAPI実装（検索・登録）",    "member": "tanaka_m",  "start": "2026-07-13", "end": "2026-08-07", "hours": 0, "parent_key": "impl", "type": "dev"},
    {"key": "impl_sato_s",    "subject": "フロント実装（一覧画面）",             "member": "sato_s",    "start": "2026-07-13", "end": "2026-08-07", "hours": 0, "parent_key": "impl", "type": "dev"},
    {"key": "impl_nakamura",  "subject": "フロント実装（詳細・検索画面）",       "member": "nakamura",  "start": "2026-07-13", "end": "2026-08-07", "hours": 0, "parent_key": "impl", "type": "dev"},
    {"key": "impl_takahashi", "subject": "フロント実装（登録画面）",             "member": "takahashi", "start": "2026-07-13", "end": "2026-08-07", "hours": 0, "parent_key": "impl", "type": "dev"},
    {"key": "impl_ito_a",     "subject": "フロント実装（管理画面）",             "member": "ito_a",     "start": "2026-07-13", "end": "2026-08-07", "hours": 0, "parent_key": "impl", "type": "dev"},
    {"key": "impl_watanabe",  "subject": "共通基盤・CI/CD構築",                 "member": "watanabe",  "start": "2026-07-13", "end": "2026-08-07", "hours": 0, "parent_key": "impl", "type": "dev"},
    # --- UT (7/27-8/14) ---
    {"key": "ut_suzuki",    "subject": "UTテスト設計・実施（バックエンド）", "member": "suzuki",    "start": "2026-07-27", "end": "2026-08-14", "hours": 0, "parent_key": "ut", "type": "dev"},
    {"key": "ut_tanaka_m",  "subject": "UTテスト設計・実施（DB・API）",     "member": "tanaka_m",  "start": "2026-07-27", "end": "2026-08-14", "hours": 0, "parent_key": "ut", "type": "dev"},
    {"key": "ut_sato_s",    "subject": "UT実施（一覧・詳細画面）",          "member": "sato_s",    "start": "2026-07-27", "end": "2026-08-14", "hours": 0, "parent_key": "ut", "type": "dev"},
    {"key": "ut_nakamura",  "subject": "UT実施（検索・登録画面）",          "member": "nakamura",  "start": "2026-07-27", "end": "2026-08-14", "hours": 0, "parent_key": "ut", "type": "dev"},
    {"key": "ut_takahashi", "subject": "UT実施（登録・管理画面）",          "member": "takahashi", "start": "2026-07-27", "end": "2026-08-14", "hours": 0, "parent_key": "ut", "type": "dev"},
    {"key": "ut_ito_a",     "subject": "UT実施（管理・共通）",              "member": "ito_a",     "start": "2026-07-27", "end": "2026-08-14", "hours": 0, "parent_key": "ut", "type": "dev"},
    {"key": "ut_watanabe",  "subject": "UT実施・テスト環境整備",            "member": "watanabe",  "start": "2026-07-27", "end": "2026-08-14", "hours": 0, "parent_key": "ut", "type": "dev"},
    # --- IT (8/3-8/21) ---
    {"key": "it_suzuki",    "subject": "ITテスト設計・実施",              "member": "suzuki",    "start": "2026-08-03", "end": "2026-08-21", "hours": 0, "parent_key": "it", "type": "dev"},
    {"key": "it_tanaka_m",  "subject": "ITテスト実施・バグ管理",          "member": "tanaka_m",  "start": "2026-08-03", "end": "2026-08-21", "hours": 0, "parent_key": "it", "type": "dev"},
    {"key": "it_sato_s",    "subject": "IT実施・バグ修正（一覧・詳細）",  "member": "sato_s",    "start": "2026-08-03", "end": "2026-08-21", "hours": 0, "parent_key": "it", "type": "dev"},
    {"key": "it_nakamura",  "subject": "IT実施・バグ修正（検索・登録）",  "member": "nakamura",  "start": "2026-08-03", "end": "2026-08-21", "hours": 0, "parent_key": "it", "type": "dev"},
    {"key": "it_takahashi", "subject": "IT実施・バグ修正（登録・管理）",  "member": "takahashi", "start": "2026-08-03", "end": "2026-08-21", "hours": 0, "parent_key": "it", "type": "dev"},
    {"key": "it_ito_a",     "subject": "IT実施（管理画面・共通）",        "member": "ito_a",     "start": "2026-08-03", "end": "2026-08-21", "hours": 0, "parent_key": "it", "type": "dev"},
    # --- ST (8/17-8/28) ---
    {"key": "st_suzuki",    "subject": "STテスト計画・実施",             "member": "suzuki",    "start": "2026-08-17", "end": "2026-08-28", "hours": 0, "parent_key": "st", "type": "dev"},
    {"key": "st_tanaka_m",  "subject": "ST品質確認・バグ管理",           "member": "tanaka_m",  "start": "2026-08-17", "end": "2026-08-28", "hours": 0, "parent_key": "st", "type": "dev"},
    {"key": "st_sato_s",    "subject": "STバグ修正対応（一覧・詳細）",   "member": "sato_s",    "start": "2026-08-17", "end": "2026-08-28", "hours": 0, "parent_key": "st", "type": "dev"},
    {"key": "st_nakamura",  "subject": "STバグ修正対応（検索・登録）",   "member": "nakamura",  "start": "2026-08-17", "end": "2026-08-28", "hours": 0, "parent_key": "st", "type": "dev"},
    # --- UAT (8/24-8/31) ---
    {"key": "uat_yamada",   "subject": "UAT対応・納品管理", "member": "yamada",   "start": "2026-08-24", "end": "2026-08-31", "hours": 0, "parent_key": "uat", "type": "dev"},
    {"key": "uat_suzuki",   "subject": "UAT技術支援",       "member": "suzuki",   "start": "2026-08-24", "end": "2026-08-31", "hours": 0, "parent_key": "uat", "type": "dev"},
    {"key": "uat_tanaka_m", "subject": "UATバグ修正",       "member": "tanaka_m", "start": "2026-08-24", "end": "2026-08-31", "hours": 0, "parent_key": "uat", "type": "dev"},
]

# ============================================================
# ヘルパー
# ============================================================
def working_days(start_str, end_str):
    result, d, e = [], date.fromisoformat(start_str), date.fromisoformat(end_str)
    while d <= e:
        if d.weekday() < 5:
            result.append(d.isoformat())
        d += timedelta(days=1)
    return result

ALL_BIZ = working_days("2026-06-01", "2026-08-31")
TOTAL_BIZ = len(ALL_BIZ)   # 65
CLIENT_DAYS = [d for d in ALL_BIZ if date.fromisoformat(d).weekday() in (0, 3)]

def isoweek(d_str):
    return date.fromisoformat(d_str).isocalendar()[1]

def api(endpoint, method="GET", data=None):
    url = f"{BASE_URL}{endpoint}"
    body = json.dumps(data).encode("utf-8") if data else None
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header("X-Redmine-API-Key", API_KEY)
    req.add_header("Accept", "application/json")
    if data:
        req.add_header("Content-Type", "application/json; charset=utf-8")
    try:
        with urllib.request.urlopen(req) as res:
            b = res.read().decode("utf-8")
            return json.loads(b) if b.strip() else {}
    except Exception as e:
        print(f"  [API Error] {method} {endpoint}: {e}")
        return None

def exec_sql_file(sql_path):
    container_path = "/tmp/setup_data.sql"
    subprocess.run(["docker", "cp", sql_path, f"{DB_CONTAINER}:{container_path}"],
                   check=True, capture_output=True)
    res = subprocess.run(
        ["docker", "exec", DB_CONTAINER, "psql", "-U", DB_USER, "-d", DB_NAME,
         "-f", container_path, "-q"],
        capture_output=True, text=True, encoding="utf-8"
    )
    if res.returncode != 0:
        print(f"  [DB Error] {res.stderr[:500]}")
    else:
        errs = [l for l in res.stderr.splitlines() if "ERROR" in l.upper()]
        for e in errs[:5]:
            print(f"  [SQL WARN] {e}")
    return res.returncode

def sq(s):
    return str(s).replace("'", "''")

# ============================================================
# STEP 0: estimated_hours の自動計算
# 各メンバーの1日あたり稼働上限 = 8h - 固定オーバーヘッド
# 並行する dev タスク数で均等割りして超過しないよう保証する
# ============================================================
def compute_all_hours():
    member_map = {m["login"]: m for m in MEMBERS}

    for tmpl in ISSUE_TEMPLATES:
        login  = tmpl["member"]
        member = member_map[login]
        ttype  = tmpl["type"]

        if ttype == "mtg":
            # 1h/day × 全営業日
            tmpl["hours"] = float(TOTAL_BIZ)
        elif ttype == "cmtg":
            # 0.5h × 月・木の日数
            tmpl["hours"] = round(len(CLIENT_DAYS) * 0.5, 1)
        elif ttype == "pmgmt":
            # yamada の PM 管理業務固定
            tmpl["hours"] = 50.0
        else:
            # dev タスク: 並行タスクを考慮して上限を超えないよう計算
            overhead = 1.0  # mtg は常に 1h/day
            if member["has_client_mtg"]:
                overhead += len(CLIENT_DAYS) * 0.5 / TOTAL_BIZ  # cmtg 平均
            if login == "yamada":
                overhead += 50.0 / TOTAL_BIZ  # pm_mgmt 平均

            dev_cap = 8.0 - overhead

            task_days  = working_days(tmpl["start"], tmpl["end"])
            member_devs = [t for t in ISSUE_TEMPLATES
                           if t["member"] == login and t["type"] == "dev"]

            total_h = 0.0
            for d in task_days:
                n_concurrent = sum(1 for t in member_devs
                                   if t["start"] <= d <= t["end"])
                total_h += dev_cap / max(n_concurrent, 1)

            tmpl["hours"] = round(total_h, 1)

    total = sum(t["hours"] for t in ISSUE_TEMPLATES if t["type"] == "dev")
    print(f"  estimated_hours 計算完了 (dev合計: {total:.0f}h = {total/160:.1f}人月)")

# ============================================================
# STEP 1: クリーンアップ
# ============================================================
def clean_all():
    print("\n===== STEP 1: 既存データ削除 =====")
    te = api(f"/time_entries.json?project_id={PROJECT_ID}&limit=1000")
    entries = te.get("time_entries", []) if te else []
    for e in entries:
        api(f"/time_entries/{e['id']}.json", "DELETE")
    print(f"  time_entries {len(entries)} 件削除")

    ns = api(f"/projects/{PROJECT_ID}/news.json?limit=200")
    news_list = ns.get("news", []) if ns else []
    for n in news_list:
        api(f"/news/{n['id']}.json", "DELETE")
    print(f"  news {len(news_list)} 件削除")

    resp = api(f"/issues.json?project_id={PROJECT_ID}&status_id=*&limit=200")
    issues = resp.get("issues", []) if resp else []
    for i in [x for x in issues if x.get("parent")]:
        api(f"/issues/{i['id']}.json", "DELETE")
    for i in [x for x in issues if not x.get("parent")]:
        api(f"/issues/{i['id']}.json", "DELETE")
    print(f"  issues {len(issues)} 件削除\n  完了")

# ============================================================
# STEP 2: ユーザー作成
# ============================================================
def create_users():
    print("\n===== STEP 2: ユーザー作成 =====")
    existing = api("/users.json?limit=100")
    for u in (existing.get("users", []) if existing else []):
        if u["id"] != 1:
            api(f"/users/{u['id']}.json", "DELETE")
            print(f"  削除: {u['login']} (id={u['id']})")

    login_to_id = {}
    for m in MEMBERS:
        res = api("/users.json", "POST", {"user": {
            "login": m["login"], "firstname": m["fn"], "lastname": m["ln"],
            "mail": f"{m['login']}@example.com", "password": "password123", "status": 1,
        }})
        if res and "user" in res:
            uid = res["user"]["id"]
            login_to_id[m["login"]] = uid
            print(f"  作成: {m['ln']} {m['fn']} ({m['login']}) id={uid}  SPI={m['spi']}  CPI={m['cpi']}")

    for uid in login_to_id.values():
        api(f"/projects/{PROJECT_ID}/memberships.json", "POST",
            {"membership": {"user_id": uid, "role_ids": [3]}})

    print(f"  {len(login_to_id)} 名作成・プロジェクト追加完了")
    return login_to_id

# ============================================================
# STEP 3: チケット作成
# ============================================================
def create_issues(login_to_id):
    print("\n===== STEP 3: チケット作成 =====")
    key_to_id = {}

    for p in PARENT_ISSUES:
        res = api("/issues.json", "POST", {"issue": {
            "project_id": PROJECT_ID, "subject": p["subject"],
            "start_date": p["start"], "due_date": p["end"],
            "status_id": 1, "tracker_id": 1,
        }})
        if res and "issue" in res:
            pid = res["issue"]["id"]
            key_to_id[p["key"]] = pid
            print(f"  親: #{pid} {p['subject']}")

    total_h = 0.0
    for tmpl in ISSUE_TEMPLATES:
        uid       = login_to_id.get(tmpl["member"])
        parent_id = key_to_id.get(tmpl["parent_key"])
        payload   = {"issue": {
            "project_id": PROJECT_ID, "subject": tmpl["subject"],
            "start_date": tmpl["start"], "due_date": tmpl["end"],
            "estimated_hours": tmpl["hours"], "assigned_to_id": uid,
            "status_id": 1, "tracker_id": 1,
        }}
        if parent_id:
            payload["issue"]["parent_issue_id"] = parent_id
        res = api("/issues.json", "POST", payload)
        if res and "issue" in res:
            iid = res["issue"]["id"]
            key_to_id[tmpl["key"]] = iid
            if tmpl["type"] == "dev":
                total_h += tmpl["hours"]
                print(f"  末端: #{iid} [{tmpl['member']}] {tmpl['subject'][:40]} {tmpl['hours']}h")

    print(f"\n  dev合計: {total_h:.0f}h = {total_h/160:.2f}人月")
    return key_to_id

# ============================================================
# STEP 4: 日報データ生成 → SQL 一括実行
# ============================================================
def calc_progress(report_date, start, end, spi, prev_pct=0):
    biz = working_days(start, end)
    if not biz or report_date < biz[0]:
        return prev_pct
    if report_date > biz[-1]:
        raw = min(100.0, 100.0 * spi)
        return max(prev_pct, min(100, int(raw / 5 + 0.5) * 5))
    if report_date not in biz:
        return prev_pct
    idx      = biz.index(report_date)
    plan_pct = (idx + 1) / len(biz) * 100.0
    raw      = min(100.0, plan_pct * spi)
    return max(prev_pct, min(100, int(raw / 5 + 0.5) * 5))

def create_reports(login_to_id, key_to_id):
    print(f"\n===== STEP 4: 日報投入（6/1〜{REPORT_END}）=====")

    member_map   = {m["login"]: m for m in MEMBERS}
    report_days  = working_days("2026-06-01", REPORT_END)
    total_client = len(CLIENT_DAYS)
    prev_prog    = {tmpl["key"]: 0 for tmpl in ISSUE_TEMPLATES}

    sql_lines = ["BEGIN;"]

    # ニュースを一括 INSERT
    for day in report_days:
        ts    = f"{day} 08:00:00"
        title = sq(f"{day.replace('-', '')}-日報")
        desc  = sq(f"{day}の作業報告スレッド")
        sql_lines.append(
            f"INSERT INTO news (project_id, title, summary, description, author_id, created_on, comments_count) "
            f"VALUES ({PROJECT_PK}, '{title}', '{day}の日報', '{desc}', 1, '{ts}', 0);"
        )

    sql_lines.append(
        "CREATE TEMP TABLE tmp_news_ids AS "
        "SELECT id, title FROM news WHERE project_id=1 AND title LIKE '2026%-日報';"
    )

    do_lines = ["DO $$ DECLARE", "  v_news_id INT;", "  v_j_id INT;", "BEGIN"]

    elapsed_biz    = 0
    elapsed_client = 0

    for day in report_days:
        d_obj          = date.fromisoformat(day)
        is_client_day  = d_obj.weekday() in (0, 3)
        elapsed_biz   += 1
        if is_client_day:
            elapsed_client += 1

        mtg_pct  = min(100, int(elapsed_biz   / TOTAL_BIZ   * 100 / 5 + 0.5) * 5)
        cmtg_pct = min(100, int(elapsed_client / total_client * 100 / 5 + 0.5) * 5) if total_client else 0
        tweek    = isoweek(day)
        ts_entry = f"{day} 09:00:00"

        do_lines.append(f"  SELECT id INTO v_news_id FROM tmp_news_ids WHERE title='{day.replace('-', '')}-日報';")

        for m in MEMBERS:
            login = m["login"]
            uid   = login_to_id.get(login)
            if not uid:
                continue

            spi        = m["spi"]
            cpi        = m["cpi"]
            has_client = m["has_client_mtg"] and is_client_day

            # アクティブな dev タスク
            active_dev = [t for t in ISSUE_TEMPLATES
                          if t["member"] == login and t["type"] == "dev"
                          and t["start"] <= day <= t["end"]]

            mtg_key  = f"mtg_{login}"
            mtg_id   = key_to_id.get(mtg_key)
            cmtg_key = f"cmtg_{login}"
            cmtg_id  = key_to_id.get(cmtg_key) if has_client else None

            mtg_h    = 1.0
            cmtg_h   = 0.5 if cmtg_id else 0.0

            # 計画工数（容量から会議を引いた残りを dev タスク数で割る）
            member_info = member_map[login]
            overhead    = 1.0
            if member_info["has_client_mtg"]:
                overhead += len(CLIENT_DAYS) * 0.5 / TOTAL_BIZ
            if login == "yamada":
                overhead += 50.0 / TOTAL_BIZ
            dev_cap_day = 8.0 - overhead
            n_dev       = max(len(active_dev), 1)
            planned_dev_h_each = round(dev_cap_day / n_dev, 2)

            # 実績工数 = 計画 × SPI / CPI
            # → 累積で CPI ≈ target に収束する
            actual_dev_h_each = round(planned_dev_h_each * spi / cpi, 2)

            comment_lines = []

            # 社内 MTG
            if mtg_id:
                old_p = prev_prog.get(mtg_key, 0)
                comment_lines.append(f"#{mtg_id} {mtg_pct}% {mtg_h:.1f}h")
                do_lines.append(
                    f"  INSERT INTO time_entries "
                    f"(project_id,user_id,issue_id,hours,comments,activity_id,spent_on,tyear,tmonth,tweek,created_on,updated_on,author_id) "
                    f"VALUES ({PROJECT_PK},{uid},{mtg_id},{mtg_h},'',{ACTIVITY_ID},"
                    f"'{day}',{d_obj.year},{d_obj.month},{tweek},'{ts_entry}','{ts_entry}',{uid});"
                )
                if mtg_pct != old_p:
                    old_v = f"'{old_p}'" if old_p else "NULL"
                    do_lines.append(
                        f"  INSERT INTO journals(journalized_type,journalized_id,user_id,notes,created_on,private_notes) "
                        f"VALUES('Issue',{mtg_id},{uid},'','{ts_entry}',false) RETURNING id INTO v_j_id;"
                    )
                    do_lines.append(
                        f"  INSERT INTO journal_details(journal_id,property,prop_key,old_value,value) "
                        f"VALUES(v_j_id,'attr','done_ratio',{old_v},'{mtg_pct}');"
                    )
                    prev_prog[mtg_key] = mtg_pct

            # 客先 MTG
            if cmtg_id:
                old_p = prev_prog.get(cmtg_key, 0)
                comment_lines.append(f"#{cmtg_id} {cmtg_pct}% {cmtg_h:.1f}h")
                do_lines.append(
                    f"  INSERT INTO time_entries "
                    f"(project_id,user_id,issue_id,hours,comments,activity_id,spent_on,tyear,tmonth,tweek,created_on,updated_on,author_id) "
                    f"VALUES ({PROJECT_PK},{uid},{cmtg_id},{cmtg_h},'',{ACTIVITY_ID},"
                    f"'{day}',{d_obj.year},{d_obj.month},{tweek},'{ts_entry}','{ts_entry}',{uid});"
                )
                if cmtg_pct != old_p:
                    old_v = f"'{old_p}'" if old_p else "NULL"
                    do_lines.append(
                        f"  INSERT INTO journals(journalized_type,journalized_id,user_id,notes,created_on,private_notes) "
                        f"VALUES('Issue',{cmtg_id},{uid},'','{ts_entry}',false) RETURNING id INTO v_j_id;"
                    )
                    do_lines.append(
                        f"  INSERT INTO journal_details(journal_id,property,prop_key,old_value,value) "
                        f"VALUES(v_j_id,'attr','done_ratio',{old_v},'{cmtg_pct}');"
                    )
                    prev_prog[cmtg_key] = cmtg_pct

            # PM 管理業務（yamada のみ）
            if login == "yamada":
                pm_key = "pm_mgmt"
                pm_id  = key_to_id.get(pm_key)
                if pm_id:
                    old_p    = prev_prog.get(pm_key, 0)
                    pm_pct   = mtg_pct
                    pm_h_act = round(50.0 / TOTAL_BIZ * spi / cpi, 2)
                    comment_lines.append(f"#{pm_id} {pm_pct}% {pm_h_act:.1f}h")
                    do_lines.append(
                        f"  INSERT INTO time_entries "
                        f"(project_id,user_id,issue_id,hours,comments,activity_id,spent_on,tyear,tmonth,tweek,created_on,updated_on,author_id) "
                        f"VALUES ({PROJECT_PK},{uid},{pm_id},{pm_h_act},'',{ACTIVITY_ID},"
                        f"'{day}',{d_obj.year},{d_obj.month},{tweek},'{ts_entry}','{ts_entry}',{uid});"
                    )
                    if pm_pct != old_p:
                        old_v = f"'{old_p}'" if old_p else "NULL"
                        do_lines.append(
                            f"  INSERT INTO journals(journalized_type,journalized_id,user_id,notes,created_on,private_notes) "
                            f"VALUES('Issue',{pm_id},{uid},'','{ts_entry}',false) RETURNING id INTO v_j_id;"
                        )
                        do_lines.append(
                            f"  INSERT INTO journal_details(journal_id,property,prop_key,old_value,value) "
                            f"VALUES(v_j_id,'attr','done_ratio',{old_v},'{pm_pct}');"
                        )
                        prev_prog[pm_key] = pm_pct

            # dev タスク
            for tmpl in active_dev:
                tk  = tmpl["key"]
                tid = key_to_id.get(tk)
                if not tid:
                    continue
                old_p = prev_prog.get(tk, 0)
                new_p = calc_progress(day, tmpl["start"], tmpl["end"], spi, old_p)
                comment_lines.append(f"#{tid} {new_p}% {actual_dev_h_each:.1f}h")
                do_lines.append(
                    f"  INSERT INTO time_entries "
                    f"(project_id,user_id,issue_id,hours,comments,activity_id,spent_on,tyear,tmonth,tweek,created_on,updated_on,author_id) "
                    f"VALUES ({PROJECT_PK},{uid},{tid},{actual_dev_h_each},'',{ACTIVITY_ID},"
                    f"'{day}',{d_obj.year},{d_obj.month},{tweek},'{ts_entry}','{ts_entry}',{uid});"
                )
                if new_p != old_p:
                    old_v = f"'{old_p}'" if old_p else "NULL"
                    do_lines.append(
                        f"  INSERT INTO journals(journalized_type,journalized_id,user_id,notes,created_on,private_notes) "
                        f"VALUES('Issue',{tid},{uid},'','{ts_entry}',false) RETURNING id INTO v_j_id;"
                    )
                    do_lines.append(
                        f"  INSERT INTO journal_details(journal_id,property,prop_key,old_value,value) "
                        f"VALUES(v_j_id,'attr','done_ratio',{old_v},'{new_p}');"
                    )
                    prev_prog[tk] = new_p

            # コメント
            if comment_lines:
                content_esc = "\\n".join(comment_lines).replace("'", "''")
                do_lines.append(
                    f"  INSERT INTO comments(commented_type,commented_id,author_id,content,created_on,updated_on) "
                    f"VALUES('News',v_news_id,{uid},E'{content_esc}','{ts_entry}','{ts_entry}');"
                )
                do_lines.append(
                    f"  UPDATE news SET comments_count=comments_count+1 WHERE id=v_news_id;"
                )

    do_lines.append("END $$;")
    sql_lines.extend(do_lines)
    sql_lines.append("COMMIT;")

    sql_path = os.path.join(PROJECT_ROOT, "tmp_setup_3months.sql")
    with open(sql_path, "w", encoding="utf-8") as f:
        f.write("\n".join(sql_lines))
    size_kb = os.path.getsize(sql_path) // 1024
    print(f"  SQL 生成完了: {sql_path} ({size_kb} KB)")

    print("  PostgreSQL に一括投入中...")
    rc = exec_sql_file(sql_path)
    print("  完了" if rc == 0 else f"  [WARN] return code={rc}")

    res = subprocess.run(
        ["docker", "exec", DB_CONTAINER, "psql", "-U", DB_USER, "-d", DB_NAME, "-At",
         "-c", "SELECT COUNT(*) FROM time_entries;"],
        capture_output=True, text=True, encoding="utf-8"
    )
    print(f"  time_entries 件数: {res.stdout.strip()}")

# ============================================================
# STEP 5: Redmine の done_ratio 最終更新
# ============================================================
def update_final_progress(login_to_id, key_to_id):
    print("\n===== STEP 5: Redmine done_ratio 最終更新 =====")
    member_map = {m["login"]: m for m in MEMBERS}
    updated = 0
    for tmpl in ISSUE_TEMPLATES:
        tid = key_to_id.get(tmpl["key"])
        if not tid or tmpl["type"] not in ("dev", "mtg", "cmtg", "pmgmt"):
            continue
        m   = member_map.get(tmpl["member"])
        spi = m["spi"] if m else 1.0
        pct = calc_progress(REPORT_END, tmpl["start"], tmpl["end"], spi, 0)
        end_biz = working_days(tmpl["start"], tmpl["end"])
        if end_biz and end_biz[-1] <= REPORT_END:
            pct = 100
        status_id = 5 if pct == 100 else 2
        res = api(f"/issues/{tid}.json", "PUT",
                  {"issue": {"done_ratio": pct, "status_id": status_id}})
        if res is not None:
            updated += 1
    print(f"  {updated} 件更新完了")

# ============================================================
# STEP 6: DB 同期・EVM 計算
# ============================================================
def sync_and_calc():
    print(f"\n===== STEP 6: DB同期・EVM計算（基準日: {REPORT_END}）=====")
    tool = os.path.join(PROJECT_ROOT, "redmine_evm_tool.py")
    env  = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    res  = subprocess.run(
        ["python", tool, "--date", REPORT_END],
        capture_output=True, text=True, encoding="utf-8",
        env=env, cwd=PROJECT_ROOT
    )
    for line in res.stdout.splitlines():
        if any(k in line for k in ["===", "SPI", "CPI", "EAC", "完了予測", "ERROR", "WARN", "容量", "member_alert"]):
            print(" ", line)
    if res.returncode != 0:
        print("[ERROR]", res.stderr[:300])
    else:
        print("  同期・計算完了")

# ============================================================
# メイン
# ============================================================
def main():
    print("=" * 60)
    print("3か月分シミュレーション投入スクリプト v2")
    print(f"対象: {BASE_URL} / {PROJECT_ID}")
    print(f"日報投入: 6/1 〜 {REPORT_END}")
    print(f"メンバー別 SPI/CPI:")
    for m in MEMBERS:
        print(f"  {m['ln']}{m['fn']}: SPI={m['spi']}  CPI={m['cpi']}")
    print("=" * 60)

    compute_all_hours()   # estimated_hours を自動計算（容量超過なし）
    clean_all()
    login_to_id = create_users()
    key_to_id   = create_issues(login_to_id)
    create_reports(login_to_id, key_to_id)
    update_final_progress(login_to_id, key_to_id)
    sync_and_calc()

    print("\n===== 完了 =====")
    print(f"ダッシュボード: http://localhost:8000")
    print(f"基準日 {REPORT_END} で確認してください。")

if __name__ == "__main__":
    main()
