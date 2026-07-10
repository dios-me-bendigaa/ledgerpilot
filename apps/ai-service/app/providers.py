"""Provider dispatch — routes advisor/categorization requests to ollama, openai-compatible,
or falls back to local-rules on any error/timeout."""
from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING, Any

import httpx

if TYPE_CHECKING:
    from app.main import (
        AdvisorRequest,
        AdvisorResponse,
        CategorizationRequest,
        CategorizationResponse,
        SavingsPlanResponse,
    )

logger = logging.getLogger(__name__)

_TIMEOUT = 30.0
_MAX_TOKENS = 1024


def _advisor_prompt(request: AdvisorRequest) -> str:
    cats = ', '.join(
        f"{c.category}: {c.total:.0f} CAD"
        for c in request.dashboard.top_expense_categories[:6]
    )
    return (
        f"You are a personal finance advisor. Answer based ONLY on this data.\n\n"
        f"Question: {request.question}\n\n"
        f"Net cash flow: {request.dashboard.kpis.net_cash_flow:.0f} CAD\n"
        f"Income: {request.dashboard.kpis.income:.0f} CAD\n"
        f"Expenses: {request.dashboard.kpis.expenses:.0f} CAD\n"
        f"Savings rate: {request.dashboard.kpis.savings_rate:.1f}%\n"
        f"Top categories: {cats}\n"
        f"Transactions analysed: {len(request.transactions)}\n\n"
        f"Reply with a JSON object with keys: answer (string), "
        f"insights (array of {{title, detail, supporting_data}}).\n"
        f"Be specific, grounded in the numbers above. No generic advice."
    )


def _savings_prompt(request: AdvisorRequest) -> str:
    cats = ', '.join(
        f"{c.category}: {c.total:.0f} CAD"
        for c in request.dashboard.top_expense_categories[:6]
    )
    goals_summary = '; '.join(
        f"{g.name} ({g.target_amount:.0f} CAD by {g.deadline})"
        for g in request.goals[:3]
    )
    return (
        f"You are a savings optimizer. Recommend cuts based ONLY on this data.\n\n"
        f"Top spending: {cats}\n"
        f"Goals: {goals_summary or 'none'}\n"
        f"Savings rate: {request.dashboard.kpis.savings_rate:.1f}%\n\n"
        f"Reply with JSON: recommendations (array of "
        f"{{category, title, monthly_savings (number), goal_impact_days (int), rationale}}).\n"
        f"Only include categories where real spend exists. Be specific and grounded."
    )


def _categorize_prompt(transactions_text: str) -> str:
    return (
        f"You are a Canadian personal finance categorization engine.\n"
        f"Categorize each transaction. Use the account_name as strong context:\n"
        f"  - Credits (positive amounts) in a credit card account -> credit_card_payments\n"
        f"  - Credits (positive amounts) in a line of credit account -> line_of_credit_payments\n"
        f"  - Debits from chequing labeled as LOC/credit-card payment -> same payment category\n\n"
        f"Categories (pick exactly one):\n"
        f"  Income: salary, income, interest_income, refunds\n"
        f"  Expenses: groceries, restaurants, fuel, shopping, travel, utilities, insurance,\n"
        f"            bill_payments, fees, interest_charges, taxes, lifestyle, india_expenses\n"
        f"  Payments/Debt: credit_card_payments, line_of_credit_payments, mortgage_payments,\n"
        f"                  car_payments, rent\n"
        f"  Transfers: bank_transfers, internal_transfers, interac_e_transfers, investments\n"
        f"  Fallback: unknown\n\n"
        f"{transactions_text}\n\n"
        f"Reply with JSON array: "
        f"[{{transaction_id, category, confidence_score (0-1), rationale}}]"
    )


def _chat_ollama(base_url: str, model: str, prompt: str) -> str:
    url = base_url.rstrip('/') + '/api/chat'
    payload = {
        'model': model,
        'messages': [{'role': 'user', 'content': prompt}],
        'stream': False,
        'format': 'json',
    }
    with httpx.Client(timeout=_TIMEOUT) as client:
        resp = client.post(url, json=payload)
        resp.raise_for_status()
        data = resp.json()
        return data['message']['content']


