"""
微信日历小程序后端 - FastAPI + MySQL
安装: pip install fastapi uvicorn python-jose[cryptography] httpx
运行: uvicorn main:app --host 0.0.0.0 --port 8000 --reload
"""

from datetime import datetime, timedelta, timezone
import secrets

from fastapi import FastAPI, HTTPException, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import database as db
import schemas
import auth
import time_extract
import os
import logging
import pymysql

logger = logging.getLogger("uvicorn.error")
@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    yield

app = FastAPI(title="微信日历小程序API", lifespan=lifespan)
print("BOOT MARK: 2026-04-14 v0.2")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_current_user(x_wx_openid: str = Header(default=None)):
    if not x_wx_openid:
        raise HTTPException(status_code=401, detail="未授权，缺少 X-WX-OPENID 请求头")

    user = db.get_user_by_openid(x_wx_openid)
    if not user:
        raise HTTPException(status_code=401, detail="用户未注册/未登录")
    return user


def get_current_app_user(authorization: str = Header(default=None)):
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="未授权，缺少 Bearer token")
    token = authorization.split(" ", 1)[1].strip()
    user = db.get_user_by_app_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="App Token 无效")
    return user


def parse_datetime_str(dt_str: str) -> datetime:
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y/%m/%d %H:%M:%S", "%Y/%m/%d %H:%M"):
        try:
            return datetime.strptime(dt_str, fmt)
        except ValueError:
            continue
    raise HTTPException(status_code=400, detail=f"时间格式无效：{dt_str}")


def normalize_end_time(start_time: str, end_time: str | None) -> str:
    if end_time:
        return end_time
    start_dt = parse_datetime_str(start_time)
    return (start_dt + timedelta(hours=1)).strftime("%Y-%m-%d %H:%M:%S")


def get_subscribe_config() -> dict:
    approval_result_template_id = (os.environ.get("WX_TMPL_APPROVAL_RESULT") or "").strip()
    schedule_update_template_id = (os.environ.get("WX_TMPL_SCHEDULE_UPDATE") or "").strip()
    event_reminder_template_id = (os.environ.get("WX_TMPL_EVENT_REMINDER") or "").strip()
    return {
        "approval_result_template_id": approval_result_template_id,
        "schedule_update_template_id": schedule_update_template_id,
        "event_reminder_template_id": event_reminder_template_id,
    }


def shorten_text(value: str | None, limit: int = 20, default: str = "") -> str:
    text = (value or default or "").strip()
    if len(text) <= limit:
        return text
    return text[: max(limit - 1, 0)] + "…"


def format_subscribe_time(time_str: str | None) -> str:
    if not time_str:
        return ""
    try:
        return parse_datetime_str(time_str).strftime("%Y-%m-%d %H:%M")
    except HTTPException:
        return str(time_str)


def get_user_openid(user_id: int) -> str | None:
    target_user = db.get_user_by_id(user_id)
    if not target_user:
        return None
    return target_user.get("openid")


def build_subscribe_payload_if_accepted(user_id: int, template_id: str, data: dict, event_id: int):
    if not template_id:
        logger.warning("[订阅消息] 跳过: template_id为空 user_id=%s event_id=%s", user_id, event_id)
        return None
    prefs = db.get_subscribe_prefs(user_id)
    current_state = prefs.get(template_id, "unknown")
    if current_state != "accept":
        logger.info(
            "[订阅消息] 跳过: 用户未接受订阅 user_id=%s template_id=%s state=%s event_id=%s",
            user_id, template_id, current_state, event_id
        )
        return None

    openid = get_user_openid(user_id)
    if not openid:
        logger.warning("[订阅消息] 跳过: 用户无openid user_id=%s event_id=%s", user_id, event_id)
        return None

    logger.info("[订阅消息] 构建成功 user_id=%s template_id=%s event_id=%s", user_id, template_id, event_id)
    return {
        "openid": openid,
        "template_id": template_id,
        "page": f"pages/event-detail/event-detail?id={event_id}",
        "data": data,
    }


def notify_schedule_update_subscribe(target_user_id: int, cal: dict, event: dict, actor_name: str, action: str, remark: str = None):
    template_id = get_subscribe_config()["schedule_update_template_id"]
    if not template_id:
        return None

    if remark is None:
        remark = f"{shorten_text(actor_name, 8, '成员')}{action}，待审批"

    data = {
        "thing1": {"value": shorten_text(event.get("title"), 20, "未命名日程")},
        "time2": {"value": format_subscribe_time(event.get("start_time"))},
        "thing3": {"value": shorten_text(event.get("location"), 20, "无")},
        "thing4": {"value": shorten_text(actor_name, 20, "成员")},
        "thing5": {"value": shorten_text(remark, 20)},
    }
    return build_subscribe_payload_if_accepted(target_user_id, template_id, data, event["id"])


# 北京时区 (UTC+8)，用于所有对外展示的时间格式化
BEIJING_TZ = timezone(timedelta(hours=8))

