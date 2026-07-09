# LedgerPilot Test Charter

This file defines the expected end-to-end validation strategy for LedgerPilot.

It is intended for:

- AI agents
- future contributors
- manual testers
- release verification work

The purpose is to ensure the app is not treated like a prototype. The target is a stable desktop application that behaves correctly across repeated imports, ambiguous finance data, and large or malformed inputs.

## Test Philosophy

Validate in layers:

1. build correctness
2. local startup correctness
3. import correctness
4. normalization correctness
5. dashboard correctness
6. AI review/advisor correctness
7. goals/savings correctness
8. persistence correctness
9. packaging correctness
10. repeated-run stability

## Required Baseline Checks

Always run before deeper E2E tests:

```bash
npm run build
npm run lint
npm run typecheck
npm run test
source .venv/bin/activate && pytest apps/ai-service/tests
```

## Workspace Onboarding Tests

### Desired product behavior

The app should eventually support:

- create new workspace
- open existing workspace
- ask for workspace name
- ask for initial financial goal
- initial CSV upload capped at 5 files

### Current test expectations

Even if the current UI is incomplete, agents should validate the underlying behaviors that this onboarding requires:

1. local workspace directories are created
2. database directory exists before SQLite open
3. logs directory exists
4. settings and goals can be created without crash
5. re-opening the app does not corrupt local state

## Canonical CSV Fixture Set

Future agents should create or maintain a reusable fixture folder such as:

```text
tests/fixtures/csv/
```

At minimum, define these 4 realistic CSV scenarios.

### Fixture 1: Primary chequing account

Purpose:

- salary
- groceries
- restaurants
- fees
- one unknown merchant

Include examples like:

- payroll deposit
- grocery store debit
- restaurant delivery
- monthly bank fee
- ambiguous merchant string

### Fixture 2: Savings account

Purpose:

- internal transfers from chequing
- interest income
- manual savings deposits

### Fixture 3: Credit card statement

Purpose:

- credit card payment
- shopping
- travel
- refund

### Fixture 4: Second bank format

Purpose:

- verify format detection across a different schema
- include transfer-like text with different headers
- include duplicate-like rows

## Minimum Happy-Path E2E Scenario

Run this as the baseline scenario.

1. Start from a clean local environment.
2. Launch the app.
3. Create/open a workspace.
4. Import 4 CSV fixtures.
5. Confirm import history is created.
6. Confirm normalization runs automatically.
7. Confirm transactions persist into SQLite.
8. Confirm dashboard renders non-zero values.
9. Confirm review queue contains ambiguous rows.
10. Ask advisor: `Where am I overspending?`
11. Create goal: `Save 50000 CAD by next year`.
12. Generate savings plan.
13. Export data.
14. Create encrypted backup.
15. Restart app.
16. Confirm state is preserved.

## Incremental Import Scenario

This is critical because the user explicitly asked for staged imports.

Desired behavior:

1. import first set of up to 5 CSVs
2. process and normalize
3. later import 1-5 additional CSVs
4. merge old + new data
5. re-sort chronologically
6. re-run duplicate detection
7. preserve corrections and learned rules

Validate:

- no duplicate double-counting
- dashboards update correctly
- goal forecasts update correctly
- old transaction identifiers remain stable where possible

## Unknown Transaction Clarification Scenario

Required user expectation:

- if AI cannot classify a transaction confidently, the app should ask
- once clarified, that learning should be reused

Test steps:

1. import fixture containing 2-3 ambiguous merchants
2. confirm they appear in review queue
3. request AI category suggestions
4. manually override one merchant/category
5. import another CSV containing the same merchant pattern
6. confirm learned rule applies automatically

Validate:

- override persisted locally
- same merchant across files/banks is categorized consistently
- corrected transactions leave review queue

## Internal Transfer Detection Scenario

Test with:

- transfer out of chequing
- matching transfer into savings
- same date or close date
- same amount opposite sign

Validate:

