# Scan emission baseline

Frozen snapshot of `buildScanPayload` behaviour captured **2026-04-24**
before the scan-UI narrowing refactor. Used as a regression check: the
contract with `entry-rules` must not drift during a UI-only refactor.

## Files

- **input_fixture.json** — the inputs fed to `buildScanPayload`. Same
  fixture shape as `lib/scanEmission.test.mjs`.
- **expected_output.json** — the exact return value on the capture run.
  Contains real UUIDs from that run — the verifier normalises them to
  `<<UUID>>` before comparing, so don't be alarmed by UUID churn
  between runs.

## Usage

```bash
# Re-capture (only if we deliberately change the emission contract).
node scripts/capture_baseline.mjs

# Verify no regression after a refactor commit.
node scripts/verify_baseline.mjs
# Exit 0 = clean. Exit 1 = diff summary on stderr.
```

## Fields normalised in comparison

- Any UUID (scan_id, candidate_id, session_id-when-set) → `<<UUID>>`.

Everything else is compared literally — any change to field names,
ordering, types, or values will trigger a regression.

## When to re-capture

**Only** when we deliberately and knowingly change the emission
schema. Re-capturing silently to make the verify pass is a footgun —
it will hide real contract regressions from entry-rules.
