from __future__ import annotations

import re
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Literal, Optional

from fastapi import FastAPI
from pydantic import BaseModel, Field
from app import providers


# "Needed" vs "wasteful" tiers for expense categories — used by the advisor to actually answer
# "which of my expenses are waste" instead of just listing top categories by size regardless of
# whether they're essential. Deliberately conservative: anything ambiguous (india_expenses,
# remittances, insurance, taxes) is left OUT of "discretionary" rather than risk labeling a real
# obligation as waste.
ESSENTIAL_CATEGORIES = {
    'groceries', 'home_utilities', 'mobile', 'internet', 'bill_payments', 'utilities',
    'insurance', 'car_insurance', 'home_insurance', 'fuel', 'rent', 'mortgage_payments',
    'property_tax', 'taxes', 'car_payments', 'india_expenses',
}
DISCRETIONARY_CATEGORIES = {
    'restaurants', 'shopping', 'travel', 'vacation', 'lifestyle',
}
# Pure cost with no offsetting value — always called out separately, never "discretionary" (that
# framing implies a choice; a bank fee or interest charge is a cost to eliminate outright).
PURE_COST_CATEGORIES = {'fees', 'interest_charges'}


class HealthResponse(BaseModel):
    status: str
    service: str


class GoalInput(BaseModel):
    id: str
    name: str
    target_amount: float
    current_amount: float
    deadline: str
    monthly_contribution_target: float


class CategoryTotal(BaseModel):
    category: str
    total: float


class MonthlyTrendPoint(BaseModel):
    label: str
    income: float
    expenses: float
    net_cash_flow: float


class CalendarHeatmapPoint(BaseModel):
    date: str
    expense_total: float


class DashboardKpis(BaseModel):
    net_cash_flow: float
    income: float
    expenses: float
    savings_rate: float
    interest_paid: float
    debt_payments: float
    budget_health: float
    financial_health_score: float
    internal_transfers: int
    review_count: int


class DashboardSnapshot(BaseModel):
    generated_at: str
    kpis: DashboardKpis
    top_expense_categories: list[CategoryTotal]
    monthly_trend: list[MonthlyTrendPoint]
    yearly_trend: list[MonthlyTrendPoint]
    spending_calendar: list[CalendarHeatmapPoint]


class TransactionInput(BaseModel):
    id: str
    account_name: str
    posted_at: str
    amount: float
    category: str
    description_raw: str
    merchant_normalized: str
    confidence_score: float
    is_internal_transfer: bool


class AdvisorRequest(BaseModel):
    provider: Literal['local-rules', 'ollama', 'openai-compatible', 'claude']
    question: str
    dashboard: DashboardSnapshot
    transactions: list[TransactionInput] = Field(default_factory=list)
    goals: list[GoalInput] = Field(default_factory=list)
    model: Optional[str] = None
    base_url: Optional[str] = None
    api_key: Optional[str] = None


class AdvisorInsight(BaseModel):
    title: str
    detail: str
    supporting_data: str


class AdvisorResponse(BaseModel):
    provider: str
    answer: str
    insights: list[AdvisorInsight]


class SavingsRecommendation(BaseModel):
    category: str
    title: str
    monthly_savings: float
    goal_impact_days: int
    rationale: str


class GoalForecast(BaseModel):
    goal_id: str
    goal_name: str
    required_monthly_savings: float
    projected_completion_date: str
    success_probability: float
    verdict: str  # 'on_track' | 'achievable_with_cuts' | 'shortfall' | 'needs_income_boost'
    shortfall_per_month: float
    max_reachable_by_deadline: float
    message: str


class FinancialHealthInsight(BaseModel):
    title: str
    metric: str
    recommendation: str
    severity: str  # 'good' | 'warning' | 'alert'


class SavingsPlanResponse(BaseModel):
    recommendations: list[SavingsRecommendation]
    total_monthly_savings: float
    goal_forecasts: list[GoalForecast]
    financial_summary: list[FinancialHealthInsight]


class CategorizationSuggestion(BaseModel):
    transaction_id: str
    category: str
    confidence_score: float
    rationale: str


class CategorizationRequest(BaseModel):
    provider: Literal['local-rules', 'ollama', 'openai-compatible', 'claude']
    transactions: list[TransactionInput]
    model: Optional[str] = None
    base_url: Optional[str] = None
    api_key: Optional[str] = None


class CategorizationResponse(BaseModel):
    provider: str
    suggestions: list[CategorizationSuggestion]


app = FastAPI(title="LedgerPilot AI Service", version="1.0.0")


def _parse_date(value: str) -> date:
    return datetime.fromisoformat(value).date()


def _days_until(deadline: str) -> int:
    return max((_parse_date(deadline) - date.today()).days, 1)


def _add_days(base: date, days: float) -> date:
    """Adds a (possibly large) number of days to a date without raising on absurd inputs — a
    goal that's barely making progress can project centuries out, which should read as "not
    reachable on this trajectory" rather than crash the endpoint."""
    try:
        return date.fromordinal(min(base.toordinal() + int(round(days)), date.max.toordinal()))
    except (ValueError, OverflowError):
        return date(9999, 12, 31)


