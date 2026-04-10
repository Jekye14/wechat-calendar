"""
JWT-based invite token
"""
from jose import jwt, JWTError
from datetime import datetime, timedelta
import os

SECRET_KEY = os.environ.get("SECRET_KEY", "CHANGE_THIS_IN_PRODUCTION_SECRET_KEY_2025")
ALGORITHM = "HS256"
TOKEN_EXPIRE_DAYS = 7

def generate_invite_token(cal_id: int) -> str:
    expire = datetime.utcnow() + timedelta(days=TOKEN_EXPIRE_DAYS)
    data = {"cal_id": cal_id, "exp": expire, "type": "invite"}
    return jwt.encode(data, SECRET_KEY, algorithm=ALGORITHM)

def verify_invite_token(token: str):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("type") != "invite":
            return None
        return payload.get("cal_id")
    except JWTError:
        return None
