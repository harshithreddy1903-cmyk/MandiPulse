"""Exercise the real server functions with synthetic records and no service calls.

Load function definitions without app startup, environment files, or networking
imports so these checks can also run on restricted local Python installations.
"""
import ast
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
import importlib.util
import json
import math
from pathlib import Path
import re
from types import SimpleNamespace
import unittest


BACKEND = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("price_analytics", BACKEND / "app" / "analytics.py")
analytics = importlib.util.module_from_spec(spec)
spec.loader.exec_module(analytics)


class ApiError(Exception):
    def __init__(self, status_code, detail):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


def load_functions():
    source = BACKEND / "app" / "main.py"
    tree = ast.parse(source.read_text(encoding="utf-8"))
    nodes = [ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0)]
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            node.decorator_list = []
            nodes.append(node)
        elif isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id in {"_KNOWN_CROP_WORDS", "_CROP_ALIASES", "_VEGETABLE_CROP_WORDS", "_QUANTITY_PATTERN"} for target in node.targets):
            nodes.append(node)
        elif isinstance(node, ast.ClassDef) and node.name == "PlanRequest":
            method = next(item for item in node.body if isinstance(item, ast.FunctionDef) and item.name == "validate_quantity")
            method.decorator_list = []
            nodes.append(method)
    namespace = {"re": re, "math": math, "json": json, "date": date, "timedelta": timedelta, "Decimal": Decimal, "ROUND_HALF_UP": ROUND_HALF_UP, "defaultdict": defaultdict, "parse_date": analytics.parse_date, "analyze_prices": analytics.analyze_prices, "DATA_GOV_STATE": "Karnataka", "HTTPException": ApiError}
    exec(compile(ast.fix_missing_locations(ast.Module(body=nodes, type_ignores=[])), str(source), "exec"), namespace)
    namespace["_rate_limit"] = lambda *args: None
    return namespace


def finish(coroutine):
    try:
        coroutine.send(None)
    except StopIteration as stop:
        return stop.value
    finally:
        coroutine.close()
    raise AssertionError("A synthetic check unexpectedly yielded to external work")


def row(crop="Tomato", market="Mysore", price=1000, day=None, variety="Local", grade="FAQ", district=None):
    return {"state": "Karnataka", "district": district or market, "market": market, "commodity": crop, "modal_price": price, "min_price": price, "max_price": price, "arrival_date": (day or date.today()).strftime("%d/%m/%Y"), "variety": variety, "grade": grade, "unit": "INR/quintal", "source": "Synthetic regression fixture"}


