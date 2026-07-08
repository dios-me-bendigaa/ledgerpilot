# LedgerPilot

Local-first AI-powered personal finance desktop application for macOS.

## Phase 1

- Electron + React + TypeScript desktop shell
- FastAPI AI service shell
- Local workspace bootstrap
- Shared domain/config packages
- CI build, lint, typecheck, test, release scaffolding

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
python3 -m venv .venv
source .venv/bin/activate
pip install -r apps/ai-service/requirements.txt
pytest apps/ai-service/tests
```