def _estimate_goal_forecasts(
    goals: list[GoalInput],
    cut_savings: float,
    avg_monthly_net: float,
) -> list[GoalForecast]:
    forecasts: list[GoalForecast] = []
    total_monthly_available = avg_monthly_net + cut_savings

    for goal in goals:
        remaining = max(goal.target_amount - goal.current_amount, 0)
        months_left = max(_days_until(goal.deadline) / 30, 0.1)
        monthly_required = round(remaining / months_left, 2)

        max_reachable = round(max(total_monthly_available * months_left + goal.current_amount, goal.current_amount), 2)
        pct_reachable = max_reachable / goal.target_amount if goal.target_amount > 0 else 1.0

        # Realistic completion date for the FULL original target at the achievable monthly pace —
        # this is the "keep the same target, just push the deadline out" alternative. Computed up
        # front so shortfall/needs_income_boost messages below can state it as a concrete option
        # instead of just reporting the gap.
        reachable_at_all = total_monthly_available > 0
        if remaining <= 0:
            projected = date.today()
        elif reachable_at_all:
            months_to_complete = min(remaining / total_monthly_available, 1200)
            projected = _add_days(date.today(), months_to_complete * 30)
        else:
            projected = date(9999, 12, 31)  # never, at zero or negative net savings capacity

        if total_monthly_available >= monthly_required:
            if avg_monthly_net >= monthly_required:
                verdict = 'on_track'
                shortfall = 0.0
                message = (
                    f"You're on track. Your current net cash flow covers the required "
                    f"${monthly_required:.0f}/month without any spending cuts."
                )
            else:
                verdict = 'achievable_with_cuts'
                shortfall = 0.0
                extra_needed = monthly_required - avg_monthly_net
                message = (
                    f"Achievable — but you need to redirect ${extra_needed:.0f}/month from discretionary spending "
                    f"toward this goal. The optimizer recommendations above cover that gap."
                )
        else:
            shortfall = round(monthly_required - total_monthly_available, 2)
            # Two concrete, always-computed alternatives to "you're short": accept a lower amount
            # by the original deadline, or keep the full amount and accept a later date. Whichever
            # verdict below, the user gets a real recalculated option — not just a gap to close.
            if not reachable_at_all:
                alt_option = (
                    "At your current spending, even with every recommended cut you have $0 or less "
                    "left over each month, so this goal isn't reachable on any timeline until income "
                    "rises or spending drops further."
                )
            else:
                alt_option = (
                    f"Realistic alternatives: settle for ${max_reachable:.0f} by your original deadline, "
                    f"or keep the full ${goal.target_amount:.0f} target and expect to reach it by "
                    f"{projected.isoformat()} instead."
                )
            if shortfall > avg_monthly_net * 0.25:
                verdict = 'needs_income_boost'
                message = (
                    f"This goal requires ${monthly_required:.0f}/month, but even after all recommended "
                    f"cuts you'd only have ${max(total_monthly_available, 0):.0f}/month to save — a "
                    f"${shortfall:.0f}/month gap that spending cuts alone can't close. {alt_option}"
                )
            else:
                verdict = 'shortfall'
                message = (
                    f"You're ${shortfall:.0f}/month short of the ${monthly_required:.0f}/month needed. "
                    f"Cutting an extra ${shortfall:.0f}/month from discretionary spend would hit the original "
                    f"plan exactly. {alt_option}"
                )

        success_probability = min(100.0, round((total_monthly_available / max(monthly_required, 1)) * 70 + 30, 1))

        forecasts.append(
            GoalForecast(
                goal_id=goal.id,
                goal_name=goal.name,
                required_monthly_savings=monthly_required,
                projected_completion_date=projected.isoformat(),
                success_probability=success_probability,
                verdict=verdict,
                shortfall_per_month=shortfall,
                max_reachable_by_deadline=max_reachable,
                message=message,
            )
        )

    return forecasts


def _investment_guidance_insight(
    request: AdvisorRequest,
    debt_pct: float,
    interest: float,
    avg_monthly_income: float,
    savings_rate: float,
    num_months: int,
) -> Optional[FinancialHealthInsight]:
    """Educational-only investing guidance, shared by the financial-health summary and the advisor
    chat. Never names a specific product, fund, ticker, or timing — this app is not licensed to
    give investment advice, only general sequencing principles (debt first, then buffer, then
    invest), and only once the prior step is actually in place."""
    kpis = request.dashboard.kpis
    monthly_expenses = kpis.expenses / max(num_months, 1)
    emergency_goal = next((g for g in request.goals if 'emergency' in g.name.lower()), None)
    has_healthy_buffer = emergency_goal is not None and emergency_goal.current_amount >= monthly_expenses * 3

    if debt_pct > 20 or interest > avg_monthly_income * 0.05:
        return FinancialHealthInsight(
            title='Pay down debt before investing',
            metric=f'${interest:.0f} in interest and {debt_pct:.0f}% debt-to-income this period',
            recommendation=(
                'Educational note, not investment advice: interest on credit cards or lines of credit '
                'typically exceeds realistic investment returns, so paying down high-interest debt first '
                'is usually the higher-value move before directing money into investments.'
            ),
            severity='warning',
        )
    if savings_rate >= 15:
        if not has_healthy_buffer:
            return FinancialHealthInsight(
                title='Build your emergency fund first',
                metric=f'Target buffer: ~${monthly_expenses * 3:.0f}\u2013${monthly_expenses * 6:.0f} (3\u20136 months of expenses)',
                recommendation=(
                    'Educational note, not investment advice: with debt under control and a healthy savings '
                    'rate, a common next step is holding 3\u20136 months of expenses in an easily accessible '
                    'account before investing further, so an emergency never forces you to sell investments '
                    'or take on high-interest debt.'
                ),
                severity='good',
            )
        return FinancialHealthInsight(
            title='Fundamentals are in place for further investing',
            metric=f'Savings rate {savings_rate:.1f}%, debt-to-income {debt_pct:.0f}%, buffer already funded',
            recommendation=(
                'Educational note, not investment advice: with debt low, savings healthy, and a buffer '
                'already funded, many people at this stage look into low-cost, diversified, long-horizon '
                'investing. Speak with a licensed financial advisor for guidance specific to your goals, '
                'tax situation, and risk tolerance \u2014 this app does not recommend specific products or timing.'
            ),
            severity='good',
        )
    return None