- both rows marked internal transfer
- they do not inflate income/expense totals
- dashboard net cash flow remains correct

## Duplicate Detection Scenario

Prepare:

- exact duplicate rows across two files
- near-duplicate rows with same date/amount/merchant

Validate:

- import duplicate file detection at file-hash level
- normalization duplicate detection at transaction-fingerprint level
- duplicates are not double-counted in dashboard

## Dashboard Accuracy Scenario

For a known fixture set, compute expected totals manually and compare.

Validate at minimum:

- total income
- total expenses
- net cash flow
- top categories
- monthly comparison
- yearly comparison
- interest paid
- debt payments
- review count

Target standard:

- values should be explainable to the cent
- no unexplained rounding drift

## Goals / Savings Optimizer Scenario

Create at least 2 goals:

- Emergency Fund
- Vacation

Validate:

- required monthly savings is computed
- projected completion date is generated
- success probability is generated
- savings recommendations tie back to actual spend categories
- recommendations mention concrete categories like restaurants/shopping/subscriptions

## Advisor Scenario

Ask at least these questions:

1. `Where am I overspending?`
2. `How can I save 10000 in 3 months?`
3. `What changed compared to last month?`
4. `How much interest have I paid?`
5. `Which subscriptions should I cancel?`

Validate:

- answers are grounded in actual imported data
- no generic filler advice
- supporting data is present
- response remains stable under repeated calls

## Backup / Export Scenario

Validate:

1. encrypted backup file is created
2. backup history updates
3. export file is created
4. exported JSON contains dashboard, settings, goals, normalization history, and transactions snapshot

## Stress / Hard-Input Scenarios

Future agents should generate larger or intentionally messy test inputs.

### Stress cases

- 100k+ transactions synthetic load
- many CSV files imported sequentially
- long merchant strings
- repeated transfer chains
- mixed bank formats

### Hard-input cases

- malformed headers
- blank rows
- missing dates
- missing amounts
- negative values in parentheses
- duplicate columns
- unusual UTF-8 merchant names

Validate:

- app does not crash
- import failures are surfaced clearly
- partial success is handled gracefully
- logs explain failures

## Packaging / Release Validation

For every public release candidate:

1. verify CI success
2. verify release workflow success
3. verify both architecture artifacts exist:
   - Intel (`x64`)
   - Apple Silicon (`arm64`)
4. install on a clean Mac matching the architecture
5. confirm app launches
6. confirm no blank window
7. confirm top-left app menu is present and usable

## macOS UX Review Checklist

Compare LedgerPilot against polished Mac desktop apps.

Validate:

- app-name dropdown behavior
- File menu usefulness
- Edit menu standard actions
- View menu standard actions
- Window menu behavior
- About panel quality
- app reopen behavior after closing windows
- startup error clarity
- drag/drop feel
- first-run empty states

## Known Historical Failure Modes

These were seen during development and should be explicitly regression-tested:

1. wrong architecture artifact downloaded on Intel Mac
2. packaged runtime module-not-found for workspace packages
3. blank window with no visible failure
4. SQLite directory missing before database open
5. preload built as ESM and rejected by Electron require path
6. missing/weak macOS application menu

## Quality Bar For Agents

Do not stop at “build passes.”

An agent working on LedgerPilot should aim for:

- no crash on startup
- no silent blank windows
- no data corruption on repeated imports
- no double counting
- useful AI guidance grounded in real data
- stable packaging for both Intel and Apple Silicon
- high-confidence desktop UX on macOS

## Recommended Next Agent Actions

When picking up this repo, a strong next workflow is:

1. read `AGENT-CONTEXT.md`
2. read this `TEST-CHARTER.md`
3. inspect latest successful release tag and recent fixes
4. create/update CSV fixtures
5. run baseline checks
6. run minimum happy-path scenario
7. run incremental import scenario
8. run unknown transaction learning scenario
9. run packaging validation on both architectures
10. only then propose or implement new features
