from __future__ import annotations

from datetime import date, datetime
from typing import Literal, Optional

from fastapi import FastAPI
from pydantic import BaseModel, Field
from app import providers


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
    provider: Literal['local-rules', 'ollama', 'openai-compatible']
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
    required_monthly_savings: float
    projected_completion_date: str
    success_probability: float


class SavingsPlanResponse(BaseModel):
    recommendations: list[SavingsRecommendation]
    total_monthly_savings: float
    goal_forecasts: list[GoalForecast]


class CategorizationSuggestion(BaseModel):
    transaction_id: str
    category: str
    confidence_score: float
    rationale: str


class CategorizationRequest(BaseModel):
    provider: Literal['local-rules', 'ollama', 'openai-compatible']
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


def _estimate_goal_forecasts(goals: list[GoalInput], monthly_savings: float) -> list[GoalForecast]:
    forecasts: list[GoalForecast] = []

    for goal in goals:
        remaining = max(goal.target_amount - goal.current_amount, 0)
        monthly_required = round(remaining / max(_days_until(goal.deadline) / 30, 1), 2)
        actual_monthly = max(goal.monthly_contribution_target + monthly_savings, 0.01)
        months_to_complete = remaining / actual_monthly if remaining > 0 else 0
        projected_completion = date.today().replace(day=1)
        projected_completion_date = (
            projected_completion.fromordinal(
                projected_completion.toordinal() + int(round(months_to_complete * 30))
            )
            if remaining > 0
            else projected_completion
        )
        success_probability = min(100.0, round((actual_monthly / max(monthly_required, 1)) * 70 + 30, 1))

        forecasts.append(
            GoalForecast(
                goal_id=goal.id,
                required_monthly_savings=monthly_required,
                projected_completion_date=projected_completion_date.isoformat(),
                success_probability=success_probability,
            )
        )

    return forecasts


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


def _advisor_from_rules(request: AdvisorRequest) -> AdvisorResponse:
    insights: list[AdvisorInsight] = []
    transactions = request.transactions
    categories = {category.category: category.total for category in request.dashboard.top_expense_categories}

    restaurant_total = categories.get('restaurants', 0)
    shopping_total = categories.get('shopping', 0)
    fee_total = categories.get('fees', 0)
    subscriptions = _top_transactions(transactions, categories={'bill_payments', 'utilities'}, limit=2)

    if restaurant_total > 0:
        insights.append(
            AdvisorInsight(
                title='Restaurant spend stands out',
                detail=f'Restaurant spend is {restaurant_total:.0f} CAD in the current dataset.',
                supporting_data='Top driver: '
                + ', '.join(transaction.description_raw for transaction in _top_transactions(transactions, categories={'restaurants'})),
            )
        )

    if shopping_total > 0:
        insights.append(
            AdvisorInsight(
                title='Shopping has room to trim',
                detail=f'Shopping spend totals {shopping_total:.0f} CAD.',
                supporting_data='Largest shopping transactions: '
                + ', '.join(transaction.description_raw for transaction in _top_transactions(transactions, categories={'shopping'})),
            )
        )

    if fee_total > 0:
        insights.append(
            AdvisorInsight(
                title='Fees are reducing cash flow',
                detail=f'Fees and service charges total {fee_total:.0f} CAD.',
                supporting_data='Review bank fee patterns and interest charges in the dashboard.',
            )
        )

    if subscriptions:
        insights.append(
            AdvisorInsight(
                title='Recurring bills may be optimised',
                detail='Recurring utility or bill transactions were detected.',
                supporting_data='Potential recurring items: '
                + ', '.join(transaction.description_raw for transaction in subscriptions),
            )
        )

    if not insights:
        insights.append(
            AdvisorInsight(
                title='Data looks stable',
                detail='No major overspending cluster was detected from the current transaction history.',
                supporting_data='Continue importing more months of data for stronger recommendations.',
            )
        )

    answer = (
        f"{request.question.strip()} Based on your current data, net cash flow is "
        f"{request.dashboard.kpis.net_cash_flow:.0f} CAD with a savings rate of "
        f"{request.dashboard.kpis.savings_rate:.1f}%. "
        f"Main action areas are {', '.join(insight.title.lower() for insight in insights[:2])}."
    )

    return AdvisorResponse(provider=request.provider, answer=answer, insights=insights)


def _savings_plan_from_rules(request: AdvisorRequest) -> SavingsPlanResponse:
    category_totals = {category.category: category.total for category in request.dashboard.top_expense_categories}
    candidates = [
        ('unused_subscriptions', 'Review recurring utility and subscription bills', category_totals.get('bill_payments', 0) * 0.18),
        ('duplicate_services', 'Consolidate overlapping services', category_totals.get('utilities', 0) * 0.12),
        ('restaurants', 'Reduce restaurant and delivery spend', category_totals.get('restaurants', 0) * 0.22),
        ('shopping', 'Trim discretionary shopping', category_totals.get('shopping', 0) * 0.18),
        ('travel', 'Pause discretionary travel spend', category_totals.get('travel', 0) * 0.1),
    ]

    recommendations: list[SavingsRecommendation] = []
    total_monthly_savings = 0.0

    for category, title, estimate in candidates:
      monthly_savings = round(estimate, 2)
      if monthly_savings <= 0:
          continue
      total_monthly_savings += monthly_savings
      recommendations.append(
          SavingsRecommendation(
              category=category,
              title=title,
              monthly_savings=monthly_savings,
              goal_impact_days=max(int(monthly_savings * 1.4), 7),
              rationale=f'Estimated from current {category.replace("_", " ")} spend patterns in your local transaction history.',
          )
      )

    forecasts = _estimate_goal_forecasts(request.goals, total_monthly_savings)

    return SavingsPlanResponse(
        recommendations=recommendations,
        total_monthly_savings=round(total_monthly_savings, 2),
        goal_forecasts=forecasts,
    )


def _categorize_with_rules(request: CategorizationRequest) -> CategorizationResponse:
    keyword_map = {
        'salary': ('salary', 0.98, 'Matched salary-related payroll keywords.'),
        'payroll': ('salary', 0.98, 'Matched payroll wording in the description.'),
        'uber eats': ('restaurants', 0.93, 'Matched food delivery merchant.'),
        'restaurant': ('restaurants', 0.9, 'Matched restaurant keyword.'),
        'walmart': ('groceries', 0.82, 'Matched grocery and household merchant.'),
        'costco': ('groceries', 0.88, 'Matched warehouse grocery merchant.'),
        'shell': ('fuel', 0.9, 'Matched fuel merchant.'),
        'insurance': ('insurance', 0.91, 'Matched insurance keyword.'),
        'transfer': ('bank_transfers', 0.89, 'Matched transfer wording.'),
        'interest': ('interest_charges', 0.86, 'Matched interest-related wording.'),
        'amazon': ('shopping', 0.92, 'Matched shopping merchant.'),
    }

    suggestions: list[CategorizationSuggestion] = []

    for transaction in request.transactions:
        normalized = transaction.description_raw.lower()
        chosen = ('unknown', max(transaction.confidence_score, 0.45), 'No stronger local rule matched.')

        for keyword, suggestion in keyword_map.items():
            if keyword in normalized:
                chosen = suggestion
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
            return result
    return local


@app.post('/categorization/suggest', response_model=CategorizationResponse)
def categorization_suggest(request: CategorizationRequest) -> CategorizationResponse:
    if request.provider != 'local-rules':
        result = providers.dispatch_categorization(request)
        if result is not None:
            return result
    return _categorize_with_rules(request)
