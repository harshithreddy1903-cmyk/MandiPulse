"""Test fallback precedence and honest response contracts without network calls."""
import asyncio
import time
from copy import deepcopy
from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace
import unittest

import test_main
from test_main import ApiError, analytics, finish, load_functions, row


class FeedFallbackTests(unittest.TestCase):
    def setUp(self):
        self.ns = load_functions()
        self.ns.update({"httpx": SimpleNamespace(HTTPError=OSError), "subprocess": SimpleNamespace(SubprocessError=OSError), "_FEED_CACHE_PATH": Path("unused-in-memory-test"), "_cache": {}, "time": time})
        self.saved = []
        self.ns["save_market_cache"] = lambda path, state, feed: self.saved.append(deepcopy(feed)) or True
        self.ns["load_market_cache"] = lambda *args: None
        async def none(*args, **kwargs):
            return None
        self.ns["get_official_history"] = none
        self.weekly = {"mode": "cached", "stale": True, "source": "AGMARKNET · official weekly report", "history": [row()], "updated_at": "2026-10-31T10:00:00Z", "last_retrieved_at": "2026-10-31T10:00:00Z", "warning": "Dated official weekly observations; partial coverage.", "coverage": {"partial": True}}

    def fail_primary(self, status=404):
        async def failure():
            raise ApiError(status, "Primary returned no Karnataka observations")
        self.ns["_fetch_live_feed"] = failure

    def test_primary_success_is_saved_and_not_replaced(self):
        live = {**self.weekly, "mode": "live", "source": "data.gov.in · AGMARKNET"}
        async def primary():
            return live
        self.ns["_fetch_live_feed"] = primary
        self.assertIs(finish(self.ns["_get_feed"]()), live)
        self.assertEqual(len(self.saved), 1)

    def test_empty_primary_fetches_weekly_then_persists_it(self):
        self.fail_primary()
        calls = []
        async def weekly(state, **kwargs):
            calls.append(kwargs)
            return self.weekly
        self.ns["get_official_history"] = weekly
        result = finish(self.ns["_get_feed"](requested_commodities=["Tomato"]))
        self.assertEqual(result["mode"], "cached")
        self.assertEqual(result["records"][0]["commodity"], "Tomato")
        self.assertEqual(calls[0]["commodity_names"], ["Tomato"])
        self.assertEqual(len(self.saved), 1)

    def test_empty_or_error_uses_valid_last_good_when_weekly_empty(self):
        for status in [404, 502, 503]:
            with self.subTest(status=status):
                self.fail_primary(status)
                self.ns["load_market_cache"] = lambda *args: deepcopy(self.weekly)
                result = finish(self.ns["_get_feed"]())
                self.assertEqual(result["mode"], "cached")
                self.assertTrue(result["stale"])

    def test_no_cache_or_history_keeps_honest_primary_error(self):
        self.fail_primary()
        with self.assertRaises(ApiError) as error:
            finish(self.ns["_get_feed"]())
        self.assertEqual(error.exception.status_code, 404)

    def test_cancelled_primary_and_weekly_are_never_masked(self):
        async def cancelled(*args, **kwargs):
            raise asyncio.CancelledError()
        self.ns["_fetch_live_feed"] = cancelled
        with self.assertRaises(asyncio.CancelledError):
            finish(self.ns["_get_feed"]())
        self.fail_primary()
        self.ns["get_official_history"] = cancelled
        with self.assertRaises(asyncio.CancelledError):
            finish(self.ns["_get_feed"]())

    def test_disk_write_failure_does_not_hide_live_prices(self):
        # Real persistence handles OS errors internally and reports False.
        self.ns["save_market_cache"] = lambda *args: False
        async def live():
            return {"mode": "live"}
        self.ns["_fetch_live_feed"] = live
        self.assertEqual(finish(self.ns["_get_feed"]())["mode"], "live")


    def test_selected_missing_live_crop_can_return_separate_dated_official_feed(self):
        live = {"mode": "live", "records": [row("Rice")]}
        async def primary():
            return live
        async def weekly(names, category=None):
            self.assertEqual(names, ["Apple"])
            return deepcopy(self.weekly)
        self.ns["_fetch_live_feed"] = primary
        self.ns["_weekly_feed"] = weekly
        result = finish(self.ns["_get_feed"](requested_commodities=["Apple"]))
        self.assertEqual(result["mode"], "cached")
        self.assertEqual(live["records"][0]["commodity"], "Rice")
        self.assertEqual(self.saved[0]["mode"], "live")

    def test_cached_analytics_are_real_observations_not_demo_values(self):
        result = analytics.analyze_prices([row()], 1, "cached")
        self.assertNotEqual(result["quality"]["label"], "Illustrative")
        self.assertNotEqual(result["forecast"]["status"], "demo_only")

    def test_repeated_weekly_scope_reuses_batch_without_new_reports_or_save(self):
        calls = []
        async def weekly(*args, **kwargs):
            calls.append(kwargs)
            return self.weekly
        self.ns["get_official_history"] = weekly
        first = finish(self.ns["_weekly_feed"](["Tomato"]))
        second = finish(self.ns["_weekly_feed"](["Tomato"]))
        self.assertIs(first, second)
        self.assertEqual(len(calls), 1)
        self.assertEqual(len(self.saved), 1)

    def test_scoped_lookup_does_not_replace_shared_last_good_overview(self):
        self.ns["load_market_cache"] = lambda *args: deepcopy(self.weekly)
        async def weekly(*args, **kwargs):
            return deepcopy(self.weekly)
        self.ns["get_official_history"] = weekly
        self.assertIsNotNone(finish(self.ns["_weekly_feed"](["Tomato"])))
        self.assertEqual(len(self.saved), 0)
        self.assertIsNotNone(finish(self.ns["_weekly_feed"]()))
        self.assertEqual(len(self.saved), 1)


