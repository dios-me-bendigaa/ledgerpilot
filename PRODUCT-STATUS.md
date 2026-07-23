# LedgerPilot — Product Status

Local-first, AI-assisted personal finance desktop app for macOS. Raw financial data stays
on-device by default. This file tracks **what works today** vs **the desired end state** for the
final version. Update it as functionality lands.

_Last updated: 2026-07-22 · Version: 3.0.0_

---

## Current functionality (implemented today)

### Workspaces
- Multi-workspace support: an explicit "choose a workspace" screen shown every launch (never
  auto-resumes the last one), with create-new-workspace inline. Each workspace has fully isolated
  transactions, goals, settings, and rules.
- Existing single-workspace installs migrate automatically and safely (rename-based, no data
  copy/loss window) into the new `workspaces/<id>/` layout on first launch after upgrading.

### App shell & navigation
- Multi-page design: Overview, Transactions, Categorize, Import, Goals, Advisor, Settings — each
  with its own sidebar entry, native menu shortcut (Cmd+1-6), and error boundary.
- Shared design system (`@ledgerpilot/ui`): Card, Button, Meter, Input, Select, Textarea, Badge,
  Switch, Skeleton, EmptyState, Toast — consistent look across every page.
- Native macOS application menu: custom About panel, Preferences, File (Import/Export/Backup),
  Edit, View (page shortcuts), Window, Help.
- Mandatory first-run AI provider setup (Claude / OpenAI-compatible / Ollama) with a live
  connection test — local-rules alone does not satisfy setup.

### Import
- CSV import via file picker and drag-and-drop, up to 10 files per batch.
- Format auto-detection: generic amount, generic debit/credit, RBC; delimiter sniffing (`,` `;` tab).
- Header-less CSV exports (e.g. some CIBC credit card formats) are now detected and handled via a
  positional column guess, instead of silently importing zero rows while reporting "completed".
- Original + processed CSVs copied into the local workspace; import history persisted.
- Duplicate-file detection and resume of failed imports.

### Normalization & classification
- Canonical transaction model persisted in local SQLite (`better-sqlite3`).
- Merchant normalization, duplicate-transaction fingerprinting (with repeat-occurrence handling).
- Category classification via: merchant overrides → bank's own category column → account-type
  context → description keyword rules; low-confidence rows (< 0.7) flagged for review.
- Fixed: a `Debit=0`/`Credit=0` placeholder row (seen in real NBC exports) no longer picks up the
  Balance column as its amount — resolves to a correctly-dropped $0 no-op instead of a phantom fee.
- Fixed: the `nsf` fee keyword no longer accidentally matches any description containing
  "transfer" (`tra-nsf-er`), and "Real Canadian Superstore" is now recognized as groceries.
- Internal-transfer detection pairs debit/credit across accounts (±1 day) and excludes them from
  spend/income.
- Normalization reports and a review queue per batch; batches can be re-processed.
- Real outstanding-debt tracking from any import with a running-balance column (credit card / LOC),
  separate from period payment totals, with interest-vs-principal split.

### Dashboard & analytics
- KPIs: net cash flow, income, discretionary expenses, savings rate, interest paid, debt payments,
  budget health, financial-health score, internal-transfer count, review count.
- Debt breakdown (mortgage / car / rent / credit-card / line-of-credit), kept separate from spend.
- Top expense categories, expenses rolled up into parent groups with drill-down.
- Month-over-month category comparison, monthly and yearly trends (real chart components via
  Recharts), spending calendar heatmap, account→category flow summaries.
- India-expense netting (Remitly debits netted against INTERAC credits), generalized to any
  custom category via a per-category netting flag.

### Review, categorization & rules
- Review queue with AI category suggestions (local-rules, Ollama, OpenAI-compatible, and Claude).
- Manual allocation of any transaction; "teach once, apply to all" propagates a correction to
  transactions sharing the same merchant and to future imports via saved rules.
- User-defined custom categories tagged as income / expense / transfer.

### Goals, advisor & optimizer
- Real goal-creation form (not blind-create-then-edit), read-only goal cards with live progress
  meters, two-step delete confirmation, and a "debt payoff" card that turns any real outstanding
  balance into a goal in one click.
- A stale-plan banner when goals change after the last optimizer run.
- Advisor answers grounded in a real needs-vs-discretionary spend breakdown, detected recurring
  merchant charges (not just category guessing), and question-intent routing (interest/debt,
  month-over-month, subscriptions, investing, general overspending).
