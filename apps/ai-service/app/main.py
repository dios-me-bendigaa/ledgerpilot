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
        chosen = ('unknown', max(transaction.confidence_score, 0.45), 'No matching rule found.')

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
