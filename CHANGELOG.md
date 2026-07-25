# Changelog

## v3.2.1 — 2026-07-25

### AI and overview

- A connected AI provider now analyses the review queue immediately after an import and opens the review screen with proposed categories. Proposals never modify data until individually approved; approving a new label explicitly adds it to My Categories with income/expense inferred from the transaction direction.
- Advisor and savings prompts now include up to 1,000 transactions, concrete merchant totals, and transaction evidence so responses can identify actual spending patterns instead of defaulting to generic category advice.
- Added a beginner-first “Start here” summary and replaced the category donut with a simple ranked spending list.
- Corrected the toggle geometry with fixed insets so the thumb stays inside its track in both states.

## v3.2.0 — 2026-07-25

### Startup, safety, and diagnostics

- Every launch now requires a quick AI Settings confirmation before the workspace picker. Saved Keychain credentials remain available without re-entry when the configuration is unchanged.
- Added an explicit two-step workspace deletion action. Workspaces are never silently removed during an update or reinstall.
- Added automatic desktop-log reporting for failed renderer actions, including the IPC action, safe error message, and stack. Provider test failures retain sanitized status/body details without API keys.

### Categories and imports

- Removed built-in user-facing categories. Workspaces now begin with only Uncategorized, and legacy categories, rules, and custom labels are reset for review.
- Added the dedicated **My Categories** flow. Suggestions can only offer categories a user has already created; applying a category or merchant rule always requires an explicit user action.
- New imports remain Uncategorized unless a user-approved rule matches. Headerless CIBC credit-card charges continue to normalize as cash out.

### Clarity and dashboard

- Fixed the switch thumb alignment, simplified the chart as Cash in & Cash out, and replaced the spending-calendar heatmap with an actionable spending snapshot.
- Removed repeated Advisor answer cards and made unreachable goal completion dates read “Not projected yet” instead of showing a fake date.
- Retained the Intel-specific x64 release build runner so the bundled AI sidecar remains compatible with Intel Macs.

## v3.1.1 — 2026-07-25

### Fixed

- Built the Intel DMG on an Intel runner so the bundled AI sidecar launches correctly on Intel Macs.
- Made bulk category acceptance safe: rule writes are atomic, bulk updates are serialized, and affected rule files recover automatically.
- Normalized headerless CIBC credit-card charges as spending so expense and overview totals are accurate.
- Corrected the settings switch interaction and clarified that existing workspaces persist across app reinstalls.
- Updated GitHub Actions to versions compatible with the Node.js 24 runner runtime.

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