def _financial_health_summary(request: AdvisorRequest, cut_savings: float) -> list[FinancialHealthInsight]:
    kpis = request.dashboard.kpis
    categories = {c.category: c.total for c in request.dashboard.top_expense_categories}
    insights: list[FinancialHealthInsight] = []

    # Average monthly net from trend data if available, else estimate from totals
    if request.dashboard.monthly_trend:
        recent = request.dashboard.monthly_trend[-6:]
        avg_monthly_net = sum(m.net_cash_flow for m in recent) / len(recent)
        num_months = len(request.dashboard.monthly_trend)
        avg_monthly_income = sum(m.income for m in recent) / len(recent)
    else:
        num_months = max(1, round(kpis.income / max(kpis.income / 12, 1)))
        avg_monthly_net = kpis.net_cash_flow / num_months
        avg_monthly_income = kpis.income / num_months

    # Savings rate
    savings_rate = kpis.savings_rate
    if savings_rate < 5:
        insights.append(FinancialHealthInsight(
            title='Savings rate is critically low',
            metric=f'Savings rate: {savings_rate:.1f}% (benchmark: 20%+)',
            recommendation=(
                f'You keep ${avg_monthly_net:.0f}/month on average after expenses. '
                f'The optimizer above can free up ${cut_savings:.0f}/month more. '
                f'Target 20% savings rate = ${avg_monthly_income * 0.20:.0f}/month.'
            ),
            severity='alert',
        ))
    elif savings_rate < 15:
        insights.append(FinancialHealthInsight(
            title='Savings rate below benchmark',
            metric=f'Savings rate: {savings_rate:.1f}% (benchmark: 20%+)',
            recommendation=(
                f'Good start but room to grow. Freeing up ${cut_savings:.0f}/month via the optimizer '
                f'would lift your rate closer to the 20% mark.'
            ),
            severity='warning',
        ))
    else:
        insights.append(FinancialHealthInsight(
            title='Healthy savings rate',
            metric=f'Savings rate: {savings_rate:.1f}%',
            recommendation='Strong. Keep directing surplus toward your goals.',
            severity='good',
        ))

    # Top expense category dominance
    total_expenses = kpis.expenses
    if categories:
        top_cat, top_total = max(categories.items(), key=lambda x: x[1])
        pct = top_total / max(total_expenses, 1) * 100
        if pct > 50:
            insights.append(FinancialHealthInsight(
                title=f'"{top_cat.replace("_", " ").title()}" dominates spending',
                metric=f'${top_total:.0f} = {pct:.0f}% of all expenses',
                recommendation=(
                    f'One category eating more than half your expenses is a concentration risk. '
                    f'Review whether this is recurring or contains large one-time amounts.'
                ),
                severity='alert',
            ))
        elif pct > 30:
            insights.append(FinancialHealthInsight(
                title=f'"{top_cat.replace("_", " ").title()}" is your biggest spend',
                metric=f'${top_total:.0f} = {pct:.0f}% of expenses',
                recommendation='Watch this category — small reductions here have the biggest impact.',
                severity='warning',
            ))

    # Interest charges
    interest = kpis.interest_paid
    if interest > 0:
        insights.append(FinancialHealthInsight(
            title='Interest charges reduce savings',
            metric=f'${interest:.0f} paid in interest',
            recommendation=(
                f'Every dollar of interest is dead money. Prioritise paying down high-interest debt '
                f'(LOC, credit card) before investing.'
            ),
            severity='warning' if interest < avg_monthly_income else 'alert',
        ))

    # Debt-to-income
    debt = kpis.debt_payments
    debt_pct = debt / max(kpis.income, 1) * 100
    if debt_pct > 40:
        insights.append(FinancialHealthInsight(
            title='High debt-service load',
            metric=f'Debt payments are {debt_pct:.0f}% of income (safe limit: 35%)',
            recommendation='Consider consolidating or accelerating paydown to free cash flow.',
            severity='alert',
        ))
    elif debt_pct > 20:
        insights.append(FinancialHealthInsight(
            title='Moderate debt-service load',
            metric=f'Debt payments are {debt_pct:.0f}% of income',
            recommendation='Manageable but watch for new debt. Stay below 35% to keep headroom.',
            severity='warning',
        ))

    # Monthly cashflow consistency
    if request.dashboard.monthly_trend:
        negative_months = [m for m in request.dashboard.monthly_trend if m.net_cash_flow < 0]
        if len(negative_months) >= 2:
            insights.append(FinancialHealthInsight(
                title='Negative cashflow months detected',
                metric=f'{len(negative_months)} of {len(request.dashboard.monthly_trend)} months ended in deficit',
                recommendation='Spending exceeded income in multiple months. Build a 1-month buffer to avoid LOC draws.',
                severity='alert',
            ))

    # Educational-only investing guidance. This app is not licensed to give investment advice, so
    # this deliberately never names a specific product, fund, ticker, or timing — only general
    # sequencing principles, and only once debt/buffer fundamentals are actually in place.
    investment_insight = _investment_guidance_insight(request, debt_pct, interest, avg_monthly_income, savings_rate, num_months)
    if investment_insight is not None:
        insights.append(investment_insight)

    return insights


def _top_transactions(
    transactions: list[TransactionInput], *, categories: set[str], limit: int = 3
) -> list[TransactionInput]:
    return sorted(
        [
            transaction
            for transaction in transactions
            if transaction.category in categories and not transaction.is_internal_transfer
        ],
        key=lambda transaction: abs(transaction.amount),
        reverse=True,
    )[:limit]


# Recurring-charge detection deliberately excludes income and pure transfer/fixed-obligation
# categories — those repeat by nature (rent, mortgage, LOC payments) and flagging them as
# "subscriptions to review" would be noise, not insight.
_NON_DISCRETIONARY_RECURRING_CATEGORIES = {
    'salary', 'income', 'interest_income', 'refunds',
    'credit_card_payments', 'line_of_credit_payments', 'bank_transfers',
    'internal_transfers', 'interac_e_transfers', 'investments',
    'mortgage_payments', 'car_payments', 'rent',
}

_TIMEFRAME_DAYS = {'day': 1, 'week': 7, 'month': 30, 'year': 365}
# Matches free text like "save $10000 in 3 months" / "save 500 dollars within 2 weeks" /
# "put aside 1,200 by the next 6 weeks". Amount must come before the timeframe — good enough for
# the app's own suggested prompts and typical phrasing without over-engineering an NLP parser (a
# connected cloud provider handles genuinely free-form phrasing; this is the local-rules fallback).
_SAVINGS_TARGET_RE = re.compile(
    r'\$?\s?([\d][\d,]*(?:\.\d+)?)\s*(?:dollars?|cad|bucks?)?\s*'
    r'(?:in|within|over|by)\s*(?:the\s*next\s*)?(\d+)\s*(day|week|month|year)s?',
    re.IGNORECASE,
)