class CachedResponseTests(unittest.TestCase):
    setUp = test_main.BackendTests.setUp
    set_feed = test_main.BackendTests.set_feed
    chat = test_main.BackendTests.chat
    history = test_main.BackendTests.history
    def cached_feed(self):
        self.feed.update({"mode": "cached", "stale": True, "warning": "Saved official observations. Dates: 2026-10-29. Last retrieved: 2026-10-31T10:00:00Z. Partial coverage.", "last_retrieved_at": "2026-10-31T10:00:00Z", "observation_dates": ["2026-10-29"], "coverage": {"partial": True}})
        async def scoped(feed, *args):
            return feed
        self.ns["_scope_cached_feed"] = scoped

    def test_cached_price_answer_and_comparison_are_explicitly_dated(self):
        self.cached_feed()
        result = self.chat("show tomato prices")
        self.assertEqual(result["mode"], "cached")
        self.assertIn("Last retrieved", result["answer"])
        self.assertIn("partial coverage", result["comparison"]["caption"])

    def test_cached_plan_warning_survives_kannada_localization_and_pdf_caveat(self):
        self.cached_feed()
        result = self.chat("plan 50 kg tomato", language="Kannada")
        self.assertEqual(result["plan"]["mode"], "cached")
        self.assertIn("2026-10-31T10:00:00Z", result["plan"]["caveat"])
        self.assertIn("ಪ್ರಸ್ತುತ ನೇರ ಬೆಲೆಗಳಲ್ಲ", result["answer"])

    def test_targeted_cached_crop_uses_full_catalog_before_routing(self):
        self.feed.update({"mode": "cached", "commodity_catalog": ["Rice", "Tomato", "Apple"], "coverage": {"queried_commodities": ["Tomato"]}})
        calls = []
        async def weekly(names, category):
            calls.append((names, category))
            return {**self.feed, "records": [row("Apple")], "history": [row("Apple")], "commodities": ["Apple"], "warning": "Dated partial official observations."}
        self.ns["_weekly_feed"] = weekly
        result = self.chat("give me Apple prices")
        self.assertEqual(calls, [(["Apple"], None)])
        self.assertEqual(result["comparison"]["commodity"], "Apple")

    def test_targeted_moong_dal_uses_processed_catalog_name_not_whole_alias(self):
        dal = "Green Gram Dal(Moong Dal)"
        whole = "Green Gram (Moong)(Whole)"
        self.feed.update({"mode": "cached", "commodity_catalog": [dal, whole], "coverage": {"queried_commodities": ["Tomato"]}})
        calls = []
        async def weekly(names, category):
            calls.append((names, category))
            return {**self.feed, "records": [row(dal)], "history": [row(dal)], "commodities": [dal], "warning": "Dated partial official observations."}
        self.ns["_weekly_feed"] = weekly
        result = self.chat("show MoongDal prices")
        self.assertEqual(calls, [([dal], "dals")])
        self.assertEqual({item["commodity"] for item in result["comparison"]["records"]}, {dal})


    def live_whole_pulses_with_dated_dal_fallback(self):
        self.set_feed([row("Tomato"), row("Green Gram (Moong)(Whole)"), row("Red Gram")])
        calls = []
        previous_day = date.today() - timedelta(days=2)
        async def weekly(names, category=None):
            calls.append((names, category))
            rows = [row("Green Gram Dal(Moong Dal)", price=9000, day=previous_day), row("Bengal Gram Dal(Chana Dal)", price=7000, day=previous_day)]
            return {**self.feed, "mode": "cached", "stale": True, "records": rows, "history": rows, "commodities": [item["commodity"] for item in rows], "warning": "Retrieved official weekly reports dated " + previous_day.isoformat() + "; partial coverage, not today's live prices.", "last_retrieved_at": "2026-10-31T10:00:00Z"}
        self.ns["_weekly_feed"] = weekly
        return calls, previous_day

    def test_live_feed_without_processed_dal_uses_separate_dated_category(self):
        calls, _day = self.live_whole_pulses_with_dated_dal_fallback()
        result = self.chat("give me for dals", self.history("List available vegetable prices in Karnataka in a table."))
        self.assertEqual(calls, [(None, "dals")])
        self.assertEqual(result["mode"], "cached")
        self.assertEqual({item["product_form"] for item in result["comparison"]["records"]}, {"Processed dal"})
        self.assertIn("not today's live prices", result["answer"])
        self.assertEqual(self.feed["mode"], "live")
        self.assertEqual(len(self.feed["records"]), 3)


    def test_sort_them_retains_dal_category_across_live_and_cached_four_turn_history(self):
        calls, _day = self.live_whole_pulses_with_dated_dal_fallback()
        vegetable_question = "List available vegetable prices in Karnataka in a table."
        first = self.chat(vegetable_question)
        history = [{"role": "user", "content": vegetable_question}, {"role": "assistant", "content": first["answer"]}]
        dal_question = "give me for dals"
        dals = self.chat(dal_question, history)
        history += [{"role": "user", "content": dal_question}, {"role": "assistant", "content": dals["answer"]}]
        for message, descending in [("Sort them from lowest to highest price.", False), ("Please order those from highest to lowest price.", True), ("lowest to highest", False)]:
            with self.subTest(message=message):
                result = self.chat(message, history)
                rows = result["comparison"]["records"]
                self.assertEqual(result["comparison"]["commodity"], "Dals")
                self.assertEqual({item["product_form"] for item in rows}, {"Processed dal"})
                self.assertEqual([item["modal_price"] for item in rows], sorted([item["modal_price"] for item in rows], reverse=descending))
                self.assertEqual(result["mode"], "cached")
                self.assertNotIn("plan", result)
                self.assertNotIn("pdf_offer", result)
        self.assertTrue(all(category == "dals" for _names, category in calls))

    def test_sort_named_new_crop_resets_prior_dal_category(self):
        _calls, _day = self.live_whole_pulses_with_dated_dal_fallback()
        history = self.history("show vegetable prices", "give me for dals")
        result = self.chat("Sort tomato prices from lowest to highest.", history)
        self.assertEqual(result["comparison"]["commodity"], "Tomato")
        self.assertEqual(result["mode"], "live")
        self.assertNotIn("category", result)

    def test_live_shop_to_dated_dals_to_live_tomato_preserves_current_plan_preferences(self):
        _calls, _day = self.live_whole_pulses_with_dated_dal_fallback()
        question = "I am opening a vegetable shop in Bengaluru. Make a starter buying plan for 10 different vegetables, total 50 kg, budget Rs 5000, freight Rs 100 per quintal."
        first = self.chat(question)
        self.assertEqual(first["mode"], "live")
        history = [{"role": "user", "content": question}, {"role": "assistant", "content": first["answer"]}]
        dal_question = "Give me the same for dals."
        dals = self.chat(dal_question, history)
        self.assertEqual(dals["mode"], "cached")
        self.assertEqual(dals["plan"]["commodity"], "Dal starter mix")
        self.assertEqual(sum(item["suggested_kg"] for item in dals["plan"]["ranking"]), 50)
        history += [{"role": "user", "content": dal_question}, {"role": "assistant", "content": dals["answer"]}]
        tomato = self.chat("Give me the same for tomato.", history)
        self.assertEqual(tomato["mode"], "live")
        self.assertEqual(tomato["plan"]["commodity"], "Tomato")
        self.assertFalse(tomato["plan"].get("multi_commodity", False))
        self.assertNotIn("category", tomato)
        for result in [first, dals, tomato]:
            self.assertEqual(result["plan"]["quantity_quintals"], .5)
            self.assertEqual(result["plan"]["budget_inr"], 5000)
            self.assertEqual(result["plan"]["destination"], "Bengaluru")
            self.assertEqual(result["plan"]["freight_inr_per_quintal"], 100)

    def test_live_matching_whole_pulses_and_vegetables_stay_live(self):
        calls, _day = self.live_whole_pulses_with_dated_dal_fallback()
        for message in ["show pulses prices", "list vegetable prices", "show tomato prices"]:
            result = self.chat(message)
            self.assertEqual(result["mode"], "live")
            self.assertTrue(result["comparison"]["records"])
        self.assertEqual(calls, [])

    def test_explicit_today_never_uses_old_dal_price_as_today(self):
        calls, _previous_day = self.live_whole_pulses_with_dated_dal_fallback()
        for date_phrase in ["today", date.today().isoformat(), date.today().strftime("%d/%m/%Y")]:
            result = self.chat("show dal prices " + date_phrase)
            self.assertNotIn("comparison", result)
            self.assertNotIn("plan", result)
            self.assertEqual(result["mode"], "live")
        self.assertEqual(calls, [])

    def test_known_named_crop_missing_from_live_coverage_is_queried_directly(self):
        self.set_feed([row("Tomato")])
        calls = []
        async def weekly(names, category=None):
            calls.append((names, category))
            return {**self.feed, "mode": "cached", "records": [row("Apple")], "history": [row("Apple")], "commodities": ["Apple"], "warning": "Dated official observations; partial coverage."}
        self.ns["_weekly_feed"] = weekly
        result = self.chat("show Apple prices")
        self.assertEqual(calls, [(["apple"], None)])
        self.assertEqual(result["mode"], "cached")
        self.assertEqual(result["comparison"]["commodity"], "Apple")

    def test_dal_storage_is_dry_staple_guidance_without_a_feed(self):
        async def unavailable():
            raise AssertionError("Storage advice must not request market prices")
        self.ns["_get_feed"] = unavailable
        for message in ["How should I store dal?", "dal storage tips", "Dal storage", "How should I store rice?"]:
            result = self.chat(message)
            words = " ".join([result["answer"], *result["steps"]]).lower()
            self.assertEqual(result["mode"], "general")
            self.assertEqual(len(result["steps"]), 5)
            self.assertIn("dry scoop", words)
            self.assertIn("off the floor", words)
            self.assertNotIn("refrigerat", words)
            self.assertNotIn("wetting", words)
            self.assertLess(len(words.split()), 100)

    def test_dal_storage_in_kannada_has_five_local_steps(self):
        result = self.chat("How should I store dal?", language="Kannada")
        self.assertEqual(len(result["steps"]), 5)
        self.assertIn("ಒಣ", " ".join(result["steps"]))


if __name__ == "__main__":
    unittest.main()
