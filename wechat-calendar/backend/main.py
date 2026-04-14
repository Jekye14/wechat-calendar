"""
微信日历小程序后端 - FastAPI + SQLite
安装: pip install fastapi uvicorn python-jose[cryptography] httpx
运行: uvicorn main:app --host 0.0.0.0 --port 8000 --reload
"""

from fastapi import FastAPI, HTTPException, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import database as db
import schemas
import auth
import wechat

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

@app.put("/auth/profile")
def update_profile(body: schemas.UpdateProfileRequest, user=Depends(get_current_user)):
    db.update_user(user["id"], body.nick_name, body.avatar_url)
    return {"ok": True}

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

    if not is_creator:
        conflicts = db.check_time_conflict_with_creator(
            cal_id, cal["creator_id"], body.start_time, body.end_time, None)
        if conflicts:
            raise HTTPException(status_code=409,
                detail=f"与创建者事件时间冲突：{conflicts[0]['title']}（{conflicts[0]['start_time']} ~ {conflicts[0]['end_time']}）")

    status = "approved" if is_creator else "pending"
    event = db.create_event(
        cal_id=cal_id, creator_id=user["id"], title=body.title,
        start_time=body.start_time, end_time=body.end_time,
        location=body.location, content=body.content,
        status=status, event_type="normal",
    )

    if not is_creator:
        db.create_notification(
            user_id=cal["creator_id"], type="new_event",
            title="新事件待审批",
            content=f"成员「{user['nick_name']}」在「{cal['name']}」创建了事件「{body.title}」，请审批。",
            ref_event_id=event["id"], ref_cal_id=cal_id,
        )
    return event

@app.get("/calendars/{cal_id}/events", response_model=list[schemas.Event])
def list_events(cal_id: int, user=Depends(get_current_user)):
    cal = db.get_calendar(cal_id)
    if not cal:
        raise HTTPException(status_code=404, detail="日历不存在")
    if not db.is_member_or_creator(cal_id, user["id"], cal["creator_id"]):
        raise HTTPException(status_code=403, detail="无权访问")
    return db.get_calendar_events(cal_id)
@app.get("/calendars/{cal_id}/events/{event_id}", response_model=schemas.Event)
def get_event(cal_id: int, event_id: int, user=Depends(get_current_user)):
    cal = db.get_calendar(cal_id)
    if not cal:
        raise HTTPException(status_code=404, detail="日历不存在")
    if not db.is_member_or_creator(cal_id, user["id"], cal["creator_id"]):
        raise HTTPException(status_code=403, detail="无权访问")

    event = db.get_event(event_id)
    if not event or event["calendar_id"] != cal_id:
        raise HTTPException(status_code=404, detail="事件不存在")

    # db.get_event 返回的字段可能不含 creator_name/assignees 等，
    # 但前端事件详情页使用的是 schemas.Event，所以这里用 update_event 返回的完整结构保持一致：
    return db.update_event(event_id, schemas.UpdateEventRequest(), event["status"])
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
    comparable_fields = ["title", "start_time", "end_time", "location", "content"]

    def _normalize(v):
        return "" if v is None else v

    has_real_changes = any(
        field in incoming and _normalize(incoming[field]) != _normalize(event[field])
        for field in comparable_fields
    )

    # 成员改时间 -> 待审批；其余保持原状态
    changed_time = ("start_time" in incoming and incoming["start_time"] != event["start_time"]) or \
                   ("end_time" in incoming and incoming["end_time"] != event["end_time"])
    new_status = "pending" if (not is_creator and changed_time) else event["status"]

    updated_event = db.update_event(event_id, body, new_status)

    if (not is_creator) and has_real_changes:
        action = "修改了事件时间，待你审批" if changed_time else "更新了事件内容"
        db.create_notification(
            user_id=cal["creator_id"], type="update_request",
            title="事件更新通知",
            content=f"成员「{user['nick_name']}」{action}：「{updated_event['title']}」",
            ref_event_id=event_id, ref_cal_id=cal_id,
        )

    return updated_event


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
        return {"ok": True, "message": "删除成功"}

    # 新规则：未通过(rejected)事件，成员可直接删除，无需审批
    if event["status"] == "rejected":
        db.delete_event(event_id)
        return {"ok": True, "message": "未通过事件已删除"}

    # 其余成员删除走删除审批：新增状态 delete_pending
    if event["status"] == "delete_pending":
        return {"ok": True, "message": "删除申请已提交，等待审批"}

    db.update_event_status(event_id, "delete_pending")
    db.create_notification(
        user_id=cal["creator_id"], type="delete_request",
        title="事件删除待审批",
        content=f"成员「{user['nick_name']}」申请删除「{event['title']}」，请审批。",
        ref_event_id=event_id, ref_cal_id=cal_id,
    )
    return {"ok": True, "message": "删除申请已提交，待创建者审批"}


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
        return {"ok": True, "message": "删除申请已通过，事件已删除"}

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
    return {"ok": True, "message": "审批通过"}


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
        return {"ok": True, "message": "删除申请已驳回"}

    # 普通审批拒绝
    db.update_event_status(event_id, "rejected")
    db.create_notification(
        user_id=event["creator_id"], type="rejected",
        title="事件审批未通过",
        content=f"你在「{cal['name']}」创建的事件「{event['title']}」审批未通过。原因：{reason}",
        ref_event_id=event_id, ref_cal_id=cal_id,
    )
    return {"ok": True, "message": "审批已拒绝"}

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
