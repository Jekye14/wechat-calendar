"""
微信API调用封装
"""
import httpx
import os

APPID = os.environ.get("WX_APPID", "YOUR_APPID")
SECRET = os.environ.get("WX_SECRET", "YOUR_SECRET")

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
        return data.get("openid")
    except Exception:
        return None

def send_subscribe_message(openid: str, template_id: str, data: dict, page: str = ""):
    """发送微信订阅消息（需配置模板ID）"""
    # 实际部署时需先获取access_token，此处为示意
    pass
