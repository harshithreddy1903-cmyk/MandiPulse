"""Bounded, credential-free snapshots of genuine official market observations."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
import json
import math
import os
from pathlib import Path
import tempfile
from typing import Any

MAX_BYTES = 2 * 1024 * 1024
MAX_ROWS = 1000
MAX_AGE = timedelta(days=7)
OFFICIAL_SOURCES = {
    "data.gov.in · AGMARKNET": "AGMARKNET · data.gov.in",
    "AGMARKNET · official weekly report": "AGMARKNET · official weekly report",
}


def get_market_cache_path(project_root: Path) -> Path:
    if os.getenv("VERCEL") == "1":
        return Path(tempfile.gettempdir()) / "mandipulse" / "market-feed-cache.json"
    return Path(project_root) / ".local" / "market-feed-cache.json"


def _utc(value: Any) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed.astimezone(timezone.utc) if parsed.tzinfo else None
    except (ValueError, TypeError):
        return None


def _day(value: Any) -> date | None:
    raw = str(value or "").strip()
    for pattern in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d-%b-%Y", "%d %b %Y"):
        try:
            return datetime.strptime(raw, pattern).date()
        except ValueError:
            pass
    parsed = _utc(raw)
    return parsed.date() if parsed else None


def _positive(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
        return number if math.isfinite(number) and number > 0 else None
    except (TypeError, ValueError, OverflowError):
        return None


def _rows(rows: Any, state: str, source: str, today: date) -> list[dict[str, Any]]:
    if not isinstance(rows, list):
        return []
    accepted = []
    for row in rows[:MAX_ROWS]:
        if not isinstance(row, dict) or row.get("source") != OFFICIAL_SOURCES[source]:
            continue
        if str(row.get("state", "")).strip().casefold() != state.casefold():
            continue
        day = _day(row.get("arrival_date"))
        price = _positive(row.get("modal_price"))
        if day is None or day > today or day < today - MAX_AGE or price is None:
            continue
        if row.get("unit") != "INR/quintal":
            continue
        strings = {key: str(row.get(key, "")).strip() for key in ("district", "market", "commodity", "variety", "grade")}
        if not strings["market"] or not strings["commodity"] or any(len(value) > 200 for value in strings.values()):
            continue
        accepted.append({**strings, "state": state, "arrival_date": str(row["arrival_date"]).strip(), "modal_price": price, "min_price": _positive(row.get("min_price")), "max_price": _positive(row.get("max_price")), "unit": "INR/quintal", "source": OFFICIAL_SOURCES[source]})
    return accepted


def save_market_cache(path: Path, state: str, feed: dict[str, Any], now: datetime | None = None) -> bool:
    current = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    source = feed.get("source")
    if not isinstance(source, str) or source not in OFFICIAL_SOURCES or feed.get("mode") not in ("live", "cached"):
        return False
    if source == "data.gov.in · AGMARKNET" and feed.get("mode") != "live":
        return False
    fetched = _utc(feed.get("last_retrieved_at") or feed.get("updated_at"))
    if fetched is None or not timedelta(0) <= current - fetched <= MAX_AGE:
        return False
    records = _rows(feed.get("history"), state, source, current.astimezone().date())
    if not records:
        return False
    coverage = feed.get("coverage") if isinstance(feed.get("coverage"), dict) else {}
    catalog = feed.get("commodity_catalog", [])
    catalog = sorted({name.strip() for name in catalog if isinstance(name, str) and 0 < len(name.strip()) <= 200}, key=str.casefold)[:1000] if isinstance(catalog, list) else []
    payload = {"version": 1, "state": state, "source": source, "fetched_at": fetched.isoformat().replace("+00:00", "Z"), "partial": bool(coverage.get("partial")) or len(feed.get("history", [])) > MAX_ROWS, "records": records, "commodity_catalog": catalog}
    categories = feed.get("category_catalog")
    if isinstance(categories, dict):
        payload["category_catalog"] = {key: [name for name in categories.get(key, [])[:1000] if isinstance(name, str) and name in catalog] for key in ("vegetables", "dals", "pulses", "lentils") if isinstance(categories.get(key), list)}
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(encoded) > MAX_BYTES:
        return False
    temporary = None
    try:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix="market-feed-", suffix=".tmp", delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        return True
    except OSError:
        return False
    finally:
        if temporary is not None:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass


def load_market_cache(path: Path, state: str, now: datetime | None = None) -> dict[str, Any] | None:
    current = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    try:
        path = Path(path)
        if path.stat().st_size > MAX_BYTES:
            return None
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, UnicodeError):
        return None
    if not isinstance(payload, dict) or payload.get("version") != 1 or str(payload.get("state", "")).casefold() != state.casefold():
        return None
    source = payload.get("source")
    if not isinstance(source, str) or source not in OFFICIAL_SOURCES or not isinstance(payload.get("records"), list) or len(payload["records"]) > MAX_ROWS:
        return None
    fetched = _utc(payload.get("fetched_at"))
    if fetched is None or not timedelta(0) <= current - fetched <= MAX_AGE:
        return None
    records = _rows(payload["records"], state, source, current.astimezone().date())
    if not records:
        return None
    retrieved = fetched.isoformat().replace("+00:00", "Z")
    days = sorted({_day(row["arrival_date"]).isoformat() for row in records})
    partial = bool(payload.get("partial"))
    warning = f"Saved official observations, not current live prices. Source: {source}. Observation dates: {', '.join(days)}. Last retrieved: {retrieved}."
    if partial:
        warning += " The saved snapshot has partial market/product coverage."
    warning += " Confirm current prices and availability before buying."
    catalog = payload.get("commodity_catalog", [])
    catalog = [name.strip() for name in catalog[:1000] if isinstance(name, str) and 0 < len(name.strip()) <= 200] if isinstance(catalog, list) else []
    categories = payload.get("category_catalog")
    categories = {key: [name for name in categories.get(key, [])[:1000] if isinstance(name, str) and name in catalog] for key in ("vegetables", "dals", "pulses", "lentils") if isinstance(categories.get(key), list)} if isinstance(categories, dict) else {}
    return {"mode": "cached", "stale": True, "warning": warning, "message": warning, "history": records, "updated_at": retrieved, "last_retrieved_at": retrieved, "observation_dates": days, "source": source, "commodity_catalog": catalog, "category_catalog": categories, "coverage": {"records_received": len(records), "partial": partial, "cached_snapshot": True, "observation_dates": days}}