def _needs_vs_wants_breakdown(
    categories: dict[str, float]
) -> tuple[float, float, float, list[tuple[str, float]]]:
    """Splits expense categories into essential / discretionary / pure-cost tiers so the advisor can
    answer "which of my expenses are needed vs waste" with real numbers, instead of just listing
    the biggest categories regardless of whether they're necessary."""
    essential_total = sum(total for cat, total in categories.items() if cat in ESSENTIAL_CATEGORIES)
    discretionary_total = sum(total for cat, total in categories.items() if cat in DISCRETIONARY_CATEGORIES)
    pure_cost_total = sum(total for cat, total in categories.items() if cat in PURE_COST_CATEGORIES)
    top_discretionary = sorted(
        ((cat, total) for cat, total in categories.items() if cat in DISCRETIONARY_CATEGORIES and total > 0),
        key=lambda pair: pair[1],
        reverse=True,
    )
    return essential_total, discretionary_total, pure_cost_total, top_discretionary


def _detect_recurring_charges(
    transactions: list[TransactionInput], *, limit: int = 5
) -> list[tuple[str, int, float, float, str]]:
    """Groups transactions by merchant to find real recurring charges (2+ occurrences at a
    consistent amount). This app's categorization has no dedicated "subscription" category — a
    $9.99 streaming charge could land in shopping, lifestyle, or bill_payments depending on the
    description — so detecting by merchant + amount consistency is far more reliable than guessing
    from category alone. Returns (display_name, occurrence_count, avg_amount, total_amount, category),
    sorted by occurrence count then total spend, descending."""
    groups: dict[str, list[TransactionInput]] = defaultdict(list)
    for transaction in transactions:
        if transaction.is_internal_transfer:
            continue
        if transaction.category in _NON_DISCRETIONARY_RECURRING_CATEGORIES:
            continue
        key = (transaction.merchant_normalized or transaction.description_raw).strip().lower()
        if not key:
            continue
        groups[key].append(transaction)

    recurring: list[tuple[str, int, float, float, str]] = []
    for items in groups.values():
        if len(items) < 2:
            continue
        amounts = [abs(item.amount) for item in items]
        spread = max(amounts) - min(amounts)
        tolerance = max(min(amounts) * 0.15, 2.0)  # allow small drift (tax/tips), not unrelated charges
        if spread > tolerance:
            continue
        display_name = max((item.description_raw for item in items), key=len)
        category = max(
            {item.category for item in items},
            key=lambda cat: sum(1 for item in items if item.category == cat),
        )
        recurring.append((display_name, len(items), sum(amounts) / len(amounts), sum(amounts), category))

    recurring.sort(key=lambda entry: (entry[1], entry[3]), reverse=True)
    return recurring[:limit]


def _parse_savings_target_from_question(question: str) -> Optional[tuple[float, int]]:
    """Parses free text like "how can I save $10000 in 3 months" into (amount, days). Returns None
    if no specific target is found, in which case the advisor falls back to general analysis."""
    match = _SAVINGS_TARGET_RE.search(question)
    if not match:
        return None
    amount = float(match.group(1).replace(',', ''))
    count = int(match.group(2))
    unit = match.group(3).lower()
    days = count * _TIMEFRAME_DAYS[unit]
    if amount <= 0 or days <= 0:
        return None
    return amount, days


def _feasibility_for_free_text_goal(request: AdvisorRequest, amount: float, days: int, cut_savings: float) -> str:
    """Answers a specific "can I save $X in Y days" question directly, reusing the same
    achievable-alternative math as formal goal forecasting (_estimate_goal_forecasts) via a
    synthetic one-off GoalInput — single source of truth for the feasibility calculation instead of
    a second, divergent implementation."""
    synthetic_goal = GoalInput(
        id='__adhoc__',
        name='this goal',
        target_amount=amount,
        current_amount=0.0,
        deadline=(date.today() + timedelta(days=days)).isoformat(),
        monthly_contribution_target=0.0,
    )
    avg_monthly_net = _avg_monthly_net(request)
    forecast = _estimate_goal_forecasts([synthetic_goal], cut_savings, avg_monthly_net)[0]
    return f"Saving ${amount:.0f} in {days} days needs ${forecast.required_monthly_savings:.0f}/month. {forecast.message}"


def _build_needs_vs_wants_insight(
    transactions: list[TransactionInput],
    essential_total: float,
    discretionary_total: float,
    top_discretionary: list[tuple[str, float]],
) -> Optional[AdvisorInsight]:
    if essential_total <= 0 and discretionary_total <= 0:
        return None
    if top_discretionary:
        worst_category, worst_total = top_discretionary[0]
        examples = _top_transactions(transactions, categories={worst_category}, limit=3)
        supporting = (
            'Largest transactions in that category: '
            + ', '.join(f'{t.description_raw} (${abs(t.amount):.0f})' for t in examples)
            if examples
            else 'No individual transactions available to break this down further.'
        )
        detail = (
            f'${essential_total:.0f} of tracked expenses looks essential (groceries, housing, utilities, '
            f'insurance, debt payments). ${discretionary_total:.0f} looks discretionary \u2014 the single '
            f'biggest discretionary category is {worst_category.replace("_", " ")} at ${worst_total:.0f}.'
        )
    else:
        supporting = 'Essential categories (groceries, housing, utilities, insurance, debt payments) make up tracked expenses.'
        detail = (
            f'${essential_total:.0f} of tracked expenses looks essential. No clearly discretionary '
            f'category spend was detected in the current data.'
        )
    return AdvisorInsight(title='Needed vs. waste breakdown', detail=detail, supporting_data=supporting)


def _build_recurring_insight(recurring: list[tuple[str, int, float, float, str]]) -> Optional[AdvisorInsight]:
    if not recurring:
        return None
    return AdvisorInsight(
        title='Recurring charges detected',
        detail=(
            f'{len(recurring)} merchant(s) charge you repeatedly at a consistent amount \u2014 '
            f'review these for subscriptions you no longer use.'
        ),
        supporting_data=', '.join(
            f'{name} (\u00d7{count}, ~${avg:.2f} each, {category.replace("_", " ")})'
            for name, count, avg, _, category in recurring
        ),
    )


