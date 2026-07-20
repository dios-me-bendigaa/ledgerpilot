# Manual Allocation Fix — Validation

## Root cause (verified empirically against better-sqlite3)

`saveCategoryOverride` propagated a manual category change to sibling rows with:

```sql
UPDATE transactions SET category = ?, requires_review = 0 WHERE merchant_normalized LIKE '%' || pattern || '%'
```

That substring match is unsafe:

- **Empty `merchant_normalized`** — descriptions such as `"***"` or `"- - -"` pass the
  `descriptionRaw.length > 0` import filter but normalize to `""`. The pattern becomes `LIKE '%%'`,
  matching **every** transaction and silently recategorizing the whole table.
- **Short merchant** (e.g. `iga`) — collides with unrelated rows (`vigant iga plus`).

For normal merchants the update did work, so the dashboard did update; the defect surfaces on the
empty/short cases, corrupting totals rather than leaving them stale.

## Fix

In `apps/desktop/electron/main.ts` `saveCategoryOverride`:

1. Always allocate the clicked transaction by `id` first — the dashboard reflects it regardless of
   the merchant pattern.
2. Propagate to siblings by **exact merchant equality**, guarded against an empty pattern:

```sql
UPDATE transactions SET category = ?, requires_review = 0 WHERE merchant_normalized = ? AND id != ?
```

Preserves "teach once, apply to all" for real siblings; removes the wipeout and collision paths.

## Empirical test matrix (all pass)

| Case | Before fix | After fix |
|------|-----------|-----------|
| Normal merchant, apply-to-all | siblings updated | siblings updated ✓ |
| Empty `merchant_normalized` | ALL rows corrupted | only clicked row ✓ |
| Short merchant `iga` | unrelated row hit | no collision ✓ |
| Explicit single (`applyToAll:false`) | single | single ✓ |
| Target merchant ≠ pattern | might miss | always allocated ✓ |

## Build / test validation (ARM64 / Apple Silicon)

```
npm run typecheck   # no errors
npm run build       # pass
npm run test        # all pass (core 5, import-engine 2, normalization 2, desktop 2)
```

## Architecture note (M3 vs Intel)

This fix is pure TypeScript — no native or arch-specific code. Behavior is identical on `arm64` and
`x64`. Any M3-vs-Intel runtime differences originate elsewhere (the per-arch `better-sqlite3` native
binary, or the two machines running different app versions / local databases), not this code path.

To confirm on Intel: run the three commands above, then import ~30 days of CSVs, allocate a few
Unknown transactions, and confirm dashboard totals / category charts / savings rate update and
survive an app restart.
