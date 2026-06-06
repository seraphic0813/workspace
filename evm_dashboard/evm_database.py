"""
evm_database.py - EVM Dashboard 用 SQLite データベースモジュール

Redmineから取得したデータをローカルSQLiteに格納し、
EVM指標の計算をDB上のデータだけで完結させるための永続化層。
"""

import sqlite3
import os
import json
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "evm_dashboard.db")


def get_connection():
    """SQLiteデータベースへの接続を取得する。"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    """データベースの初期化（テーブルが存在しなければ作成）。"""
    conn = get_connection()
    cursor = conn.cursor()

    cursor.executescript("""
        CREATE TABLE IF NOT EXISTS issues (
            id INTEGER PRIMARY KEY,
            subject TEXT NOT NULL DEFAULT '',
            assigned_to_id INTEGER,
            assigned_to_name TEXT DEFAULT '',
            estimated_hours REAL,
            done_ratio INTEGER DEFAULT 0,
            start_date TEXT,
            due_date TEXT,
            parent_id INTEGER,
            status_id INTEGER,
            status_name TEXT DEFAULT '',
            tracker_id INTEGER,
            tracker_name TEXT DEFAULT '',
            updated_on TEXT,
            is_leaf INTEGER DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS time_entries (
            id INTEGER PRIMARY KEY,
            issue_id INTEGER,
            user_id INTEGER,
            user_name TEXT DEFAULT '',
            hours REAL DEFAULT 0.0,
            spent_on TEXT,
            activity_id INTEGER,
            comments TEXT DEFAULT '',
            updated_on TEXT
        );

        CREATE TABLE IF NOT EXISTS issue_journals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            issue_id INTEGER NOT NULL,
            journal_date TEXT NOT NULL,
            done_ratio INTEGER NOT NULL,
            UNIQUE(issue_id, journal_date, done_ratio)
        );

        CREATE TABLE IF NOT EXISTS sync_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sync_type TEXT NOT NULL,
            synced_at TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'success',
            detail TEXT DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS news_comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            news_id INTEGER NOT NULL,
            news_title TEXT DEFAULT '',
            comment_id INTEGER NOT NULL,
            author_id INTEGER,
            author_name TEXT DEFAULT '',
            content TEXT DEFAULT '',
            created_on TEXT DEFAULT '',
            parsed_items TEXT DEFAULT '[]',
            UNIQUE(news_id, comment_id)
        );
    """)

    conn.commit()
    conn.close()


# === Issues CRUD ===

def upsert_issue(issue_dict):
    """チケットをUPSERT（存在すれば更新、なければ挿入）する。"""
    conn = get_connection()
    conn.execute("""
        INSERT INTO issues (id, subject, assigned_to_id, assigned_to_name,
                           estimated_hours, done_ratio, start_date, due_date,
                           parent_id, status_id, status_name, tracker_id,
                           tracker_name, updated_on, is_leaf)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            subject=excluded.subject,
            assigned_to_id=excluded.assigned_to_id,
            assigned_to_name=excluded.assigned_to_name,
            estimated_hours=excluded.estimated_hours,
            done_ratio=excluded.done_ratio,
            start_date=excluded.start_date,
            due_date=excluded.due_date,
            parent_id=excluded.parent_id,
            status_id=excluded.status_id,
            status_name=excluded.status_name,
            tracker_id=excluded.tracker_id,
            tracker_name=excluded.tracker_name,
            updated_on=excluded.updated_on,
            is_leaf=excluded.is_leaf
    """, (
        issue_dict["id"],
        issue_dict.get("subject", ""),
        issue_dict.get("assigned_to_id"),
        issue_dict.get("assigned_to_name", ""),
        issue_dict.get("estimated_hours"),
        issue_dict.get("done_ratio", 0),
        issue_dict.get("start_date"),
        issue_dict.get("due_date"),
        issue_dict.get("parent_id"),
        issue_dict.get("status_id"),
        issue_dict.get("status_name", ""),
        issue_dict.get("tracker_id"),
        issue_dict.get("tracker_name", ""),
        issue_dict.get("updated_on"),
        issue_dict.get("is_leaf", 1)
    ))
    conn.commit()
    conn.close()


def upsert_issues_bulk(issue_dicts):
    """複数チケットを一括UPSERT。"""
    conn = get_connection()
    for issue_dict in issue_dicts:
        conn.execute("""
            INSERT INTO issues (id, subject, assigned_to_id, assigned_to_name,
                               estimated_hours, done_ratio, start_date, due_date,
                               parent_id, status_id, status_name, tracker_id,
                               tracker_name, updated_on, is_leaf)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                subject=excluded.subject,
                assigned_to_id=excluded.assigned_to_id,
                assigned_to_name=excluded.assigned_to_name,
                estimated_hours=excluded.estimated_hours,
                done_ratio=excluded.done_ratio,
                start_date=excluded.start_date,
                due_date=excluded.due_date,
                parent_id=excluded.parent_id,
                status_id=excluded.status_id,
                status_name=excluded.status_name,
                tracker_id=excluded.tracker_id,
                tracker_name=excluded.tracker_name,
                updated_on=excluded.updated_on,
                is_leaf=excluded.is_leaf
        """, (
            issue_dict["id"],
            issue_dict.get("subject", ""),
            issue_dict.get("assigned_to_id"),
            issue_dict.get("assigned_to_name", ""),
            issue_dict.get("estimated_hours"),
            issue_dict.get("done_ratio", 0),
            issue_dict.get("start_date"),
            issue_dict.get("due_date"),
            issue_dict.get("parent_id"),
            issue_dict.get("status_id"),
            issue_dict.get("status_name", ""),
            issue_dict.get("tracker_id"),
            issue_dict.get("tracker_name", ""),
            issue_dict.get("updated_on"),
            issue_dict.get("is_leaf", 1)
        ))
    conn.commit()
    conn.close()


def get_leaf_issues():
    """末端チケット（子チケットを持たないチケット）を全件取得する。"""
    conn = get_connection()
    rows = conn.execute("SELECT * FROM issues WHERE is_leaf = 1").fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_all_issues():
    """全チケットを取得する。"""
    conn = get_connection()
    rows = conn.execute("SELECT * FROM issues").fetchall()
    conn.close()
    return [dict(r) for r in rows]


# === Time Entries CRUD ===

def upsert_time_entry(entry_dict):
    """タイムエントリーをUPSERT。"""
    conn = get_connection()
    conn.execute("""
        INSERT INTO time_entries (id, issue_id, user_id, user_name, hours,
                                  spent_on, activity_id, comments, updated_on)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            issue_id=excluded.issue_id,
            user_id=excluded.user_id,
            user_name=excluded.user_name,
            hours=excluded.hours,
            spent_on=excluded.spent_on,
            activity_id=excluded.activity_id,
            comments=excluded.comments,
            updated_on=excluded.updated_on
    """, (
        entry_dict["id"],
        entry_dict.get("issue_id"),
        entry_dict.get("user_id"),
        entry_dict.get("user_name", ""),
        entry_dict.get("hours", 0.0),
        entry_dict.get("spent_on"),
        entry_dict.get("activity_id"),
        entry_dict.get("comments", ""),
        entry_dict.get("updated_on")
    ))
    conn.commit()
    conn.close()


def upsert_time_entries_bulk(entry_dicts):
    """複数タイムエントリーを一括UPSERT。"""
    conn = get_connection()
    for entry_dict in entry_dicts:
        conn.execute("""
            INSERT INTO time_entries (id, issue_id, user_id, user_name, hours,
                                      spent_on, activity_id, comments, updated_on)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                issue_id=excluded.issue_id,
                user_id=excluded.user_id,
                user_name=excluded.user_name,
                hours=excluded.hours,
                spent_on=excluded.spent_on,
                activity_id=excluded.activity_id,
                comments=excluded.comments,
                updated_on=excluded.updated_on
        """, (
            entry_dict["id"],
            entry_dict.get("issue_id"),
            entry_dict.get("user_id"),
            entry_dict.get("user_name", ""),
            entry_dict.get("hours", 0.0),
            entry_dict.get("spent_on"),
            entry_dict.get("activity_id"),
            entry_dict.get("comments", ""),
            entry_dict.get("updated_on")
        ))
    conn.commit()
    conn.close()


def get_all_time_entries():
    """全タイムエントリーを取得。"""
    conn = get_connection()
    rows = conn.execute("SELECT * FROM time_entries").fetchall()
    conn.close()
    return [dict(r) for r in rows]


# === Issue Journals (進捗率の履歴) ===

def upsert_journal(issue_id, journal_date, done_ratio):
    """チケットの進捗率変更履歴をUPSERT。"""
    conn = get_connection()
    conn.execute("""
        INSERT INTO issue_journals (issue_id, journal_date, done_ratio)
        VALUES (?, ?, ?)
        ON CONFLICT(issue_id, journal_date, done_ratio) DO NOTHING
    """, (issue_id, journal_date, done_ratio))
    conn.commit()
    conn.close()


def upsert_journals_bulk(journals):
    """複数の進捗率変更履歴を一括UPSERT。journals: list of (issue_id, journal_date, done_ratio)"""
    conn = get_connection()
    for issue_id, journal_date, done_ratio in journals:
        conn.execute("""
            INSERT INTO issue_journals (issue_id, journal_date, done_ratio)
            VALUES (?, ?, ?)
            ON CONFLICT(issue_id, journal_date, done_ratio) DO NOTHING
        """, (issue_id, journal_date, done_ratio))
    conn.commit()
    conn.close()


def get_issue_history():
    """全チケットの進捗率変更履歴を取得。{ issue_id: { date: done_ratio } } 形式で返す。"""
    conn = get_connection()
    rows = conn.execute(
        "SELECT issue_id, journal_date, done_ratio FROM issue_journals ORDER BY issue_id, journal_date, id ASC"
    ).fetchall()
    conn.close()

    history = {}
    for row in rows:
        iid = row["issue_id"]
        if iid not in history:
            history[iid] = {}
        history[iid][row["journal_date"]] = row["done_ratio"]
    return history


# === News Comments ===

def upsert_news_comment(comment_dict):
    """ニュースコメントをUPSERT。"""
    conn = get_connection()
    conn.execute("""
        INSERT INTO news_comments (news_id, news_title, comment_id, author_id,
                                    author_name, content, created_on, parsed_items)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(news_id, comment_id) DO UPDATE SET
            news_title=excluded.news_title,
            author_id=excluded.author_id,
            author_name=excluded.author_name,
            content=excluded.content,
            created_on=excluded.created_on,
            parsed_items=excluded.parsed_items
    """, (
        comment_dict["news_id"],
        comment_dict.get("news_title", ""),
        comment_dict["comment_id"],
        comment_dict.get("author_id"),
        comment_dict.get("author_name", ""),
        comment_dict.get("content", ""),
        comment_dict.get("created_on", ""),
        json.dumps(comment_dict.get("parsed_items", []), ensure_ascii=False)
    ))
    conn.commit()
    conn.close()


def get_all_news_comments():
    """全ニュースコメントを取得。"""
    conn = get_connection()
    rows = conn.execute("SELECT * FROM news_comments ORDER BY created_on DESC").fetchall()
    conn.close()
    results = []
    for row in rows:
        d = dict(row)
        d["parsed_items"] = json.loads(d.get("parsed_items", "[]"))
        results.append(d)
    return results


# === Sync Log ===

def add_sync_log(sync_type, status="success", detail=""):
    """同期ログを追加。"""
    conn = get_connection()
    conn.execute("""
        INSERT INTO sync_log (sync_type, synced_at, status, detail)
        VALUES (?, ?, ?, ?)
    """, (sync_type, datetime.now().isoformat(), status, detail))
    conn.commit()
    conn.close()


def get_last_sync_time():
    """最終同期日時を取得。"""
    conn = get_connection()
    row = conn.execute(
        "SELECT synced_at FROM sync_log WHERE status='success' ORDER BY synced_at DESC LIMIT 1"
    ).fetchone()
    conn.close()
    return row["synced_at"] if row else None


# === DB初期化実行 ===
init_db()
