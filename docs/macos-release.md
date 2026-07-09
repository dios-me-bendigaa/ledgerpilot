# macOS Release Requirements

Public macOS releases must be signed and notarized. Unsigned DMGs often download, install, and then show the Gatekeeper error:

`"LedgerPilot.app" is damaged and can’t be opened.`

## Required GitHub Secrets

Set these in the GitHub repository before publishing public releases:

- `APPLE_DEVELOPER_ID_APPLICATION_P12_BASE64`
- `APPLE_DEVELOPER_ID_APPLICATION_P12_PASSWORD`
- `APPLE_NOTARIZATION_APPLE_ID`
- `APPLE_NOTARIZATION_APP_PASSWORD`
- `APPLE_TEAM_ID`

## Notes

- `APPLE_DEVELOPER_ID_APPLICATION_P12_BASE64`: base64-encoded Developer ID Application certificate export (`.p12`)
- `APPLE_DEVELOPER_ID_APPLICATION_P12_PASSWORD`: password used when exporting the `.p12`
- `APPLE_NOTARIZATION_APPLE_ID`: Apple account used for notarization
- `APPLE_NOTARIZATION_APP_PASSWORD`: app-specific password for notarization
- `APPLE_TEAM_ID`: Apple Developer Team ID

## Current Release Behaviour

Releases are currently **unsigned personal-test DMGs** — no Apple secrets are configured in the release workflow, no signing or notarization step exists. The workflow publishes ad-hoc signed DMGs for personal testing only.

- DMGs built locally on your own Mac: open directly, no Gatekeeper block.
- DMGs downloaded from GitHub Releases: macOS quarantines them. Use the workaround below before launching, or right-click → **Open** the first time.

When ready for signed public distribution, configure the five secrets above and add an `electron-builder` signing + notarization step to the release workflow.

## Immediate Local Workaround

For the already-downloaded unsigned app, macOS can be instructed to remove the quarantine attribute manually:

```bash
xattr -dr com.apple.quarantine "/Applications/LedgerPilot.app"
```

Use this only for personal validation builds. The real fix for shared/public downloads is signed + notarized releases.
