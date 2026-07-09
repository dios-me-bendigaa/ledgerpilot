# LedgerPilot Agent Context

This file is the single entrypoint for AI agents or new contributors who need end-to-end context about this repository.

## Project Goal

LedgerPilot is a **local-first AI-powered personal finance desktop application** for macOS.

The core product goal is:

- import bank CSV files locally
- normalize and merge transaction history locally
- persist canonical financial data in local SQLite
- provide dashboard analytics and insights
- provide AI-driven categorization, review, goals, advisor, and savings optimization
- keep raw financial data on-device by default

Nothing should leave the machine unless the user explicitly enables cloud AI or export flows.

## End State We Were Building Toward

The target product for `v1.0.0` was:

1. Native macOS desktop application
2. DMG installable release via GitHub Releases
3. Local workspace bootstrap on first launch
4. CSV import engine with duplicate handling and resume support
5. Normalization pipeline into a canonical transaction model
6. SQLite-backed analytics and reporting
7. AI categorization and review queue
8. Goals and savings optimizer
9. Advisor-style question/answer flow grounded in transaction history
10. Settings, local backups, export, and release automation

## Architecture Summary

### Frontend/Desktop

- Electron desktop shell
- React + TypeScript renderer
- Tailwind CSS styling

### Local Data

- SQLite via `better-sqlite3`
- local workspace under macOS application support
- JSON files for settings, goals, import history, and reports

### AI

- FastAPI local AI sidecar service
- current implementation is local-rule driven with provider abstraction surfaces for:
  - `local-rules`
  - `ollama`
  - `openai-compatible`

### Build/Release

- GitHub Actions CI
- GitHub Actions release workflow
- dual-architecture macOS DMG build matrix:
  - Apple Silicon (`arm64`)
  - Intel (`x64`)

## Monorepo Layout

- `apps/desktop`
  Electron + React desktop app
- `apps/ai-service`
  FastAPI AI service
- `packages/core`
  shared types and product contracts
- `packages/ui`
  shared UI primitives
- `packages/import-engine`
  CSV import engine
- `packages/normalization-engine`
  normalization and transaction classification engine

## Git / Remote Access

This repository is pushed to the user's **personal GitHub account**, not the Just Eat GitHub Enterprise account.

### Remote

- `origin = git@github-personal:dios-me-bendigaa/ledgerpilot.git`

### Local SSH isolation

This repo uses a repo-local SSH config so personal GitHub access does not interfere with work credentials.

- SSH config path:
  - `.local/ssh/config`
- personal key path:
  - `.local/ssh/id_ed25519_github_personal`

### Typical push / pull pattern

For agents running locally in this repo:

- normal git commands work because repo-local SSH is already configured
- if `gh` is needed against `github.com`, prefer:
  - `GH_HOST=github.com GIT_SSH_COMMAND='ssh -F /absolute/path/to/.local/ssh/config' gh ...`

### Important constraint

- do not assume `gh` is authenticated for `github.com` globally
- do not use JET / `github.je-labs.com` auth for this repo

## Implemented Features By Phase

### Phase 1

- monorepo scaffold
- Electron shell
- React renderer
- FastAPI health service shell
- CI/release workflow scaffold

### Phase 2

- CSV file selection and drag/drop
- batch limit of 10 files
- duplicate import detection
- import history persistence
- resume failed imports
- local storage of original and processed CSVs

### Phase 3

- CSV format detection
- transaction normalization
- merge/sort behavior
- duplicate transaction fingerprinting
- internal transfer detection
- SQLite persistence of transactions
- normalization reports and review queue

### Phase 4

- dashboard KPIs
- monthly/yearly comparisons
- category totals
- calendar heatmap data
- sankey-style flow summaries

### Phase 5

- AI categorization API surface
- local rule-based category suggestions
- learned category override rules

### Phase 6

- advisor API surface
- grounded advice based on dashboard + transaction context

### Phase 7

- unlimited goals
- monthly savings targets
- goal forecasting
- savings optimizer recommendations

### Phase 8

- settings persistence
- keychain-backed API key storage
- backup history and encrypted backup generation
- export flow
- macOS app-shell polish

## Important Release/Packaging History

The repo went through several packaging/runtime fixes during `v1.0.0`:

1. **Wrong architecture artifact**
   - early build only worked for Apple Silicon
   - Intel Mac testing failed with incorrect executable format
   - fixed by adding release matrix for `arm64` and `x64`

