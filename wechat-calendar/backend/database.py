"""
数据库操作层 - SQLite
"""
import sqlite3
import os
from typing import Optional

DB_PATH = os.environ.get("DB_PATH", "calendar.db")

def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn

def row_to_dict(row) -> Optional[dict]:
    return dict(row) if row else None

def rows_to_list(rows) -> list[dict]:
    return [dict(r) for r in rows]

def init_db():
    with get_conn() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            openid      TEXT    UNIQUE NOT NULL,
            nick_name   TEXT    DEFAULT '',
            avatar_url  TEXT    DEFAULT '',
            created_at  TEXT    DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS calendars (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT    NOT NULL,
            description TEXT    DEFAULT '',
            creator_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at  TEXT    DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS calendar_members (
            calendar_id INTEGER NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
            user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            joined_at   TEXT    DEFAULT (datetime('now','localtime')),
            PRIMARY KEY (calendar_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS events (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            calendar_id INTEGER NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
            creator_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            title       TEXT    NOT NULL,
            start_time  TEXT    NOT NULL,
            end_time    TEXT    NOT NULL,
            location    TEXT    DEFAULT '',
            content     TEXT    DEFAULT '',
            status      TEXT    DEFAULT 'approved',
            event_type  TEXT    DEFAULT 'normal',
            created_at  TEXT    DEFAULT (datetime('now','localtime')),
            updated_at  TEXT    DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS event_assignees (
            event_id    INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
            user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            PRIMARY KEY (event_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS notifications (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            type        TEXT    NOT NULL,
            title       TEXT    NOT NULL,
            content     TEXT    NOT NULL,
            is_read     INTEGER DEFAULT 0,
            ref_event_id  INTEGER,
            ref_cal_id    INTEGER,
            created_at  TEXT    DEFAULT (datetime('now','localtime'))
        );
        """)

# ── 用户 ────────────────────────────────────────────────────

def get_user_by_openid(openid: str) -> Optional[dict]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM users WHERE openid=?", (openid,)).fetchone()
        return row_to_dict(row)

def get_user_by_id(user_id: int) -> Optional[dict]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        return row_to_dict(row)

def get_or_create_user(openid: str, nick_name: str, avatar_url: str) -> dict:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM users WHERE openid=?", (openid,)).fetchone()
        if row:
            conn.execute(
                "UPDATE users SET nick_name=?, avatar_url=? WHERE openid=?",
                (nick_name, avatar_url, openid)
            )
            return {**dict(row), "nick_name": nick_name, "avatar_url": avatar_url}
        conn.execute(
            "INSERT INTO users (openid, nick_name, avatar_url) VALUES (?,?,?)",
            (openid, nick_name, avatar_url)
        )
        row = conn.execute("SELECT * FROM users WHERE openid=?", (openid,)).fetchone()
        return row_to_dict(row)

def update_user(user_id: int, nick_name: str, avatar_url: str):
    with get_conn() as conn:
        conn.execute(
            "UPDATE users SET nick_name=?, avatar_url=? WHERE id=?",
            (nick_name, avatar_url, user_id)
        )

# ── 日历 ────────────────────────────────────────────────────

def create_calendar(name: str, description: str, creator_id: int) -> dict:
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO calendars (name, description, creator_id) VALUES (?,?,?)",
            (name, description or "", creator_id)
        )
        row = conn.execute("SELECT * FROM calendars WHERE id=?", (cur.lastrowid,)).fetchone()
        return row_to_dict(row)

def get_calendar(cal_id: int) -> Optional[dict]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM calendars WHERE id=?", (cal_id,)).fetchone()
        return row_to_dict(row)

def get_user_calendars(user_id: int) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute("""
            SELECT c.* FROM calendars c
            WHERE c.creator_id = ?
            UNION
            SELECT c.* FROM calendars c
            JOIN calendar_members cm ON cm.calendar_id = c.id
            WHERE cm.user_id = ?
            ORDER BY created_at DESC
        """, (user_id, user_id)).fetchall()
        return rows_to_list(rows)

def delete_calendar(cal_id: int):
    with get_conn() as conn:
        conn.execute("DELETE FROM calendars WHERE id=?", (cal_id,))

# ── 成员 ────────────────────────────────────────────────────

def is_member(cal_id: int, user_id: int) -> bool:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT 1 FROM calendar_members WHERE calendar_id=? AND user_id=?",
            (cal_id, user_id)
        ).fetchone()
        return row is not None

def is_member_or_creator(cal_id: int, user_id: int, creator_id: int) -> bool:
    return user_id == creator_id or is_member(cal_id, user_id)

def get_calendar_members(cal_id: int) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute("""
            SELECT u.id, u.nick_name, u.avatar_url, cm.joined_at
            FROM calendar_members cm
            JOIN users u ON u.id = cm.user_id
            WHERE cm.calendar_id = ?
            ORDER BY cm.joined_at
        """, (cal_id,)).fetchall()
        return rows_to_list(rows)

def add_member(cal_id: int, user_id: int):
    with get_conn() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO calendar_members (calendar_id, user_id) VALUES (?,?)",
            (cal_id, user_id)
        )

def remove_member(cal_id: int, user_id: int):
    with get_conn() as conn:
        conn.execute(
            "DELETE FROM calendar_members WHERE calendar_id=? AND user_id=?",
            (cal_id, user_id)
        )

# ── 事件 ────────────────────────────────────────────────────

def create_event(cal_id, creator_id, title, start_time, end_time,
                 location, content, status, event_type) -> dict:
    with get_conn() as conn:
        cur = conn.execute("""
            INSERT INTO events
                (calendar_id, creator_id, title, start_time, end_time,
                 location, content, status, event_type)
            VALUES (?,?,?,?,?,?,?,?,?)
        """, (cal_id, creator_id, title, start_time, end_time,
              location or "", content or "", status, event_type))
        return _get_event_with_creator(conn, cur.lastrowid)

def get_event(event_id: int) -> Optional[dict]:
    with get_conn() as conn:
        return _get_event_with_creator(conn, event_id)

def _get_event_with_creator(conn, event_id: int) -> Optional[dict]:
    row = conn.execute("""
        SELECT e.*, u.nick_name as creator_name, u.avatar_url as creator_avatar
        FROM events e JOIN users u ON u.id = e.creator_id
        WHERE e.id = ?
    """, (event_id,)).fetchone()
    if not row:
        return None
    d = dict(row)
    # 附加指派成员
    assignees = conn.execute("""
        SELECT u.id, u.nick_name, u.avatar_url
        FROM event_assignees ea JOIN users u ON u.id = ea.user_id
        WHERE ea.event_id = ?
    """, (event_id,)).fetchall()
    d["assignees"] = rows_to_list(assignees)
    return d

def get_calendar_events(cal_id: int) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id FROM events WHERE calendar_id=? ORDER BY start_time",
            (cal_id,)
        ).fetchall()
        return [_get_event_with_creator(conn, r["id"]) for r in rows]

def update_event(event_id: int, body, new_status: str) -> dict:
    with get_conn() as conn:
        event = conn.execute("SELECT * FROM events WHERE id=?", (event_id,)).fetchone()
        if not event:
            return None
        e = dict(event)
        conn.execute("""
            UPDATE events SET
                title=?, start_time=?, end_time=?, location=?,
                content=?, status=?,
                updated_at=datetime('now','localtime')
            WHERE id=?
        """, (
            body.title or e["title"],
            body.start_time or e["start_time"],
            body.end_time or e["end_time"],
            body.location if body.location is not None else e["location"],
            body.content if body.content is not None else e["content"],
            new_status, event_id
        ))
        return _get_event_with_creator(conn, event_id)

def update_event_status(event_id: int, status: str):
    with get_conn() as conn:
        conn.execute(
            "UPDATE events SET status=?, updated_at=datetime('now','localtime') WHERE id=?",
            (status, event_id)
        )

def delete_event(event_id: int):
    with get_conn() as conn:
        conn.execute("DELETE FROM events WHERE id=?", (event_id,))

def check_time_conflict_with_creator(cal_id, creator_id, start_time, end_time, exclude_event_id) -> list[dict]:
    """检查与创建者的已审批事件是否有时间冲突"""
    with get_conn() as conn:
        query = """
            SELECT * FROM events
            WHERE calendar_id=? AND creator_id=? AND status='approved'
              AND start_time < ? AND end_time > ?
        """
        params = [cal_id, creator_id, end_time, start_time]
        if exclude_event_id:
            query += " AND id != ?"
            params.append(exclude_event_id)
        rows = conn.execute(query, params).fetchall()
        return rows_to_list(rows)

def set_assigned_members(event_id: int, member_ids: list[int]):
    with get_conn() as conn:
        conn.execute("DELETE FROM event_assignees WHERE event_id=?", (event_id,))
        for mid in member_ids:
            conn.execute(
                "INSERT OR IGNORE INTO event_assignees (event_id, user_id) VALUES (?,?)",
                (event_id, mid)
            )

# ── 通知 ────────────────────────────────────────────────────

def create_notification(user_id, type, title, content, ref_event_id=None, ref_cal_id=None):
    with get_conn() as conn:
        conn.execute("""
            INSERT INTO notifications
                (user_id, type, title, content, ref_event_id, ref_cal_id)
            VALUES (?,?,?,?,?,?)
        """, (user_id, type, title, content, ref_event_id, ref_cal_id))

def get_user_notifications(user_id: int) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute("""
            SELECT * FROM notifications WHERE user_id=?
            ORDER BY created_at DESC LIMIT 100
        """, (user_id,)).fetchall()
        return rows_to_list(rows)

def mark_notification_read(notif_id: int, user_id: int):
    with get_conn() as conn:
        conn.execute(
            "UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?",
            (notif_id, user_id)
        )

def mark_all_notifications_read(user_id: int):
    with get_conn() as conn:
        conn.execute("UPDATE notifications SET is_read=1 WHERE user_id=?", (user_id,))

def get_unread_count(user_id: int) -> int:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT COUNT(*) as cnt FROM notifications WHERE user_id=? AND is_read=0",
            (user_id,)
        ).fetchone()
        return row["cnt"] if row else 0
