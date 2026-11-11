# visual-review

Structural review pages for pull requests, ranges and uncommitted work: the Rust crates and modules, the TS/JS modules and the Rails classes of a repo, before and after, with what changed coloured, and optional notes written by Claude or anyone else. Public, and published to npm as `@pablocm90/visual-review`.

## Where things are

The layout: `src/core/` holds the ports (`Reader`, `Linker`), config, `read-range.ts` and `read-stacks.ts`, the diff, the collapse rules (`visible-diff.ts`: what is drawn at an expansion, its unchanged edges merged per pair of boxes unless the page's "All edges" is ticked, what the page's Show keeps of it, `changesOnly` (the default: changed nodes and the ends of added or removed edges) `logicOnly` (the files with a changed decision, boxes open, every edge between them, whatever `expanded` and `drawn` say), or `nearChanges` (one hop of any edge touching a change), or, on a PR's later round, `sinceLastReview` (what changed since its last review, at the expansion drawn), and what going to an id opens, widening Show as far as it needs) and notes, placed on them (`notes.ts`); the adapters sit behind the ports in `src/readers/{rust,typescript,rails}/` and `src/linkers/fetch-axum/`, listed in `src/adapters.ts`, which `cli.ts` hands to `readRange` (the core imports neither it nor `on-path.ts`); `src/git/` holds the git, `gh` and `PATH` plumbing; `src/viewer/` is the page, which imports the core and never the reverse, its styles in `src/viewer/styles/` by area. Bare file names below live in those folders.

- `src/cli.ts` is the entry point (`pnpm review <pr | from..to>`, or nothing for uncommitted work). Each area has its own page under `docs/`; read the one for the code you change, and keep it in step:
  - [`docs/reading.md`](docs/reading.md): `readRange` and `readStacks`, the readers, config, linkers, rules, the diff, churn and metrics, symbols and logic, reaches, and running cargo.
  - [`docs/change-readers.md`](docs/change-readers.md): lockfiles, migrations, schema dumps, routes and authorization, read by `readChanges`.
  - [`docs/findings-and-notes.md`](docs/findings-and-notes.md): notes, the split suggestion, the findings (`RAISERS`), coverage and Start here.
  - [`docs/rounds.md`](docs/rounds.md): a PR's later round, its last review and what changed since.
  - [`docs/page-and-serve.md`](docs/page-and-serve.md): the reading order, `page.ts`'s page data contract, and `serve`.
  - [`docs/viewer.md`](docs/viewer.md): the page's components, screens and styles.
- `src/test-support/` builds temporary git repos, Cargo workspaces and a fake `gh` for the tests. Pipeline rules are tested on `readStacks` with `fakeReader`/`fakeLinker` (`fakes.ts`); only what needs a real reader goes through `readRange` with the real adapters (`read-range.ts` there). `src/fixtures/` holds captured `cargo metadata` and depcruise output.
- `plugin/` is the Claude Code plugin (`plugin/skills/visual-review/SKILL.md` writes notes onto a page, on a later round with its answers to the last review, serves it in the background and acts on the review's verdict when `serve` exits), and `.claude-plugin/marketplace.json` makes the repo its marketplace (`pablocm90`). The skill runs the CLI through npx at the version `package.json` says (`plugin.test.ts` keeps `plugin.json` and the pin in step); `VISUAL_REVIEW_PACKAGE` swaps in another npm spec, such as a packed tarball's absolute path.

## Commands

- `pnpm install`, then `pnpm check` (biome), `pnpm typecheck` (tsc 7, no emit), `pnpm test` (vitest, ~40 s), `pnpm mutate` (Stryker), `pnpm build` (`dist/`: the CLI as JS via `tsconfig.build.json`, plus the page).
- The package is `@pablocm90/visual-review` with the bin `visual-review` (`dist/cli.js`), shipping only `dist/`. Anything the CLI imports at runtime must be in `dependencies`; what only the page bundles (React, ELK, highlight.js) stays in `devDependencies`. Check an install with `pnpm pack` and `pnpm add <tarball>` in a scratch project.
- **Pre-push gate:** `pnpm check && pnpm typecheck`. CI (`.github/workflows/ci.yml`, GitHub Actions on every push) runs those plus `pnpm test` and `pnpm build`, with git and cargo on the runner.
- `src/index.ts` is the package entry: types only (`Reader`, `Graph`…). Node ids are part of a reader's contract (JSDoc on `GraphNode`): notes are keyed by them.

## Stack and gotchas

- Node 22.22 (`.tool-versions`) runs the `.ts` sources directly by type stripping: relative imports carry `.ts`, and no syntax that needs emit (enums, parameter properties).
- TypeScript strict with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and `noPropertyAccessFromIndexSignature`: index results are `T | undefined`, and `process.env['X']` takes brackets.
- Biome: single quotes, width 100, arrow parens as needed; two a11y rules are off under `src/viewer/**`.
- TypeScript 7 has no JS compiler API, so dependency-cruiser parses TS through `@swc/core`. Without it the web graph silently reads no modules.
- The tests shell out to real `git` and `cargo`. The page tests are split by feature (`src/viewer/page-*.test.tsx`: graph and tray, findings and reading, inspector, What changed, rows and landing, last review and logic), all importing their helpers, fixtures and jsdom stubs from `review-page.fixtures.tsx`, which lays the shared fixture out once at load; they wait up to 3 s (`asyncUtilTimeout`) in every `findBy` and `waitFor`, so a loaded machine renders the first page in time, and the page project's `testTimeout` is 15 s, since each `getByRole` and click makes jsdom match its default stylesheet and a long page test passes 5 s at 12 parallel runs; ask before raising a timeout, and diagnose a flake with the test file run 12× in parallel under busy loops before blaming load. `vitest.config.ts` runs the `.test.ts` files first and the `.test.tsx` files after them, one at a time (`sequence.groupOrder`, `fileParallelism`), because a page test's slowdown follows the other files running during it: keep them apart. To expose a page test that reads before a relayout lands, delay `layoutDiff` by a temporary `setTimeout` and run the file at several delays; it should stay green.

## Conventions

- The domain's words (finding, dimension, level, fact, check, Start here) are defined in `GLOSSARY.md`.
- **This repo is public.** Commit messages and PR bodies carry no `Claude-Session:` line, whatever the attribution reminder says. Keep `Co-Authored-By`.
- Changes land through PRs from a task branch (`claude-dev task <slug>`), never pushed straight to `main`.
- Publishing to npm is an outward-facing step the user runs or approves.
