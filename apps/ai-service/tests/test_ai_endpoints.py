from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def _dashboard_payload() -> dict:
    return {
        "generated_at": "2026-07-07T10:00:00",
        "kpis": {
            "net_cash_flow": 1200,
            "income": 5000,
            "expenses": 3800,
            "savings_rate": 24,
            "interest_paid": 90,
            "debt_payments": 450,
            "budget_health": 72,
            "financial_health_score": 68,
            "internal_transfers": 2,
            "review_count": 1,
        },
        "top_expense_categories": [
            {"category": "restaurants", "total": 420},
            {"category": "shopping", "total": 260},
            {"category": "bill_payments", "total": 180},
        ],
        "monthly_trend": [],
        "yearly_trend": [],
        "spending_calendar": [],
    }


def test_advisor_respond() -> None:
    response = client.post(
        "/advisor/respond",
        json={
            "provider": "local-rules",
            "question": "Where am I overspending?",
            "dashboard": _dashboard_payload(),
            "transactions": [
                {
                    "id": "1",
                    "account_name": "Chequing",
                    "posted_at": "2026-07-01T00:00:00",
                    "amount": -85,
                    "category": "restaurants",
                    "description_raw": "UBER EATS TORONTO",
                    "merchant_normalized": "uber eats toronto",
                    "confidence_score": 0.93,
                    "is_internal_transfer": False,
                }
            ],
            "goals": [],
        },
    )

    assert response.status_code == 200
    assert response.json()["provider"] == "local-rules"
    assert response.json()["insights"]


def test_savings_plan() -> None:
    response = client.post(
        "/advisor/savings-plan",
        json={
            "provider": "local-rules",
            "question": "How can I save faster?",
            "dashboard": _dashboard_payload(),
            "transactions": [],
            "goals": [
                {
                    "id": "goal-1",
                    "name": "Emergency Fund",
                    "target_amount": 12000,
                    "current_amount": 3000,
                    "deadline": "2027-01-01",
                    "monthly_contribution_target": 400,
                }
            ],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["total_monthly_savings"] > 0
    assert payload["goal_forecasts"]


def test_categorization_suggest() -> None:
    response = client.post(
        "/categorization/suggest",
        json={
            "provider": "local-rules",
            "transactions": [
                {
                    "id": "txn-1",
                    "account_name": "Chequing",
                    "posted_at": "2026-07-01T00:00:00",
                    "amount": -40,
                    "category": "unknown",
                    "description_raw": "SHELL STATION",
                    "merchant_normalized": "shell station",
                    "confidence_score": 0.4,
                    "is_internal_transfer": False,
                }
            ],
        },
    )

    assert response.status_code == 200
    assert response.json()["suggestions"][0]["category"] == "fuel"
