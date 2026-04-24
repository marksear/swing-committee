# Merge `entry-rules` into `swing-committee` — Monorepo Spec

## Context

The Money Program pipeline is two repos today:

- `swing-committee` (Next.js, TS) — scanner + signal UI, deploys to Vercel, emits `scan_YYYYMMDD.json`.
- `entry-rules/money-program-trading` (Python) — execution engine, manages IG DEMO/LIVE trades, consumes the scan.

The split has bitten us repeatedly:

- Schema round-tripping across TS ↔ pydantic is hand-maintained (`feedback_schema_canon`).
- Scan handoff is a **browser download** into `entry-rules/data/scans/` — fragile, user-in-the-loop.
- Cross-repo `rule_set_version` linkage breaks every time one side pushes without the other.
- `project_episodic_memory` (shared decision-event store across Trading + Investment) is effectively impossible while repos are split.

This spec is **option (a) from the merge discussion**: monorepo with both codebases as subdirs, history preserved via `git subtree`, each toolchain retained (no port). Scanner stays TypeScript, engine stays Python.

## Target state

```
swing-committee/                     # repo root (surviving repo, Vercel deploys from here)
├── app/                             # existing Next.js
├── lib/
├── components/
├── docs/
├── ...                              # other existing swing-committee files
├── entry-rules/                     # NEW — was entry-rules/money-program-trading/*
│   ├── src/
│   ├── tests/
│   ├── docs/
│   │   └── runbooks/
│   ├── data/
│   ├── reports/
│   ├── pyproject.toml
│   └── ...
├── schemas/                         # NEW — shared types, pydantic canonical per feedback_schema_canon
│   ├── pydantic/                    # sources (identical to entry-rules/src/models/)
│   └── generated/                   # TS output via pydantic2ts, gitignored
└── .github/                         # unified CI (optional — not in scope for this spec)
```

**Key decisions:**

1. `entry-rules/money-program-trading/` flattens to `entry-rules/`. The double-nesting is historical residue — the Cowork project name and the pip package name are the same thing in practice.
2. `git subtree add` preserves entry-rules history. `git log -- entry-rules/` will show the full pre-merge history.
3. Vercel root stays at repo root; `.vercelignore` excludes `entry-rules/` so Python + data files don't bloat the edge bundle.
4. The old `entry-rules` GitHub remote is **archived, not deleted** — investigation memos reference commit SHAs that must keep resolving.
5. `/Users/mark.sear/CoWork/entry-rules/` disk folder stays for ~2 weeks as a read-only safety net. Cowork project config for entry-rules is deleted by the user through the Cowork UI once the monorepo is proven.

## Preconditions — MUST all be true before starting

These are gates. Do not proceed if any is false.

### P1. Both working trees clean

```bash
cd /Users/mark.sear/Documents/swing-committee && git status --short
cd /Users/mark.sear/CoWork/entry-rules/money-program-trading && git status --short
```

Both must return empty. If either has modifications, stop and run the respective tidy-up session first:

- `swing-committee`: scanner-bug fix session (user is handling separately).
- `entry-rules`: see `project_entry_rules_tidyup.md` — 6 staged + 3 unstaged + ~20 untracked as of 2026-04-22. Spec for that cleanup is **not** in scope here; deal with it in its own session before this merge runs.

### P2. Both remotes pushed and verified

Per `feedback_verify_git_push` — silent-push failures have bitten us. For each repo:

```bash
LOCAL=$(git rev-parse HEAD)
git fetch origin
REMOTE=$(git rev-parse origin/main)
[ "$LOCAL" = "$REMOTE" ] && echo "OK: $LOCAL" || { echo "DIVERGED: local=$LOCAL remote=$REMOTE"; exit 1; }
```

If diverged: push, re-verify. Do not start the merge from a divergent state.

### P3. No open DEMO positions on IG

Per the DEMO Day-1 2026-04-20 debacle, there was (is?) a question mark over `DIAAAAW9EMBWDAF`. Before touching the execution engine's git root:

```bash
cd /Users/mark.sear/CoWork/entry-rules/money-program-trading
python - <<'PY'
from src.auth.ig_auth import IGSession
s = IGSession(); s.connect()
pos = s.service.fetch_open_positions()
print(pos)
s.disconnect()
PY
```

Must return zero open positions. If anything is open, close it on IG web first — the monorepo migration can't fix open positions and they'll confuse the post-merge smoke test.

### P4. Both tests green pre-merge

Run each repo's test suite. Baseline must be clean — otherwise a regression post-merge could be blamed on the merge when it pre-existed.

```bash
cd /Users/mark.sear/Documents/swing-committee && npm test
cd /Users/mark.sear/CoWork/entry-rules/money-program-trading && pytest -q
```