def _build_month_over_month_insight(monthly_trend: list[MonthlyTrendPoint]) -> Optional[AdvisorInsight]:
    if len(monthly_trend) < 2:
        return None
    current, previous = monthly_trend[-1], monthly_trend[-2]
    expense_delta = current.expenses - previous.expenses
    income_delta = current.income - previous.income
    direction = 'up' if expense_delta > 0 else 'down' if expense_delta < 0 else 'flat'
    detail = (
        f'Expenses in {current.label} were {direction} ${abs(expense_delta):.0f} vs {previous.label} '
        f'(${previous.expenses:.0f} \u2192 ${current.expenses:.0f}). Income moved ${income_delta:+.0f} over '
        f'the same period, for a net cash flow change of ${current.net_cash_flow - previous.net_cash_flow:+.0f}.'
    )
    return AdvisorInsight(
        title=f'{current.label} vs {previous.label}',
        detail=detail,
        supporting_data=(
            f'{current.label} net: ${current.net_cash_flow:.0f} CAD. {previous.label} net: '
            f'${previous.net_cash_flow:.0f} CAD.'
        ),
    )


def _advisor_from_rules(request: AdvisorRequest) -> AdvisorResponse:
    transactions = request.transactions
    categories = {category.category: category.total for category in request.dashboard.top_expense_categories}
    kpis = request.dashboard.kpis
    question_lower = request.question.lower()

    # A specific, parseable "save $X in Y days/weeks/months" question gets a direct numeric answer
    # instead of the general breakdown below — this is one of the app's own suggested prompts.
    parsed_target = _parse_savings_target_from_question(request.question)
    if parsed_target is not None:
        amount, days = parsed_target
        cut_savings = _savings_plan_from_rules(request).total_monthly_savings
        answer = _feasibility_for_free_text_goal(request, amount, days, cut_savings)
        return AdvisorResponse(
            provider=request.provider,
            answer=answer,
            insights=[
                AdvisorInsight(
                    title=f'Feasibility of saving ${amount:.0f} in {days} days',
                    detail=answer,
                    supporting_data=(
                        f'Based on average net cash flow of ${_avg_monthly_net(request):.0f}/month plus '
                        f'${cut_savings:.0f}/month in identified potential cuts.'
                    ),
                )
            ],
        )

    essential_total, discretionary_total, _pure_cost_total, top_discretionary = _needs_vs_wants_breakdown(categories)
    recurring = _detect_recurring_charges(transactions)
    fee_total = categories.get('fees', 0)

    needs_vs_wants_insight = _build_needs_vs_wants_insight(transactions, essential_total, discretionary_total, top_discretionary)
    recurring_insight = _build_recurring_insight(recurring)
    fees_insight = (
        AdvisorInsight(
            title='Fees are reducing cash flow',
            detail=f'Fees and service charges total {fee_total:.0f} CAD.',
            supporting_data='Review bank fee patterns and interest charges in the dashboard.',
        )
        if fee_total > 0
        else None
    )
    month_over_month_insight = _build_month_over_month_insight(request.dashboard.monthly_trend)

    wants_interest = any(word in question_lower for word in ('interest', 'debt'))
    wants_change = any(word in question_lower for word in ('chang', 'compared', 'last month', 'vs last'))
    wants_subscriptions = any(word in question_lower for word in ('subscription', 'recurring', 'cancel'))
    wants_investing = any(word in question_lower for word in ('invest', 'stocks', 'etf'))

    insights: list[AdvisorInsight] = []
    if wants_interest:
        detail = (
            f"You've paid ${kpis.interest_paid:.0f} in interest charges, and debt payments total "
            f"${kpis.debt_payments:.0f} ({kpis.debt_payments / max(kpis.income, 1) * 100:.0f}% of income)."
        )
        answer = detail + (
            ' Every dollar of interest is money that never reaches your goals \u2014 paying down the '
            'highest-interest balance first saves the most over time.'
            if kpis.interest_paid > 0
            else ' No interest charges were detected in the current data \u2014 good sign.'
        )
        insights.append(
            AdvisorInsight(title='Interest & debt summary', detail=detail, supporting_data=f'Net cash flow: ${kpis.net_cash_flow:.0f} CAD.')
        )
    elif wants_change:
        if month_over_month_insight is not None:
            answer = month_over_month_insight.detail
            insights.append(month_over_month_insight)
        else:
            answer = (
                'Not enough monthly history to compare yet \u2014 at least two months of imported data '
                'are needed to show what changed month over month.'
            )
    elif wants_subscriptions:
        if recurring_insight is not None:
            answer = recurring_insight.detail
            insights.append(recurring_insight)
        else:
            answer = (
                'No repeating charges at a consistent amount were detected in the current transaction '
                'history \u2014 import more months of data for a stronger signal, or check the Transactions '
                'page for merchants you recognise as subscriptions.'
            )
    elif wants_investing:
        num_months = max(len(request.dashboard.monthly_trend), 1)
        avg_monthly_income = kpis.income / num_months
        debt_pct = kpis.debt_payments / max(kpis.income, 1) * 100
        guidance = _investment_guidance_insight(request, debt_pct, kpis.interest_paid, avg_monthly_income, kpis.savings_rate, num_months)
        if guidance is not None:
            answer = guidance.recommendation
            insights.append(AdvisorInsight(title=guidance.title, detail=guidance.recommendation, supporting_data=guidance.metric))
        else:
            answer = (
                "It's early to focus on investing \u2014 build up savings rate and pay down debt first, and "
                "this advisor will flag when the fundamentals are in place."
            )
    else:
        # Default / "where am I overspending" style questions: the core needs-vs-waste answer.
        if needs_vs_wants_insight is not None:
            answer = needs_vs_wants_insight.detail
            insights.append(needs_vs_wants_insight)
        else:
            answer = (
                f"Net cash flow is {kpis.net_cash_flow:.0f} CAD with a savings rate of {kpis.savings_rate:.1f}%. "
                f"No clear overspending cluster was detected from the current transaction history."
            )

    # Always append any remaining, not-yet-included insights as supporting context.
    already_titled = {insight.title for insight in insights}
    for extra in (needs_vs_wants_insight, recurring_insight, fees_insight):
        if extra is not None and extra.title not in already_titled:
            insights.append(extra)
            already_titled.add(extra.title)

    if not insights:
        insights.append(
            AdvisorInsight(
                title='Data looks stable',
                detail='No major overspending cluster was detected from the current transaction history.',
                supporting_data='Continue importing more months of data for stronger recommendations.',
            )
        )

    return AdvisorResponse(provider=request.provider, answer=answer, insights=insights[:5])


