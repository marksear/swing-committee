# Fix Vercel Build Failure — Spec for Claude Code

## Context

The swing-committee repo (`~/Documents/swing-committee`, GitHub remote `marksear/swing-committee`, deployed via Vercel on push to `main`) is currently failing its production build. The error from the Vercel build log is:

```
./lib/scanEmission.js
Module not found: Can't resolve './eventFilter.js'
> Build failed because of webpack errors
Error: Command "npm run build" exited with 1
```

The failing commit on Vercel is `b0d95be` (`feat(bypass): allow Grade-C selection on DEMO mechanics-test runs`).

## Root Cause

`lib/scanEmission.js` imports `{ filterByEvents, indexCalendar }` from `./eventFilter.js` (around line 43). The file `lib/eventFilter.js` exists on the local Mac but was never tracked in git — it shows as `??` (untracked) in `git status`. The same applies to its sibling test file `lib/eventFilter.test.mjs`.

Earlier successful Vercel deploys ran on commits that pre-dated the broken `import` line. `b0d95be` was simply the first push to touch `lib/` after the import was added, which is why the failure surfaces now.

This is **not** a problem with the bypass feature in `b0d95be` itself. It's a latent bug from an earlier "lean-scan" commit (around `5c07a2c`) that added an import without also tracking the imported file.

## Scope

Make the minimum change required to unblock the Vercel build. Do not modify any application logic. Do not touch any other uncommitted working-tree changes — those are separate in-progress work that the user will handle on their own cadence.

## Steps

Operate in `~/Documents/swing-committee`.

1. **Verify the problem is still present.** Run `git status` and confirm that `lib/eventFilter.js` and `lib/eventFilter.test.mjs` appear under "Untracked files". If they do not — because the previous paste attempt partially succeeded — run `git log --oneline -3`; if HEAD is already a commit titled `fix(build): add eventFilter.js...`, the job is already done. Stop and report.

2. **Verify the files exist and are non-empty.** `ls -la lib/eventFilter.js lib/eventFilter.test.mjs`. Both must exist. If either is missing, stop and report — we have a different problem than the spec describes.

3. **Verify the exports match the imports.** `lib/scanEmission.js` imports `filterByEvents` and `indexCalendar`. Run `grep -E '^export' lib/eventFilter.js` and confirm both names appear. If they do not, stop and report — the fix is not just a missing-file issue.

4. **Do not stage any other changes.** Run `git status` again and ensure the only things you are about to commit are the two eventFilter files. Other modified files (`app/api/analyze/route.js`, `app/api/scanner/route.js`, `docs/lean_scan_spec.md`, `lib/scanEmission.test.mjs`, `package.json`, etc.) must remain uncommitted.

5. **Stage only the two files.**

   ```
   git add lib/eventFilter.js lib/eventFilter.test.mjs
   ```

6. **Commit.** Use this message verbatim:

   ```
   fix(build): add eventFilter.js/.test that scanEmission.js imports

   lib/scanEmission.js has imported { filterByEvents, indexCalendar } from
   ./eventFilter.js since the lean-scan work, but those two files were never
   tracked in git. Works on the Mac because the files exist there; fails on
   Vercel because the GitHub checkout has nothing to resolve the import to.

   Surfaced when b0d95be (feat(bypass): Grade-C selection) was the first
   commit to touch lib/ after lean-scan — earlier successful Vercel deploys
   were on commits that pre-dated the broken import line.
   ```

7. **Push to origin/main.** `git push origin main`. This triggers a new Vercel deploy automatically.

8. **Confirm the push landed.** Run `git log --oneline origin/main -3` and show the top three commits to the user. The first line should be the new `fix(build)` commit.

9. **Do not run `npm run build` yourself** — it takes minutes and adds no signal. The Vercel deploy is the source of truth.

## Acceptance

- A single new commit on `main`, titled `fix(build): add eventFilter.js/.test that scanEmission.js imports`, containing exactly `lib/eventFilter.js` and `lib/eventFilter.test.mjs`.
- `git status` still shows all the user's other in-progress modifications (they should not have been staged).
- The commit is visible on `origin/main` after `git push`.
- Vercel will pick this up automatically; the user will watch the Vercel dashboard to confirm the build now reaches "Compiled successfully".

## Rollback

If anything goes wrong, `git reset --soft HEAD~1` unstages the commit without losing the file changes. The push is harder to undo once published; only do that if the pushed commit contains something it shouldn't (which this spec's staging step exists to prevent).

## Non-goals

- Do not fix the lean-scan import line that caused this. The files exist; adding them is the right fix.
- Do not commit any other uncommitted changes, even if they look related.
- Do not modify `.gitignore`. These files are source code; they simply weren't added.
- Do not run the project's test suite or build locally — Vercel is the target.
