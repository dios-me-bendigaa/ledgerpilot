# LedgerPilot

Local-first AI-powered personal finance desktop application for macOS.

## Version 1.0.0

- Electron + React + TypeScript macOS desktop app
- FastAPI local AI service
- CSV import, normalization, duplicate detection, and transfer matching
- SQLite-backed dashboard, goals, advisor, savings optimizer, settings, backup, and export flows
- GitHub Actions build, test, DMG packaging, and release scaffolding

## Monorepo

- `apps/desktop`: Electron desktop app with React UI
- `apps/ai-service`: FastAPI sidecar service
- `packages/core`: shared domain types and workspace bootstrap helpers
- `packages/ui`: shared UI primitives
- `packages/config`: shared TypeScript config packages
- `docs`: architecture and delivery notes

## Local Development

```bash
npm install
npm run build
npm run test
python3 -m venv apps/ai-service/.venv
apps/ai-service/.venv/bin/pip install -r apps/ai-service/requirements.txt
apps/ai-service/.venv/bin/pytest apps/ai-service/tests
npm run dev
```

LedgerPilot automatically uses `apps/ai-service/.venv` for the local sidecar in development.
Choosing Local Rules needs no external model. Choosing Local LLM requires Ollama to be installed,
running, and to have the selected model available.