class BackendTests(unittest.TestCase):
    def setUp(self):
        self.ns = load_functions()
        self.set_feed([row(), row("Onion", price=2000), row("Rice", price=3000)])
        async def ai(*args):
            return json.dumps({"answer": "General guidance answer", "used_indexes": []})
        self.ns["_ask_gemini"] = ai
        async def no_weekly(*args, **kwargs):
            return None
        self.ns["_weekly_feed"] = no_weekly

    def set_feed(self, rows, history=None):
        history = history or rows
        self.feed = {"records": rows, "history": history, "commodities": sorted({item["commodity"] for item in rows}), "source": "Synthetic", "updated_at": "Synthetic", "mode": "live", "analytics": analytics.analyze_prices(history, len(history), "live")}
        async def get_feed(*args, **kwargs):
            return self.feed
        self.ns["_get_feed"] = get_feed

    def chat(self, message, history=None, language="English"):
        body = SimpleNamespace(message=message, history=history or [], language=language, depth="simple")
        return finish(self.ns["assistant_chat"](body, None))

    def history(self, *messages):
        return [{"role": "user", "content": message} for message in messages]

    def test_grouped_and_indian_quantities(self):
        for text, quintals in [("1,250 kg", 12.5), ("1,000 kg", 10), ("1,25,000 kg", 1250), ("2 metric tonnes", 20), (".5 kg", .005), ("+10 kg", .1), ("3 qtls", 3)]:
            with self.subTest(text=text):
                self.assertEqual(self.ns["_requested_quantity"](text)["quantity_quintals"], quintals)

    def test_invalid_quantities_do_not_match_a_positive_suffix(self):
        for text in ["-10 kg", "−10 kg", "0 kg", "1,2,3 kg", "1.2.3 kg", "9" * 350 + " kg", "0.0001 kg"]:
            with self.subTest(text=text):
                self.assertIsNone(self.ns["_requested_quantity"](text))

    def test_invalid_weight_does_not_reuse_old_plan_weight(self):
        result = self.chat("-10 kg", self.history("make a buying plan for 50 kg tomato"))
        self.assertNotIn("plan", result)
        self.assertIn("positive weight", result["answer"])

    def test_gram_allocation_never_negative_and_conserves_weight(self):
        for kg in [1.6, .5, .001, 50.123, 10000000]:
            for count in [1, 3, 10]:
                with self.subTest(kg=kg, count=count):
                    allocations = self.ns["_allocate_grams"](kg, count)
                    self.assertTrue(all(item >= 0 for item in allocations))
                    self.assertAlmostEqual(sum(allocations), kg, places=6)
                    self.assertLessEqual(max(allocations) - min(allocations), .00100001)

    def test_small_shop_plan_has_no_negative_cost(self):
        vegetables = ["Tomato", "Onion", "Potato", "Carrot", "Cabbage", "Cauliflower", "Brinjal", "Beans", "Garlic", "Ginger"]
        self.set_feed([row(crop) for crop in vegetables])
        result = self.chat("Make a buying plan for 1.6 kg for my vegetable shop")
        self.assertTrue(result["plan"]["multi_commodity"])
        self.assertAlmostEqual(sum(item["suggested_kg"] for item in result["plan"]["ranking"]), 1.6)
        self.assertTrue(all(item["estimated_total_inr"] >= 0 for item in result["plan"]["ranking"]))

    def test_new_crop_price_question_is_not_a_previous_plan(self):
        result = self.chat("what are onion prices", self.history("make a buying plan for 50 kg tomato"))
        self.assertNotIn("plan", result)

    def test_natural_missing_price_lookup_does_not_call_ai_or_reuse_old_crop(self):
        self.set_feed([row("Rice"), row("Cotton")])
        async def unexpected_ai(*args):
            raise AssertionError("An exact price lookup must not call AI")
        self.ns["_ask_gemini"] = unexpected_ai
        result = self.chat("What are tomato prices today?", self.history("show Rice prices", "show Cotton prices"))
        self.assertIn("couldn’t find a matching crop", result["answer"])
        self.assertNotIn("comparison", result)

    def test_natural_available_price_lookup_is_deterministic(self):
        async def unexpected_ai(*args):
            raise AssertionError("An exact price lookup must not call AI")
        self.ns["_ask_gemini"] = unexpected_ai
        result = self.chat("What are Rice prices today?")
        self.assertEqual(result["comparison"]["commodity"], "Rice")
        self.assertEqual(result["comparison"]["records"][0]["arrival_date"], date.today().strftime("%d/%m/%Y"))

    def test_retail_price_setting_question_remains_guidance(self):
        result = self.chat("how should I set a retail price for Rice")
        self.assertNotIn("comparison", result)

    def test_new_comparison_is_not_a_previous_plan(self):
        result = self.chat("show onion prices", self.history("make a buying plan for 50 kg tomato"))
        self.assertNotIn("plan", result)
        self.assertEqual(result["comparison"]["commodity"], "Onion")

    def test_new_explicit_plan_does_not_reuse_another_crops_weight(self):
        result = self.chat("make a buying plan for onion", self.history("make a buying plan for 50 kg tomato"))
        self.assertNotIn("plan", result)
        self.assertIn("How much Onion", result["answer"])

    def test_quantity_reply_continues_current_plan(self):
        result = self.chat("1,250 kg", self.history("make a buying plan for tomato"))
        self.assertEqual(result["plan"]["commodity"], "Tomato")
        self.assertEqual(result["plan"]["quantity_quintals"], 12.5)

    def test_unit_confirmation_preserves_explicit_tonnes(self):
        result = self.chat("kg", self.history("make a buying plan for 2 tonn tomato"))
        self.assertEqual(result["plan"]["quantity_quintals"], 20)

    def test_bare_plan_requests_use_established_crop_and_quantity(self):
        previous = "What is the best market to purchase tomato? Give me a list and a plan for 2 tons."
        for message in ["plan", "a plan please", "make a plan", "plan please"]:
            with self.subTest(message=message):
                result = self.chat(message, self.history(previous))
                self.assertEqual(result["plan"]["commodity"], "Tomato")
                self.assertEqual(result["plan"]["quantity_quintals"], 20)

    def test_chained_bare_plan_then_same_keeps_quantity_and_preferences(self):
        self.set_feed([row("Tomato", price=1000), row("Apple", price=4000)])
        original = "make a buying plan for 2 tons tomato, budget Rs50000, deliver to Bengaluru, freight Rs100 per quintal"
        first = self.chat(original)
        history = self.history(original) + [{"role": "assistant", "content": first["answer"]}]
        repeated = self.chat("plan", history)
        history += [{"role": "user", "content": "plan"}, {"role": "assistant", "content": repeated["answer"]}]
        result = self.chat("Give me the same for apple.", history)
        plan = result["plan"]
        self.assertEqual(plan["commodity"], "Apple")
        self.assertEqual(plan["quantity_quintals"], 20)
        self.assertEqual(plan["budget_inr"], 50000)
        self.assertEqual(plan["destination"], "Bengaluru")
        self.assertEqual(plan["freight_inr_per_quintal"], 100)
        self.assertEqual(plan["ranking"][0]["estimated_total_inr"], 82000)

    def test_recent_plan_summary_recovers_context_at_eight_turn_boundary(self):
        self.set_feed([row("Tomato", "Haveri", 1000), row("Tomato", "Mysore", 500), row("Apple", "Haveri", 4000), row("Apple", "Mysore", 2000)])
        original = "make a buying plan for 2 tons tomato from Haveri, budget Rs50000, deliver to Bengaluru, freight Rs100 per quintal"
        first = self.chat(original)
        history = self.history(original) + [{"role": "assistant", "content": first["answer"]}]
        for message in ["plan", "a plan please", "make a plan", "plan please"]:
            result = self.chat(message, history[-8:])
            self.assertEqual(result["plan"]["quantity_quintals"], 20)
            history += [{"role": "user", "content": message}, {"role": "assistant", "content": result["answer"]}]
        self.assertNotIn(original, [turn["content"] for turn in history[-8:]])
        restored = self.chat("plan", history[-8:])
        self.assertEqual(restored["plan"]["commodity"], "Tomato")
        self.assertEqual(restored["plan"]["quantity_quintals"], 20)
        self.assertEqual(restored["plan"]["budget_inr"], 50000)
        result = self.chat("Give me the same for apple.", history[-8:])
        plan = result["plan"]
        self.assertEqual(plan["quantity_quintals"], 20)
        self.assertEqual(plan["budget_inr"], 50000)
        self.assertEqual(plan["destination"], "Bengaluru")
        self.assertEqual(plan["freight_inr_per_quintal"], 100)
        self.assertEqual({item["market"] for item in plan["ranking"]}, {"Haveri"})

    def test_explicit_new_task_blocks_old_summary_recovery(self):
        original = "make a buying plan for 2 tons tomato, budget Rs50000, freight Rs100 per quintal"
        first = self.chat(original)
        history = self.history(original) + [{"role": "assistant", "content": first["answer"]}, {"role": "user", "content": "make a buying plan for onion"}, {"role": "assistant", "content": "How much Onion do you plan to buy?"}]
        result = self.chat("plan", history)
        self.assertNotIn("plan", result)
        self.assertIn("How much Onion", result["answer"])
        preferences = self.ns["_plan_preferences"]("plan", history, inherit=True)
        self.assertIsNone(preferences["budget_inr"])
        self.assertEqual(preferences["freight_inr_per_quintal"], 0)

    def test_generic_unit_explanation_is_not_a_plan_summary(self):
        self.assertIsNone(self.ns["_assistant_plan_quantity"]("A quintal is 100 kg."))
        self.assertIsNone(self.ns["_assistant_plan_quantity"]("For 100 kg, the lowest listed modal price is shown in the table."))

    def test_kannada_summary_never_treats_modal_price_as_freight(self):
        first = self.chat("make a buying plan for 50 kg tomato", language="Kannada")
        self.assertNotIn("freight_inr_per_quintal", self.ns["_assistant_plan_preferences"](first["answer"]))

    def test_kannada_recent_summary_restores_explicit_preferences(self):
        self.set_feed([row("Tomato", price=1000), row("Apple", price=4000)])
        original = "make a buying plan for 50 kg tomato, budget Rs500, deliver to Bengaluru, freight Rs100 per quintal"
        first = self.chat(original, language="Kannada")
        history = [{"role": "user", "content": "plan"}, {"role": "assistant", "content": first["answer"]}]
        result = self.chat("Give me the same for apple.", history, language="Kannada")
        self.assertEqual(result["plan"]["quantity_quintals"], .5)
        self.assertEqual(result["plan"]["budget_inr"], 500)
        self.assertEqual(result["plan"]["destination"], "Bengaluru")
        self.assertEqual(result["plan"]["freight_inr_per_quintal"], 100)

    def test_bare_plan_after_quantity_comparison_reuses_known_weight(self):
        result = self.chat("plan", self.history("list tomato prices for 100 kg"))
        self.assertEqual(result["plan"]["commodity"], "Tomato")
        self.assertEqual(result["plan"]["quantity_quintals"], 1)

    def test_bare_plan_only_asks_for_missing_detail(self):
        result = self.chat("a plan please", self.history("list tomato prices"))
        self.assertNotIn("plan", result)
        self.assertIn("How much Tomato", result["answer"])
        self.assertEqual(result["answer"].count("?"), 1)

    def test_buy_recommendation_after_crop_list_keeps_crop(self):
        result = self.chat("where do you suggest me to buy?", self.history("list tomato prices"))
        self.assertEqual(result["comparison"]["commodity"], "Tomato")
        self.assertNotIn("plan", result)
        self.assertIn("lowest modal price", result["answer"])

    def test_quintal_equivalent_is_singular_when_one(self):
        self.assertEqual(self.ns["_quantity_display"](100, "kg", 1), "100 kg (1 quintal)")
        self.assertEqual(self.ns["_quantity_display"](.1, "tonnes", 1), "0.1 tonnes (1 quintal)")
        self.assertEqual(self.ns["_quantity_display"](None, "quintals", 1), "1 quintal")

    def test_shop_history_does_not_hijack_new_single_crop_plan(self):
        result = self.chat("make a buying plan for 100 kg tomato", self.history("make a plan for my vegetable shop"))
        self.assertEqual(result["plan"]["commodity"], "Tomato")
        self.assertFalse(result["plan"].get("multi_commodity", False))

    def test_shop_location_wording_is_destination_not_source(self):
        for message in ["I am opening a vegetable shop in Bengaluru and want a buying plan for 50 kg.", "My vegetable shop is based in Bengaluru. Make a buying plan for 50 kg.", "My vegetable store, located in Bengaluru, needs a buying plan for 50 kg."]:
            with self.subTest(message=message):
                result = self.chat(message)
                self.assertEqual(result["plan"]["destination"], "Bengaluru")
                self.assertEqual({item["market"] for item in result["plan"]["ranking"]}, {"Mysore"})

    def test_shop_quantity_reply_continues_current_shop(self):
        result = self.chat("50 kg", self.history("make a plan for my vegetable shop"))
        self.assertTrue(result["plan"]["multi_commodity"])

    def test_new_task_stops_old_shop_context(self):
        result = self.chat("50 kg", self.history("make a plan for my vegetable shop", "explain soil moisture"))
        self.assertNotIn("plan", result)

    def test_latest_dates_are_chronological_and_keep_variants(self):
        older = row(day=date(2026, 9, 30), price=100)
        newer = row(day=date(2026, 10, 1), price=200)
        hybrid = row(day=date(2026, 10, 1), price=300, variety="Hybrid")
        graded = row(day=date(2026, 10, 1), price=400, grade="A")
        latest = self.ns["_latest"]([older, newer, hybrid, graded])
        self.assertEqual(len(latest), 3)
        self.assertEqual({item["modal_price"] for item in latest}, {200, 300, 400})

    def test_latest_excludes_invalid_and_future_dates(self):
        invalid = {**row(), "arrival_date": "unknown"}
        future = row(day=date.today() + timedelta(days=1))
        self.assertEqual(self.ns["_latest"]([invalid, future]), [])

    def test_plan_preserves_variety_and_grade(self):
        result = self.chat("make a buying plan for 100 kg tomato")
        self.assertEqual(result["plan"]["ranking"][0]["variety"], "Local")
        self.assertEqual(result["plan"]["ranking"][0]["grade"], "FAQ")

    def test_price_word_does_not_select_rice(self):
        self.assertEqual(self.ns["_find_commodity"]("show market prices", self.feed["commodities"]), (None, False))

    def test_multiword_alias_and_paddy_feed_name(self):
        self.assertEqual(self.ns["_find_commodity"]("show green gram prices", ["Green Gram (Moong)(Whole)"])[0], "Green Gram (Moong)(Whole)")
        self.assertEqual(self.ns["_find_commodity"]("show paddy prices", ["Paddy(Dhan)(Common)"])[0], "Paddy(Dhan)(Common)")

    def test_compound_crop_comparison_includes_both(self):
        result = self.chat("compare tomato and onion prices")
        self.assertEqual({item["commodity"] for item in result["comparison"]["records"]}, {"Tomato", "Onion"})
        self.assertTrue(result["comparison"]["include_commodity"])

    def test_sweet_potato_does_not_also_select_potato(self):
        self.assertEqual(self.ns["_named_commodities"]("compare sweet potato prices", ["Potato", "Sweet Potato"]), ["Sweet Potato"])
        self.assertEqual(self.ns["_named_commodities"]("show sweet potatoes prices", ["Potato", "Sweet Potato"]), ["Sweet Potato"])

    def test_common_plural_crop_names(self):
        self.assertEqual(self.chat("list tomatoes and onions prices")["comparison"]["count"], 2)

    def test_named_shop_crops_are_all_included(self):
        result = self.chat("make a vegetable shop plan with 50 kg total for tomato and onion")
        self.assertEqual({item["commodity"] for item in result["plan"]["ranking"]}, {"Tomato", "Onion"})

    def test_individual_shop_weights_are_not_silently_reallocated(self):
        result = self.chat("make a vegetable shop plan with 10 kg tomato and 20 kg onion")
        self.assertNotIn("plan", result)
        self.assertIn("one total stock weight", result["answer"])

    def test_all_crops_is_compact_and_respects_descending(self):
        self.set_feed([row("Crop " + str(index), price=index + 1) for index in range(25)])
        result = self.chat("show all crops highest to lowest")
        prices = [item["modal_price"] for item in result["comparison"]["records"]]
        self.assertEqual(len(prices), 20)
        self.assertEqual(prices, sorted(prices, reverse=True))

    def test_place_names_need_complete_phrase(self):
        self.assertFalse(self.ns["_name_in_message"]("Bangalore Rural", "show prices in Bangalore Urban"))
        self.assertTrue(self.ns["_name_in_message"]("Mysore APMC", "show tomato prices in Mysore"))

    def test_unknown_location_is_not_silently_statewide(self):
        result = self.chat("show tomato prices in Delhi")
        self.assertNotIn("comparison", result)
        self.assertIn("couldn’t find", result["answer"])

    def test_requested_historical_day_uses_history(self):
        yesterday = row(price=1500, day=date.today() - timedelta(days=1))
        self.set_feed([row()], [yesterday, row()])
        result = self.chat("show tomato prices yesterday")
        self.assertEqual(result["comparison"]["records"][0]["modal_price"], 1500)

    def test_variety_and_grade_are_filtered(self):
        self.set_feed([row(), row(price=1500, variety="Hybrid", grade="A")])
        result = self.chat("show tomato prices for Hybrid variety grade A")
        self.assertEqual(len(result["comparison"]["records"]), 1)
        self.assertEqual(result["comparison"]["records"][0]["variety"], "Hybrid")

    def test_multiword_variety_and_any_variety(self):
        self.set_feed([row(), row(price=1500, variety="Arka Rakshak")])
        result = self.chat("show tomato prices for Arka Rakshak variety")
        self.assertEqual(len(result["comparison"]["records"]), 1)
        self.assertEqual(result["comparison"]["records"][0]["variety"], "Arka Rakshak")
        self.assertEqual(self.chat("show tomato prices for any variety")["comparison"]["count"], 2)

    def test_format_contract(self):
        self.assertEqual(self.chat("list tomato prices")["comparison"]["display"], "list")
        self.assertEqual(self.chat("table of tomato prices")["comparison"]["display"], "table")

    def test_general_shop_guidance_needs_no_feed_or_crop(self):
        async def unavailable():
            raise ApiError(503, "Feed unavailable")
        self.ns["_get_feed"] = unavailable
        result = self.chat("how do I start a vegetable shop")
        self.assertEqual(result["mode"], "general")
        self.assertTrue(result["steps"])
        self.assertNotIn("comparison", result)

    def test_guidance_table_and_list_shapes(self):
        table = self.chat("give a table of steps to start a vegetable shop")["table"]
        self.assertTrue(all(len(item) == len(table["columns"]) for item in table["rows"]))
        self.assertTrue(self.chat("list tips for starting a vegetable shop")["bullets"])

    def test_storage_advice_is_not_shop_startup_advice(self):
        result = self.chat("how should I store onions")
        self.assertIn("spoilage", result["answer"])
        self.assertTrue(result["steps"])

    def test_specific_spoilage_question_does_not_get_opening_shop_template(self):
        result = self.chat("How can I reduce vegetable spoilage in my shop? Give me clear steps.")
        self.assertIn("spoilage", result["answer"])
        self.assertTrue(any("damaged" in item for item in result["steps"]))
        self.assertFalse(any("competitors" in item for item in result["steps"]))
        self.assertNotIn("follow_up", result)

    def test_list_of_spoilage_causes_gets_causes_not_a_price_table(self):
        result = self.chat("list common causes of vegetable spoilage")
        self.assertIn("Common causes", result["answer"])
        self.assertTrue(result["bullets"])
        self.assertNotIn("comparison", result)

    def test_wholesale_retail_comparison_is_explanatory(self):
        result = self.chat("give a table comparing wholesale and retail prices")
        self.assertIn("Wholesale prices", result["answer"])
        self.assertTrue(result["table"]["rows"])
        self.assertNotIn("comparison", result)

    def test_margin_meaning_gets_margin_explanation(self):
        result = self.chat("explain the meaning of margin in my vegetable shop")
        self.assertIn("Gross margin", result["answer"])
        self.assertTrue(any("16.7%" in item for item in result["bullets"]))
        self.assertNotIn("follow_up", result)

    def test_storage_question_after_price_context_answers_storage(self):
        result = self.chat("how should I store onions", self.history("list tomato prices", "make a buying plan for 50 kg tomato"))
        self.assertIn("spoilage", result["answer"])
        self.assertTrue(result["steps"])
        self.assertNotIn("plan", result)

    def test_other_shop_topics_use_question_specific_ai(self):
        result = self.chat("how can I negotiate with suppliers for my vegetable shop")
        self.assertEqual(result["answer"], "General guidance answer")
        self.assertFalse(result.get("follow_up"))

    def test_single_record_uses_singular_wording(self):
        self.assertIn("1 official market record,", self.chat("list Rice prices")["answer"])

    def test_simple_unit_question_needs_no_feed(self):
        result = self.chat("how many kg is a quintal")
        self.assertEqual(result["mode"], "general")
        self.assertIn("100 kg", result["answer"])

    def test_language_in_message_is_not_an_unknown_place(self):
        self.assertIn("comparison", self.chat("show Rice prices in Kannada"))

    def test_kannada_deterministic_plan_and_guidance(self):
        for message in ["show tomato prices", "make a buying plan for 50 kg tomato", "how to start a vegetable shop", "make a buying plan for onion"]:
            with self.subTest(message=message):
                self.assertRegex(self.chat(message, language="Kannada")["answer"], "[\u0c80-\u0cff]")

    def test_ai_structured_guidance_is_sanitized(self):
        async def ai(*args):
            return json.dumps({"answer": "Check soil moisture.", "steps": ["Inspect the soil.", {"bad": "shape"}], "table": {"columns": ["Action"], "rows": [["Inspect"], ["bad", "width"], [{"bad": "type"}]]}})
        self.ns["_ask_gemini"] = ai
        result = self.chat("explain soil moisture")
        self.assertEqual(result["steps"], ["Inspect the soil."])
        self.assertEqual(result["table"]["rows"], [["Inspect"]])

    def test_invalid_ai_json_returns_useful_gateway_error(self):
        async def ai(*args):
            return '{"answer":'
        self.ns["_ask_gemini"] = ai
        with self.assertRaises(ApiError) as error:
            self.chat("explain soil moisture")
        self.assertEqual(error.exception.status_code, 502)

    def test_plan_request_quantity_consistency(self):
        body = SimpleNamespace(quantity_unit="kg", quantity_value=50, quantity_quintals=.5)
        self.assertIs(self.ns["validate_quantity"](body), body)
        body.quantity_quintals = 50
        with self.assertRaises(ValueError):
            self.ns["validate_quantity"](body)
        body.quantity_value = None
        self.ns["validate_quantity"](body)
        self.assertEqual(body.quantity_value, 5000)

    def test_plan_endpoint_computes_freight_budget_without_ai(self):
        body = SimpleNamespace(commodity="Tomato", quantity_quintals=.5, quantity_value=50, quantity_unit="kg", budget_inr=100, destination="Mysore", freight_inr_per_quintal=100, language="English")
        result = finish(self.ns["assistant_plan"](body, None))
        self.assertEqual(result["ranking"][0]["estimated_total_inr"], 550)
        self.assertFalse(result["ranking"][0]["within_budget"])
        self.assertIn("None of the listed options", result["summary"])
        self.assertEqual(result["ranking"][0]["grade"], "FAQ")

    def test_market_endpoint_scopes_history_and_analytics(self):
        result = finish(self.ns["market_prices"](None, "Tomato", "Karnataka"))
        self.assertEqual({item["commodity"] for item in result["history"]}, {"Tomato"})
        self.assertNotEqual(result["analytics"]["forecast"]["status"], "insufficient_comparable_data")


if __name__ == "__main__":
    unittest.main()
