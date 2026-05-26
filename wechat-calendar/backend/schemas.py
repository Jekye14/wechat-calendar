"""
Pydantic 请求/响应模型
"""
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

# ── 认证 ────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    # 将 code 改为带有默认值的可选字段，或者干脆直接删掉这一行
    code: str = ""
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
    joined_at: datetime

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
    end_time: Optional[str] = None
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
    updated_at: datetime

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


class SubscribeConfigResponse(BaseModel):
    approval_result_template_id: str = ""
    schedule_update_template_id: str = ""


class SubscribeReportRequest(BaseModel):
    result: dict[str, str]


class SubscribeStatusResponse(BaseModel):
    status: dict[str, str]


# ── App 绑定 / 捕获通知 / 批量创建 ──────────────────────────

class CreateBindCodeResponse(BaseModel):
    bind_code: str
    expires_at: datetime


class AppBindRequest(BaseModel):
    bind_code: str
    device_id: str = "unknown"


class AppBindResponse(BaseModel):
    app_token: str
    user_id: int


class AndroidIngestNotificationRequest(BaseModel):
    package_name: str
    title: str = ""
    text: str = ""
    posted_at: str
    dedupe_key: str


class CapturedNotification(BaseModel):
    id: int
    user_id: int
    package_name: str
    title: str
    text: str
    posted_at: str
    received_at: datetime
    dedupe_key: str
    status: str
    suggested_start_time: Optional[str] = None
    suggested_end_time: Optional[str] = None


class BatchCreateEventsRequest(BaseModel):
    calendar_ids: list[int]
    title: str
    start_time: str
    end_time: Optional[str] = None
    location: Optional[str] = ""
    content: Optional[str] = ""


class BatchCreateEventResult(BaseModel):
    calendar_id: int
    calendar_name: str
    ok: bool
    event_id: Optional[int] = None
    error: Optional[str] = None


class BatchCreateEventsResponse(BaseModel):
    all_ok: bool
    results: list[BatchCreateEventResult]


class CreateEventsFromCapturedResponse(BaseModel):
    all_ok: bool
    results: list[BatchCreateEventResult]
