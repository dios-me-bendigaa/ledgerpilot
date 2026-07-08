# LedgerPilot Architecture

## Principles

- local-first by default
- no transaction uploads without opt-in
- reusable monorepo for future desktop products
- desktop shell separated from data and AI workflows

## Phase 1 components

- Electron desktop shell
- React renderer for the local UI
- FastAPI sidecar for AI workflow orchestration
- shared TypeScript packages for domain and UI primitives
- GitHub Actions for build, test, and macOS release packaging

## Planned next components

- import engine package
- normalized transaction schema
- SQLite persistence and encryption adapter
- AI provider abstraction
- analytics and dashboard modules
