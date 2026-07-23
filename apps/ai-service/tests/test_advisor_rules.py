"""Tests for the smarter local-rules advisor: needs-vs-waste breakdown, recurring-charge
detection, free-text savings-goal parsing, goal-recalculation alternatives, and educational-only
investment guidance. These exercise the rule-based reasoning directly (the same code path used
both for the 'local-rules' provider and as the fallback whenever a cloud provider call fails)."""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import (
    GoalInput,
    TransactionInput,
    _detect_recurring_charges,
    _estimate_goal_forecasts,
    _needs_vs_wants_breakdown,
    _parse_savings_target_from_question,
    app,
)

client = TestClient(app)


def _dashboard_payload(**overrides) -> dict:
    base = {
        "generated_at": "2026-07-07T10:00:00",
        "kpis": {
            "net_cash_flow": 800,
            "income": 5000,
            "expenses": 4200,
            "savings_rate": 16,
            "interest_paid": 0,
            "debt_payments": 200,
            "budget_health": 70,
            "financial_health_score": 65,
            "internal_transfers": 0,
            "review_count": 0,
        },
        "top_expense_categories": [
            {"category": "groceries", "total": 900},
            {"category": "restaurants", "total": 600},
            {"category": "shopping", "total": 400},
            {"category": "home_utilities", "total": 300},
        ],
        "monthly_trend": [],
        "yearly_trend": [],
        "spending_calendar": [],
    }
    base.update(overrides)
    return base


def _transaction(**overrides) -> dict:
    base = {
        "id": "txn-1",
        "account_name": "Chequing",
        "posted_at": "2026-07-01T00:00:00",
        "amount": -45.0,
        "category": "restaurants",
        "description_raw": "UBER EATS TORONTO",
        "merchant_normalized": "uber eats toronto",
        "confidence_score": 0.9,
        "is_internal_transfer": False,
    }
    base.update(overrides)
    return base


def _advisor_request(question: str, **overrides) -> dict:
    payload = {
        "provider": "local-rules",
        "question": question,
        "dashboard": _dashboard_payload(),
        "transactions": [],
        "goals": [],
    }
    payload.update(overrides)
    return payload


class TestNeedsVsWantsBreakdown:
    def test_splits_essential_and_discretionary_correctly(self) -> None:
        categories = {
            "groceries": 900.0,       # essential
            "home_utilities": 300.0,  # essential
            "restaurants": 600.0,     # discretionary
            "shopping": 400.0,        # discretionary
            "fees": 25.0,             # pure cost, neither
            "unknown": 50.0,          # unclassified, neither
        }
        essential, discretionary, pure_cost, top_discretionary = _needs_vs_wants_breakdown(categories)

        assert essential == 1200.0
        assert discretionary == 1000.0
        assert pure_cost == 25.0
        assert top_discretionary[0] == ("restaurants", 600.0)

    def test_empty_categories_returns_zeros(self) -> None:
        essential, discretionary, pure_cost, top_discretionary = _needs_vs_wants_breakdown({})
        assert (essential, discretionary, pure_cost, top_discretionary) == (0.0, 0.0, 0.0, [])

    def test_endpoint_surfaces_breakdown_insight_for_generic_question(self) -> None:
        response = client.post(
            "/advisor/respond",
            json=_advisor_request(
                "Where am I overspending?",
                transactions=[_transaction(category="restaurants", amount=-120, description_raw="THE KEG")],
            ),
        )
        assert response.status_code == 200
        payload = response.json()
        titles = [insight["title"] for insight in payload["insights"]]
        assert "Needed vs. waste breakdown" in titles
        # groceries (900) + home_utilities (300) = 1200 essential
        assert "$1200" in payload["answer"]


