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

1. Add a startup self-check screen that validates workspace, DB, preload, and AI service status
2. Add end-to-end packaged smoke tests for macOS artifacts
3. Add real chart components instead of current lightweight visual summaries
4. Replace rule-based AI with real local model integration via Ollama
5. Add migration/versioning around settings and DB schema evolution
6. Add release notes generation and asset naming clarity per architecture

## Most Important Things To Remember

- This project is personal/local-first finance software.
- The user wanted direct implementation, not endless planning.
- The product should be App Store minded, but current public releases are still unsigned test builds unless Apple secrets are configured.
- The repo has gone through multiple packaging fixes; if a tester reports old errors, first confirm they downloaded the newest release artifact.