def beijing_now() -> datetime:
    """返回北京时间的当前时刻"""
    return datetime.now(BEIJING_TZ)


def notify_approval_result_subscribe(target_user_id: int, cal: dict, event: dict, result_text: str, remark: str):
    template_id = get_subscribe_config()["approval_result_template_id"]
    if not template_id:
        return None

    data = {
        "phrase2": {"value": result_text},
        "time3": {"value": beijing_now().strftime("%Y-%m-%d %H:%M")},
        "thing4": {"value": shorten_text(remark, 20)},
        "thing5": {"value": shorten_text(cal.get("name"), 20, "未命名日历")},
    }
    return build_subscribe_payload_if_accepted(target_user_id, template_id, data, event["id"])


def normalize_remind_before_minutes(value: int | None) -> int | None:
    if value is None:
        return None
    if value < 0:
        raise HTTPException(status_code=400, detail="提醒时间不能小于0")
    return value


def create_single_event_for_calendar(cal_id: int, payload: schemas.BatchCreateEventsRequest, user: dict):
    cal = db.get_calendar(cal_id)
    if not cal:
        return {"calendar_id": cal_id, "calendar_name": f"#{cal_id}", "ok": False, "error": "日历不存在"}
    if not db.is_member_or_creator(cal_id, user["id"], cal["creator_id"]):
        return {"calendar_id": cal_id, "calendar_name": cal["name"], "ok": False, "error": "无权访问该日历"}

    is_creator = cal["creator_id"] == user["id"]
    final_end_time = normalize_end_time(payload.start_time, payload.end_time)
    if not is_creator:
        conflicts = db.check_time_conflict_with_creator(
            cal_id, cal["creator_id"], payload.start_time, final_end_time, None
        )
        if conflicts:
            return {
                "calendar_id": cal_id,
                "calendar_name": cal["name"],
                "ok": False,
                "error": f"与创建者事件时间冲突：{conflicts[0]['title']}（{conflicts[0]['start_time']} ~ {conflicts[0]['end_time']}）",
            }

    status = "approved" if is_creator else "pending"
    event = db.create_event(
        cal_id=cal_id,
        creator_id=user["id"],
        title=payload.title,
        start_time=payload.start_time,
        end_time=final_end_time,
        location=payload.location,
        content=payload.content,
        status=status,
        event_type="normal",
        remind_before_minutes=payload.remind_before_minutes,
    )
    subscribe_to_send_list = []
    if not is_creator:
        db.create_notification(
            user_id=cal["creator_id"],
            type="new_event",
            title="新事件待审批",
            content=f"成员「{user['nick_name']}」在「{cal['name']}」创建了事件「{payload.title}」，请审批。",
            ref_event_id=event["id"],
            ref_cal_id=cal_id,
        )
        payload_to_send = notify_schedule_update_subscribe(
            cal["creator_id"], cal, event, user["nick_name"], "创建日程"
        )
        if payload_to_send:
            subscribe_to_send_list.append(payload_to_send)
    return {
        "calendar_id": cal_id,
        "calendar_name": cal["name"],
        "ok": True,
        "event_id": event["id"],
        "subscribe_to_send_list": subscribe_to_send_list,
    }

# ── 认证 ──────────────────────────────────────────────────────────

@app.post("/auth/login", response_model=schemas.LoginResponse)
def login(body: schemas.LoginRequest, x_wx_openid: str = Header(default=None)):
    # 2. 删除原有的 wechat.code2openid(body.code)
    # 直接使用云托管网关注入的 openid
    openid = x_wx_openid

    if not openid:
        # 如果本地开发测试没有经过微信网关，可以做个降级（可选）
        raise HTTPException(status_code=400, detail="未获取到微信 OpenID，请确保使用 wx.cloud.callContainer 发起请求")

    user = db.get_or_create_user(openid, body.nick_name, body.avatar_url)
    return {"openid": openid, "user": user}

@app.get("/auth/profile")
def get_profile(user=Depends(get_current_user)):
    """返回当前用户的最新资料，用于多端同步"""
    current = db.get_user_by_id(user["id"])
    return {"ok": True, "user": current}

@app.put("/auth/profile")
def update_profile(body: schemas.UpdateProfileRequest, user=Depends(get_current_user)):
    db.update_user(user["id"], body.nick_name, body.avatar_url)
    updated = db.get_user_by_id(user["id"])
    return {"ok": True, "user": updated}

# ── 日历 ──────────────────────────────────────────────────────────

@app.post("/calendars", response_model=schemas.Calendar)
def create_calendar(body: schemas.CreateCalendarRequest, user=Depends(get_current_user)):
    return db.create_calendar(body.name, body.description, user["id"])

@app.get("/calendars", response_model=list[schemas.Calendar])
def list_my_calendars(user=Depends(get_current_user)):
    return db.get_user_calendars(user["id"])

