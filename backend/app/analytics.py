from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from statistics import median
from typing import Any


def parse_date(value: Any) -> date | None:
    if not value:
        return None
    raw = str(value).strip()
    for pattern in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d-%b-%Y", "%d %b %Y"):
        try:
            return datetime.strptime(raw, pattern).date()
        except ValueError:
            pass
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).date()
    except ValueError:
        return None


def _mae(actual: list[float], predicted: list[float]) -> float:
    return sum(abs(a - p) for a, p in zip(actual, predicted)) / len(actual) if actual else 0.0


def _smape(actual: list[float], predicted: list[float]) -> float | None:
    if not actual:
        return None
    terms = [2 * abs(a - p) / (abs(a) + abs(p)) for a, p in zip(actual, predicted) if abs(a) + abs(p) > 0]
    return (100 * sum(terms) / len(terms)) if terms else None


def _movement_7d(series: list[dict[str, Any]]) -> float | None:
    if len(series) < 14:
        return None
    dated = {parse_date(point["date"]): float(point["modal_price"]) for point in series}
    dated.pop(None, None)
    if not dated:
        return None
    last_day = max(dated)
    days = [last_day - timedelta(days=offset) for offset in range(14)]
    if any(day not in dated for day in days):
        return None
    recent = median([dated[day] for day in days[:7]])
    previous = median([dated[day] for day in days[7:]])
    return round(100 * (recent - previous) / previous, 2) if previous else None


def _forecast(series: list[dict[str, Any]], minimum_history: int = 21) -> dict[str, Any]:
    dates = [parse_date(point["date"]) for point in series]
    gaps = [(right - left).days for left, right in zip(dates, dates[1:]) if left and right]
    if len(series) < minimum_history or (gaps and max(gaps) > 7):
        return {
            "status": "insufficient_history",
            "minimum_observations": minimum_history,
            "observations": len(series),
            "message": f"Need at least {minimum_history} observations with no gap longer than seven days before producing a forecast.",
            "evaluation": None,
            "points": [],
        }

    last_date = dates[-1]
    if last_date is None or (date.today() - last_date).days > 3:
        return {
            "status": "stale_history",
            "minimum_observations": minimum_history,
            "observations": len(series),
            "message": "A current forecast needs a price observation from the last three days.",
            "evaluation": None,
            "points": [],
        }

    values = [float(point["modal_price"]) for point in series]
    test_size = min(14, len(values) - 7)
    start = len(values) - test_size
    actual = values[start:]
    last_value_predictions = [values[index - 1] for index in range(start, len(values))]
    rolling_median_predictions = [median(values[index - 7:index]) for index in range(start, len(values))]
    scale_values = values[:start]
    scale = sum(abs(right - left) for left, right in zip(scale_values, scale_values[1:])) / max(1, len(scale_values) - 1)

    def metrics(predictions: list[float]) -> dict[str, float | None]:
        error = _mae(actual, predictions)
        return {"mae_inr_per_quintal": round(error, 2), "smape_percent": round(_smape(actual, predictions) or 0, 2), "mase": round(error / scale, 4) if scale else None}

    candidates = {
        "last_observation": last_value_predictions,
        "rolling_median_7": rolling_median_predictions,
    }
    evaluation = {name: metrics(predictions) for name, predictions in candidates.items()}
    selected_name = min(candidates, key=lambda name: float(evaluation[name]["mae_inr_per_quintal"]))
    selected_predictions = candidates[selected_name]
    absolute_errors = sorted(abs(a - p) for a, p in zip(actual, selected_predictions))
    interval_error = absolute_errors[min(len(absolute_errors) - 1, int(0.9 * (len(absolute_errors) - 1)))] if absolute_errors else 0
    next_value = values[-1] if selected_name == "last_observation" else median(values[-7:])
    points = []
    for offset in range(1, 8):
        forecast_date = last_date + timedelta(days=offset)
        points.append({
            "date": forecast_date.isoformat(),
            "median": round(next_value, 2),
            "lower": round(max(0, next_value - interval_error), 2),
            "upper": round(next_value + interval_error, 2),
        })
    return {
        "status": "ready",
        "model": selected_name,
        "observations": len(values),
        "horizon_days": 7,
        "evaluation_window_observations": test_size,
        "selected_metrics": evaluation[selected_name],
        "baselines": evaluation,
        "interval_method": "empirical 90th percentile of rolling-origin absolute errors; indicative, not a guarantee",
        "points": points,
    }