def _avg_monthly_net(request: AdvisorRequest) -> float:
    if request.dashboard.monthly_trend:
        recent = request.dashboard.monthly_trend[-6:]
        return sum(m.net_cash_flow for m in recent) / len(recent)
    num_months = max(len(request.dashboard.yearly_trend) * 12, 12)
    return request.dashboard.kpis.net_cash_flow / num_months


def _savings_plan_from_rules(request: AdvisorRequest) -> SavingsPlanResponse:
    category_totals = {category.category: category.total for category in request.dashboard.top_expense_categories}
    num_months = max(len(request.dashboard.monthly_trend), 1)

    # Convert all-time totals → monthly averages for fair comparison
    def monthly(cat: str, pct: float) -> float:
        return round(category_totals.get(cat, 0) / num_months * pct, 2)

    candidates = [
        ('unused_subscriptions', 'Review recurring utility and subscription bills', monthly('bill_payments', 0.18)),
        ('duplicate_services', 'Consolidate overlapping services', monthly('utilities', 0.12)),
        ('restaurants', 'Reduce restaurant and delivery spend', monthly('restaurants', 0.22)),
        ('shopping', 'Trim discretionary shopping', monthly('shopping', 0.18)),
        ('travel', 'Pause discretionary travel spend', monthly('travel', 0.10)),
        ('lifestyle', 'Trim lifestyle & entertainment spend', monthly('lifestyle', 0.15)),
        ('fees', 'Eliminate unnecessary bank fees', monthly('fees', 0.50)),
    ]

    recommendations: list[SavingsRecommendation] = []
    total_monthly_savings = 0.0

    for category, title, monthly_savings in candidates:
        if monthly_savings <= 0:
            continue
        total_monthly_savings += monthly_savings
        recommendations.append(
            SavingsRecommendation(
                category=category,
                title=title,
                monthly_savings=monthly_savings,
                goal_impact_days=max(int(monthly_savings * 1.4), 7),
                rationale=f'Based on your actual {category.replace("_", " ")} history averaged over {num_months} months.',
            )
        )

    avg_net = _avg_monthly_net(request)
    forecasts = _estimate_goal_forecasts(request.goals, total_monthly_savings, avg_net)
    summary = _financial_health_summary(request, total_monthly_savings)

    return SavingsPlanResponse(
        recommendations=recommendations,
        total_monthly_savings=round(total_monthly_savings, 2),
        goal_forecasts=forecasts,
        financial_summary=summary,
    )


