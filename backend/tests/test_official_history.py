"""Validate bounded official-weekly parsing with synthetic HTTP responses."""
from datetime import date, timedelta
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("official_history_under_test", Path(__file__).parents[1] / "app" / "official_history.py")
official = importlib.util.module_from_spec(spec)
spec.loader.exec_module(official)


class OfficialHistoryTests(unittest.TestCase):
    def setUp(self):
        self.metadata = {
            "state_data": [{"state_id": 16, "state_name": "Karnataka"}],
            "market_data": [
                {"id": 99, "mkt_name": "Bengaluru APMC", "state_id": 16, "district_id": 243},
                {"id": 100, "mkt_name": "Binny Mill (FF&V) Bengaluru APMC", "state_id": 16, "district_id": 243},
            ],
            "district_data": [{"id": 243, "state_id": 16, "district_name": "Bengaluru Urban"}],
            "cmdt_group_data": [{"id": 6, "cmdt_grp_name": "Vegetables"}, {"id": 2, "cmdt_grp_name": "Pulses"}, {"id": 1, "cmdt_grp_name": "Cereals"}],
            "cmdt_data": [
                {"cmdt_id": 65, "cmdt_name": "Tomato", "cmdt_group_id": 6},
                {"cmdt_id": 23, "cmdt_name": "Onion", "cmdt_group_id": 6},
                {"cmdt_id": 24, "cmdt_name": "Potato", "cmdt_group_id": 6},
                {"cmdt_id": 3, "cmdt_name": "Rice", "cmdt_group_id": 1},
                {"cmdt_id": 219, "cmdt_name": "Green Gram Dal(Moong Dal)", "cmdt_group_id": 2},
                *[{"cmdt_id": 900 + index, "cmdt_name": f"Custom Gram Dal {index}", "cmdt_group_id": 2} for index in range(12)],
            ],
        }
        self.report_calls = []

    def fake_fetch(self, path, params=None, timeout=8):
        if path == "daily-price-arrival/filters":
            return {"status": True, "data": self.metadata}
        self.report_calls.append((params, timeout))
        crop = next(item for item in self.metadata["cmdt_data"] if item["cmdt_id"] == params["commodityId"])
        market = next(item for item in self.metadata["market_data"] if item["id"] == params["marketId"])
        return {
            "success": True,
            "title": f"Commodity Prices During Last Week Market: {market['mkt_name']}, State/UT: Karnataka",
            "data": [{"variety": crop["cmdt_name"] + " - Local", "unitOfPrice": "Rs./Quintal", (date.today() - timedelta(days=1)).isoformat(): 1234}],
        }

    def run_history(self, **kwargs):
        with patch.object(official, "_get_metadata", return_value=self.metadata), patch.object(official, "_fetch_json", side_effect=self.fake_fetch):
            return official._get_official_history("Karnataka", **kwargs)

    def test_default_is_explicitly_partial_and_catalog_is_not_restricted_to_sample(self):
        result = self.run_history()
        self.assertEqual(len(self.report_calls), 8)
        self.assertTrue(result["stale"])
        self.assertEqual(result["mode"], "cached")
        self.assertEqual(result["source"], official.SOURCE)
        self.assertTrue(all(row["source"] == official.SOURCE for row in result["history"]))
        self.assertTrue(all(row["min_price"] is None and row["max_price"] is None for row in result["history"]))
        self.assertTrue(result["coverage"]["partial"])
        self.assertIn("not today's live prices", result["warning"])
        self.assertIn("statewide", result["warning"])
        self.assertEqual(set(result["commodity_catalog"]), {crop["cmdt_name"] for crop in self.metadata["cmdt_data"]})

    def test_on_demand_crop_outside_default_sample_uses_dynamic_catalog(self):
        result = self.run_history(commodity_names=["custom gram dal 11"])
        self.assertEqual({row["commodity"] for row in result["history"]}, {"Custom Gram Dal 11"})
        self.assertEqual(self.report_calls[0][0]["commodityId"], 911)

    def test_case_and_compact_moong_dal_aliases_do_not_fetch_whole_products(self):
        result = self.run_history(commodity_names=["MoongDal", "RICE", "tomatoes"])
        self.assertEqual({row["commodity"] for row in result["history"]}, {"Green Gram Dal(Moong Dal)", "Rice", "Tomato"})

    def test_category_breadth_is_dynamic_and_capped_at_ten_requests(self):
        result = self.run_history(category="dals")
        self.assertEqual(len(self.report_calls), 10)
        self.assertEqual(len(result["category_catalog"]["dals"]), 13)
        self.assertEqual(len(result["coverage"]["requested_commodities"]), 13)
        self.assertTrue(all(timeout <= 8 for _, timeout in self.report_calls))

    def test_vegetable_category_prioritizes_reporting_core_before_alphabetical_entries(self):
        self.metadata["cmdt_data"] = [
            *[{"cmdt_id": 1000 + index, "cmdt_name": f"Aloe Variety {index}", "cmdt_group_id": 6} for index in range(12)],
            *self.metadata["cmdt_data"],
        ]
        selected = official._select_crops(self.metadata["cmdt_data"], {6: "vegetables", 2: "pulses", 1: "cereals"}, None, "vegetables")
        self.assertEqual([crop["cmdt_id"] for crop in selected[:3]], [65, 23, 24])
        result = self.run_history(category="vegetables")
        queried = [params["commodityId"] for params, _ in self.report_calls]
        self.assertTrue({65, 23, 24} <= set(queried))
        self.assertEqual(len(queried), 10)
        self.assertTrue({"Tomato", "Onion", "Potato"} <= set(result["coverage"]["covered_commodities"]))
        self.assertIn("Aloe Variety 11", result["category_catalog"]["vegetables"])

    def test_fresh_category_excludes_processed_meal_and_chunks_but_keeps_raw_gram(self):
        groups = {6: "vegetables"}
        for name in ("Meal Maker(Soya Chunks)", "SoyaChunks", "Onion Flakes", "Processed Beans", "Dehydrated Carrot", "Dry Chilli"):
            with self.subTest(name=name):
                self.assertNotIn("vegetables", official._categories({"cmdt_name": name, "cmdt_group_id": 6}, groups))
        self.assertIn("vegetables", official._categories({"cmdt_name": "Gram Raw", "cmdt_group_id": 6}, groups))

    def test_common_fresh_families_are_distinct_before_alias_variants(self):
        names = ["Onion Green", "Tomato", "Onion", "Potato", "Carrot", "Brinjal", "Beetroot", "Cabbage", "Cauliflower", "Bhindi(Ladies Finger)", "Cucumber(Kheera)"]
        crops = [{"cmdt_id": index, "cmdt_name": name} for index, name in enumerate(names)]
        prioritized = official._prioritize_category(crops, "vegetables")
        self.assertEqual([crop["cmdt_name"] for crop in prioritized[:3]], ["Tomato", "Onion", "Potato"])
        self.assertNotIn("Onion Green", [crop["cmdt_name"] for crop in prioritized[:10]])
        self.assertEqual({crop["cmdt_name"] for crop in prioritized}, set(names))

    def test_pulse_category_prioritizes_common_reporting_dals_without_losing_catalog(self):
        names = ["Avare Dal", "Masur Dal", "Green Gram Dal(Moong Dal)", "Black Gram Dal(Urd Dal)", "Bengal Gram Dal(Chana Dal)", "Red gram split/Arhar dal/Tur dal"]
        crops = [{"cmdt_id": index, "cmdt_name": name} for index, name in enumerate(names)]
        prioritized = official._prioritize_category(crops, "dals")
        self.assertEqual([crop["cmdt_name"] for crop in prioritized[:4]], list(reversed(names[2:])))
        self.assertEqual({crop["cmdt_name"] for crop in prioritized}, set(names))

    def test_nr_invalid_prices_wrong_units_and_dates_are_not_fabricated(self):
        crop, market = self.metadata["cmdt_data"][0], self.metadata["market_data"][1]
        today = date.today()
        report = {"success": True, "title": f"{market['mkt_name']} State/UT: Karnataka", "data": [
            {"variety": "Tomato - Local", "unitOfPrice": "Rs./Quintal", today.isoformat(): 1700, (today - timedelta(days=1)).isoformat(): "NR", (today - timedelta(days=2)).isoformat(): -1, (today - timedelta(days=3)).isoformat(): float("inf"), (today - timedelta(days=4)).isoformat(): True, (today - timedelta(days=8)).isoformat(): 1500, (today + timedelta(days=1)).isoformat(): 1900},
            {"variety": "Unknown", "unitOfPrice": "Rs./Quintal", today.isoformat(): 1000},
            {"variety": "Tomato - Hybrid", "unitOfPrice": "Rs./Kg", today.isoformat(): 17},
        ]}
        rows = official._normalize_report(report, crop, market, "Karnataka", "Bengaluru Urban", today)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["modal_price"], 1700)
        self.assertEqual(rows[0]["arrival_date"], today.isoformat())

    def test_no_rows_or_wrong_state_is_not_a_fake_feed(self):
        self.assertIsNone(self.run_history(commodity_names=["Unlisted Crop"]))
        with patch.object(official, "_get_metadata", return_value=self.metadata):
            self.assertIsNone(official._get_official_history("Unlisted State"))

    def test_metadata_is_cached_for_repeated_requests(self):
        original = official._metadata
        try:
            official._metadata = None
            with patch.object(official, "_fetch_json", side_effect=self.fake_fetch) as fetch:
                self.assertEqual(official._get_metadata(), self.metadata)
                self.assertEqual(official._get_metadata(), self.metadata)
                self.assertEqual(fetch.call_count, 1)
        finally:
            official._metadata = original

    def test_warning_names_only_markets_with_actual_observations(self):
        def fetch(path, params=None, timeout=8):
            if params["marketId"] == 100:
                return {"success": True, "title": "Binny Mill (FF&V) Bengaluru APMC State/UT: Karnataka", "data": []}
            return self.fake_fetch(path, params, timeout)
        with patch.object(official, "_get_metadata", return_value=self.metadata), patch.object(official, "_fetch_json", side_effect=fetch):
            result = official._get_official_history("Karnataka")
        self.assertNotIn("Binny Mill", result["warning"])
        self.assertEqual(result["coverage"]["covered_markets"], ["Bengaluru APMC"])
        self.assertIn("Binny Mill (FF&V) Bengaluru APMC", result["coverage"]["queried_markets"])

    def test_malformed_metadata_does_not_raise_an_application_error(self):
        with patch.object(official, "_get_metadata", return_value={"state_data": [None]}):
            self.assertIsNone(official._get_official_history("Karnataka"))

    def test_expired_batch_preserves_completed_rows_and_skips_unstarted_reports(self):
        calls = iter([0, 1])
        def clock():
            return next(calls, 23)
        with patch.object(official.time, "monotonic", side_effect=clock):
            result = self.run_history()
        self.assertIsNotNone(result)
        self.assertEqual(len(self.report_calls), 1)
        self.assertEqual(result["coverage"]["report_requests"], 1)


if __name__ == "__main__":
    unittest.main()