2. **Packaged runtime module resolution failure**
   - packaged app could not resolve workspace modules like `@ledgerpilot/core`
   - fixed by bundling Electron `main` and `preload` using `esbuild`

3. **Blank window / app process alive but no UI**
   - likely due in part to `BrowserWindow` lifecycle and startup failure visibility
   - fixed by:
     - retaining `mainWindow` at module scope
     - adding startup logs
     - adding fallback startup error page
     - adding renderer error fallback UI

4. **Database startup ordering bug**
   - error seen during testing:
     - `TypeError: Cannot open database because the directory does not exist`
   - root cause:
     - SQLite was opened before workspace directories were guaranteed to exist
   - fixed by ensuring workspace creation before DB initialization and creating DB parent directory explicitly

5. **Preload format mismatch**
   - error seen during testing:
     - Electron attempted to `require()` preload while preload was emitted as ESM
   - fixed by building preload as CommonJS (`preload.cjs`)

6. **macOS menu gap**
   - app lacked native top-bar menus like File/Edit/View/Window
   - fixed by installing a proper macOS application menu in Electron main

## Latest Known Release State

At the time this file was written:

- latest successful release workflow:
  - `28922675737`
- latest successful CI workflow:
  - `28922673080`
- latest release tag:
  - `v1.0.0`
- latest release-related fix commit before this document:
  - `62d6afb PERSONAL: build preload script as commonjs`

Note: there were later fixes after that commit too, but this file should always be updated if more release-related debugging occurs.

## Current Testing Reality

Public macOS releases are currently **unsigned/unnotarized** unless Apple Developer signing secrets are configured.

That means:

- GitHub Releases can publish test DMGs
- users may still need to bypass Gatekeeper manually
- this is acceptable only for personal testing
- it is not acceptable for broad public distribution

## Local Resource / Storage Expectations

Agents should understand that this app intentionally reserves local disk usage for finance processing.

### App data location

Primary workspace data lives under macOS application support:

- `~/Library/Application Support/LedgerPilot/`

Expected subdirectories:

- `database/`
- `imports/original/`
- `imports/processed/`
- `ai/memory/`
- `ai/embeddings/`
- `rules/`
- `reports/`
- `logs/`
- `settings/`
- `cache/`
- `backups/`

### Storage implications

On install / first meaningful use, the app may consume local space for:

- copied original CSV files
- processed CSV copies
- SQLite database growth
- AI memory / embeddings
- logs
- exports
- encrypted backups

Agents should preserve the local-first model and not silently move any of this to cloud storage.

### Runtime / performance expectations

The product goal is to remain responsive while processing large transaction volumes.

Future agents should treat these as product requirements:

- background processing where possible
- no UI hangs during import/normalization
- incremental data loading
- memory-aware analytics for large datasets
- avoid blocking renderer startup with long-running tasks

## Apple Signing / Notarization Context

Proper public macOS distribution requires Apple Developer assets and GitHub secrets.

Required secrets are documented in:

- `docs/macos-release.md`

Without these secrets:

- builds may install and run for testing
- macOS may show quarantine/damaged/unidentified warnings
- notarized public trust is not available

## How Future Agents Should Approach Debugging

If the app appears to launch but shows a blank window or fails silently:

1. Check desktop logs:
   - `~/Library/Application Support/LedgerPilot/logs/desktop.log`
2. Check whether startup fallback UI is rendered
3. Confirm DB path and workspace initialization order
4. Confirm packaged preload/main file paths inside `app.asar`
5. Confirm architecture of downloaded DMG matches target machine
6. Confirm whether testing is happening on an old downloaded release vs latest artifact

If the app launches but shows no useful UI:

7. Check whether Electron preload loaded successfully
8. Check whether renderer fallback UI rendered an explicit startup error
9. Check whether `BrowserWindow` lifecycle is being preserved
10. Check that workspace directories exist before SQLite opens

## Product Vision Still Not Fully Met

The current repo has many implemented pieces, but several user-desired product behaviors are still incomplete or need refinement.

Future agents should treat these as **active product goals**, not closed work.

### Workspace-first onboarding

Desired behavior:

1. App home should ask user to:
   - create a new workspace
   - or open an existing workspace
2. Creating a workspace should ask for:
   - workspace name
   - financial goal
   - initial CSV import set

Current state:

- local workspace directories exist conceptually
- but explicit workspace picker / create-open UX is not yet complete

### CSV batch limit refinement

Desired behavior:

- initial CSV add should be capped at **5 files**, not 10
- after processing, user should be able to add 5 more
- new CSVs should be merged with existing history
- history should be reprocessed and re-sorted chronologically