class TestRecurringChargeDetection:
    def test_detects_consistent_repeating_merchant(self) -> None:
        transactions = [
            TransactionInput(**_transaction(id=f"t{i}", amount=-15.99, description_raw="NETFLIX.COM", merchant_normalized="netflix.com"))
            for i in range(4)
        ]
        recurring = _detect_recurring_charges(transactions)
        assert len(recurring) == 1
        name, count, avg, total, category = recurring[0]
        assert "NETFLIX" in name
        assert count == 4
        assert avg == 15.99

    def test_ignores_single_occurrence(self) -> None:
        transactions = [TransactionInput(**_transaction())]
        assert _detect_recurring_charges(transactions) == []

    def test_ignores_inconsistent_amounts(self) -> None:
        transactions = [
            TransactionInput(**_transaction(id="t1", amount=-15.99, description_raw="SOME STORE", merchant_normalized="some store")),
            TransactionInput(**_transaction(id="t2", amount=-89.50, description_raw="SOME STORE", merchant_normalized="some store")),
        ]
        assert _detect_recurring_charges(transactions) == []

    def test_ignores_internal_transfers_and_fixed_obligations(self) -> None:
        transactions = [
            TransactionInput(**_transaction(id="t1", amount=-1500, category="mortgage_payments", is_internal_transfer=False)),
            TransactionInput(**_transaction(id="t2", amount=-1500, category="mortgage_payments", is_internal_transfer=False)),
            TransactionInput(**_transaction(id="t3", amount=-200, category="restaurants", is_internal_transfer=True)),
            TransactionInput(**_transaction(id="t4", amount=-200, category="restaurants", is_internal_transfer=True)),
        ]
        assert _detect_recurring_charges(transactions) == []

    def test_endpoint_surfaces_recurring_insight_when_asked_about_subscriptions(self) -> None:
        transactions = [
            _transaction(id=f"t{i}", amount=-15.99, description_raw="SPOTIFY", merchant_normalized="spotify", category="shopping")
            for i in range(3)
        ]
        response = client.post(
            "/advisor/respond",
            json=_advisor_request("Which subscriptions should I cancel?", transactions=transactions),
        )
        assert response.status_code == 200
        payload = response.json()
        assert "SPOTIFY" in payload["answer"] or "Recurring charges detected" in [i["title"] for i in payload["insights"]]


class TestFreeTextSavingsTarget:
    def test_parses_dollar_amount_and_months(self) -> None:
        assert _parse_savings_target_from_question("How can I save $10000 in 3 months?") == (10000.0, 90)

    def test_parses_amount_without_dollar_sign_and_weeks(self) -> None:
        assert _parse_savings_target_from_question("save 500 dollars in 2 weeks") == (500.0, 14)

    def test_parses_comma_separated_amount(self) -> None:
        assert _parse_savings_target_from_question("put aside 1,200 within 6 weeks") == (1200.0, 42)

    def test_returns_none_when_no_target_present(self) -> None:
        assert _parse_savings_target_from_question("Where am I overspending?") is None

    def test_endpoint_answers_feasibility_directly(self) -> None:
        response = client.post(
            "/advisor/respond",
            json=_advisor_request("How can I save 10000 in 3 months?"),
        )
        assert response.status_code == 200
        payload = response.json()
        assert "$10000" in payload["answer"] or "10000" in payload["answer"]
        assert "month" in payload["answer"].lower()


class TestInterestAndMonthOverMonthQuestions:
    def test_interest_question_reports_real_numbers(self) -> None:
        response = client.post(
            "/advisor/respond",
            json=_advisor_request(
                "How much interest have I paid?",
                dashboard=_dashboard_payload(kpis={
                    "net_cash_flow": 200, "income": 5000, "expenses": 4800, "savings_rate": 4,
                    "interest_paid": 340, "debt_payments": 900, "budget_health": 50,
                    "financial_health_score": 40, "internal_transfers": 0, "review_count": 0,
                }),
            ),
        )
        assert response.status_code == 200
        assert "340" in response.json()["answer"]

    def test_month_over_month_question_compares_last_two_months(self) -> None:
        response = client.post(
            "/advisor/respond",
            json=_advisor_request(
                "What changed compared to last month?",
                dashboard=_dashboard_payload(monthly_trend=[
                    {"label": "May 2026", "income": 5000, "expenses": 3800, "net_cash_flow": 1200},
                    {"label": "Jun 2026", "income": 5000, "expenses": 4400, "net_cash_flow": 600},
                ]),
            ),
        )
        assert response.status_code == 200
        payload = response.json()
        assert "Jun 2026" in payload["answer"] and "May 2026" in payload["answer"]
        assert "600" in payload["answer"]  # the $600 expense delta

    def test_month_over_month_question_with_insufficient_data_says_so_explicitly(self) -> None:
        """Regression test: previously a 'what changed' question with <2 months of trend data would
        silently fall through to an unrelated branch instead of saying data was insufficient."""
        response = client.post(
            "/advisor/respond",
            json=_advisor_request(
                "What changed compared to last month?",
                dashboard=_dashboard_payload(monthly_trend=[]),
            ),
        )
        assert response.status_code == 200
        answer = response.json()["answer"].lower()
        assert "not enough" in answer or "at least two months" in answer