@app.get("/calendars/{cal_id}", response_model=schemas.CalendarDetail)
def get_calendar(cal_id: int, user=Depends(get_current_user)):
    cal = db.get_calendar(cal_id)
    if not cal:
        raise HTTPException(status_code=404, detail="日历不存在")
    if not db.is_member_or_creator(cal_id, user["id"], cal["creator_id"]):
        raise HTTPException(status_code=403, detail="无权访问")
    members = db.get_calendar_members(cal_id)
    return {**cal, "members": members}

@app.delete("/calendars/{cal_id}")
def delete_calendar(cal_id: int, user=Depends(get_current_user)):
    cal = db.get_calendar(cal_id)
    if not cal:
        raise HTTPException(status_code=404, detail="日历不存在")
    if cal["creator_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="仅创建者可删除日历")
    db.delete_calendar(cal_id)
    return {"ok": True}

# ── 邀请/加入 ──────────────────────────────────────────────────────

@app.get("/calendars/{cal_id}/invite-token")
def get_invite_token(cal_id: int, user=Depends(get_current_user)):
    cal = db.get_calendar(cal_id)
    if not cal:
        raise HTTPException(status_code=404, detail="日历不存在")
    if cal["creator_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="仅创建者可生成邀请")
    token = auth.generate_invite_token(cal_id)
    return {"token": token, "cal_id": cal_id}

@app.post("/calendars/join")
def join_calendar(body: schemas.JoinRequest, user=Depends(get_current_user)):
    cal_id = auth.verify_invite_token(body.token)
    if not cal_id:
        raise HTTPException(status_code=400, detail="邀请链接无效或已过期")
    cal = db.get_calendar(cal_id)
    if not cal:
        raise HTTPException(status_code=404, detail="日历不存在")
    if cal["creator_id"] == user["id"]:
        return {"ok": True, "message": "你是创建者", "calendar": cal}
    if db.is_member(cal_id, user["id"]):
        return {"ok": True, "message": "已是成员", "calendar": cal}
    db.add_member(cal_id, user["id"])
    return {"ok": True, "message": "加入成功", "calendar": cal}

@app.delete("/calendars/{cal_id}/members/{member_id}")
def remove_member(cal_id: int, member_id: int, user=Depends(get_current_user)):
    cal = db.get_calendar(cal_id)
    if not cal or cal["creator_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="仅创建者可移除成员")
    db.remove_member(cal_id, member_id)
    return {"ok": True}

# ── 普通事件 ──────────────────────────────────────────────────────

@app.post("/calendars/{cal_id}/events", response_model=schemas.Event)
def create_event(cal_id: int, body: schemas.CreateEventRequest, user=Depends(get_current_user)):
    cal = db.get_calendar(cal_id)
    if not cal:
        raise HTTPException(status_code=404, detail="日历不存在")
    if not db.is_member_or_creator(cal_id, user["id"], cal["creator_id"]):
        raise HTTPException(status_code=403, detail="无权访问")

    is_creator = cal["creator_id"] == user["id"]

    final_end_time = normalize_end_time(body.start_time, body.end_time)

    if not is_creator:
        conflicts = db.check_time_conflict_with_creator(
            cal_id, cal["creator_id"], body.start_time, final_end_time, None)
        if conflicts:
            raise HTTPException(status_code=409,
                detail=f"与创建者事件时间冲突：{conflicts[0]['title']}（{conflicts[0]['start_time']} ~ {conflicts[0]['end_time']}）")

    status = "approved" if is_creator else "pending"
    remind_before_minutes = normalize_remind_before_minutes(body.remind_before_minutes)
    event = db.create_event(
        cal_id=cal_id, creator_id=user["id"], title=body.title,
        start_time=body.start_time, end_time=final_end_time,
        location=body.location, content=body.content,
        status=status, event_type="normal",
        remind_before_minutes=remind_before_minutes,
    )
    subscribe_to_send_list = []

    if not is_creator:
        db.create_notification(
            user_id=cal["creator_id"], type="new_event",
            title="新事件待审批",
            content=f"成员「{user['nick_name']}」在「{cal['name']}」创建了事件「{body.title}」，请审批。",
            ref_event_id=event["id"], ref_cal_id=cal_id,
        )
        payload_to_send = notify_schedule_update_subscribe(cal["creator_id"], cal, event, user["nick_name"], "创建日程")
        if payload_to_send:
            subscribe_to_send_list.append(payload_to_send)
    return {**event, "subscribe_to_send_list": subscribe_to_send_list}

@app.get("/calendars/{cal_id}/events", response_model=list[schemas.Event])
def list_events(cal_id: int, user=Depends(get_current_user)):
    cal = db.get_calendar(cal_id)
    if not cal:
        raise HTTPException(status_code=404, detail="日历不存在")
    if not db.is_member_or_creator(cal_id, user["id"], cal["creator_id"]):
        raise HTTPException(status_code=403, detail="无权访问")
    return db.get_calendar_events_with_revisions(cal_id)
@app.get("/calendars/{cal_id}/events/{event_id}", response_model=schemas.Event)
def get_event(cal_id: int, event_id: int, user=Depends(get_current_user)):
    cal = db.get_calendar(cal_id)
    if not cal:
        raise HTTPException(status_code=404, detail="日历不存在")
    if not db.is_member_or_creator(cal_id, user["id"], cal["creator_id"]):
        raise HTTPException(status_code=403, detail="无权访问")

    event = db.get_event_with_revision(event_id)
    if not event or event["calendar_id"] != cal_id:
        raise HTTPException(status_code=404, detail="事件不存在")
    return event


@app.get("/events/{event_id}", response_model=schemas.Event)
def get_event_by_id(event_id: int, user=Depends(get_current_user)):
    event = db.get_event_with_revision(event_id)
    if not event:
        raise HTTPException(status_code=404, detail="事件不存在")

    cal = db.get_calendar(event["calendar_id"])
    if not cal:
        raise HTTPException(status_code=404, detail="日历不存在")
    if not db.is_member_or_creator(cal["id"], user["id"], cal["creator_id"]):
        raise HTTPException(status_code=403, detail="无权访问")
    return event
# 更新事件
@app.put("/calendars/{cal_id}/events/{event_id}", response_model=schemas.Event)
def update_event(cal_id: int, event_id: int, body: schemas.UpdateEventRequest, user=Depends(get_current_user)):
    cal = db.get_calendar(cal_id)
    if not cal:
        raise HTTPException(status_code=404, detail="日历不存在")
    event = db.get_event(event_id)
    if not event or event["calendar_id"] != cal_id:
        raise HTTPException(status_code=404, detail="事件不存在")

    is_creator = cal["creator_id"] == user["id"]
    is_event_owner = event["creator_id"] == user["id"]

    if not is_creator and not is_event_owner:
        raise HTTPException(status_code=403, detail="无权修改他人事件")
    if not is_creator and event["event_type"] == "assigned":
        raise HTTPException(status_code=403, detail="指派事件仅创建者可修改")

    new_start = body.start_time or event["start_time"]
    new_end = body.end_time or event["end_time"]

    if not is_creator:
        conflicts = db.check_time_conflict_with_creator(
            cal_id, cal["creator_id"], new_start, new_end, event_id
        )
        if conflicts:
            raise HTTPException(
                status_code=409,
                detail=f"与创建者事件时间冲突：{conflicts[0]['title']}"
            )

    # 仅在确实有字段变化时才通知（避免空更新/同值更新）
    incoming = body.model_dump(exclude_unset=True)
    if "remind_before_minutes" in incoming:
        incoming["remind_before_minutes"] = normalize_remind_before_minutes(incoming["remind_before_minutes"])
        body.remind_before_minutes = incoming["remind_before_minutes"]
    comparable_fields = ["title", "start_time", "end_time", "location", "content", "remind_before_minutes"]

    def _normalize(v):
        return "" if v is None else v

    has_real_changes = any(
        field in incoming and _normalize(incoming[field]) != _normalize(event[field])
        for field in comparable_fields
    )

    # ── 成员修改：写入 event_revisions 表，不碰 events 表 ──
    if (not is_creator) and has_real_changes:
        # 检查是否已有待审批的修改提案
        existing_rev = db.get_pending_revision(event_id)
        if existing_rev:
            raise HTTPException(status_code=409, detail="该事件已有待审批的修改，请等待审批人处理")

        db.create_event_revision(event_id, user["id"], body)
        db.update_event_status(event_id, "update_pending")

        subscribe_to_send_list = []
        db.create_notification(
            user_id=cal["creator_id"], type="update_request",
            title="事件更新通知",
            content=f"成员「{user['nick_name']}」修改了事件「{event['title']}」，待你审批。",
            ref_event_id=event_id, ref_cal_id=cal_id,
        )
        payload_to_send = notify_schedule_update_subscribe(
            cal["creator_id"], cal, event, user["nick_name"], "修改日程"
        )
        if payload_to_send:
            subscribe_to_send_list.append(payload_to_send)

        return {**event, "subscribe_to_send_list": subscribe_to_send_list}

    # ── 创建者修改：直接更新 events 表 ─────────────────────
    updated_event = db.update_event(event_id, body, event["status"])
    subscribe_to_send_list = []

    # 若被修改的日程创建者不是日历创建者，通知原创建者
    if event["creator_id"] != user["id"]:
        db.create_notification(
            user_id=event["creator_id"], type="schedule_update",
            title="日程更新通知",
            content=f"日历「{cal['name']}」的创建者「{user['nick_name']}」修改了你的日程「{updated_event['title']}」。",
            ref_event_id=event_id, ref_cal_id=cal_id,
        )
        payload = notify_schedule_update_subscribe(
            event["creator_id"], cal, updated_event, user["nick_name"],
            "创建者修改", remark="你的日程被创建者修改"
        )
        if payload:
            subscribe_to_send_list.append(payload)

    return {**updated_event, "subscribe_to_send_list": subscribe_to_send_list}


# 删除事件
@app.delete("/calendars/{cal_id}/events/{event_id}")
def delete_event(cal_id: int, event_id: int, user=Depends(get_current_user)):
    cal = db.get_calendar(cal_id)
    if not cal:
        raise HTTPException(status_code=404, detail="日历不存在")
    event = db.get_event(event_id)
    if not event or event["calendar_id"] != cal_id:
        raise HTTPException(status_code=404, detail="事件不存在")

    is_creator = cal["creator_id"] == user["id"]
    is_event_owner = event["creator_id"] == user["id"]

    if not is_creator and not is_event_owner:
        raise HTTPException(status_code=403, detail="无权删除他人事件")
    if not is_creator and event["event_type"] == "assigned":
        raise HTTPException(status_code=403, detail="指派事件仅创建者可删除")

    # 创建者可直接删除
    if is_creator:
        db.delete_event(event_id)
        subscribe_to_send_list = []

        # 若被删除的日程创建者不是日历创建者，通知原创建者
        if event["creator_id"] != user["id"]:
            db.create_notification(
                user_id=event["creator_id"], type="schedule_update",
                title="日程更新通知",
                content=f"日历「{cal['name']}」的创建者「{user['nick_name']}」删除了你的日程「{event['title']}」。",
                ref_event_id=event_id, ref_cal_id=cal_id,
            )
            payload = notify_schedule_update_subscribe(
                event["creator_id"], cal, event, user["nick_name"],
                "创建者删除", remark="你的日程被创建者删除"
            )
            if payload:
                subscribe_to_send_list.append(payload)

        return {"ok": True, "message": "删除成功", "subscribe_to_send_list": subscribe_to_send_list}

    # 新规则：未通过(rejected)事件，成员可直接删除，无需审批
    if event["status"] == "rejected":
        db.delete_event(event_id)
        return {"ok": True, "message": "未通过事件已删除", "subscribe_to_send_list": []}

    # 其余成员删除走删除审批：新增状态 delete_pending
    if event["status"] == "delete_pending":
        return {"ok": True, "message": "删除申请已提交，等待审批", "subscribe_to_send_list": []}

    db.update_event_status(event_id, "delete_pending")
    db.create_notification(
        user_id=cal["creator_id"], type="delete_request",
        title="事件删除待审批",
        content=f"成员「{user['nick_name']}」申请删除「{event['title']}」，请审批。",
        ref_event_id=event_id, ref_cal_id=cal_id,
    )
    payload_to_send = notify_schedule_update_subscribe(cal["creator_id"], cal, event, user["nick_name"], "删除日程")
    subscribe_to_send_list = [payload_to_send] if payload_to_send else []
    return {"ok": True, "message": "删除申请已提交，待创建者审批", "subscribe_to_send_list": subscribe_to_send_list}


# 同意审批（合并：普通审批通过 + 删除审批通过）
@app.post("/calendars/{cal_id}/events/{event_id}/approve")
def approve_event(cal_id: int, event_id: int, user=Depends(get_current_user)):
    cal = db.get_calendar(cal_id)
    if not cal or cal["creator_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="仅创建者可审批")
    event = db.get_event(event_id)
    if not event or event["calendar_id"] != cal_id:
        raise HTTPException(status_code=404, detail="事件不存在")

    # 删除审批通过：直接删除事件
    if event["status"] == "delete_pending":
        db.delete_event(event_id)
        db.create_notification(
            user_id=event["creator_id"], type="approved",
            title="删除申请已通过",
            content=f"你在「{cal['name']}」申请删除的事件「{event['title']}」已通过并删除。",
            ref_event_id=event_id, ref_cal_id=cal_id,
        )
        payload_to_send = notify_approval_result_subscribe(
            event["creator_id"], cal, event, "审批通过", f"事件{event['title']}删除审批通过"
        )
        return {
            "ok": True,
            "message": "删除申请已通过，事件已删除",
            "subscribe_to_send_list": [payload_to_send] if payload_to_send else [],
        }

    # 修改审批通过：将提案数据应用到 events 表
    if event["status"] == "update_pending":
        revision = db.get_pending_revision(event_id)
        if not revision:
            raise HTTPException(status_code=400, detail="未找到待审批的修改提案")

        updated_event = db.apply_revision(event_id, revision)
        editor = db.get_user_by_id(revision["editor_id"])
        editor_name = editor["nick_name"] if editor else "成员"

        db.create_notification(
            user_id=revision["editor_id"], type="approved",
            title="事件修改已通过",
            content=f"你在「{cal['name']}」修改的事件「{updated_event['title']}」已通过审批。",
            ref_event_id=event_id, ref_cal_id=cal_id,
        )
        payload_to_send = notify_approval_result_subscribe(
            revision["editor_id"], cal, updated_event, "审批通过",
            f"事件{updated_event['title']}修改审批通过"
        )
        return {
            "ok": True,
            "message": "修改已通过",
            "subscribe_to_send_list": [payload_to_send] if payload_to_send else [],
        }

    # 普通待审批通过
    if event["status"] != "pending":
        raise HTTPException(status_code=400, detail="事件不在可审批状态")

    db.update_event_status(event_id, "approved")
    db.create_notification(
        user_id=event["creator_id"], type="approved",
        title="事件已通过审批",
        content=f"你在「{cal['name']}」创建的事件「{event['title']}」已通过审批。",
        ref_event_id=event_id, ref_cal_id=cal_id,
    )
    payload_to_send = notify_approval_result_subscribe(
        event["creator_id"], cal, event, "审批通过", f"事件{event['title']}审批成功"
    )
    return {"ok": True, "message": "审批通过", "subscribe_to_send_list": [payload_to_send] if payload_to_send else []}


# 拒绝审批（合并：普通审批拒绝 + 删除审批驳回）
@app.post("/calendars/{cal_id}/events/{event_id}/reject")
def reject_event(cal_id: int, event_id: int, body: schemas.RejectRequest, user=Depends(get_current_user)):
    cal = db.get_calendar(cal_id)
    if not cal or cal["creator_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="仅创建者可审批")
    event = db.get_event(event_id)
    if not event or event["calendar_id"] != cal_id:
        raise HTTPException(status_code=404, detail="事件不存在")

    reason = body.reason or "无"

    # 删除审批驳回：恢复为 approved（原事件继续保留）
    if event["status"] == "delete_pending":
        db.update_event_status(event_id, "approved")
        db.create_notification(
            user_id=event["creator_id"], type="rejected",
            title="删除申请未通过",
            content=f"你在「{cal['name']}」申请删除的事件「{event['title']}」未通过。原因：{reason}",
            ref_event_id=event_id, ref_cal_id=cal_id,
        )
        payload_to_send = notify_approval_result_subscribe(
            event["creator_id"], cal, event, "审批驳回", f"事件{event['title']}删除审批驳回"
        )
        return {"ok": True, "message": "删除申请已驳回", "subscribe_to_send_list": [payload_to_send] if payload_to_send else []}

    # 修改审批拒绝：丢弃提案，恢复事件状态（events 表数据不变）
    if event["status"] == "update_pending":
        revision = db.get_pending_revision(event_id)
        if revision:
            db.update_revision_status(revision["id"], "rejected")
        db.update_event_status(event_id, "approved")

        editor_id = revision["editor_id"] if revision else event["creator_id"]
        editor = db.get_user_by_id(editor_id)
        editor_name = editor["nick_name"] if editor else "成员"

        db.create_notification(
            user_id=editor_id, type="rejected",
            title="事件修改未通过",
            content=f"你在「{cal['name']}」修改的事件「{event['title']}」未通过。原因：{reason}",
            ref_event_id=event_id, ref_cal_id=cal_id,
        )
        payload_to_send = notify_approval_result_subscribe(
            editor_id, cal, event, "审批驳回", f"事件{event['title']}修改审批驳回"
        )
        return {
            "ok": True,
            "message": "修改已拒绝",
            "subscribe_to_send_list": [payload_to_send] if payload_to_send else [],
        }

    # 普通审批拒绝
    db.update_event_status(event_id, "rejected")
    db.create_notification(
        user_id=event["creator_id"], type="rejected",
        title="事件审批未通过",
        content=f"你在「{cal['name']}」创建的事件「{event['title']}」审批未通过。原因：{reason}",
        ref_event_id=event_id, ref_cal_id=cal_id,
    )
    payload_to_send = notify_approval_result_subscribe(
        event["creator_id"], cal, event, "审批驳回", f"事件{event['title']}审批失败"
    )
    return {"ok": True, "message": "审批已拒绝", "subscribe_to_send_list": [payload_to_send] if payload_to_send else []}

# ── 指派事件（附加功能2） ─────────────────────────────────────────

@app.post("/calendars/{cal_id}/assigned-events", response_model=schemas.Event)
def create_assigned_event(cal_id: int, body: schemas.CreateAssignedEventRequest, user=Depends(get_current_user)):
    cal = db.get_calendar(cal_id)
    if not cal:
        raise HTTPException(status_code=404, detail="日历不存在")
    if cal["creator_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="仅创建者可创建指派事件")
    if not body.assigned_member_ids:
        raise HTTPException(status_code=400, detail="请至少选择一名成员")

    members = db.get_calendar_members(cal_id)
    member_ids = {m["id"] for m in members}
    for mid in body.assigned_member_ids:
        if mid not in member_ids:
            raise HTTPException(status_code=400, detail=f"用户{mid}不是日历成员")

    event = db.create_event(
        cal_id=cal_id, creator_id=user["id"], title=body.title,
        start_time=body.start_time, end_time=body.end_time,
        location=body.location, content=body.content,
        status="approved", event_type="assigned",
        remind_before_minutes=10,
    )
    db.set_assigned_members(event["id"], body.assigned_member_ids)

    for mid in body.assigned_member_ids:
        db.create_notification(
            user_id=mid, type="assigned",
            title="你有新的指派事件",
            content=f"导师在「{cal['name']}」为你指派了事件「{body.title}」，时间：{body.start_time} ~ {body.end_time}",
            ref_event_id=event["id"], ref_cal_id=cal_id,
        )
    return event

# ── 通知 ──────────────────────────────────────────────────────────


@app.get("/subscribe/config", response_model=schemas.SubscribeConfigResponse)
def get_subscribe_config_route():
    return get_subscribe_config()


@app.get("/subscribe/status", response_model=schemas.SubscribeStatusResponse)
def get_subscribe_status(user=Depends(get_current_user)):
    config = get_subscribe_config()
    prefs = db.get_subscribe_prefs(user["id"])
    status = {}
    for template_id in config.values():
        if template_id:
            status[template_id] = prefs.get(template_id, "unknown")
    return {"status": status}


@app.post("/subscribe/report")
def report_subscribe_result(body: schemas.SubscribeReportRequest, user=Depends(get_current_user)):
    valid_states = {"accept", "reject", "ban"}
    valid_template_ids = {template_id for template_id in get_subscribe_config().values() if template_id}
    for template_id, state in (body.result or {}).items():
        if template_id not in valid_template_ids or state not in valid_states:
            continue
        db.upsert_subscribe_pref(user["id"], template_id, state, body.result)
    return {"ok": True}


@app.get("/notifications", response_model=list[schemas.Notification])
def list_notifications(user=Depends(get_current_user)):
    return db.get_user_notifications(user["id"])

@app.put("/notifications/{notif_id}/read")
def mark_read(notif_id: int, user=Depends(get_current_user)):
    db.mark_notification_read(notif_id, user["id"])
    return {"ok": True}

@app.put("/notifications/read-all")
def mark_all_read(user=Depends(get_current_user)):
    db.mark_all_notifications_read(user["id"])
    return {"ok": True}

@app.get("/notifications/unread-count")
def unread_count(user=Depends(get_current_user)):
    return {"count": db.get_unread_count(user["id"])}


# ── App 绑定 / 通知捕获 ──────────────────────────────────────────────

# @app.post("/app/bind-code", response_model=schemas.CreateBindCodeResponse)
# def create_bind_code(user=Depends(get_current_user)):
#     bind_code = secrets.token_hex(3).upper()
#     expires_at = datetime.now() + timedelta(minutes=10)
#     db.create_bind_code(bind_code, user["id"], expires_at)
#     return {"bind_code": bind_code, "expires_at": expires_at}

@app.post("/app/bind-code", response_model=schemas.CreateBindCodeResponse)
def create_bind_code(user=Depends(get_current_user)):
    bind_code = secrets.token_hex(3).upper()

    row = db.create_bind_code(bind_code, user["id"])
    # row 里应包含 expires_at（DB时间）
    expires_at = row["expires_at"] if row else None

    return {"bind_code": bind_code, "expires_at": expires_at}

# @app.post("/app/bind-code", response_model=schemas.CreateBindCodeResponse)
# def create_bind_code(user=Depends(get_current_user)):
#     bind_code = secrets.token_hex(3).upper()
#     expires_at = datetime.now() + timedelta(minutes=10)
#
#     db.create_bind_code(bind_code, user["id"], expires_at)
#
#     # --- DEBUG: 写入后立刻回查（看是否真的入库 / 时间是否合理）
#     try:
#         with db.get_conn() as conn:
#             with conn.cursor() as cur:
#                 cur.execute("SELECT NOW() AS now_time")
#                 now_row = cur.fetchone()
#
#                 cur.execute(
#                     "SELECT code, user_id, expires_at, used_at, created_at FROM bind_codes WHERE code=%s",
#                     (bind_code,),
#                 )
#                 row = cur.fetchone()
#         logger.info(
#             "[DEBUG bind-code] code=%s user_id=%s app_now=%s db_now=%s db_row=%s",
#             bind_code,
#             user.get("id"),
#             datetime.now().isoformat(),
#             (now_row or {}).get("now_time"),
#             row,
#         )
#     except Exception as e:
#         logger.exception("[DEBUG bind-code] db check failed: %s", e)
#     # --- DEBUG END
#
#     return {"bind_code": bind_code, "expires_at": expires_at}
#
# @app.get("/app/debug/bind-code/{code}")
# def debug_bind_code(code: str):
#     """
#     调试接口：查看 bind_code 在 DB 中的记录状态
#     仅用于排查：写入是否成功 / 是否立刻过期 / 是否已被消费
#     """
#     code = (code or "").strip().upper()
#     with db.get_conn() as conn:
#         with conn.cursor() as cur:
#             cur.execute("SELECT NOW() AS now_time")
#             now_row = cur.fetchone()
#
#             cur.execute(
#                 "SELECT code, user_id, expires_at, used_at, created_at FROM bind_codes WHERE code=%s",
#                 (code,),
#             )
#             row = cur.fetchone()
#
#             cur.execute(
#                 "SELECT code, user_id, expires_at, used_at, created_at FROM bind_codes "
#                 "WHERE code=%s AND used_at IS NULL AND expires_at > NOW() LIMIT 1",
#                 (code,),
#             )
#             valid_row = cur.fetchone()
#
#     return {
#         "input_code": code,
#         "db_now": (now_row or {}).get("now_time"),
#         "row": row,
#         "would_be_consumable": bool(valid_row),
#         "mysql_address": os.environ.get("MYSQL_ADDRESS"),
#         "mysql_database": os.environ.get("MYSQL_DATABASE"),
#     }
#
# @app.get("/app/debug/db-time")
# def debug_db_time():
#     with db.get_conn() as conn:
#         with conn.cursor() as cur:
#             cur.execute("SELECT NOW() AS now_time, @@system_time_zone AS system_tz, @@time_zone AS tz")
#             row = cur.fetchone()
#     return {"db": row, "app_now": datetime.now().isoformat()}


@app.post("/app/bind", response_model=schemas.AppBindResponse)
def app_bind(body: schemas.AppBindRequest):
    bind = db.consume_bind_code(body.bind_code.strip().upper())
    if not bind:
        raise HTTPException(status_code=400, detail="绑定码无效或已过期")
    app_token = secrets.token_urlsafe(32)
    db.create_app_token(app_token, bind["user_id"], body.device_id)
    return {"app_token": app_token, "user_id": bind["user_id"]}


@app.post("/app/notifications/ingest", response_model=schemas.CapturedNotification)
def ingest_notification(body: schemas.AndroidIngestNotificationRequest, user=Depends(get_current_app_user)):
    raw_text = f"{body.title or ''}\n{body.text or ''}".strip()
    suggested_start, suggested_end = time_extract.extract_suggested_time(raw_text, body.posted_at)
    inserted = db.insert_captured_notification(
        user_id=user["id"],
        package_name=body.package_name,
        title=body.title,
        text=body.text,
        posted_at=body.posted_at,
        dedupe_key=body.dedupe_key,
        suggested_start_time=suggested_start,
        suggested_end_time=suggested_end,
    )
    return inserted


@app.get("/captured-notifications", response_model=list[schemas.CapturedNotification])
def list_captured_notifications(user=Depends(get_current_user)):
    return db.list_captured_notifications(user["id"], status="pending")


@app.post("/captured-notifications/{captured_id}/dismiss")
def dismiss_captured_notification(captured_id: int, user=Depends(get_current_user)):
    notif = db.get_captured_notification(captured_id, user["id"])
    if not notif:
        raise HTTPException(status_code=404, detail="捕获通知不存在")
    db.dismiss_captured_notification(captured_id, user["id"])
    return {"ok": True}


@app.post("/events/batch-create", response_model=schemas.BatchCreateEventsResponse)
def batch_create_events(body: schemas.BatchCreateEventsRequest, user=Depends(get_current_user)):
    if not body.calendar_ids:
        raise HTTPException(status_code=400, detail="请至少选择一个日历")
    body.remind_before_minutes = normalize_remind_before_minutes(body.remind_before_minutes)

    results = []
    all_ok = True
    subscribe_to_send_list = []
    for cal_id in body.calendar_ids:
        result = create_single_event_for_calendar(cal_id, body, user)
        if not result["ok"]:
            all_ok = False
        for payload in result.pop("subscribe_to_send_list", []) or []:
            subscribe_to_send_list.append(payload)
        results.append(result)
    return {"all_ok": all_ok, "results": results, "subscribe_to_send_list": subscribe_to_send_list}


@app.post("/captured-notifications/{captured_id}/create-events", response_model=schemas.CreateEventsFromCapturedResponse)
def create_events_from_captured(captured_id: int, body: schemas.BatchCreateEventsRequest, user=Depends(get_current_user)):
    notif = db.get_captured_notification(captured_id, user["id"])
    if not notif:
        raise HTTPException(status_code=404, detail="捕获通知不存在")
    if notif["status"] != "pending":
        raise HTTPException(status_code=400, detail="该通知已处理")

    req_payload = body
    if not req_payload.title:
        req_payload.title = notif["title"] or "通知日程"
    if not req_payload.start_time:
        if not notif.get("suggested_start_time"):
            raise HTTPException(status_code=400, detail="缺少开始时间")
        req_payload.start_time = notif["suggested_start_time"]
    if not req_payload.end_time:
        req_payload.end_time = notif.get("suggested_end_time")

    batch_result = batch_create_events(req_payload, user)
    if batch_result["all_ok"]:
        db.mark_captured_notification_confirmed(captured_id, user["id"])
    return batch_result
