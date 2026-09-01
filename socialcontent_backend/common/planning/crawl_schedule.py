from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


DEFAULT_TIMEZONE = "Asia/Ho_Chi_Minh"


def timezone_info(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except (ValueError, ZoneInfoNotFoundError) as exc:
        raise ValueError("Múi giờ không hợp lệ") from exc


def validate_schedule_values(
    *,
    runs_per_day: int,
    window_start: time,
    window_end: time,
    weekdays: list[int],
    timezone_name: str,
) -> None:
    if not 1 <= runs_per_day <= 24:
        raise ValueError("Số lần chạy mỗi ngày phải từ 1 đến 24")
    if not weekdays:
        raise ValueError("Phải chọn ít nhất một ngày chạy")
    if len(set(weekdays)) != len(weekdays) or any(day < 0 or day > 6 for day in weekdays):
        raise ValueError("Ngày chạy phải là danh sách không trùng từ 0 (Thứ Hai) đến 6 (Chủ Nhật)")
    timezone_info(timezone_name)

    start_minute = window_start.hour * 60 + window_start.minute
    end_minute = window_end.hour * 60 + window_end.minute
    if end_minute < start_minute:
        raise ValueError("Giờ kết thúc phải sau hoặc bằng giờ bắt đầu trong cùng một ngày")
    if runs_per_day > 1 and end_minute - start_minute < runs_per_day - 1:
        raise ValueError("Khoảng thời gian quá ngắn cho số lần chạy đã chọn")


def daily_run_times(runs_per_day: int, window_start: time, window_end: time) -> list[time]:
    start_minute = window_start.hour * 60 + window_start.minute
    end_minute = window_end.hour * 60 + window_end.minute
    if runs_per_day == 1:
        minute_values = [start_minute]
    else:
        span = end_minute - start_minute
        minute_values = [round(start_minute + span * index / (runs_per_day - 1)) for index in range(runs_per_day)]
    return [time(hour=value // 60, minute=value % 60) for value in minute_values]


def next_run_at(
    *,
    runs_per_day: int,
    window_start: time,
    window_end: time,
    weekdays: list[int],
    timezone_name: str,
    after: datetime | None = None,
    inclusive: bool = True,
) -> datetime:
    validate_schedule_values(
        runs_per_day=runs_per_day,
        window_start=window_start,
        window_end=window_end,
        weekdays=weekdays,
        timezone_name=timezone_name,
    )
    tzinfo = timezone_info(timezone_name)
    cursor = after or datetime.now(timezone.utc)
    if cursor.tzinfo is None:
        cursor = cursor.replace(tzinfo=timezone.utc)
    local_cursor = cursor.astimezone(tzinfo)
    allowed_days = set(weekdays)
    run_times = daily_run_times(runs_per_day, window_start, window_end)

    for day_offset in range(8):
        candidate_date: date = local_cursor.date() + timedelta(days=day_offset)
        if candidate_date.weekday() not in allowed_days:
            continue
        for run_time in run_times:
            candidate = datetime.combine(candidate_date, run_time, tzinfo=tzinfo)
            if candidate > local_cursor or (inclusive and candidate == local_cursor):
                return candidate.astimezone(timezone.utc)
    raise ValueError("Không tìm thấy lần chạy kế tiếp trong lịch đã chọn")


def next_run_for_schedule(schedule, *, after: datetime | None = None, inclusive: bool = True) -> datetime:
    return next_run_at(
        runs_per_day=int(schedule.runs_per_day),
        window_start=schedule.window_start,
        window_end=schedule.window_end,
        weekdays=list(schedule.weekdays or []),
        timezone_name=schedule.timezone,
        after=after,
        inclusive=inclusive,
    )
