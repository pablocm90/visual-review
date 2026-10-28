---
description: Run the quality gates, push the task branch and open a PR
---

1. Run `pnpm check && pnpm typecheck` bare, as the only command in the call. On failure, fix and rerun; never push red. The tests run in CI.
2. Push the current branch (never `main`) with `git push -u origin HEAD`.
3. Open the PR with `gh pr create`, body in the `tdd` skill's PR format (headline, then Where / Why / Ship / Look at / Not done / Green), naming the plan slice, if any, under **Where**.
4. No `Claude-Session:` line in the body: this repo will be public. End with the Claude Code generated-with line only.
5. Reply with the PR URL. Never merge.