- Goal feasibility forecasting states two concrete, always-computed alternatives when a target
  isn't reachable (a lower amount by the same deadline, or the full amount by a later date) instead
  of just reporting a shortfall.
- Educational-only investing guidance (debt-first, then emergency buffer, then general investing)
  — never names a specific product, fund, ticker, or timing; always suggests a licensed advisor.

### Settings, backup & platform
- Settings persistence; Keychain-backed API-key storage; opt-in cloud AI and telemetry (off by
  default).
- Encrypted local backups with history (including category rules, custom categories, and
  normalization reports); two-step-confirmed restore; JSON export; "clear all data" wipe.
- Startup error fallback UI; workspace bootstrap on first launch.
- FastAPI AI sidecar auto-started by the Electron main process, with real Claude/Anthropic support
  and a dedicated `/provider/test` endpoint that surfaces real connection errors during setup.

### Build & release
- CI (build/lint/typecheck/test JS + pytest) on macOS.
- Tag-driven (`v*`) release workflow building arm64 + x64 DMGs in parallel and publishing both to
  one GitHub Release via a separate, race-free publish step.
- On-demand PR build: add the `build-mac` label to a PR to produce downloadable arm64/x64 DMG
  artifacts.

---

## Desired end state (planned for the final version)

> Product direction carried over from `AGENT-CONTEXT.md`. Edit freely — this is the plan, not a
> commitment of the current build.

### Onboarding & workspaces
- New-workspace flow currently captures a name only — no primary-financial-goal prompt or
  initial-CSV-set capture during creation yet (both still worth adding).
- No in-session workspace switcher yet — switching means quitting and relaunching (the picker is
  always shown fresh). A "Switch workspace" action without a full relaunch is a reasonable follow-up.

### Import UX
- Initial CSV add capped at **5 files**, with the ability to add 5 more after processing.
- New CSVs merge into existing history; full re-sort chronologically on every add.

### Unknown-transaction resolution loop
- When AI is not confident, ask the user; once clarified, apply that learning consistently across
  banks and files for similar transactions. Make the loop explicit and friendly (beyond today's
  primitive queue).

### Dashboard fidelity
- Real chart components (Recharts) have replaced the earlier lightweight SVG summaries; remaining
  work is mostly amount-precision edge cases and further-discovered classification gaps (see
  "Known classification gaps" below) rather than the chart layer itself.

### Long-term financial-goal coaching
- Define goals like "50k CAD by next year"; AI analyses real income/expenses and proposes realistic
  savings redirections, explains what to stop/reduce/restructure, and suggests grounded ways to
  improve net income. Goal feasibility with concrete alternatives now exists; a fuller coaching
  narrative (multi-step plan, check-ins over time) is still future work.

### AI
- Claude/Anthropic, OpenAI-compatible, and Ollama are all supported today with a mandatory,
  connection-tested setup step. Remaining direction: keep improving the local-rules fallback's
  reasoning quality so a fully offline/free setup stays genuinely useful, not just a placeholder.

### Known classification gaps (discovered via real multi-bank testing, not yet fixed)
- Scotia-specific transfer/payment descriptions (e.g. "customer transfer dr. Mb-Credit Card/Loc
  Pay.") aren't recognized by any built-in rule — only by a manually-taught "teach once" category
  rule. A fresh Scotia user hits this until they correct it once themselves.
- Credit-card export formats whose amounts have no sign convention (always positive, e.g. some
  CIBC exports) aren't automatically flipped to expenses — they'd currently bucket as income.
  Needs a careful, narrowly-scoped design (detecting "this is a charges-only format" reliably)
  rather than a broad heuristic that could mis-flip correctly-signed formats.

### macOS polish & distribution
- App-shell/menu behavior matching mature macOS apps (app-name menu, standard shortcuts, About
  dialog, window lifecycle, empty states).
- Signed + notarized public DMGs once Apple Developer secrets are configured (today's public builds
  are unsigned test builds).
- Startup self-check screen (workspace / DB / preload / AI-service status) and packaged smoke tests.

### Robustness
- No crash on overload; no silent blank window; useful error surfaces; reliable local storage;
  consistent UX across repeated imports. Settings/DB schema migration + versioning.
