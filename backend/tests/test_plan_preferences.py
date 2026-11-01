"""Check chat buying preferences using synthetic records and no external services."""
import unittest

import test_main as fixtures


class PlanPreferencesTests(unittest.TestCase):
    # Reuse the existing isolated server loader and chat helpers without
    # inheriting the unrelated regression tests on BackendTests.
    setUp = fixtures.BackendTests.setUp
    set_feed = fixtures.BackendTests.set_feed
    chat = fixtures.BackendTests.chat
    history = fixtures.BackendTests.history

    original_plan = "plan 50 kg rice, budget Rs 2000, deliver to Bengaluru, freight Rs100 per quintal"

    def test_labeled_budget_delivery_and_freight_are_parsed(self):
        for budget in ("budget Rs 2000", "budget ₹2000", "budget 2000"):
            with self.subTest(budget=budget):
                result = self.ns["_plan_preferences"](
                    f"plan 50 kg rice, {budget}, deliver to Bengaluru, freight Rs100 per quintal", []
                )
                self.assertEqual(result["budget_inr"], 2000)
                self.assertEqual(result["destination"], "Bengaluru")
                self.assertEqual(result["freight_inr_per_quintal"], 100)
                self.assertIsNone(result["error"])

    def test_per_kg_freight_is_converted_to_per_quintal(self):
        result = self.ns["_plan_preferences"]("plan 50 kg rice, freight Rs5 per kg", [])
        self.assertEqual(result["freight_inr_per_quintal"], 500)
        self.assertIsNone(result["error"])

    def test_preferences_default_without_explicit_inheritance(self):
        result = self.ns["_plan_preferences"]("plan 100 kg onion", self.history(self.original_plan))
        self.assertIsNone(result["budget_inr"])
        self.assertEqual(result["destination"], "Not specified")
        self.assertEqual(result["freight_inr_per_quintal"], 0)
        self.assertIsNone(result["error"])

    def test_inherited_preferences_allow_one_field_to_change(self):
        result = self.ns["_plan_preferences"]("budget Rs 500", self.history(self.original_plan), inherit=True)
        self.assertEqual(result["budget_inr"], 500)
        self.assertEqual(result["destination"], "Bengaluru")
        self.assertEqual(result["freight_inr_per_quintal"], 100)
        self.assertIsNone(result["error"])

    def test_chat_plan_uses_landed_cost_and_delivery_does_not_filter_sources(self):
        result = self.chat(self.original_plan)
        self.assertIn("plan", result)
        plan = result["plan"]
        self.assertEqual(plan["budget_inr"], 2000)
        self.assertEqual(plan["destination"], "Bengaluru")
        self.assertEqual(plan["freight_inr_per_quintal"], 100)
        self.assertEqual(plan["quantity_quintals"], .5)
        best = plan["ranking"][0]
        self.assertEqual(best["market"], "Mysore")
        self.assertEqual(best["landed_cost_inr_per_quintal"], 3100)
        self.assertEqual(best["estimated_total_inr"], 1550)
        self.assertTrue(best["within_budget"])

    def test_explicit_source_and_delivery_city_remain_separate(self):
        self.set_feed([fixtures.row("Rice", "Haveri", 3000), fixtures.row("Rice", "Mysore", 2000)])
        message = "plan 50 kg rice from Haveri, budget Rs 2000, deliver to Bengaluru, freight Rs100 per quintal"
        source_message = self.ns["_source_message"](message)
        self.assertIn("Haveri", source_message)
        self.assertNotIn("Bengaluru", source_message)
        result = self.chat(message)
        self.assertIn("plan", result)
        self.assertEqual({item["market"] for item in result["plan"]["ranking"]}, {"Haveri"})
        self.assertEqual(result["plan"]["destination"], "Bengaluru")

    def test_chat_plan_converts_per_kg_freight_before_costing(self):
        result = self.chat("plan 50 kg rice, freight Rs5 per kg")
        self.assertIn("plan", result)
        self.assertEqual(result["plan"]["freight_inr_per_quintal"], 500)
        self.assertEqual(result["plan"]["ranking"][0]["estimated_total_inr"], 1750)

    def test_mixed_crop_budget_applies_to_whole_stock_including_freight(self):
        result = self.chat(
            "make a vegetable shop buying plan for 50 kg total of tomato and onion, "
            "budget Rs 1000, deliver to Bengaluru, freight Rs1000 per quintal"
        )
        self.assertIn("plan", result)
        plan = result["plan"]
        self.assertTrue(plan["multi_commodity"])
        self.assertEqual(plan["budget_inr"], 1000)
        self.assertEqual(plan["destination"], "Bengaluru")
        self.assertEqual(plan["freight_inr_per_quintal"], 1000)
        self.assertEqual({item["commodity"] for item in plan["ranking"]}, {"Tomato", "Onion"})
        self.assertEqual(sum(item["estimated_total_inr"] for item in plan["ranking"]), 1250)
        self.assertTrue(all(item["freight_inr_per_quintal"] == 1000 for item in plan["ranking"]))
        self.assertTrue(all(not item["within_budget"] for item in plan["ranking"]))

    def test_budget_reply_retains_plan_crop_weight_delivery_and_freight(self):
        result = self.chat("budget Rs 500", self.history(self.original_plan))
        self.assertIn("plan", result)
        plan = result["plan"]
        self.assertEqual(plan["commodity"], "Rice")
        self.assertEqual(plan["quantity_quintals"], .5)
        self.assertEqual(plan["budget_inr"], 500)
        self.assertEqual(plan["destination"], "Bengaluru")
        self.assertEqual(plan["freight_inr_per_quintal"], 100)
        self.assertEqual(plan["ranking"][0]["estimated_total_inr"], 1550)
        self.assertFalse(plan["ranking"][0]["within_budget"])

    def test_quantity_reply_retains_plan_preferences(self):
        result = self.chat("make that 100 kg", self.history(self.original_plan))
        self.assertIn("plan", result)
        plan = result["plan"]
        self.assertEqual(plan["commodity"], "Rice")
        self.assertEqual(plan["quantity_quintals"], 1)
        self.assertEqual(plan["budget_inr"], 2000)
        self.assertEqual(plan["destination"], "Bengaluru")
        self.assertEqual(plan["freight_inr_per_quintal"], 100)
        self.assertEqual(plan["ranking"][0]["estimated_total_inr"], 3100)
        self.assertFalse(plan["ranking"][0]["within_budget"])

    def test_explicit_new_crop_plan_resets_old_preferences(self):
        result = self.chat("make a buying plan for 100 kg onion", self.history(self.original_plan))
        self.assertIn("plan", result)
        plan = result["plan"]
        self.assertEqual(plan["commodity"], "Onion")
        self.assertEqual(plan["quantity_quintals"], 1)
        self.assertIsNone(plan["budget_inr"])
        self.assertEqual(plan["destination"], "Not specified")
        self.assertEqual(plan["freight_inr_per_quintal"], 0)
        self.assertEqual(plan["ranking"][0]["estimated_total_inr"], 2000)

    def test_what_about_crop_is_a_continuation_with_preferences(self):
        result = self.chat("what about 100 kg onion", self.history(self.original_plan))
        self.assertIn("plan", result)
        plan = result["plan"]
        self.assertEqual(plan["commodity"], "Onion")
        self.assertEqual(plan["budget_inr"], 2000)
        self.assertEqual(plan["destination"], "Bengaluru")
        self.assertEqual(plan["freight_inr_per_quintal"], 100)
        self.assertEqual(plan["ranking"][0]["estimated_total_inr"], 2100)

    def test_ambiguous_freight_amount_asks_once_and_does_not_make_a_plan(self):
        result = self.chat("plan 50 kg rice, budget Rs 2000, freight Rs100")
        self.assertNotIn("plan", result)
        question = result["answer"] + " " + result.get("follow_up", "")
        self.assertIn("freight", question.lower())
        self.assertEqual(question.count("?"), 1)

    def test_transport_rate_is_freight_rather_than_a_total_budget(self):
        result = self.chat("plan 50 kg rice, transport Rs100 per quintal")
        self.assertIn("plan", result)
        plan = result["plan"]
        self.assertIsNone(plan["budget_inr"])
        self.assertEqual(plan["freight_inr_per_quintal"], 100)
        self.assertEqual(plan["ranking"][0]["estimated_total_inr"], 1550)

    def test_shop_budget_reply_preserves_explicit_crop_subset(self):
        self.set_feed([
            fixtures.row("Tomato", price=1000),
            fixtures.row("Onion", price=2000),
            fixtures.row("Potato", price=3000),
        ])
        original = (
            "make a vegetable shop buying plan for 50 kg total of tomato and onion, "
            "budget Rs 1000, deliver to Bengaluru, freight Rs100 per quintal"
        )
        result = self.chat("budget Rs 500", self.history(original))
        self.assertIn("plan", result)
        plan = result["plan"]
        self.assertEqual({item["commodity"] for item in plan["ranking"]}, {"Tomato", "Onion"})
        self.assertTrue(all(item["suggested_kg"] == 25 for item in plan["ranking"]))
        self.assertEqual(plan["budget_inr"], 500)
        self.assertEqual(plan["destination"], "Bengaluru")
        self.assertEqual(sum(item["estimated_total_inr"] for item in plan["ranking"]), 800)

    def test_delivery_clause_excludes_the_connector_before_freight(self):
        result = self.ns["_plan_preferences"](
            "plan 50 kg rice, deliver to Bengaluru with freight Rs100 per quintal", []
        )
        self.assertEqual(result["destination"], "Bengaluru")
        self.assertEqual(result["freight_inr_per_quintal"], 100)

    def test_give_me_the_same_changes_crop_and_preserves_two_tons(self):
        self.set_feed([fixtures.row("Tomato", price=1000), fixtures.row("Apple", price=4000)])
        original = "What is the best market to purchase tomato? Give me a list and a plan for 2 tons."
        first = self.chat(original)
        self.assertEqual(first["plan"]["quantity_quintals"], 20)
        history = self.history(original) + [{"role": "assistant", "content": first["answer"]}]
        result = self.chat("Give me the same for apple.", history)
        self.assertIn("plan", result)
        self.assertEqual(result["plan"]["commodity"], "Apple")
        self.assertEqual(result["plan"]["quantity_quintals"], 20)
        self.assertEqual(result["plan"]["ranking"][0]["estimated_total_inr"], 80000)
        self.assertEqual({item["commodity"] for item in result["comparison"]["records"]}, {"Apple"})

    def test_same_crop_followup_preserves_budget_destination_and_freight(self):
        self.set_feed([fixtures.row("Tomato", price=1000), fixtures.row("Apple", price=4000)])
        original = (
            "What is the best market to purchase tomato? Give me a list and a plan for 2 tons. "
            "Budget Rs 50000, deliver to Bengaluru, freight Rs100 per quintal."
        )
        result = self.chat("Give me the same for apple.", self.history(original))
        self.assertIn("plan", result)
        plan = result["plan"]
        self.assertEqual(plan["commodity"], "Apple")
        self.assertEqual(plan["quantity_quintals"], 20)
        self.assertEqual(plan["budget_inr"], 50000)
        self.assertEqual(plan["destination"], "Bengaluru")
        self.assertEqual(plan["freight_inr_per_quintal"], 100)
        self.assertEqual(plan["ranking"][0]["estimated_total_inr"], 82000)
        self.assertFalse(plan["ranking"][0]["within_budget"])

    def test_do_the_same_and_do_that_reuse_plan_for_new_crop(self):
        self.set_feed([fixtures.row("Tomato", price=1000), fixtures.row("Apple", price=4000)])
        original = "What is the best market to purchase tomato? Give me a list and a plan for 2 tons."
        for followup in ("do the same for apple", "do that for apple"):
            with self.subTest(followup=followup):
                result = self.chat(followup, self.history(original))
                self.assertIn("plan", result)
                self.assertEqual(result["plan"]["commodity"], "Apple")
                self.assertEqual(result["plan"]["quantity_quintals"], 20)
                self.assertEqual(result["plan"]["ranking"][0]["estimated_total_inr"], 80000)


    def test_shop_total_phrase_is_not_mistaken_for_a_market_location(self):
        self.set_feed([fixtures.row("Tomato", price=1000), fixtures.row("Onion", price=2000), fixtures.row("Rice", price=3000)])
        result = self.chat("I am opening a vegetable shop. Prepare a buying plan for 10 different vegetables, 50 kg in total, budget Rs 1000, deliver to Bengaluru, freight Rs100 per quintal.")
        plan = result["plan"]
        self.assertTrue(plan["multi_commodity"])
        self.assertEqual({item["commodity"] for item in plan["ranking"]}, {"Tomato", "Onion"})
        self.assertEqual(sum(item["suggested_kg"] for item in plan["ranking"]), 50)
        self.assertEqual(sum(item["estimated_total_inr"] for item in plan["ranking"]), 800)
        self.assertEqual(plan["destination"], "Bengaluru")
        self.assertEqual(plan["budget_inr"], 1000)

    def test_bulk_phrase_does_not_hide_an_unknown_source_market(self):
        result = self.chat("plan 50 kg tomato in bulk from UnlistedTown")
        self.assertNotIn("plan", result)
        self.assertNotIn("comparison", result)

    def test_unknown_source_articles_and_benign_prefixes_do_not_widen_the_plan(self):
        for place in (
            "from the Delhi market",
            "from an UnlistedTown market",
            "in bulk from the Delhi market",
            "in total from an UnlistedTown market",
            "in the market from the Delhi market",
        ):
            with self.subTest(place=place):
                result = self.chat(f"plan 50 kg tomato {place}")
                self.assertNotIn("plan", result)
                self.assertNotIn("comparison", result)

    def test_benign_total_bulk_and_market_phrases_allow_a_plan(self):
        for phrase in ("in total", "in bulk", "in the market"):
            with self.subTest(phrase=phrase):
                result = self.chat(f"plan 50 kg tomato {phrase}")
                self.assertIn("plan", result)
                self.assertEqual(result["plan"]["quantity_quintals"], .5)
                self.assertEqual(result["plan"]["ranking"][0]["market"], "Mysore")

    def test_source_market_with_an_article_keeps_the_requested_market(self):
        self.set_feed([fixtures.row("Tomato", "Haveri", 1600), fixtures.row("Tomato", "Mysore", 1000)])
        result = self.chat("plan 50 kg tomato from the Haveri market")
        self.assertIn("plan", result)
        self.assertEqual({item["market"] for item in result["plan"]["ranking"]}, {"Haveri"})
        self.assertEqual(result["plan"]["ranking"][0]["estimated_total_inr"], 800)


if __name__ == "__main__":
    unittest.main()
