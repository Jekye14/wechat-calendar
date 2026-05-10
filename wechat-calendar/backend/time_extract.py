import re
from datetime import datetime, timedelta
from typing import Optional


DATE_TIME_PATTERNS = [
    # YYYY-MM-DD HH:MM [ - HH:MM ]
    re.compile(
        r"(?P<year>\d{4})[-/](?P<month>\d{1,2})[-/](?P<day>\d{1,2})\s+"
        r"(?P<start_h>\d{1,2}):(?P<start_m>\d{2})"
        r"(?:\s*[-~至到]+\s*(?P<end_h>\d{1,2}):(?P<end_m>\d{2}))?"
    ),
    # MM-DD HH:MM [ - HH:MM ]
    re.compile(
        r"(?P<month>\d{1,2})[-/](?P<day>\d{1,2})\s+"
        r"(?P<start_h>\d{1,2}):(?P<start_m>\d{2})"
        r"(?:\s*[-~至到]+\s*(?P<end_h>\d{1,2}):(?P<end_m>\d{2}))?"
    ),
]


def _fmt(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def _safe_make_datetime(
    year: int,
    month: int,
    day: int,
    hour: int,
    minute: int,
) -> Optional[datetime]:
    try:
        return datetime(year, month, day, hour, minute, 0)
    except ValueError:
        return None


def _guess_year(month: int, day: int, base: datetime) -> int:
    candidate = _safe_make_datetime(base.year, month, day, 0, 0)
    if not candidate:
        return base.year
    if (candidate - base).days < -180:
        return base.year + 1
    return base.year


def extract_suggested_time(text: str, posted_at: Optional[str] = None) -> tuple[Optional[str], Optional[str]]:
    if not text:
        return None, None

    base_dt = datetime.now()
    if posted_at:
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y/%m/%d %H:%M:%S", "%Y/%m/%d %H:%M"):
            try:
                base_dt = datetime.strptime(posted_at, fmt)
                break
            except ValueError:
                continue

    for pattern in DATE_TIME_PATTERNS:
        m = pattern.search(text)
        if not m:
            continue

        gd = m.groupdict()
        year = int(gd["year"]) if gd.get("year") else _guess_year(int(gd["month"]), int(gd["day"]), base_dt)
        month = int(gd["month"])
        day = int(gd["day"])
        start_h = int(gd["start_h"])
        start_m = int(gd["start_m"])

        start_dt = _safe_make_datetime(year, month, day, start_h, start_m)
        if not start_dt:
            continue

        if gd.get("end_h") is not None and gd.get("end_m") is not None:
            end_h = int(gd["end_h"])
            end_m = int(gd["end_m"])
            end_dt = _safe_make_datetime(year, month, day, end_h, end_m)
            if not end_dt:
                end_dt = start_dt + timedelta(hours=1)
            elif end_dt <= start_dt:
                end_dt = end_dt + timedelta(days=1)
        else:
            end_dt = start_dt + timedelta(hours=1)

        return _fmt(start_dt), _fmt(end_dt)

    return None, None
