"""Bounded, public AGMARKNET weekly observations; never a statewide live feed."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, wait
from datetime import date, datetime, timedelta, timezone
import json
import math
import os
import re
import subprocess
import threading
import time
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen


SOURCE = "AGMARKNET · official weekly report"
BASE_URL = "https://api.agmarknet.gov.in/v1/"
MAX_REPORT_REQUESTS = 10
HEADERS = {"Origin": "https://agmarknet.gov.in", "Referer": "https://agmarknet.gov.in/", "User-Agent": "Mozilla/5.0"}
_metadata: tuple[float, dict[str, Any]] | None = None
_metadata_lock = threading.Lock()


def _fetch_json(path: str, params: dict[str, Any] | None = None, timeout: float = 8) -> dict[str, Any]:
    url = BASE_URL + path + ("?" + urlencode(params) if params else "")
    if os.name == "nt":
        script = r"""
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$headers = @{Origin='https://agmarknet.gov.in'; Referer='https://agmarknet.gov.in/'; 'User-Agent'='Mozilla/5.0'}
$response = Invoke-WebRequest -Uri $request.url -Headers $headers -TimeoutSec $request.timeout -UseBasicParsing
[Console]::Out.Write($response.Content)
"""
        response = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
            input=json.dumps({"url": url, "timeout": max(1, math.ceil(timeout))}), text=True, encoding="utf-8", capture_output=True,
            timeout=timeout + .5, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), check=False,
        )
        if response.returncode:
            raise RuntimeError("Official weekly report unavailable")
        raw = response.stdout
    else:
        with urlopen(Request(url, headers=HEADERS), timeout=timeout) as response:
            raw = response.read(2_000_001).decode("utf-8")
    if len(raw.encode("utf-8")) > 2_000_000:
        raise ValueError("Official response exceeds the bounded size")
    result = json.loads(raw)
    if not isinstance(result, dict):
        raise ValueError("Invalid official response")
    return result


def _get_metadata() -> dict[str, Any]:
    global _metadata
    with _metadata_lock:
        if _metadata is not None and time.monotonic() - _metadata[0] < 3600:
            return _metadata[1]
        payload = _fetch_json("daily-price-arrival/filters")
        data = payload.get("data")
        if payload.get("status") is not True or not isinstance(data, dict):
            raise ValueError("Official filter metadata unavailable")
        _metadata = (time.monotonic(), data)
        return data


def _words(value: Any) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", str(value).casefold()))


def _categories(crop: dict[str, Any], groups: dict[Any, str]) -> set[str]:
    name = _words(crop.get("cmdt_name", ""))
    group = groups.get(crop.get("cmdt_group_id"), "")
    if group == "vegetables" and not re.search(r"\b(dry|dried|dal|seed|seeds|powder|flour|chunks?|meal|processed|dehydrated|flakes?)\b|\bmealmaker\b|\bsoyachunks?\b", name):
        return {"vegetables"}
    if group != "pulses":
        return set()
    categories = {"pulses"}
    if re.search(r"\b(dal|dhal|split)\b", name):
        categories.add("dals")
    if re.search(r"\b(lentil|lentils|masoor|masur)\b", name):
        categories.add("lentils")
    return categories


def _prioritize_category(crops: list[dict[str, Any]], category: str) -> list[dict[str, Any]]:
    if category == "vegetables":
        families = (
            ("tomato",), ("onion",), ("potato",), ("carrot",), ("brinjal", "eggplant"),
            ("beetroot", "beet root"), ("cabbage",), ("cauliflower",),
            ("ladies finger", "lady finger", "bhindi", "okra"), ("cucumber", "cucumbar", "kheera"),
            ("beans", "french beans"), ("green chilli", "green chili"),
        )
        representatives = []
        for aliases in families:
            matches = [crop for crop in crops if any(re.search(rf"(?<!\w){re.escape(alias)}(?!\w)", _words(crop["cmdt_name"])) for alias in aliases)]
            if matches:
                representatives.append(min(matches, key=lambda crop: (_words(crop["cmdt_name"]) not in aliases, crop["cmdt_id"])))
        favored = {crop["cmdt_id"] for crop in representatives}
        return representatives + sorted((crop for crop in crops if crop["cmdt_id"] not in favored), key=lambda crop: crop["cmdt_id"])
    families = (r"\b(arhar|tur|toor)\b|\bred gram\b", r"\b(chana|chickpea)\b|\bbengal gram\b", r"\b(urd|urad)\b|\bblack gram\b", r"\b(moong|mung)\b|\bgreen gram\b")
    def rank(crop):
        name = _words(crop["cmdt_name"])
        family = next((index for index, pattern in enumerate(families) if re.search(pattern, name)), len(families))
        return family, not bool(re.search(r"\b(dal|dhal|split)\b", name)), crop["cmdt_id"]
    return sorted(crops, key=rank)


def _select_crops(crops: list[dict[str, Any]], groups: dict[Any, str], names: list[str] | None, category: str | None) -> list[dict[str, Any]]:
    if names:
        selected = []
        for requested in names:
            normalized = _words(requested)
            normalized = {"tomatoes": "tomato", "potatoes": "potato", "onions": "onion", "toor dal": "tur dal", "urad dal": "urd dal"}.get(normalized, normalized)
            exact = [crop for crop in crops if _words(crop["cmdt_name"]) == normalized]
            matches = exact or [crop for crop in crops if normalized and set(normalized.split()) <= set(_words(crop["cmdt_name"]).split())]
            if not matches and " " not in normalized and len(normalized) >= 4:
                for crop in crops:
                    words = _words(crop["cmdt_name"]).split()
                    if any(normalized == "".join(words[left:right]) for left in range(len(words)) for right in range(left + 1, len(words) + 1)):
                        matches.append(crop)
            selected.extend(matches)
    elif category:
        normalized = _words(category)
        key = "vegetables" if "vegetable" in normalized else "lentils" if "lentil" in normalized else "dals" if "dal" in normalized else "pulses" if "pulse" in normalized else ""
        selected = [crop for crop in crops if key in _categories(crop, groups)]
        if "whole" in normalized:
            selected = [crop for crop in selected if "dals" not in _categories(crop, groups)]
        selected = _prioritize_category(selected, key)
    else:
        # A small initial sample is expandable by requested names or category.
        fresh = [crop for crop in crops if "vegetables" in _categories(crop, groups)]
        fresh = _prioritize_category(fresh, "vegetables")
        dals = [crop for crop in crops if "dals" in _categories(crop, groups)]
        dals.sort(key=lambda crop: ("gram" not in _words(crop["cmdt_name"]), crop["cmdt_id"]))
        selected = fresh[:3] + dals[:5]
    unique = {crop["cmdt_id"]: crop for crop in selected}
    return list(unique.values())


def _market_for(crop: dict[str, Any], groups: dict[Any, str], markets: list[dict[str, Any]]) -> dict[str, Any] | None:
    group = groups.get(crop.get("cmdt_group_id"), "")
    name = _words(crop["cmdt_name"])
    if group in {"vegetables", "fruits"} and name not in {"onion", "potato", "garlic"}:
        return next((market for market in markets if "binny mill" in _words(market.get("mkt_name"))), None)
    if group in {"pulses", "cereals", "vegetables", "spices", "oil seeds"}:
        return next((market for market in markets if _words(market.get("mkt_name")) == "bengaluru apmc"), None)
    return None


def _normalize_report(payload: dict[str, Any], crop: dict[str, Any], market: dict[str, Any], state: str, district: str, today: date) -> list[dict[str, Any]]:
    if payload.get("success") is not True or not isinstance(payload.get("data"), list):
        return []
    title = _words(payload.get("title", ""))
    if _words(state) not in title or _words(market["mkt_name"]) not in title:
        return []
    rows = []
    for item in payload["data"][:100]:
        if not isinstance(item, dict) or _words(item.get("unitOfPrice")) not in {"rs quintal", "rs quintals", "inr quintal"}:
            continue
        label = str(item.get("variety", "")).strip()
        prefix, separator, variety = label.partition(" - ")
        if not separator or _words(prefix) != _words(crop["cmdt_name"]) or _words(variety) in {"", "unknown", "nr"}:
            continue
        for day_text, raw_price in item.items():
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day_text):
                continue
            try:
                day = date.fromisoformat(day_text)
                price = float(raw_price)
            except (TypeError, ValueError):
                continue
            if isinstance(raw_price, bool) or not math.isfinite(price) or price <= 0 or not 0 <= (today - day).days <= 7:
                continue
            rows.append({
                "state": state, "district": district, "market": market["mkt_name"], "commodity": crop["cmdt_name"],
                "variety": variety.strip(), "grade": "", "arrival_date": day.isoformat(),
                "modal_price": price, "min_price": None, "max_price": None, "unit": "INR/quintal", "source": SOURCE,
            })
    return rows


def _get_official_history(state: str, commodity_names: list[str] | None = None, category: str | None = None) -> dict[str, Any] | None:
    deadline = time.monotonic() + 22
    try:
        metadata = _get_metadata()
        matched_state = next((item for item in metadata.get("state_data", []) if _words(item.get("state_name")) == _words(state)), None)
        if matched_state is None:
            return None
        state_name, state_id = matched_state["state_name"], matched_state["state_id"]
        markets = [item for item in metadata.get("market_data", []) if item.get("state_id") == state_id]
        groups = {item["id"]: _words(item.get("cmdt_grp_name")) for item in metadata.get("cmdt_group_data", [])}
        crops = [item for item in metadata.get("cmdt_data", []) if isinstance(item.get("cmdt_id"), int) and item.get("cmdt_name")]
        selected = _select_crops(crops, groups, commodity_names, category)
        pairs = [(crop, market) for crop in selected if (market := _market_for(crop, groups, markets)) is not None][:MAX_REPORT_REQUESTS]
        if not pairs:
            return None
        districts = {item["id"]: item.get("district_name", "") for item in metadata.get("district_data", []) if item.get("state_id") == state_id}
        now = datetime.now(timezone.utc)
        attempted = []

        def fetch(pair):
            crop, market = pair
            remaining = deadline - time.monotonic()
            if remaining < .3:
                return []
            attempted.append(pair)
            try:
                report = _fetch_json("prices-and-arrivals/commodity-price/lastweek", {"marketId": market["id"], "stateId": state_id, "commodityId": crop["cmdt_id"], "includeExcel": "false"}, timeout=min(8, remaining))
                return _normalize_report(report, crop, market, state_name, districts.get(market.get("district_id"), ""), now.date())
            except (OSError, ValueError, RuntimeError, KeyError, TypeError, AttributeError, subprocess.SubprocessError):
                return []

        executor = ThreadPoolExecutor(max_workers=3)
        futures = [executor.submit(fetch, pair) for pair in pairs]
        done, pending = wait(futures, timeout=max(0, deadline - time.monotonic()))
        for future in pending:
            future.cancel()
        executor.shutdown(wait=True, cancel_futures=True)
        history = [row for future in futures if not future.cancelled() and future.done() for row in future.result()][:1000]
        if not history:
            return None
        fetched_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        dates = sorted({row["arrival_date"] for row in history})
        covered = sorted({row["commodity"] for row in history}, key=str.casefold)
        covered_markets = sorted({row["market"] for row in history})
        queried_markets = sorted({market["mkt_name"] for _, market in attempted})
        warning = (
            f"Newly retrieved official weekly observations dated {dates[0]} to {dates[-1]}, retrieved {fetched_at}. "
            f"Partial coverage: {len(covered)} commodities from {', '.join(covered_markets)}; these are dated observations, "
            "not today's live prices or a statewide cheapest-market comparison. Other crops and markets may have no coverage in these retrieved official reports."
        )
        return {
            "history": history, "source": SOURCE, "mode": "cached", "stale": True,
            "updated_at": fetched_at, "last_retrieved_at": fetched_at, "observation_dates": dates, "warning": warning,
            "commodity_catalog": sorted({crop["cmdt_name"] for crop in crops}, key=str.casefold),
            "category_catalog": {key: sorted({crop["cmdt_name"] for crop in crops if key in _categories(crop, groups)}, key=str.casefold) for key in ("vegetables", "dals", "pulses", "lentils")},
            "coverage": {"partial": True, "method": "official_weekly_sample", "requested_commodities": [crop["cmdt_name"] for crop in selected], "queried_commodities": [crop["cmdt_name"] for crop, _ in attempted], "covered_commodities": covered, "covered_markets": covered_markets, "queried_markets": queried_markets, "total_state_markets": len(markets), "report_requests": len(attempted), "catalog_complete": True, "note": warning},
        }
    except (OSError, ValueError, RuntimeError, KeyError, TypeError, AttributeError, subprocess.SubprocessError):
        return None


async def get_official_history(state: str, commodity_names: list[str] | None = None, category: str | None = None) -> dict[str, Any] | None:
    import asyncio
    return await asyncio.to_thread(_get_official_history, state, commodity_names, category)