def _categorize_with_rules(request: CategorizationRequest) -> CategorizationResponse:
    # Ordered list — first match wins. More specific phrases before generic ones.
    rules: list[tuple[str, str, float, str]] = [
        # Income / salary
        ('direct deposit', 'salary', 0.97, 'Direct deposit — likely payroll.'),
        ('depot direct', 'salary', 0.97, 'Depot direct — likely payroll.'),
        ('depot paie', 'salary', 0.98, 'Depot paie — payroll deposit.'),
        ('virement salaire', 'salary', 0.98, 'Virement salaire — salary transfer.'),
        ('virement paie', 'salary', 0.98, 'Virement paie — pay transfer.'),
        ('remuneration', 'salary', 0.97, 'Remuneration keyword.'),
        ('salary', 'salary', 0.99, 'Salary keyword.'),
        ('payroll', 'salary', 0.99, 'Payroll keyword.'),
        ('pay deposit', 'salary', 0.97, 'Pay deposit.'),
        ('employer payment', 'salary', 0.97, 'Employer payment.'),
        # Interest income
        ('interest paid', 'interest_income', 0.95, 'Interest paid to account.'),
        ('interest earned', 'interest_income', 0.95, 'Interest earned.'),
        ('interet credite', 'interest_income', 0.95, 'Interest credited (French).'),
        ('savings interest', 'interest_income', 0.95, 'Savings interest.'),
        # Refunds
        ('refund', 'refunds', 0.92, 'Refund keyword.'),
        ('remboursement', 'refunds', 0.92, 'Remboursement (French refund).'),
        ('reversal', 'refunds', 0.90, 'Transaction reversal.'),
        ('returned item', 'refunds', 0.90, 'Returned item credit.'),
        # Credit card payments
        ('credit card payment', 'credit_card_payments', 0.97, 'Credit card payment.'),
        ('mastercard payment', 'credit_card_payments', 0.97, 'Mastercard payment.'),
        ('visa payment', 'credit_card_payments', 0.97, 'Visa payment.'),
        ('carte de credit', 'credit_card_payments', 0.97, 'Carte de crédit (French).'),
        ('paiement carte', 'credit_card_payments', 0.95, 'Card payment (French).'),
        # Mortgage
        ('mortgage', 'mortgage_payments', 0.97, 'Mortgage payment.'),
        ('hypotheque', 'mortgage_payments', 0.97, 'Hypothèque (French mortgage).'),
        # Line of credit
        ('line of credit', 'line_of_credit_payments', 0.95, 'Line of credit payment.'),
        ('marge de credit', 'line_of_credit_payments', 0.95, 'Marge de crédit (French LOC).'),
        ('loc payment', 'line_of_credit_payments', 0.95, 'LOC payment.'),
        # Interac / e-transfers
        ('interac', 'interac_e_transfers', 0.96, 'Interac e-transfer.'),
        ('e-transfer', 'interac_e_transfers', 0.96, 'E-transfer.'),
        ('etransfer', 'interac_e_transfers', 0.96, 'E-transfer.'),
        ('virement interac', 'interac_e_transfers', 0.96, 'Virement Interac.'),
        # Bill payments / pre-authorized debits
        ('pre-authorized', 'bill_payments', 0.92, 'Pre-authorized payment.'),
        ('preauthorized', 'bill_payments', 0.92, 'Preauthorized payment.'),
        ('debit preautori', 'bill_payments', 0.92, 'Débit préautorisé (French PAD).'),
        ('bill payment', 'bill_payments', 0.93, 'Bill payment.'),
        ('paiement facture', 'bill_payments', 0.93, 'Bill payment (French).'),
        ('pad ', 'bill_payments', 0.90, 'Pre-authorized debit.'),
        # Utilities
        ('hydro', 'utilities', 0.93, 'Hydro utility payment.'),
        ('hydro quebec', 'utilities', 0.95, 'Hydro-Québec.'),
        ('enbridge', 'utilities', 0.93, 'Enbridge gas.'),
        ('bell canada', 'utilities', 0.93, 'Bell Canada telecom.'),
        ('videotron', 'utilities', 0.93, 'Videotron telecom.'),
        ('rogers', 'utilities', 0.91, 'Rogers telecom.'),
        ('telus', 'utilities', 0.91, 'Telus telecom.'),
        ('fido', 'utilities', 0.90, 'Fido telecom.'),
        ('koodo', 'utilities', 0.90, 'Koodo telecom.'),
        ('electric', 'utilities', 0.88, 'Electricity utility.'),
        ('internet', 'utilities', 0.87, 'Internet service.'),
        ('cable ', 'utilities', 0.86, 'Cable service.'),
        ('phone', 'utilities', 0.82, 'Phone service.'),
        # Groceries
        ('metro ', 'groceries', 0.92, 'Metro grocery store.'),
        ('iga ', 'groceries', 0.92, 'IGA grocery store.'),
        ('provigo', 'groceries', 0.92, 'Provigo grocery store.'),
        ('maxi', 'groceries', 0.90, 'Maxi grocery store.'),
        ('super c', 'groceries', 0.92, 'Super C grocery store.'),
        ('loblaws', 'groceries', 0.92, 'Loblaws grocery store.'),
        ('no frills', 'groceries', 0.92, 'No Frills grocery store.'),
        ('food basics', 'groceries', 0.92, 'Food Basics grocery store.'),
        ('walmart', 'groceries', 0.82, 'Walmart — likely groceries.'),
        ('costco', 'groceries', 0.88, 'Costco warehouse.'),
        ('supermarche', 'groceries', 0.90, 'Supermarché (French grocery).'),
        ('epicerie', 'groceries', 0.90, 'Épicerie (French grocery).'),
        ('grocery', 'groceries', 0.90, 'Grocery store.'),
        # Restaurants / food delivery
        ('uber eats', 'restaurants', 0.95, 'Uber Eats food delivery.'),
        ('doordash', 'restaurants', 0.95, 'DoorDash food delivery.'),
        ('skip the dishes', 'restaurants', 0.95, 'SkipTheDishes food delivery.'),
        ('grubhub', 'restaurants', 0.93, 'Grubhub food delivery.'),
        ('mcdonald', 'restaurants', 0.95, 'McDonald\'s.'),
        ('tim hortons', 'restaurants', 0.95, 'Tim Hortons.'),
        ('starbucks', 'restaurants', 0.95, 'Starbucks.'),
        ('subway', 'restaurants', 0.93, 'Subway restaurant.'),
        ('restaurant', 'restaurants', 0.90, 'Restaurant keyword.'),
        ('brasserie', 'restaurants', 0.88, 'Brasserie (French restaurant).'),
        ('cafe ', 'restaurants', 0.82, 'Café.'),
        # Fuel
        ('ultramar', 'fuel', 0.95, 'Ultramar gas station.'),
        ('petro canada', 'fuel', 0.95, 'Petro-Canada gas station.'),
        ('esso', 'fuel', 0.95, 'Esso gas station.'),
        ('couche tard', 'fuel', 0.88, 'Couche-Tard (fuel + convenience).'),
        ('circle k', 'fuel', 0.88, 'Circle K fuel.'),
        ('shell', 'fuel', 0.93, 'Shell gas station.'),
        ('fuel', 'fuel', 0.90, 'Fuel purchase.'),
        ('gas station', 'fuel', 0.92, 'Gas station.'),
        # Travel
        ('air canada', 'travel', 0.95, 'Air Canada flight.'),
        ('westjet', 'travel', 0.95, 'WestJet flight.'),
        ('airbnb', 'travel', 0.95, 'Airbnb accommodation.'),
        ('hotel', 'travel', 0.90, 'Hotel accommodation.'),
        ('booking.com', 'travel', 0.93, 'Booking.com accommodation.'),
        ('expedia', 'travel', 0.93, 'Expedia travel booking.'),
        ('via rail', 'travel', 0.95, 'Via Rail train.'),
        ('airline', 'travel', 0.92, 'Airline purchase.'),
        ('flight', 'travel', 0.90, 'Flight purchase.'),
        ('parking', 'travel', 0.82, 'Parking fee.'),
        # Insurance
        ('intact', 'insurance', 0.95, 'Intact Insurance.'),
        ('desjardins assurance', 'insurance', 0.95, 'Desjardins Assurance.'),
        ('td insurance', 'insurance', 0.95, 'TD Insurance.'),
        ('belair direct', 'insurance', 0.95, 'Belair Direct Insurance.'),
        ('insurance', 'insurance', 0.92, 'Insurance premium.'),
        ('assurance', 'insurance', 0.90, 'Assurance (French insurance).'),
        # Shopping
        ('amazon', 'shopping', 0.92, 'Amazon online shopping.'),
        ('apple.com', 'shopping', 0.90, 'Apple Store purchase.'),
        ('best buy', 'shopping', 0.90, 'Best Buy electronics.'),
        ('canadian tire', 'shopping', 0.90, 'Canadian Tire.'),
        ('winners', 'shopping', 0.88, 'Winners retail.'),
        ('h&m', 'shopping', 0.88, 'H&M clothing.'),
        ('zara', 'shopping', 0.88, 'Zara clothing.'),
        ('sport chek', 'shopping', 0.88, 'Sport Chek.'),
        ('ikea', 'shopping', 0.90, 'IKEA.'),
        ('dollarama', 'shopping', 0.90, 'Dollarama.'),
        ('home depot', 'shopping', 0.88, 'Home Depot.'),
        ('rona', 'shopping', 0.88, 'Rona hardware.'),
        # Investments
        ('wealthsimple', 'investments', 0.95, 'Wealthsimple investment.'),
        ('questrade', 'investments', 0.95, 'Questrade brokerage.'),
        ('disnat', 'investments', 0.95, 'Disnat (Desjardins) brokerage.'),
        ('td direct', 'investments', 0.93, 'TD Direct Investing.'),
        ('rrsp', 'investments', 0.95, 'RRSP contribution.'),
        ('tfsa', 'investments', 0.95, 'TFSA contribution.'),
        ('resp', 'investments', 0.93, 'RESP contribution.'),
        ('invest', 'investments', 0.88, 'Investment keyword.'),
        ('placement', 'investments', 0.88, 'Placement (French investment).'),
        # Taxes
        ('canada revenue', 'taxes', 0.97, 'Canada Revenue Agency payment.'),
        ('revenu canada', 'taxes', 0.97, 'Revenu Canada (French CRA).'),
        ('cra ', 'taxes', 0.97, 'CRA tax payment.'),
        ('impot', 'taxes', 0.95, 'Impôt (French tax).'),
        ('tax ', 'taxes', 0.88, 'Tax payment.'),
        # Fees
        ('service fee', 'fees', 0.92, 'Service fee.'),
        ('monthly fee', 'fees', 0.92, 'Monthly account fee.'),
        ('frais mensuel', 'fees', 0.92, 'Frais mensuel (French monthly fee).'),
        ('frais de service', 'fees', 0.92, 'Frais de service (French service fee).'),
        ('nsf', 'fees', 0.95, 'NSF (non-sufficient funds) fee.'),
        ('overdraft', 'fees', 0.93, 'Overdraft fee.'),
        # Interest charges
        ('interest charge', 'interest_charges', 0.95, 'Interest charge on account.'),
        ('interet debit', 'interest_charges', 0.95, 'Intérêt débité (French interest charge).'),
        ('frais interet', 'interest_charges', 0.93, 'Frais d\'intérêt (French interest fee).'),
        ('interest', 'interest_charges', 0.80, 'Interest keyword — possible charge.'),
        # Bank transfers (catch-all for remaining transfers)
        ('virement', 'bank_transfers', 0.85, 'Virement (French transfer).'),
        ('transfer', 'bank_transfers', 0.85, 'Transfer keyword.'),
        ('online transfer', 'bank_transfers', 0.88, 'Online transfer.'),
    ]

    suggestions: list[CategorizationSuggestion] = []

    for transaction in request.transactions:
        normalized = transaction.description_raw.lower()
        account = transaction.account_name.lower()
        chosen = ('unknown', max(transaction.confidence_score, 0.45), 'No matching rule found.')

        # Account-type context: credits in debt/credit accounts are payments.
        if transaction.amount > 0:
            if any(p in account for p in ('credit card', 'mastercard', 'visa', 'carte credit')):
                chosen = ('credit_card_payments', 0.88, 'Credit to credit card account — payment received.')
            elif any(p in account for p in ('line of credit', 'loc', 'marge', 'ligne de credit')):
                chosen = ('line_of_credit_payments', 0.88, 'Credit to LOC account — payment received.')
            elif any(p in account for p in ('mortgage', 'hypotheque')):
                chosen = ('mortgage_payments', 0.86, 'Credit to mortgage account — payment received.')

        if chosen[0] == 'unknown':
            for keyword, category, confidence, rationale in rules:
                if keyword in normalized:
                    chosen = (category, confidence, rationale)
                    break

        suggestions.append(
            CategorizationSuggestion(
                transaction_id=transaction.id,
                category=chosen[0],
                confidence_score=chosen[1],
                rationale=chosen[2],
            )
        )

    return CategorizationResponse(provider=request.provider, suggestions=suggestions)


