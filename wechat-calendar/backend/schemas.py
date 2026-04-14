"""
Pydantic 请求/响应模型
"""
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

# ── 认证 ────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    code: str
    nick_name: str = ""
    avatar_url: str = ""

class UpdateProfileRequest(BaseModel):
    nick_name: str
    avatar_url: str = ""

class UserInfo(BaseModel):
    id: int
    openid: str
    nick_name: str
    avatar_url: str

class LoginResponse(BaseModel):
    openid: str
    user: dict

# ── 日历 ────────────────────────────────────────────────────

class CreateCalendarRequest(BaseModel):
    name: str
    description: str = ""

class Calendar(BaseModel):
    id: int
    name: str
    description: str
    creator_id: int
    created_at: datetime

class CalendarMember(BaseModel):
    id: int
    nick_name: str
    avatar_url: str
    joined_at: str

class CalendarDetail(BaseModel):
    id: int
    name: str
    description: str
    creator_id: int
    created_at: datetime
    members: list[dict]

# ── 邀请 ────────────────────────────────────────────────────

class JoinRequest(BaseModel):
    token: str

# ── 事件 ────────────────────────────────────────────────────

class CreateEventRequest(BaseModel):
    title: str
    start_time: str       # ISO 8601: "2025-03-15 09:00:00"
    end_time: str
    location: Optional[str] = ""
    content: Optional[str] = ""

class CreateAssignedEventRequest(BaseModel):
    title: str
    start_time: str
    end_time: str
    location: Optional[str] = ""
    content: Optional[str] = ""
    assigned_member_ids: list[int]

class UpdateEventRequest(BaseModel):
    title: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    location: Optional[str] = None
    content: Optional[str] = None

class Event(BaseModel):
    id: int
    calendar_id: int
    creator_id: int
    creator_name: str
    title: str
    start_time: str
    end_time: str
    location: str
    content: str
    status: str           # pending / approved / rejected / delete_pending
    event_type: str       # normal / assigned
    assignees: list[dict] = []
    created_at: datetime
    updated_at: str

class RejectRequest(BaseModel):
    reason: Optional[str] = ""

# ── 通知 ────────────────────────────────────────────────────

class Notification(BaseModel):
    id: int
    user_id: int
    type: str             # new_event / approved / rejected / assigned / update_request / delete_request
    title: str
    content: str
    is_read: int
    ref_event_id: Optional[int]
    ref_cal_id: Optional[int]
    created_at: datetime