class TestInvestmentGuidanceIsEducationalOnly:
    def _no_specific_products_named(self, text: str) -> bool:
        banned = ["s&p 500", "nasdaq", "etf ticker", "vfv", "voo", "tsx", "bitcoin", "buy shares of"]
        lowered = text.lower()
        return not any(term in lowered for term in banned)

    def test_redirects_to_debt_paydown_when_debt_is_high(self) -> None:
        response = client.post(
            "/advisor/respond",
            json=_advisor_request(
                "Should I start investing?",
                dashboard=_dashboard_payload(kpis={
                    "net_cash_flow": 100, "income": 5000, "expenses": 4900, "savings_rate": 2,
                    "interest_paid": 400, "debt_payments": 2200, "budget_health": 30,
                    "financial_health_score": 25, "internal_transfers": 0, "review_count": 0,
                }),
            ),
        )
        assert response.status_code == 200
        answer = response.json()["answer"].lower()
        assert "debt" in answer
        assert self._no_specific_products_named(answer)

    def test_educational_framing_when_finances_are_healthy(self) -> None:
        response = client.post(
            "/advisor/respond",
            json=_advisor_request(
                "Should I start investing?",
                dashboard=_dashboard_payload(kpis={
                    "net_cash_flow": 1500, "income": 6000, "expenses": 4500, "savings_rate": 25,
                    "interest_paid": 0, "debt_payments": 100, "budget_health": 90,
                    "financial_health_score": 88, "internal_transfers": 0, "review_count": 0,
                }),
                goals=[{
                    "id": "g1", "name": "Emergency Fund", "target_amount": 15000,
                    "current_amount": 15000, "deadline": "2027-01-01", "monthly_contribution_target": 0,
                }],
            ),
        )
        assert response.status_code == 200
        answer = response.json()["answer"]
        assert "educational" in answer.lower() or "not investment advice" in answer.lower()
        assert self._no_specific_products_named(answer)
        assert "licensed financial advisor" in answer.lower()

    def test_savings_plan_financial_summary_includes_investment_insight(self) -> None:
        response = client.post(
            "/advisor/savings-plan",
            json=_advisor_request(
                "How can I save faster?",
                dashboard=_dashboard_payload(kpis={
                    "net_cash_flow": 1500, "income": 6000, "expenses": 4500, "savings_rate": 25,
                    "interest_paid": 0, "debt_payments": 100, "budget_health": 90,
                    "financial_health_score": 88, "internal_transfers": 0, "review_count": 0,
                }),
                goals=[{
                    "id": "g1", "name": "Emergency Fund", "target_amount": 15000,
                    "current_amount": 15000, "deadline": "2027-01-01", "monthly_contribution_target": 0,
                }],
            ),
        )
        assert response.status_code == 200
        summary_text = " ".join(item["recommendation"] for item in response.json()["financial_summary"])
        assert "educational" in summary_text.lower() or "not investment advice" in summary_text.lower()


class TestGoalRecalculationGivesAchievableAlternative:
    def test_shortfall_goal_message_states_concrete_alternative(self) -> None:
        goal = GoalInput(
            id="g1", name="New Car", target_amount=30000, current_amount=0,
            deadline="2026-10-20", monthly_contribution_target=1000,  # ~3 months away, unreachable
        )
        forecasts = _estimate_goal_forecasts([goal], cut_savings=200.0, avg_monthly_net=500.0)
        forecast = forecasts[0]

        assert forecast.verdict in ("shortfall", "needs_income_boost")
        # Alternative (a): a lower amount by the same deadline.
        assert f"${forecast.max_reachable_by_deadline:.0f}" in forecast.message
        # Alternative (b): the same amount, reachable by a later, concretely-stated date.
        assert forecast.projected_completion_date in forecast.message or "isn't reachable" in forecast.message

    def test_on_track_goal_has_no_gap_language(self) -> None:
        goal = GoalInput(
            id="g1", name="Small Buffer", target_amount=500, current_amount=400,
            deadline="2027-01-01", monthly_contribution_target=50,
        )
        forecasts = _estimate_goal_forecasts([goal], cut_savings=0.0, avg_monthly_net=2000.0)
        forecast = forecasts[0]
        assert forecast.verdict == "on_track"
        assert forecast.shortfall_per_month == 0.0

    def test_zero_capacity_goal_states_unreachable_rather_than_absurd_date(self) -> None:
        goal = GoalInput(
            id="g1", name="Impossible Goal", target_amount=50000, current_amount=0,
            deadline="2026-09-01", monthly_contribution_target=5000,
        )
        forecasts = _estimate_goal_forecasts([goal], cut_savings=0.0, avg_monthly_net=-100.0)
        forecast = forecasts[0]
        assert forecast.verdict == "needs_income_boost"
        assert "isn't reachable" in forecast.message
        assert "9999" not in forecast.message
