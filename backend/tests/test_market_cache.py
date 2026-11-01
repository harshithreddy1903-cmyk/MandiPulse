"""Official snapshots are bounded, validated, dated, and credential-free."""
from datetime import datetime, timedelta, timezone
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("market_cache", Path(__file__).resolve().parents[1] / "app" / "market_cache.py")
cache = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cache)


class MarketCacheTests(unittest.TestCase):
    now = datetime(2026, 10, 31, 12, tzinfo=timezone.utc)

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "snapshot.json"
        self.feed = {"mode": "live", "source": "data.gov.in · AGMARKNET", "updated_at": "2026-10-31T11:00:00Z", "history": [{"state": "Karnataka", "district": "Bengaluru", "market": "Bengaluru", "commodity": "Tomato", "variety": "Local", "grade": "FAQ", "arrival_date": "29/10/2026", "modal_price": 1700, "min_price": None, "max_price": 1900, "unit": "INR/quintal", "source": "AGMARKNET · data.gov.in", "api-key": "MUST_NOT_PERSIST"}], "coverage": {"partial": False}, "api_key": "MUST_NOT_PERSIST"}

    def save(self):
        return cache.save_market_cache(self.path, "Karnataka", self.feed, self.now)

    def load(self):
        return cache.load_market_cache(self.path, "Karnataka", self.now)


    def test_vercel_uses_temporary_writable_cache_directory(self):
        project = Path(self.directory.name) / "readonly-project"
        temporary = Path(self.directory.name) / "temporary"
        with patch.dict(cache.os.environ, {"VERCEL": "1"}), patch.object(cache.tempfile, "gettempdir", return_value=str(temporary)):
            self.assertEqual(cache.get_market_cache_path(project), temporary / "mandipulse" / "market-feed-cache.json")

    def test_local_cache_location_is_preserved(self):
        project = Path(self.directory.name) / "project"
        with patch.dict(cache.os.environ, {"VERCEL": "0"}):
            self.assertEqual(cache.get_market_cache_path(project), project / ".local" / "market-feed-cache.json")

    def test_fresh_success_saves_only_official_whitelisted_fields(self):
        self.assertTrue(self.save())
        content = self.path.read_text(encoding="utf-8")
        self.assertNotIn("MUST_NOT_PERSIST", content)
        result = self.load()
        self.assertEqual(result["mode"], "cached")
        self.assertTrue(result["stale"])
        self.assertEqual(result["history"][0]["modal_price"], 1700)
        self.assertEqual(result["observation_dates"], ["2026-10-29"])
        self.assertIn("2026-10-31T11:00:00Z", result["warning"])

    def test_stale_retrieval_and_observation_dates_are_refused(self):
        self.feed["updated_at"] = "2026-10-23T11:00:00Z"
        self.assertFalse(self.save())
        self.feed["updated_at"] = "2026-10-31T11:00:00Z"
        self.feed["history"][0]["arrival_date"] = "23/10/2026"
        self.assertFalse(self.save())

    def test_corrupt_missing_oversized_cache_is_ignored(self):
        self.assertIsNone(self.load())
        for content in ["not json", "[]", "{}", " " * (cache.MAX_BYTES + 1)]:
            self.path.write_text(content, encoding="utf-8")
            self.assertIsNone(self.load())

    def test_wrong_state_future_date_and_nonpositive_prices_are_refused(self):
        row = self.feed["history"][0]
        for key, value in [("state", "Maharashtra"), ("arrival_date", "01/11/2026"), ("modal_price", 0), ("modal_price", -1), ("modal_price", float("inf")), ("source", "Synthetic browser QA fixture")]:
            original = row[key]
            row[key] = value
            self.assertFalse(self.save(), (key, value))
            row[key] = original

    def test_synthetic_feed_and_future_retrieval_are_never_saved(self):
        self.feed["source"] = "Synthetic browser QA fixture"
        self.assertFalse(self.save())
        self.feed["source"] = "data.gov.in · AGMARKNET"
        self.feed["updated_at"] = "2026-11-01T11:00:00Z"
        self.assertFalse(self.save())

    def test_load_revalidates_payload_records_and_timestamp(self):
        self.assertTrue(self.save())
        payload = json.loads(self.path.read_text(encoding="utf-8"))
        payload["records"][0]["state"] = "Other state"
        self.path.write_text(json.dumps(payload), encoding="utf-8")
        self.assertIsNone(self.load())
        self.assertTrue(self.save())
        self.assertIsNone(cache.load_market_cache(self.path, "Karnataka", self.now + timedelta(days=8)))

    def test_weekly_source_and_catalog_survive_with_partial_warning(self):
        self.feed.update({"mode": "cached", "source": "AGMARKNET · official weekly report", "commodity_catalog": ["Rice", "Tomato", {"api_key": "MUST_NOT_PERSIST"}], "coverage": {"partial": True}})
        self.feed["history"][0]["source"] = self.feed["source"]
        self.assertTrue(self.save())
        result = self.load()
        self.assertIn("partial", result["warning"])
        self.assertEqual(result["commodity_catalog"], ["Rice", "Tomato"])

    def test_structurally_corrupt_metadata_is_ignored(self):
        self.assertTrue(self.save())
        payload = json.loads(self.path.read_text(encoding="utf-8"))
        for value in [[], {}, None, 1]:
            payload["source"] = value
            self.path.write_text(json.dumps(payload), encoding="utf-8")
            self.assertIsNone(self.load())

    def test_official_category_names_survive_cache_without_extra_metadata(self):
        self.feed["commodity_catalog"] = ["Alsandikai", "Tomato"]
        self.feed["category_catalog"] = {"vegetables": ["Alsandikai", "Tomato", {"api_key": "MUST_NOT_PERSIST"}], "unknown": ["MUST_NOT_PERSIST"]}
        self.assertTrue(self.save())
        result = self.load()
        self.assertEqual(result["category_catalog"], {"vegetables": ["Alsandikai", "Tomato"]})
        self.assertNotIn("MUST_NOT_PERSIST", self.path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