def analyze_prices(records: list[dict[str, Any]], raw_count: int, mode: str) -> dict[str, Any]:
    if mode not in {"live", "cached"}:
        demo_market_daily: dict[tuple[str, str], list[float]] = defaultdict(list)
        for row in records:
            day = parse_date(row.get("arrival_date"))
            if day:
                demo_market_daily[(day.isoformat(), str(row.get("market", "")))].append(float(row["modal_price"]))
        demo_grouped: dict[str, list[float]] = defaultdict(list)
        for (day, _market), prices in demo_market_daily.items():
            demo_grouped[day].append(median(prices))
        demo_trend = [{"date": day, "modal_price": round(median(values), 2), "markets_reporting": len(values)} for day, values in sorted(demo_grouped.items())]
        demo_forecast = _forecast(demo_trend)
        demo_forecast["status"] = "demo_only"
        movement = _movement_7d(demo_trend)
        return {
            "quality": {"label": "Illustrative", "score": None, "records_received": raw_count, "usable_records": len(records), "duplicate_records": 0, "stale_records": 0, "outlier_records": 0, "note": "Sample values are not a data-quality assessment."},
            "trend": demo_trend,
            "movement_7d_percent": movement,
            "forecast": demo_forecast,
        }

    grouped_market_daily: dict[tuple[str, str], list[float]] = defaultdict(list)
    keys: set[tuple[str, ...]] = set()
    commodities: set[str] = set()
    duplicate_count = 0
    stale_count = 0
    invalid_date_count = 0
    future_date_count = 0
    prices_by_market: dict[str, list[float]] = defaultdict(list)
    today = date.today()
    for row in records:
        day = parse_date(row.get("arrival_date"))
        price = float(row["modal_price"])
        if day is None:
            invalid_date_count += 1
            continue
        if day > today:
            future_date_count += 1
            continue
        if (today - day).days > 3:
            stale_count += 1
        identity = tuple(str(row.get(field, "")).strip().casefold() for field in ("state", "district", "market", "commodity", "variety", "grade"))
        key = (*identity, day.isoformat())
        if key in keys:
            duplicate_count += 1
            continue
        keys.add(key)
        commodities.add(identity[3])
        market = "\x1f".join(identity[:3])
        grouped_market_daily[(day.isoformat(), market)].append(price)
        prices_by_market[market].append(price)

    grouped_daily: dict[str, list[float]] = defaultdict(list)
    for (day, _market), market_prices in grouped_market_daily.items():
        grouped_daily[day].append(median(market_prices))
    trend = [{"date": day, "modal_price": round(median(values), 2), "markets_reporting": len(values)} for day, values in sorted(grouped_daily.items())]
    valid_count = len(records) - invalid_date_count - future_date_count
    completeness = valid_count / max(1, raw_count)
    uniqueness = max(0.0, 1 - duplicate_count / max(1, len(records)))
    freshness = max(0.0, 1 - stale_count / max(1, valid_count))
    score = round(100 * (0.5 * completeness + 0.25 * uniqueness + 0.25 * freshness))

    outliers = 0
    for values in prices_by_market.values():
        if len(values) < 5:
            continue
        center = median(values)
        mad = median([abs(value - center) for value in values])
        if mad == 0:
            continue
        outliers += sum(1 for value in values if abs(0.6745 * (value - center) / mad) > 3.5)

    if score >= 85:
        label = "Strong"
    elif score >= 65:
        label = "Watch"
    else:
        label = "Low"
    quality = {
        "label": label,
        "score": score,
        "records_received": raw_count,
        "usable_records": valid_count,
        "duplicate_records": duplicate_count,
        "invalid_date_records": invalid_date_count,
        "future_date_records": future_date_count,
        "stale_records_over_3_days": stale_count,
        "outlier_records": outliers,
        "note": "Weighted completeness, uniqueness, and recency indicator; it is not a source certification.",
    }

    if len(commodities) > 1:
        return {
            "quality": quality,
            "trend": [],
            "movement_7d_percent": None,
            "forecast": {
                "status": "insufficient_comparable_data",
                "observations": len(trend),
                "message": "Select a single commodity to compare prices over time; prices for different crops are not comparable.",
                "evaluation": None,
                "points": [],
            },
        }

    return {
        "quality": quality,
        "trend": trend,
        "movement_7d_percent": _movement_7d(trend),
        "forecast": _forecast(trend),
    }