### P5. Back both repos up

```bash
BACKUP_DIR=~/Documents/backup_pre_monorepo_$(date +%Y%m%d_%H%M%S)
mkdir -p "$BACKUP_DIR"
cp -R /Users/mark.sear/Documents/swing-committee "$BACKUP_DIR/swing-committee"
cp -R /Users/mark.sear/CoWork/entry-rules "$BACKUP_DIR/entry-rules"
echo "Backed up to: $BACKUP_DIR"
```

This is belt-and-braces. The `git subtree` operation is reversible via `git reset` but the path rewrites and Vercel config changes aren't trivial to undo. A one-off `cp -R` is cheap insurance.

## Execution — exact commands

All commands assume cwd is `/Users/mark.sear/Documents/swing-committee` unless noted.

### Step 1 — subtree-add entry-rules at nested path

```bash
cd /Users/mark.sear/Documents/swing-committee
git remote add entry-rules-src https://github.com/marksear/entry-rules.git
git fetch entry-rules-src main
git subtree add --prefix=entry-rules-src-temp entry-rules-src main --squash=false
```

This lands entry-rules at `entry-rules-src-temp/money-program-trading/…` because the upstream repo has that nesting at its root.

**Pass check:**

```bash
ls entry-rules-src-temp/money-program-trading/src/engine/ | head -5
git log --oneline -5 -- entry-rules-src-temp/
```

Both should return content — the directory is populated and the history shows the last 5 commits from entry-rules (including `d7a4bf8 docs(monitor): investigate peak_unrealised_pnl_gbp stuck at 0.0`).

### Step 2 — flatten money-program-trading up one level

```bash
git mv entry-rules-src-temp/money-program-trading entry-rules
git rm -r entry-rules-src-temp
git commit -m "merge: flatten entry-rules/money-program-trading -> entry-rules/

Removes historical double-nesting. The Cowork project name 'entry-rules' and
the pip package name 'money-program-trading' were the same thing in practice."
```

### Step 3 — rewrite absolute paths in tracked files

Every reference to `/Users/mark.sear/CoWork/entry-rules/money-program-trading` must become `/Users/mark.sear/Documents/swing-committee/entry-rules`.

```bash
cd /Users/mark.sear/Documents/swing-committee

# Audit first — do not edit blind
grep -rn '/Users/mark.sear/CoWork/entry-rules/money-program-trading' entry-rules/ swing-committee*.md *.md 2>/dev/null | tee /tmp/path_rewrites.txt
wc -l /tmp/path_rewrites.txt

# Review /tmp/path_rewrites.txt manually. Expected hits:
# - entry-rules/docs/runbooks/*.md (demo_shakedown.md, demo_day1_20260420.md)
# - entry-rules/INVESTIGATE_*_SPEC.md (the three investigation specs at repo root)
# - Possibly README, CLAUDE.md

# Execute rewrite ONLY after reviewing
find entry-rules/ -type f \( -name '*.md' -o -name '*.py' -o -name '*.sh' \) \
  -exec sed -i '' 's|/Users/mark.sear/CoWork/entry-rules/money-program-trading|/Users/mark.sear/Documents/swing-committee/entry-rules|g' {} +

git diff --stat
git commit -am "merge: rewrite absolute paths for monorepo layout"
```

**Note the `sed -i ''`** — macOS syntax. If running on Linux, drop the `''`.

### Step 4 — Vercel config

Add `.vercelignore` at repo root:

```bash
cat >> .vercelignore <<'EOF'

# entry-rules — Python execution engine, not part of the Next.js deploy
entry-rules/
schemas/pydantic/
EOF
```

**Verify Vercel dashboard** (manual step):
- Project → Settings → Build & Development Settings
- "Root Directory" should be `./` (unchanged)
- Build Command: still default Next.js build
- Test a preview deploy before the PR merges — Vercel should complete without trying to install Python deps or upload `entry-rules/data/`.

### Step 5 — unified .gitignore

Merge entry-rules' gitignore entries into the root one:

```bash
cd /Users/mark.sear/Documents/swing-committee
echo "" >> .gitignore
echo "# entry-rules (Python execution engine)" >> .gitignore
echo "entry-rules/.venv/" >> .gitignore
echo "entry-rules/data/trading.db-shm" >> .gitignore
echo "entry-rules/data/trading.db-wal" >> .gitignore
echo "entry-rules/data/trading.db.failed_run_*" >> .gitignore
echo "entry-rules/data/trading.db.preflight_*" >> .gitignore
echo "entry-rules/data/cache/bars/" >> .gitignore
echo "entry-rules/__pycache__/" >> .gitignore
echo "entry-rules/**/__pycache__/" >> .gitignore
echo "entry-rules/reports/live_*.log" >> .gitignore
echo "entry-rules/reports/preflight_*/" >> .gitignore
```

