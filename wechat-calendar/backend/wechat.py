"""
微信API调用封装
"""
import httpx
import os
import logging
import time

logger = logging.getLogger("uvicorn.error")

APPID = os.environ.get("WX_APPID", "YOUR_APPID")
SECRET = os.environ.get("WX_SECRET", "YOUR_SECRET")
_ACCESS_TOKEN = None
_ACCESS_TOKEN_EXPIRES_AT = 0.0

def code2openid(code: str) -> str | None:
    """用登录code换取openid"""
    # 开发调试：直接返回code作为openid（真实项目请注释掉下面一行）
    if os.environ.get("ENV") == "dev":
        return f"dev_{code}"

    url = "https://api.weixin.qq.com/sns/jscode2session"
    params = {
        "appid": APPID,
        "secret": SECRET,
        "js_code": code,
        "grant_type": "authorization_code",
    }
    try:
        resp = httpx.get(url, params=params, timeout=5)
        data = resp.json()
        logger.info("jscode2session status=%s data=%s", resp.status_code, data)
        return data.get("openid")
    except Exception as e:
        logger.exception("jscode2session exception: %s", e)
        return None


def get_access_token(force_refresh: bool = False) -> str | None:
    global _ACCESS_TOKEN, _ACCESS_TOKEN_EXPIRES_AT

    if not force_refresh and _ACCESS_TOKEN and time.time() < _ACCESS_TOKEN_EXPIRES_AT:
        return _ACCESS_TOKEN

    if not APPID or APPID == "YOUR_APPID" or not SECRET or SECRET == "YOUR_SECRET":
        logger.warning("WX_APPID/WX_SECRET 未配置，无法获取 access_token")
        return None

    url = "https://api.weixin.qq.com/cgi-bin/token"
    params = {
        "grant_type": "client_credential",
        "appid": APPID,
        "secret": SECRET,
    }
    try:
        resp = httpx.get(url, params=params, timeout=10)
        data = resp.json()
        logger.info("get_access_token status=%s data=%s", resp.status_code, data)
        access_token = data.get("access_token")
        expires_in = int(data.get("expires_in", 0) or 0)
        if not access_token:
            return None
        _ACCESS_TOKEN = access_token
        _ACCESS_TOKEN_EXPIRES_AT = time.time() + max(expires_in - 60, 60)
        return _ACCESS_TOKEN
    except Exception as e:
        logger.exception("get_access_token exception: %s", e)
        return None


def send_subscribe_message(openid: str, template_id: str, data: dict, page: str = "", _retry: bool = True):
    """发送微信订阅消息（需配置模板ID）"""
    access_token = get_access_token()
    if not access_token:
        return {"errcode": -1, "errmsg": "access_token unavailable"}

    payload = {
        "touser": openid,
        "template_id": template_id,
        "data": data or {},
    }
    if page:
        payload["page"] = page

    url = f"https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token={access_token}"
    try:
        resp = httpx.post(url, json=payload, timeout=10)
        result = resp.json()
        logger.info("send_subscribe_message status=%s data=%s", resp.status_code, result)
        if _retry and result.get("errcode") in {40001, 42001}:
            get_access_token(force_refresh=True)
            return send_subscribe_message(openid, template_id, data, page, _retry=False)
        return result
    except Exception as e:
        logger.exception("send_subscribe_message exception: %s", e)
        return {"errcode": -1, "errmsg": str(e)}
