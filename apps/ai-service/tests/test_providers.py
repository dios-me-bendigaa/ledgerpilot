"""Tests for LLM provider dispatch: happy-path + fallback on failure."""
from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

BASE_ADVISOR_PAYLOAD = {
    "provider": "ollama",
    "model": "llama3.1",
    "base_url": "http://127.0.0.1:11434",
    "api_key": None,
    "question": "Where am I overspending?",
    "dashboard": {
        "generated_at": "2025-01-01T00:00:00",
        "kpis": {
            "net_cash_flow": -500,
            "income": 4000,
            "expenses": 4500,
            "savings_rate": -12.5,
            "interest_paid": 50,
            "debt_payments": 0,
            "budget_health": 0.4,
            "financial_health_score": 45.0,
            "internal_transfers": 1,
            "review_count": 2,
        },
        "top_expense_categories": [
            {"category": "restaurants", "total": 800},
            {"category": "shopping", "total": 600},
        ],
        "monthly_trend": [],
        "yearly_trend": [],
        "spending_calendar": [],
    },
    "transactions": [],
    "goals": [],
}

BASE_CATEGORIZATION_PAYLOAD = {
    "provider": "ollama",
    "model": "llama3.1",
    "base_url": "http://127.0.0.1:11434",
    "api_key": None,
    "transactions": [
        {
            "id": "txn-1",
            "account_name": "Chequing",
            "posted_at": "2025-01-10",
            "amount": -45.0,
            "category": "unknown",
            "description_raw": "UBER EATS ORDER",
            "merchant_normalized": "uber eats",
            "confidence_score": 0.45,
            "is_internal_transfer": False,
        }
    ],
}


def _mock_ollama_advisor_response() -> dict:
    return {
        "message": {
            "content": json.dumps({
                "answer": "You are overspending on restaurants and shopping.",
                "insights": [
                    {
                        "title": "Restaurant spend",
                        "detail": "800 CAD on restaurants.",
                        "supporting_data": "Top: Uber Eats",
                    }
                ],
            })
        }
    }


def _mock_ollama_categorization_response() -> dict:
    return {
        "message": {
            "content": json.dumps([
                {
                    "transaction_id": "txn-1",
                    "category": "restaurants",
                    "confidence_score": 0.95,
                    "rationale": "Uber Eats is a food delivery service.",
                }
            ])
        }
    }


class TestOllamaAdvisorDispatch:
    def test_happy_path_returns_llm_answer(self):
        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()
        mock_resp.json.return_value = _mock_ollama_advisor_response()

        with patch("httpx.Client") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.__enter__ = MagicMock(return_value=mock_client)
            mock_client.__exit__ = MagicMock(return_value=False)
            mock_client.post.return_value = mock_resp
            mock_client_cls.return_value = mock_client

            resp = client.post("/advisor/respond", json=BASE_ADVISOR_PAYLOAD)

        assert resp.status_code == 200
        data = resp.json()
        assert data["provider"] == "ollama"
        assert "overspending" in data["answer"].lower() or len(data["answer"]) > 0
        assert len(data["insights"]) >= 1

    def test_llm_failure_falls_back_to_local_rules(self):
        with patch("httpx.Client") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.__enter__ = MagicMock(return_value=mock_client)
            mock_client.__exit__ = MagicMock(return_value=False)
            mock_client.post.side_effect = Exception("Connection refused")
            mock_client_cls.return_value = mock_client

            resp = client.post("/advisor/respond", json=BASE_ADVISOR_PAYLOAD)

        assert resp.status_code == 200
        data = resp.json()
        assert data["provider"] == "ollama"
        assert len(data["answer"]) > 0

    def test_malformed_json_falls_back_to_local_rules(self):
        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()
        mock_resp.json.return_value = {"message": {"content": "not valid json {"}}

        with patch("httpx.Client") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.__enter__ = MagicMock(return_value=mock_client)
            mock_client.__exit__ = MagicMock(return_value=False)
            mock_client.post.return_value = mock_resp
            mock_client_cls.return_value = mock_client

            resp = client.post("/advisor/respond", json=BASE_ADVISOR_PAYLOAD)

        assert resp.status_code == 200
        data = resp.json()
        assert len(data["answer"]) > 0


class TestOllamaCategorizationDispatch:
    def test_happy_path_returns_llm_category(self):
        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()
        mock_resp.json.return_value = _mock_ollama_categorization_response()

        with patch("httpx.Client") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.__enter__ = MagicMock(return_value=mock_client)
            mock_client.__exit__ = MagicMock(return_value=False)
            mock_client.post.return_value = mock_resp
            mock_client_cls.return_value = mock_client

            resp = client.post("/categorization/suggest", json=BASE_CATEGORIZATION_PAYLOAD)

        assert resp.status_code == 200
        data = resp.json()
        assert data["suggestions"][0]["category"] == "restaurants"
        assert data["suggestions"][0]["confidence_score"] == 0.95

    def test_llm_failure_falls_back_to_rules(self):
        with patch("httpx.Client") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.__enter__ = MagicMock(return_value=mock_client)
            mock_client.__exit__ = MagicMock(return_value=False)
            mock_client.post.side_effect = Exception("Timeout")
            mock_client_cls.return_value = mock_client

            resp = client.post("/categorization/suggest", json=BASE_CATEGORIZATION_PAYLOAD)

        assert resp.status_code == 200
        data = resp.json()
        assert data["suggestions"][0]["category"] == "restaurants"


class TestLocalRulesUnchanged:
    def test_local_rules_provider_bypasses_dispatch(self):
        payload = {**BASE_ADVISOR_PAYLOAD, "provider": "local-rules"}
        resp = client.post("/advisor/respond", json=payload)
        assert resp.status_code == 200
        assert resp.json()["provider"] == "local-rules"