Then remove the now-redundant `entry-rules/.gitignore` **unless** it has entries not covered above — review before deleting:

```bash
diff <(cat entry-rules/.gitignore) <(grep 'entry-rules/' .gitignore | sed 's|entry-rules/||')
```

### Step 6 — shared `schemas/` dir

```bash
mkdir -p schemas/pydantic schemas/generated
git mv entry-rules/src/models schemas/pydantic/models  # DO NOT DO THIS YET
```

**Halt.** This move is the trickiest step because it breaks imports in `entry-rules/src/`. The actual plan is:

1. For this PR: **do not move** pydantic sources. Leave them in `entry-rules/src/models/`.
2. Add `schemas/` as an empty placeholder with a `README.md` explaining the direction.
3. A **follow-up spec** handles the pydantic-canonical + pydantic2ts codegen pipeline. That's a real piece of work and bundling it with the merge is what turns a half-day job into a week-long one.

So for Step 6, just:

```bash
mkdir -p schemas
cat > schemas/README.md <<'EOF'
# Shared schemas (placeholder)

Canonical schemas live in `entry-rules/src/models/` (pydantic). This directory
is reserved for a future codegen pipeline that emits TS types for
swing-committee consumption. Not yet wired up — see `SCHEMAS_CODEGEN_SPEC.md`
(to be written).
EOF
git add schemas/
git commit -m "merge: add schemas/ placeholder for future codegen pipeline"
```

### Step 7 — smoke tests

```bash
cd /Users/mark.sear/Documents/swing-committee

# Next.js still builds
npm install
npm run build

# Python engine still runs
cd entry-rules
python -m pip install -e .
pytest -q

# End-to-end: emit a scan in swing-committee, ingest it in entry-rules
cd /Users/mark.sear/Documents/swing-committee
npm run dev &
DEV_PID=$!
sleep 10
# ... manual browser step: run scanner, download scan JSON to entry-rules/data/scans/
kill $DEV_PID

# Back in entry-rules
cd entry-rules
python -m src.session_init --scan data/scans/scan_YYYYMMDD.json --account-size 10000 --label SMOKE --dry-run
```

Dry-run ingest must exit 0 with `SHORTLIST_ADDED` events written. If it crashes on imports, the path rewrite missed something.

### Step 8 — memory updates

Files in `~/Library/Application Support/Claude/.../memory/` that reference the old entry-rules path. Grep first:

```bash
MEM_DIR='/Users/mark.sear/Library/Application Support/Claude/local-agent-mode-sessions/d78e7ccf-f334-450a-8870-5afd7393ea3c/b97973d8-4494-4a33-8505-20e4edb654c6/spaces/8bd951d9-f7d0-4a74-898f-b9c47b81d3f0/memory'
grep -rln 'CoWork/entry-rules' "$MEM_DIR"
grep -rln 'money-program-trading' "$MEM_DIR"
```

Files likely to need updates (based on 2026-04-22 MEMORY.md):

- `project_architecture.md` — change "two-repo pipeline" → "monorepo"
- `project_build_checkpoint.md` — update for post-merge state
- `project_entry_rules_tidyup.md` — mark done once tidy-up + merge lands
- `project_deployment.md` — Vercel config note
- `feedback_claude_code_workflow.md` — any repo-specific path references
- `reference_ig_index_proxies.md`, `reference_trading_ig_shape.md` — likely fine, but check

**Do not mass-sed the memory directory.** Edit each file intentionally. The architecture memory in particular is going to need a rewrite, not a find/replace.

### Step 9 — commit, push, verify

```bash
cd /Users/mark.sear/Documents/swing-committee
git log --oneline -10
git push origin main
LOCAL=$(git rev-parse HEAD)
sleep 2
git fetch origin
REMOTE=$(git rev-parse origin/main)
[ "$LOCAL" = "$REMOTE" ] && echo "PUSHED OK: $LOCAL" || { echo "PUSH FAILED"; exit 1; }
```

### Step 10 — Vercel preview deploy verification