Current state:

- current import limit is 10
- incremental merge behavior is partial
- this still needs redesign to match the user's explicit expectation

### Unknown transaction resolution loop

Desired behavior:

- if AI cannot identify a transaction confidently, ask the user
- once user clarifies, apply that learning consistently across banks/files for similar transactions

Current state:

- review queue exists
- category override rules exist
- but the UX loop is still primitive and needs to become more explicit and user-friendly

### Dashboard fidelity

Desired behavior:

- dashboard should be easy to understand
- amounts should be accurate to the cent
- panels should feel trustworthy and accountable

Current state:

- dashboard scaffolding exists
- visual summaries exist
- still needs refinement, better charting, and stronger UX polish

### Long-term financial goal coaching

Desired behavior:

- user can define goals like `50k CAD by next year`
- AI should analyse actual income/expenses
- AI should propose realistic savings redirections
- AI should explain what to stop, reduce, or restructure
- AI should also suggest ways to improve net income or savings if grounded in data

Current state:

- goals and savings plan structures exist
- rule-based optimizer exists
- still needs stronger accuracy, clearer UX, and richer financial reasoning

## macOS UX Expectations

The app should behave like a real Mac desktop app, not just a wrapped webpage.

Future agents should explicitly review mature macOS apps and compare LedgerPilot against them for:

- app name menu behavior
- `File`, `Edit`, `View`, `Window`, `Help` completeness
- standard keyboard shortcuts
- About dialog quality
- window behavior on reopen / close / minimize / fullscreen
- empty-state design
- startup error visibility
- installer feel and first-launch flow

### Current known UX gap

The user reported the app-name top-left dropdown still feels wrong/incomplete even after adding a native menu.

Agents should treat this as unresolved and compare against polished macOS apps before declaring menu UX complete.

## End-to-End Test Charter For Future Agents

Future AI agents should not stop at unit/build checks.

They should create a proper macOS end-to-end validation loop, ideally with multiple interlinked phases.

### Desired end-to-end test plan

1. Create a clean workspace
2. Import at least 4 realistic synthetic CSVs
3. Mix multiple bank schemas
4. Include duplicates and internal transfers
5. Include clearly labeled salary/income
6. Include ambiguous transactions
7. Validate AI review queue triggers for unknowns
8. Apply user correction and confirm rule reuse
9. Confirm dashboard updates correctly after import
10. Add more CSVs later and confirm re-merge/re-sort behavior
11. Create at least one long-term goal
12. Run savings optimizer and advisor questions
13. Run export and backup flows
14. Verify app survives heavy/large input without crashing

### Stress / hard-input expectations

Test cases should include:

- malformed CSV headers
- missing amount/date fields
- large transaction counts
- many duplicate-looking rows
- mixed income/refund/transfer patterns
- long merchant strings
- user corrections repeated across files

### Quality bar

The target is not “prototype works once.”

The target is:

- no crash on overload
- no silent blank window
- useful error surfaces
- reliable local storage behavior
- consistent UX across repeated imports

## Operational Expectations For AI Agents

When continuing work in this repo:

- prefer the smallest correct fixes
- keep product local-first
- do not remove the current provider abstraction surfaces
- preserve GitHub Actions release automation
- verify changes with:
  - `npm run build`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`
  - `pytest apps/ai-service/tests`

When working on packaged app bugs:

- consider both renderer and Electron main-process failure modes
- remember that local repo success is not enough; packaging/runtime semantics differ

## Suggested Next Improvements

High-value follow-ups after `v1.0.0`:

1. Implement explicit create/open workspace onboarding
2. Change batch import UX to user-required 5-file incremental flow
3. Add startup self-check screen that validates workspace, DB, preload, and AI service status
4. Add end-to-end packaged smoke tests for macOS artifacts
5. Add real chart components instead of current lightweight visual summaries
6. Replace rule-based AI with real local model integration via Ollama
7. Add migration/versioning around settings and DB schema evolution
8. Review native macOS menu/app-shell behavior against polished desktop apps
9. Add release notes generation and asset naming clarity per architecture
10. Add automated multi-phase E2E finance scenarios using synthetic CSV fixtures

## Most Important Things To Remember

- This project is personal/local-first finance software.
- The user wanted direct implementation, not endless planning.
- The product should be App Store minded, but current public releases are still unsigned test builds unless Apple secrets are configured.
- The repo has gone through multiple packaging fixes; if a tester reports old errors, first confirm they downloaded the newest release artifact.
