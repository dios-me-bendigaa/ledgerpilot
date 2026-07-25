# Changelog

## v3.1.0 — 2026-07-24

### Startup and workspaces

- Moved analysis-provider setup ahead of workspace selection.
- Added an offline Local Rules path that completes setup without a connection test or API key.
- New workspaces, and existing empty workspaces, open directly to CSV import.
- Existing workspaces with imported transactions open on the Overview page.
- Migrates configured provider settings from existing workspaces into app-level settings without changing financial data.

### Providers

- Added clear choices for Local Rules, Ollama, OpenAI-compatible APIs, and Claude.
- Added connection validation for model-backed providers and clearer API-key guidance.
- Normalized OpenAI-compatible URLs so service roots, `/v1` roots, GitHub Models `/inference` roots, and complete chat-completions endpoints work without duplicate paths.
- Updated default OpenAI and Claude model names.

### Developer experience

- Documented the sidecar virtual-environment location used by development mode.
- Added startup-flow, app-settings persistence, and provider URL tests.
- GitHub releases now include this curated changelog with the DMG assets.
