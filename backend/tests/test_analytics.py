import importlib.util
from datetime import date, timedelta
from pathlib import Path
import unittest


SPEC = importlib.util.spec_from_file_location("analytics_under_test", Path(__file__).parents[1] / "app" / "analytics.py")
analytics = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(analytics)


class PriceAnalyticsTests(unittest.TestCase):
    def row(self, days_ago, price, **changes):
        row = {
            "state": "Karnataka",
            "district": "District A",
            "market": "Market A",
            "commodity": "Tomato",
            "variety": "Local",
            "grade": "FAQ",
            "arrival_date": (date.today() - timedelta(days=days_ago)).isoformat(),
            "modal_price": price,
        }
        row.update(changes)
        return row

    def analyze(self, rows):
        return analytics.analyze_prices(rows, len(rows), "live")

    def test_duplicate_feed_rows_do_not_change_daily_price(self):
        rows = [self.row(0, 100, variety="A"), self.row(0, 900, variety="B")]
        baseline = self.analyze(rows)
        repeated = self.analyze(rows + [dict(rows[0])])
        self.assertEqual(baseline["trend"], repeated["trend"])
        self.assertEqual(repeated["trend"][0]["modal_price"], 500)
        self.assertEqual(repeated["quality"]["duplicate_records"], 1)

    def test_grades_and_districts_remain_distinct(self):
        grades = self.analyze([self.row(0, 100, grade="A"), self.row(0, 900, grade="B")])
        self.assertEqual(grades["quality"]["duplicate_records"], 0)
        self.assertEqual(grades["trend"][0]["modal_price"], 500)
        districts = self.analyze([self.row(0, 100), self.row(0, 900, district="District B")])
        self.assertEqual(districts["quality"]["duplicate_records"], 0)
        self.assertEqual(districts["trend"][0]["markets_reporting"], 2)

    def test_duplicate_identity_ignores_case_and_surrounding_spaces(self):
        rows = [self.row(0, 100), self.row(0, 100, market=" market a ", commodity=" TOMATO ")]
        result = self.analyze(rows)
        self.assertEqual(result["quality"]["duplicate_records"], 1)
        self.assertEqual(len(result["trend"]), 1)

    def test_seven_day_movement_compares_consecutive_calendar_weeks(self):
        rows = [self.row(offset, 200 if offset < 7 else 100) for offset in range(14)]
        result = self.analyze(list(reversed(rows)))
        self.assertEqual(result["movement_7d_percent"], 100)

    def test_weekly_observations_cannot_claim_seven_day_movement(self):
        rows = [self.row(offset * 7, 200 if offset < 7 else 100) for offset in range(14)]
        self.assertIsNone(self.analyze(rows)["movement_7d_percent"])

    def test_missing_day_in_calendar_window_requires_more_data(self):
        rows = [self.row(offset, 100) for offset in range(15) if offset != 4]
        self.assertIsNone(self.analyze(rows)["movement_7d_percent"])

    def test_older_gap_does_not_hide_complete_recent_calendar_windows(self):
        rows = [self.row(offset, 200 if offset < 7 else 100) for offset in range(22) if offset != 18]
        self.assertEqual(self.analyze(rows)["movement_7d_percent"], 100)

    def test_old_history_cannot_produce_a_ready_forecast_in_the_past(self):
        rows = [self.row(80 + offset, 100 + offset) for offset in range(21)]
        forecast = self.analyze(rows)["forecast"]
        self.assertEqual(forecast["status"], "stale_history")
        self.assertEqual(forecast["points"], [])
        self.assertIn("last three days", forecast["message"])

    def test_current_history_produces_a_seven_day_forecast(self):
        rows = [self.row(offset, 100) for offset in range(21)]
        forecast = self.analyze(rows)["forecast"]
        self.assertEqual(forecast["status"], "ready")
        self.assertEqual(len(forecast["points"]), 7)
        self.assertEqual(forecast["points"][0]["date"], (date.today() + timedelta(days=1)).isoformat())
        self.assertEqual(forecast["points"][-1]["date"], (date.today() + timedelta(days=7)).isoformat())

    def test_mixed_crop_sampling_cannot_appear_as_price_movement(self):
        rows = [self.row(offset, 100, commodity="Onion") for offset in range(21)]
        rows += [self.row(offset, 1900, commodity="Garlic") for offset in range(7)]
        result = self.analyze(rows)
        self.assertEqual(result["trend"], [])
        self.assertIsNone(result["movement_7d_percent"])
        self.assertEqual(result["forecast"]["status"], "insufficient_comparable_data")
        self.assertEqual(result["forecast"]["points"], [])
        self.assertEqual(result["quality"]["records_received"], 28)
        self.assertEqual(result["quality"]["usable_records"], 28)


if __name__ == "__main__":
    unittest.main()
