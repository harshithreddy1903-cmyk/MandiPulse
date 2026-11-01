"""Check pulse categories and mixed-plan follow-ups without live services."""
import json
import unittest

import test_main as fixtures


class PulseCategoryTests(unittest.TestCase):
    set_feed = fixtures.BackendTests.set_feed
    chat = fixtures.BackendTests.chat
    history = fixtures.BackendTests.history

    dal_prices = {
        "Black Gram Dal(Urd Dal)": 8000,
        "Green Gram Dal (Moong Dal)": 9000,
        "Bengal Gram Dal (Chana Dal)": 7000,
        "Masoor Dal": 6500,
        "Lentil Split": 7500,
    }
    whole_prices = {
        "Black Gram(Urd Beans)(Whole)": 6000,
        "Green Gram (Moong)(Whole)": 5000,
        "Lentil (Masur)(Whole)": 5500,
    }
    lentil_crops = {"Masoor Dal", "Lentil Split", "Lentil (Masur)(Whole)"}

    def setUp(self):
        fixtures.BackendTests.setUp(self)
        rows = [fixtures.row(crop, "Mysore", price) for crop, price in {**self.dal_prices, **self.whole_prices}.items()]
        rows += [
            fixtures.row("Black Gram Dal(Urd Dal)", "Bengaluru", 9500),
            fixtures.row("French Beans", price=2000),
            fixtures.row("greenpeas", price=2500),
            fixtures.row("Rice", price=3000),
            fixtures.row("Soyabean", price=4000),
        ]
        self.set_feed(rows)

        async def unexpected_ai(*args):
            raise AssertionError("A supported pulse-category request must use the official records directly")

        self.ns["_ask_gemini"] = unexpected_ai

    def comparison_crops(self, result):
        self.assertIn("comparison", result)
        return {item["commodity"] for item in result["comparison"]["records"]}

    def test_dal_category_followup_after_vegetable_comparison_uses_real_products(self):
        original = "I am opening a vegetable shop. Show me the available vegetables."
        first = self.chat(original)
        self.assertIn("comparison", first)
        self.assertNotIn("plan", first)
        history = self.history(original) + [{"role": "assistant", "content": first["answer"]}]
        for followup in ("give me for dals", "give me for dal"):
            with self.subTest(followup=followup):
                result = self.chat(followup, history)
                self.assertNotIn("plan", result)
                self.assertEqual(result["comparison"]["commodity"], "Dals")
                self.assertEqual(self.comparison_crops(result), set(self.dal_prices))
                self.assertEqual(result["comparison"]["count"], 5)
                black_gram = [item for item in result["comparison"]["records"] if item["commodity"] == "Black Gram Dal(Urd Dal)"]
                self.assertEqual(len(black_gram), 1)
                self.assertEqual(black_gram[0]["market"], "Mysore")
                self.assertEqual(black_gram[0]["modal_price"], 8000)

    def test_pulses_include_whole_and_processed_products_without_vegetables(self):
        result = self.chat("show pulses prices")
        self.assertNotIn("plan", result)
        self.assertEqual(result["comparison"]["commodity"], "Pulses")
        self.assertEqual(self.comparison_crops(result), set(self.dal_prices) | set(self.whole_prices))
        self.assertEqual(result["comparison"]["count"], 8)

    def test_lentils_are_actual_lentil_and_masoor_products(self):
        result = self.chat("show lentils prices")
        self.assertEqual(result["comparison"]["commodity"], "Lentils")
        self.assertEqual(self.comparison_crops(result), self.lentil_crops)
        self.assertEqual(result["comparison"]["count"], 3)

    def test_dal_followup_reuses_completed_mixed_plan_quantity_and_preferences(self):
        original = (
            "Make a vegetable shop starter buying plan for total 50 kg, budget Rs 5000, "
            "deliver to Bengaluru, freight Rs100 per quintal."
        )
        first = self.chat(original)
        self.assertTrue(first["plan"]["multi_commodity"])
        history = self.history(original) + [{"role": "assistant", "content": first["answer"]}]
        result = self.chat("give me for dals", history)
        self.assertIn("plan", result)
        plan = result["plan"]
        self.assertEqual(plan["commodity"], "Dal starter mix")
        self.assertTrue(plan["multi_commodity"])
        self.assertEqual(plan["quantity_quintals"], .5)
        self.assertEqual(plan["budget_inr"], 5000)
        self.assertEqual(plan["destination"], "Bengaluru")
        self.assertEqual(plan["freight_inr_per_quintal"], 100)
        self.assertEqual({item["commodity"] for item in plan["ranking"]}, set(self.dal_prices))
        self.assertEqual({item["market"] for item in plan["ranking"]}, {"Mysore"})
        self.assertEqual(sum(item["suggested_kg"] for item in plan["ranking"]), 50)
        self.assertTrue(all(item["suggested_kg"] == 10 for item in plan["ranking"]))
        self.assertEqual(sum(item["estimated_total_inr"] for item in plan["ranking"]), 3850)
        self.assertTrue(all(item["within_budget"] for item in plan["ranking"]))
        self.assertRegex((result["answer"] + " " + plan.get("caveat", "")).lower(), r"trial")


    def test_official_vegetable_metadata_accepts_products_outside_local_name_list(self):
        crop = "Alsandikai"
        excluded = ["Black Gram(Urd Beans)(Whole)", "Meal Maker (Soya Chunks)"]
        self.set_feed([fixtures.row(crop), *[fixtures.row(name) for name in excluded]])
        self.feed["category_catalog"] = {"vegetables": [crop, *excluded]}
        result = self.chat("List available vegetable prices in Karnataka in a table.")
        self.assertEqual(self.comparison_crops(result), {crop})
        plan = self.chat("Make a vegetable shop plan for 50 kg")
        self.assertEqual({row["commodity"] for row in plan["plan"]["ranking"]}, {crop})

    def test_moong_dal_does_not_select_the_whole_gram(self):
        result = self.chat("show moong dal prices")
        self.assertEqual(self.comparison_crops(result), {"Green Gram Dal (Moong Dal)"})
        self.assertNotIn("plan", result)

    def test_whole_pulses_exclude_processed_dal_and_split_products(self):
        result = self.chat("show whole pulses prices")
        self.assertEqual(self.comparison_crops(result), set(self.whole_prices))
        self.assertEqual(result["comparison"]["count"], 3)

    def test_contradictory_whole_dal_asks_one_question(self):
        result = self.chat("show whole dal prices")
        self.assertNotIn("plan", result)
        self.assertNotIn("comparison", result)
        self.assertEqual((result["answer"] + " " + result.get("follow_up", "")).count("?"), 1)

    def test_empty_dal_category_does_not_substitute_rice_or_vegetables(self):
        self.set_feed([fixtures.row("Rice"), fixtures.row("French Beans"), fixtures.row("greenpeas")])
        result = self.chat("give me for dals", self.history("show Rice prices"))
        self.assertNotIn("plan", result)
        self.assertFalse(result.get("comparison", {}).get("records"))
        self.assertRegex(result["answer"].lower(), r"no.*dal|dal.*(?:no|not|unavailable)|couldn")

    def test_category_request_replaces_the_previous_rice_crop(self):
        result = self.chat("give me for dals", self.history("show Rice prices"))
        self.assertNotIn("plan", result)
        self.assertEqual(self.comparison_crops(result), set(self.dal_prices))

    def test_plain_vegetable_price_request_is_a_comparison_without_a_plan(self):
        result = self.chat("List available vegetable prices in Karnataka in a table.")
        self.assertNotIn("plan", result)
        self.assertEqual(self.comparison_crops(result), {"French Beans", "greenpeas"})
        self.assertEqual(result["comparison"]["display"], "table")
        self.assertEqual(result["comparison"]["count"], 2)

    def test_mixed_vegetable_then_dal_then_single_tomato_keeps_quantity_and_preferences(self):
        self.set_feed([*self.feed["records"], fixtures.row("Tomato", price=1000)])
        original = (
            "Make a vegetable shop starter buying plan for total 50 kg, budget Rs 5000, "
            "deliver to Bengaluru, freight Rs100 per quintal."
        )
        first = self.chat(original)
        self.assertTrue(first["plan"]["multi_commodity"])
        history = self.history(original) + [{"role": "assistant", "content": first["answer"]}]
        dals = self.chat("same for dals", history)
        self.assertTrue(dals["plan"]["multi_commodity"])
        history += [
            {"role": "user", "content": "same for dals"},
            {"role": "assistant", "content": dals["answer"]},
        ]
        result = self.chat("same for Tomato", history)
        self.assertIn("plan", result)
        plan = result["plan"]
        self.assertEqual(plan["commodity"], "Tomato")
        self.assertFalse(plan.get("multi_commodity", False))
        self.assertEqual(plan["quantity_quintals"], .5)
        self.assertEqual(plan["budget_inr"], 5000)
        self.assertEqual(plan["destination"], "Bengaluru")
        self.assertEqual(plan["freight_inr_per_quintal"], 100)
        self.assertEqual({item["commodity"] for item in plan["ranking"]}, {"Tomato"})
        self.assertEqual(plan["ranking"][0]["estimated_total_inr"], 550)

    def test_dal_storage_question_gives_guidance_steps_without_prices(self):
        result = self.chat("How should I store dal?")
        self.assertNotIn("comparison", result)
        self.assertNotIn("plan", result)
        self.assertTrue(result["steps"])
        self.assertEqual(result["mode"], "general")

    def test_kannada_dal_plan_is_not_described_as_a_vegetable_plan(self):
        result = self.chat(
            "Make a buying plan for total 50 kg of dals, budget Rs 5000, "
            "deliver to Bengaluru, freight Rs100 per quintal.",
            language="Kannada",
        )
        self.assertIn("plan", result)
        self.assertEqual(result["plan"]["commodity"], "Dal starter mix")
        self.assertTrue(result["plan"]["multi_commodity"])
        self.assertEqual({item["commodity"] for item in result["plan"]["ranking"]}, set(self.dal_prices))
        self.assertRegex(result["answer"], "[\u0c80-\u0cff]")
        self.assertNotIn("ತರಕಾರ", result["answer"] + " " + result["plan"]["summary"])

    def test_ai_evidence_includes_full_catalog_beyond_the_price_excerpt(self):
        target = "Black Gram Dal(Urd Dal)"
        rows = [fixtures.row(f"Filler Crop {index}") for index in range(50)]
        self.set_feed([*rows, fixtures.row(target, price=8000)])
        captured = []

        async def capture_ai(system, evidence, *args):
            captured.append(evidence)
            return json.dumps({"answer": "Confirm the seller's terms before agreeing.", "used_indexes": []})

        self.ns["_ask_gemini"] = capture_ai
        self.chat("How can I negotiate fairly with a supplier?")
        self.assertEqual(len(captured), 1)
        evidence = captured[0]
        self.assertLessEqual(len(evidence["records"]), 45)
        self.assertNotIn(target, {item["commodity"] for item in evidence["records"]})
        self.assertEqual(set(evidence["commodity_catalog"]), {item["commodity"] for item in self.feed["records"]})
        self.assertIn(target, evidence["commodity_catalog"])


if __name__ == "__main__":
    unittest.main()
