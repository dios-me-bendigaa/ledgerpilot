# LedgerPilot — Product Status

Local-first, AI-assisted personal finance desktop app for macOS. Raw financial data stays
on-device by default. This file tracks **what works today** vs **the desired end state** for the
final version. Update it as functionality lands.

_Last updated: 2026-07-20 · Version: 2.0.1_

---

## Current functionality (implemented today)

### Import
- CSV import via file picker and drag-and-drop, up to 10 files per batch.
- Format auto-detection: generic amount, generic debit/credit, RBC; delimiter sniffing (`,` `;` tab).
- Original + processed CSVs copied into the local workspace; import history persisted.
- Duplicate-file detection and resume of failed imports.

### Normalization & classification
- Canonical transaction model persisted in local SQLite (`better-sqlite3`).
- Merchant normalization, duplicate-transaction fingerprinting (with repeat-occurrence handling).
- Category classification via: merchant overrides → bank's own category column → account-type
  context → description keyword rules; low-confidence rows (< 0.7) flagged for review.
- Internal-transfer detection pairs debit/credit across accounts (±1 day) and excludes them from
  spend/income.
- Normalization reports and a review queue per batch; batches can be re-processed.

### Dashboard & analytics
- KPIs: net cash flow, income, discretionary expenses, savings rate, interest paid, debt payments,
  budget health, financial-health score, internal-transfer count, review count.
- Debt breakdown (mortgage / car / rent / credit-card / line-of-credit), kept separate from spend.
- Top expense categories, expenses rolled up into parent groups with drill-down.
- Month-over-month category comparison, monthly and yearly trends, spending calendar, account→
  category flow summaries, monthly/yearly period comparisons.
- India-expense netting (Remitly debits netted against INTERAC credits).

### Review, categorization & rules
- Review queue with AI category suggestions (local-rules provider; Ollama / OpenAI-compatible
  surfaces exist).
- Manual allocation of any transaction; "teach once, apply to all" propagates a correction to
  transactions sharing the same merchant and to future imports via saved rules.
- User-defined custom categories tagged as income / expense / transfer.

### Goals, advisor & optimizer
- Unlimited savings goals with targets, deadlines, monthly-contribution targets.
- Goal feasibility forecasting and a rule-based savings optimizer.
- Advisor Q&A grounded in dashboard + transaction context; financial-health summary.

### Settings, backup & platform
- Settings persistence; Keychain-backed API-key storage; opt-in cloud AI and telemetry (off by
  default).
- Encrypted local backups with history; JSON export; "clear all data" wipe.
- Native macOS application menu; startup error fallback UI; workspace bootstrap on first launch.
- FastAPI AI sidecar auto-started by the Electron main process.

### Build & release
- CI (build/lint/typecheck/test JS + pytest) on macOS.
- Tag-driven (`v*`) release workflow building arm64 + x64 DMGs and publishing a GitHub Release.
- On-demand PR build: add the `build-mac` label to a PR to produce downloadable arm64/x64 DMG
  artifacts.

---

## Desired end state (planned for the final version)

> Product direction carried over from `AGENT-CONTEXT.md`. Edit freely — this is the plan, not a
> commitment of the current build.

### Onboarding & workspaces
- Explicit create-workspace / open-workspace home screen.
- New-workspace flow captures workspace name, primary financial goal, and an initial CSV set.

### Import UX
- Initial CSV add capped at **5 files**, with the ability to add 5 more after processing.
- New CSVs merge into existing history; full re-sort chronologically on every add.

### Unknown-transaction resolution loop
- When AI is not confident, ask the user; once clarified, apply that learning consistently across
  banks and files for similar transactions. Make the loop explicit and friendly (beyond today's
  primitive queue).

### Dashboard fidelity
- Trustworthy, easy-to-read panels; amounts accurate to the cent; richer real chart components
  instead of the current lightweight visual summaries.

### Long-term financial-goal coaching
- Define goals like "50k CAD by next year"; AI analyses real income/expenses and proposes realistic
  savings redirections, explains what to stop/reduce/restructure, and suggests grounded ways to
  improve net income.

### AI
- Replace rule-based categorization/advice with a real local model via Ollama, keeping the provider
  abstraction and local-first guarantee.

### macOS polish & distribution
- App-shell/menu behavior matching mature macOS apps (app-name menu, standard shortcuts, About
  dialog, window lifecycle, empty states).
- Signed + notarized public DMGs once Apple Developer secrets are configured (today's public builds
  are unsigned test builds).
- Startup self-check screen (workspace / DB / preload / AI-service status) and packaged smoke tests.

### Robustness
- No crash on overload; no silent blank window; useful error surfaces; reliable local storage;
  consistent UX across repeated imports. Settings/DB schema migration + versioning.
