"""Exercise shop intent and fresh-crop selection with synthetic market records."""
import unittest

import test_main as fixtures


class ShopIntentTests(unittest.TestCase):
    setUp = fixtures.BackendTests.setUp
    set_feed = fixtures.BackendTests.set_feed
    chat = fixtures.BackendTests.chat
    history = fixtures.BackendTests.history

    shop_prompt = (
        "I am opening a vegetable shop in Bengaluru. Make a starter buying plan for "
        "10 different vegetables, total 50 kg, budget Rs 5000, freight Rs 100 per quintal. "
        "Suggest a trial mix, show each weight and cost in a table, and tell me whether "
        "real demand trends are available."
    )

    def test_fresh_beans_and_compact_greenpeas_feed_names_are_vegetables(self):
        for crop in ("French Beans", "Beans", "Green Peas", "greenpeas"):
            with self.subTest(crop=crop):
                self.assertTrue(self.ns["_is_vegetable_commodity"](crop))

    def test_pulses_dried_beans_and_dry_chillies_are_not_fresh_vegetables(self):
        for crop in (
            "Black Gram(Urd Beans)(Whole)",
            "Black Gram Dal(Urd Dal)",
            "Soyabean",
            "Dry Chillies",
            "Dry Chilli",
            "Cowpea (Whole)",
            "Dried Beans",
            "Dry Beans",
        ):
            with self.subTest(crop=crop):
                self.assertFalse(self.ns["_is_vegetable_commodity"](crop))

    def test_exact_shop_request_uses_outlet_destination_and_only_available_fresh_crops(self):
        fresh_prices = {"Tomato": 1000, "French Beans": 2000, "Beans": 1500, "greenpeas": 2500}
        rows = [fixtures.row(crop, "Mysore", price) for crop, price in fresh_prices.items()]
        rows += [
            fixtures.row("Tomato", "Bengaluru", 9000),
            fixtures.row("Black Gram(Urd Beans)(Whole)", price=100),
            fixtures.row("Black Gram Dal(Urd Dal)", price=100),
            fixtures.row("Soyabean", price=100),
            fixtures.row("Dry Chillies", price=100),
            fixtures.row("Cowpea (Whole)", price=100),
            fixtures.row("Dried Beans", price=100),
        ]
        self.set_feed(rows)
        result = self.chat(self.shop_prompt)
        self.assertIn("plan", result)
        plan = result["plan"]
        self.assertTrue(plan["multi_commodity"])
        self.assertEqual(plan["destination"], "Bengaluru")
        self.assertEqual(plan["budget_inr"], 5000)
        self.assertEqual(plan["freight_inr_per_quintal"], 100)
        self.assertEqual({item["commodity"] for item in plan["ranking"]}, set(fresh_prices))
        self.assertEqual({item["market"] for item in plan["ranking"]}, {"Mysore"})
        self.assertEqual(sum(item["suggested_kg"] for item in plan["ranking"]), 50)
        self.assertTrue(all(item["suggested_kg"] == 12.5 for item in plan["ranking"]))
        self.assertEqual(sum(item["estimated_total_inr"] for item in plan["ranking"]), 925)
        self.assertTrue(all(item["within_budget"] for item in plan["ranking"]))
        comparison = result["comparison"]
        self.assertEqual(comparison["display"], "table")
        self.assertEqual(comparison["count"], 4)
        self.assertTrue(comparison["include_weights"])
        self.assertTrue(all("suggested_kg" in item and "estimated_total_inr" in item for item in comparison["records"]))
        self.assertRegex(result["answer"], r"\b4 vegetable")
        self.assertRegex(result["answer"].lower(), r"(?:not|cannot|unavailable|do not|does not).{0,40}demand|demand.{0,40}(?:not|unavailable)")

    def test_explicit_buy_from_market_still_limits_shop_sources(self):
        self.set_feed([
            fixtures.row("Tomato", "Mysore", 1000),
            fixtures.row("Onion", "Mysore", 2000),
            fixtures.row("Tomato", "Bengaluru", 3000),
            fixtures.row("Onion", "Bengaluru", 4000),
        ])
        result = self.chat(self.shop_prompt + " Buy from Bengaluru market.")
        self.assertIn("plan", result)
        plan = result["plan"]
        self.assertEqual(plan["destination"], "Bengaluru")
        self.assertEqual({item["market"] for item in plan["ranking"]}, {"Bengaluru"})
        self.assertEqual({item["commodity"] for item in plan["ranking"]}, {"Tomato", "Onion"})
        self.assertEqual(sum(item["estimated_total_inr"] for item in plan["ranking"]), 1800)


if __name__ == "__main__":
    unittest.main()