Open the GitHub PR (or push to a preview branch first if you'd rather not push to `main`). Confirm:

- Vercel build succeeds
- Build duration is not massively larger than pre-merge (entry-rules should be excluded by `.vercelignore`)
- Preview URL serves the scanner UI as before

### Step 11 — archive the old entry-rules remote

GitHub → `marksear/entry-rules` → Settings → Archive this repository. Investigation memo commit SHAs must keep resolving — do not delete. Add a note to the repo's README.md on GitHub pointing at `marksear/swing-committee`.

Do **not** `rm -rf /Users/mark.sear/CoWork/entry-rules/` yet. Keep the local copy for 2 weeks as a read-only safety net. After 2 weeks of the monorepo working cleanly, delete.

## Verification — pass criteria

Merge is complete when **all** of these are true:

1. `git log --oneline -- entry-rules/` shows the full pre-merge entry-rules history (subtree preserved it).
2. `cd entry-rules && pytest -q` passes at parity with pre-merge baseline.
3. `npm run build` at repo root passes.
4. End-to-end scan emission → dry-run ingest works without touching the old `/Users/mark.sear/CoWork/entry-rules/` path.
5. Vercel preview deploys green, build time within 20% of pre-merge.
6. Memory files reflect the new structure; `MEMORY.md` index is unchanged in length but pointers are accurate.
7. IG DEMO auth smoke still works from the new path.
8. `main` is pushed and `LOCAL == REMOTE`.

## Rollback plan

If verification fails after Step 9:

```bash
cd /Users/mark.sear/Documents/swing-committee
git reset --hard <pre-merge SHA>   # the SHA from pre-merge `git log --oneline -1`
git push --force-with-lease origin main   # only if you already pushed
```

The backup in `~/Documents/backup_pre_monorepo_*` is a full restore if anything is truly lost.

The old entry-rules GitHub remote is untouched until Step 11, so before that step, everything is trivially recoverable.

## Out of scope for this spec

- **pydantic → TS codegen pipeline.** Placeholder in `schemas/` only. Separate spec.
- **Unified CI.** Each half still tested by its own tooling. Unifying under one GitHub Actions workflow is a future improvement.
- **Scan handoff mechanism upgrade.** Browser download is still the handoff after this merge — fixing it (in-process file write, or shared DB) is a separate design question. Merge doesn't block it; it just makes it easier.
- **Episodic memory schema.** `project_episodic_memory` is unblocked by this merge but not built in this spec.
- **`entry-rules/` tidy-up of WIP files.** That's a precondition (P1), not part of this spec.
- **Scanner bug fix.** Separate session, done pre-merge.

## Post-merge follow-ups (tech debt to pay down)

Track these as discrete items once the merge lands. They're explicitly not in this spec but are unblocked by it:

1. **Retire duplicated TS ports of Python logic.** The scanner bug fix (Apr 2026) added a TS port of `money-program-trading/src/intake/` validator into `swing-committee/lib/intake/`, following the same `MUST stay in sync with …` comment-convention used by:
   - `app/api/scanner/route.js:2062` (duplicated from `src/backtest/sector_map.py`)
   - `app/api/scanner/route.js:2340` (duplicated from `src/backtest/replay_scanner.py#score_pillars`)

   Once the pydantic→TS codegen pipeline is in place (separate spec), delete all three TS duplicates and generate them from the Python source. Search the codebase for `MUST stay in sync` to find any others that accumulate between now and then.

2. **Persistent scan archive.** The scanner bug fix (Apr 2026) added a best-effort scan archive tap so every `buildScanPayload` run leaves a JSON behind for later audit. Today that write goes to the client-downloaded JSON only (Vercel FS is ephemeral, no Blob/KV wired up). Post-merge, wire a real persistent archive: either Vercel Blob Storage keyed by scan timestamp, or — cleaner with the engine co-located — write directly into `entry-rules/data/scans/archive/` from the scanner path when running locally, and to Blob when running on Vercel. Corpus matters for:
   - Retroactive `--strict` audit (what would strict have rejected across real scans over the last N weeks?)
   - Replay testing after any scan-schema change (run N historical scans through the new schema, confirm no regressions)
   - Future backtest harness inputs once `--strict` is default-on

   Flag-gated via `SCAN_ARCHIVE_ENABLED`, fail-open (archive failure never blocks scan emission), same discipline as `EVENT_FILTER_ENABLED` per `feedback_event_filter_design`.

3. **Delete Cowork project config for entry-rules** (user-side action, after 2-week safety window).

4. **Delete `/Users/mark.sear/CoWork/entry-rules/` local safety-net copy** (after 2-week safety window + one clean DEMO session on the monorepo).

5. **Rewrite `project_architecture.md`** memory file — "two-repo pipeline" description is stale the moment this merge lands. Not a find/replace; needs a real rewrite.

## Estimated effort

Half-day focused session, assuming preconditions are all green. Most of the time is in Step 3 (path rewrites — manual review is essential) and Step 7 (smoke tests including a full scan → ingest round-trip). The subtree add itself is ~2 minutes.
