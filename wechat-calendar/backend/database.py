"""
数据库操作层 - MySQL (PyMySQL)

说明：
- 依赖环境变量（微信云托管推荐）：
  MYSQL_ADDRESS=host:port
  MYSQL_USERNAME=...
  MYSQL_PASSWORD=...
  MYSQL_DATABASE=...
- 本文件保持原有函数签名，供 main.py 直接调用
- 启动时 init_db() 自动建表（幂等）
"""
import os
from typing import Optional, Any

import pymysql


MYSQL_ADDRESS = os.environ.get("MYSQL_ADDRESS")  # host:port
MYSQL_USERNAME = os.environ.get("MYSQL_USERNAME")
MYSQL_PASSWORD = os.environ.get("MYSQL_PASSWORD")
MYSQL_DATABASE = os.environ.get("MYSQL_DATABASE")


def _parse_mysql_address(addr: str):
    host, port = addr.split(":")
    return host, int(port)


def get_conn():
    if not MYSQL_ADDRESS:
        raise RuntimeError("MYSQL_ADDRESS is not set (expected host:port)")
    if not MYSQL_USERNAME:
        raise RuntimeError("MYSQL_USERNAME is not set")
    if MYSQL_PASSWORD is None:
        raise RuntimeError("MYSQL_PASSWORD is not set")
    if not MYSQL_DATABASE:
        raise RuntimeError("MYSQL_DATABASE is not set")

    host, port = _parse_mysql_address(MYSQL_ADDRESS)
    conn = pymysql.connect(
        host=host,
        port=port,
        user=MYSQL_USERNAME,
        password=MYSQL_PASSWORD,
        database=MYSQL_DATABASE,
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=False,
    )
    return conn


def row_to_dict(row) -> Optional[dict]:
    return row if row else None


def rows_to_list(rows) -> list[dict]:
    return list(rows or [])


def _fetchone(conn, sql: str, params: tuple = ()):
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchone()


def _fetchall(conn, sql: str, params: tuple = ()):
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def _execute(conn, sql: str, params: tuple = ()) -> int:
    """执行写操作，返回 lastrowid（没有则为 0）。调用方负责 commit()."""
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return int(cur.lastrowid or 0)