@app.get('/health', response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status='ok', service='ai-service')


class ProviderTestRequest(BaseModel):
    provider: Literal['ollama', 'openai-compatible', 'claude']
    model: str | None = None
    base_url: str | None = None
    api_key: str | None = None


class ProviderTestResponse(BaseModel):
    success: bool
    message: str
    sample_reply: str | None = None


@app.post('/provider/test', response_model=ProviderTestResponse)
def provider_test(request: ProviderTestRequest) -> ProviderTestResponse:
    """Verifies an AI provider is actually reachable and correctly configured, with a real error
    message on failure — unlike the advisor/categorization endpoints, which deliberately swallow
    every LLM failure into a silent local-rules fallback (good for uninterrupted UX, useless for
    diagnosing a bad API key or unreachable Ollama host during setup)."""
    try:
        reply = providers.test_connection(request)
        return ProviderTestResponse(success=True, message='Connected successfully.', sample_reply=reply[:200])
    except Exception as exc:  # noqa: BLE001 - intentionally broad; message shown directly to the user
        return ProviderTestResponse(success=False, message=str(exc))


@app.post('/advisor/respond', response_model=AdvisorResponse)
def advisor_respond(request: AdvisorRequest) -> AdvisorResponse:
    if request.provider != 'local-rules':
        result = providers.dispatch_advisor(request)
        if result is not None:
            return result
    return _advisor_from_rules(request)


@app.post('/advisor/savings-plan', response_model=SavingsPlanResponse)
def advisor_savings_plan(request: AdvisorRequest) -> SavingsPlanResponse:
    local = _savings_plan_from_rules(request)
    if request.provider != 'local-rules':
        result = providers.dispatch_savings_plan(request)
        if result is not None:
            result.goal_forecasts = local.goal_forecasts
            result.financial_summary = local.financial_summary
            return result
    return local


@app.post('/categorization/suggest', response_model=CategorizationResponse)
def categorization_suggest(request: CategorizationRequest) -> CategorizationResponse:
    if request.provider != 'local-rules':
        result = providers.dispatch_categorization(request)
        if result is not None:
            return result
    return _categorize_with_rules(request)