def _chat_openai(base_url: str, model: str, api_key: str, prompt: str) -> str:
    url = base_url.rstrip('/') + '/v1/chat/completions'
    headers = {'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'}
    payload = {
        'model': model,
        'messages': [{'role': 'user', 'content': prompt}],
        'max_tokens': _MAX_TOKENS,
        'response_format': {'type': 'json_object'},
    }
    with httpx.Client(timeout=_TIMEOUT) as client:
        resp = client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()
        return data['choices'][0]['message']['content']


def _call_llm(request: Any, prompt: str) -> str:
    provider = request.provider
    model: str = getattr(request, 'model', None) or 'llama3.1'
    base_url: str = getattr(request, 'base_url', None) or 'http://127.0.0.1:11434'
    api_key: str | None = getattr(request, 'api_key', None)

    if provider == 'ollama':
        return _chat_ollama(base_url, model, prompt)
    if provider == 'openai-compatible':
        if not api_key:
            raise ValueError('api_key required for openai-compatible provider')
        return _chat_openai(base_url, model, api_key, prompt)
    raise ValueError(f'Unknown provider: {provider}')


def dispatch_advisor(request: AdvisorRequest) -> AdvisorResponse | None:
    """Return AdvisorResponse from LLM, or None to fall back to local-rules."""
    from app.main import AdvisorInsight, AdvisorResponse
    try:
        raw = _call_llm(request, _advisor_prompt(request))
        data = json.loads(raw)
        insights = [
            AdvisorInsight(
                title=str(i.get('title', '')),
                detail=str(i.get('detail', '')),
                supporting_data=str(i.get('supporting_data', '')),
            )
            for i in data.get('insights', [])[:5]
        ]
        return AdvisorResponse(
            provider=request.provider,
            answer=str(data.get('answer', '')),
            insights=insights,
        )
    except Exception as exc:
        logger.warning('LLM advisor dispatch failed (%s), falling back to local-rules', exc)
        return None


def dispatch_savings_plan(request: AdvisorRequest) -> SavingsPlanResponse | None:
    """Return savings recommendations from LLM (goal_forecasts still computed locally), or None."""
    from app.main import SavingsPlanResponse, SavingsRecommendation
    try:
        raw = _call_llm(request, _savings_prompt(request))
        data = json.loads(raw)
        recommendations = [
            SavingsRecommendation(
                category=str(r.get('category', 'unknown')),
                title=str(r.get('title', '')),
                monthly_savings=float(r.get('monthly_savings', 0)),
                goal_impact_days=int(r.get('goal_impact_days', 7)),
                rationale=str(r.get('rationale', '')),
            )
            for r in data.get('recommendations', [])[:5]
            if float(r.get('monthly_savings', 0)) > 0
        ]
        return SavingsPlanResponse(
            recommendations=recommendations,
            total_monthly_savings=round(sum(r.monthly_savings for r in recommendations), 2),
            goal_forecasts=[],  # filled by caller from _estimate_goal_forecasts
        )
    except Exception as exc:
        logger.warning('LLM savings dispatch failed (%s), falling back to local-rules', exc)
        return None


def dispatch_categorization(request: CategorizationRequest) -> CategorizationResponse | None:
    """Return categorization from LLM, or None to fall back to local-rules."""
    from app.main import CategorizationResponse, CategorizationSuggestion
    try:
        txn_lines = '\n'.join(
            f"- id={t.id} account={t.account_name!r} desc={t.description_raw!r} amount={t.amount}"
            for t in request.transactions[:50]
        )
        raw = _call_llm(request, _categorize_prompt(txn_lines))
        data = json.loads(raw)
        suggestions = [
            CategorizationSuggestion(
                transaction_id=str(s.get('transaction_id', '')),
                category=str(s.get('category', 'unknown')),
                confidence_score=float(s.get('confidence_score', 0.5)),
                rationale=str(s.get('rationale', '')),
            )
            for s in (data if isinstance(data, list) else data.get('suggestions', []))
        ]
        if not suggestions:
            return None
        return CategorizationResponse(provider=request.provider, suggestions=suggestions)
    except Exception as exc:
        logger.warning('LLM categorization dispatch failed (%s), falling back to local-rules', exc)
        return None