def init_db():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id BIGINT PRIMARY KEY AUTO_INCREMENT,
                openid VARCHAR(64) UNIQUE NOT NULL,
                nick_name VARCHAR(255) NOT NULL DEFAULT '',
                avatar_url TEXT,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            """)

            cur.execute("""
            CREATE TABLE IF NOT EXISTS calendars (
                id BIGINT PRIMARY KEY AUTO_INCREMENT,
                name VARCHAR(255) NOT NULL,
                description TEXT,
                creator_id BIGINT NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT fk_cal_creator FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            """)

            cur.execute("""
            CREATE TABLE IF NOT EXISTS calendar_members (
                calendar_id BIGINT NOT NULL,
                user_id BIGINT NOT NULL,
                joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (calendar_id, user_id),
                CONSTRAINT fk_cm_cal FOREIGN KEY (calendar_id) REFERENCES calendars(id) ON DELETE CASCADE,
                CONSTRAINT fk_cm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            """)

            cur.execute("""
            CREATE TABLE IF NOT EXISTS events (
                id BIGINT PRIMARY KEY AUTO_INCREMENT,
                calendar_id BIGINT NOT NULL,
                creator_id BIGINT NOT NULL,
                title VARCHAR(255) NOT NULL,
                start_time VARCHAR(64) NOT NULL,
                end_time VARCHAR(64) NOT NULL,
                location VARCHAR(255) NOT NULL DEFAULT '',
                content TEXT,
                status VARCHAR(32) NOT NULL DEFAULT 'approved',
                event_type VARCHAR(32) NOT NULL DEFAULT 'normal',
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                CONSTRAINT fk_ev_cal FOREIGN KEY (calendar_id) REFERENCES calendars(id) ON DELETE CASCADE,
                CONSTRAINT fk_ev_creator FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE,
                INDEX idx_events_calendar_start (calendar_id, start_time),
                INDEX idx_events_calendar_creator_status (calendar_id, creator_id, status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            """)

            cur.execute("""
            CREATE TABLE IF NOT EXISTS event_assignees (
                event_id BIGINT NOT NULL,
                user_id BIGINT NOT NULL,
                PRIMARY KEY (event_id, user_id),
                CONSTRAINT fk_ea_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
                CONSTRAINT fk_ea_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            """)

            cur.execute("""
            CREATE TABLE IF NOT EXISTS notifications (
                id BIGINT PRIMARY KEY AUTO_INCREMENT,
                user_id BIGINT NOT NULL,
                type VARCHAR(64) NOT NULL,
                title VARCHAR(255) NOT NULL,
                content TEXT NOT NULL,
                is_read TINYINT NOT NULL DEFAULT 0,
                ref_event_id BIGINT NULL,
                ref_cal_id BIGINT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                INDEX idx_notifications_user_created (user_id, created_at),
                INDEX idx_notifications_user_read (user_id, is_read)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            """)

        conn.commit()


# ── 用户 ────────────────────────────────────────────────────

def get_user_by_openid(openid: str) -> Optional[dict]:
    with get_conn() as conn:
        row = _fetchone(conn, "SELECT * FROM users WHERE openid=%s", (openid,))
        return row_to_dict(row)


def get_user_by_id(user_id: int) -> Optional[dict]:
    with get_conn() as conn:
        row = _fetchone(conn, "SELECT * FROM users WHERE id=%s", (user_id,))
        return row_to_dict(row)


def get_or_create_user(openid: str, nick_name: str, avatar_url: str) -> dict:
    with get_conn() as conn:
        row = _fetchone(conn, "SELECT * FROM users WHERE openid=%s", (openid,))
        if row:
            _execute(
                conn,
                "UPDATE users SET nick_name=%s, avatar_url=%s WHERE openid=%s",
                (nick_name, avatar_url, openid),
            )
            conn.commit()
            # 返回更新后的
            row2 = _fetchone(conn, "SELECT * FROM users WHERE openid=%s", (openid,))
            return row_to_dict(row2)

        _execute(
            conn,
            "INSERT INTO users (openid, nick_name, avatar_url) VALUES (%s,%s,%s)",
            (openid, nick_name, avatar_url),
        )
        conn.commit()
        row = _fetchone(conn, "SELECT * FROM users WHERE openid=%s", (openid,))
        return row_to_dict(row)


def update_user(user_id: int, nick_name: str, avatar_url: str):
    with get_conn() as conn:
        _execute(
            conn,
            "UPDATE users SET nick_name=%s, avatar_url=%s WHERE id=%s",
            (nick_name, avatar_url, user_id),
        )
        conn.commit()


# ── 日历 ────────────────────────────────────────────────────

def create_calendar(name: str, description: str, creator_id: int) -> dict:
    with get_conn() as conn:
        new_id = _execute(
            conn,
            "INSERT INTO calendars (name, description, creator_id) VALUES (%s,%s,%s)",
            (name, description or "", creator_id),
        )
        conn.commit()
        row = _fetchone(conn, "SELECT * FROM calendars WHERE id=%s", (new_id,))
        return row_to_dict(row)


def get_calendar(cal_id: int) -> Optional[dict]:
    with get_conn() as conn:
        row = _fetchone(conn, "SELECT * FROM calendars WHERE id=%s", (cal_id,))
        return row_to_dict(row)


def get_user_calendars(user_id: int) -> list[dict]:
    with get_conn() as conn:
        rows = _fetchall(conn, """
            SELECT c.* FROM calendars c
            WHERE c.creator_id = %s
            UNION
            SELECT c.* FROM calendars c
            JOIN calendar_members cm ON cm.calendar_id = c.id
            WHERE cm.user_id = %s
            ORDER BY created_at DESC
        """, (user_id, user_id))
        return rows_to_list(rows)


def delete_calendar(cal_id: int):
    with get_conn() as conn:
        _execute(conn, "DELETE FROM calendars WHERE id=%s", (cal_id,))
        conn.commit()


# ── 成员 ────────────────────────────────────────────────────

def is_member(cal_id: int, user_id: int) -> bool:
    with get_conn() as conn:
        row = _fetchone(
            conn,
            "SELECT 1 AS ok FROM calendar_members WHERE calendar_id=%s AND user_id=%s",
            (cal_id, user_id),
        )
        return row is not None


def is_member_or_creator(cal_id: int, user_id: int, creator_id: int) -> bool:
    return user_id == creator_id or is_member(cal_id, user_id)


def get_calendar_members(cal_id: int) -> list[dict]:
    with get_conn() as conn:
        rows = _fetchall(conn, """
            SELECT u.id, u.nick_name, u.avatar_url, cm.joined_at
            FROM calendar_members cm
            JOIN users u ON u.id = cm.user_id
            WHERE cm.calendar_id = %s
            ORDER BY cm.joined_at
        """, (cal_id,))
        return rows_to_list(rows)


def add_member(cal_id: int, user_id: int):
    with get_conn() as conn:
        # 依赖 PRIMARY KEY(calendar_id, user_id) 去重
        _execute(
            conn,
            "INSERT IGNORE INTO calendar_members (calendar_id, user_id) VALUES (%s,%s)",
            (cal_id, user_id),
        )
        conn.commit()


def remove_member(cal_id: int, user_id: int):
    with get_conn() as conn:
        _execute(
            conn,
            "DELETE FROM calendar_members WHERE calendar_id=%s AND user_id=%s",
            (cal_id, user_id),
        )
        conn.commit()


# ── 事件 ────────────────────────────────────────────────────

def create_event(cal_id, creator_id, title, start_time, end_time,
                 location, content, status, event_type) -> dict:
    with get_conn() as conn:
        new_id = _execute(conn, """
            INSERT INTO events
                (calendar_id, creator_id, title, start_time, end_time,
                 location, content, status, event_type)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """, (cal_id, creator_id, title, start_time, end_time,
              location or "", content or "", status, event_type))
        conn.commit()
        return _get_event_with_creator(conn, new_id)


def get_event(event_id: int) -> Optional[dict]:
    with get_conn() as conn:
        return _get_event_with_creator(conn, event_id)


def _get_event_with_creator(conn, event_id: int) -> Optional[dict]:
    row = _fetchone(conn, """
        SELECT e.*, u.nick_name as creator_name, u.avatar_url as creator_avatar
        FROM events e JOIN users u ON u.id = e.creator_id
        WHERE e.id = %s
    """, (event_id,))
    if not row:
        return None

    d = dict(row)
    assignees = _fetchall(conn, """
        SELECT u.id, u.nick_name, u.avatar_url
        FROM event_assignees ea JOIN users u ON u.id = ea.user_id
        WHERE ea.event_id = %s
    """, (event_id,))
    d["assignees"] = rows_to_list(assignees)
    return d


def get_calendar_events(cal_id: int) -> list[dict]:
    with get_conn() as conn:
        rows = _fetchall(
            conn,
            "SELECT id FROM events WHERE calendar_id=%s ORDER BY start_time",
            (cal_id,),
        )
        return [_get_event_with_creator(conn, r["id"]) for r in rows]


def update_event(event_id: int, body, new_status: str) -> dict:
    with get_conn() as conn:
        event = _fetchone(conn, "SELECT * FROM events WHERE id=%s", (event_id,))
        if not event:
            return None
        e = dict(event)

        _execute(conn, """
            UPDATE events SET
                title=%s,
                start_time=%s,
                end_time=%s,
                location=%s,
                content=%s,
                status=%s,
                updated_at=CURRENT_TIMESTAMP
            WHERE id=%s
        """, (
            getattr(body, "title", None) or e["title"],
            getattr(body, "start_time", None) or e["start_time"],
            getattr(body, "end_time", None) or e["end_time"],
            (body.location if getattr(body, "location", None) is not None else e["location"]),
            (body.content if getattr(body, "content", None) is not None else e["content"]),
            new_status,
            event_id,
        ))
        conn.commit()
        return _get_event_with_creator(conn, event_id)


def update_event_status(event_id: int, status: str):
    with get_conn() as conn:
        _execute(
            conn,
            "UPDATE events SET status=%s, updated_at=CURRENT_TIMESTAMP WHERE id=%s",
            (status, event_id),
        )
        conn.commit()


def delete_event(event_id: int):
    with get_conn() as conn:
        _execute(conn, "DELETE FROM events WHERE id=%s", (event_id,))
        conn.commit()


def check_time_conflict_with_creator(cal_id, creator_id, start_time, end_time, exclude_event_id) -> list[dict]:
    """检查与创建者的已审批事件是否有时间冲突"""
    with get_conn() as conn:
        query = """
            SELECT * FROM events
            WHERE calendar_id=%s AND creator_id=%s AND status='approved'
              AND start_time < %s AND end_time > %s
        """
        params: list[Any] = [cal_id, creator_id, end_time, start_time]
        if exclude_event_id:
            query += " AND id != %s"
            params.append(exclude_event_id)

        rows = _fetchall(conn, query, tuple(params))
        return rows_to_list(rows)


def set_assigned_members(event_id: int, member_ids: list[int]):
    with get_conn() as conn:
        _execute(conn, "DELETE FROM event_assignees WHERE event_id=%s", (event_id,))
        for mid in member_ids:
            _execute(
                conn,
                "INSERT IGNORE INTO event_assignees (event_id, user_id) VALUES (%s,%s)",
                (event_id, mid),
            )
        conn.commit()


# ── 通知 ────────────────────────────────────────────────────

def create_notification(user_id, type, title, content, ref_event_id=None, ref_cal_id=None):
    with get_conn() as conn:
        _execute(conn, """
            INSERT INTO notifications
                (user_id, type, title, content, ref_event_id, ref_cal_id)
            VALUES (%s,%s,%s,%s,%s,%s)
        """, (user_id, type, title, content, ref_event_id, ref_cal_id))
        conn.commit()


def get_user_notifications(user_id: int) -> list[dict]:
    with get_conn() as conn:
        rows = _fetchall(conn, """
            SELECT * FROM notifications WHERE user_id=%s
            ORDER BY created_at DESC LIMIT 100
        """, (user_id,))
        return rows_to_list(rows)


def mark_notification_read(notif_id: int, user_id: int):
    with get_conn() as conn:
        _execute(
            conn,
            "UPDATE notifications SET is_read=1 WHERE id=%s AND user_id=%s",
            (notif_id, user_id),
        )
        conn.commit()


def mark_all_notifications_read(user_id: int):
    with get_conn() as conn:
        _execute(conn, "UPDATE notifications SET is_read=1 WHERE user_id=%s", (user_id,))
        conn.commit()


def get_unread_count(user_id: int) -> int:
    with get_conn() as conn:
        row = _fetchone(conn, """
            SELECT COUNT(*) as cnt
            FROM notifications
            WHERE user_id=%s AND is_read=0
        """, (user_id,))
        return int(row["cnt"]) if row else 0