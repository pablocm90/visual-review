# visual-review

Draws what a change did to the structure of a repo: the Rust crates and their dependencies, the web modules and files and their imports, and the web calls to API routes, before and after, with added, removed and modified parts coloured. A renamed crate, module or file is one node that says what it was called ("was domain"), and a test that moved to another file says where it went. Changed files outside those (tools, plans, CI, config) are listed below the graph with their patches.

It reads Rust (Cargo workspaces) and TypeScript/JavaScript, and links `fetch` calls to axum routes. More languages are planned.

## Before the first run

- Node `^22.20.0 || >=24.8.0`.
- macOS or Linux. 0.1 doesn't run on Windows.
- `git`.
- `cargo` on your `PATH` for Rust crates, which come from `cargo metadata`. Without it, the Rust stacks are skipped and the page says so.
- For PRs, the GitHub CLI, logged in with `gh auth login`, and a git remote that points at the PR's repository. Any name works, so a fork's `origin` beside an `upstream` is fine.

Nothing needs installing in the reviewed repo.

## Run it

In Claude Code, add the plugin once:

```
/plugin marketplace add pablocm90/visual-review
/plugin install visual-review@pablocm90
```

Each plugin release pins the CLI version it runs, so a new release reaches you only once you update the plugin. Run this in your shell, and the next session uses it:

```sh
claude plugin update visual-review@pablocm90
```

Or, in `/plugin`, pick the `pablocm90` marketplace and enable auto-update.

Then, from anywhere in the repo (as `/visual-review:visual-review` when another skill or command already takes the name):

| Command | Reviews |
|---|---|
| `/visual-review 42` | PR #42, from where it branched off its base to its head |
| `/visual-review main..my-branch` | a range of commits |
| `/visual-review` | your uncommitted work against `HEAD` |

Claude builds the page, writes structural notes and flags onto it, and opens it in your browser. Selecting a crate, module, file or edge opens its note and patches in a panel beside the graph; drag the divider between them, or focus it and use the arrow keys, to give either side more room.

Without Claude, run the CLI with the same argument. It builds the page with no notes and prints its path:

```sh
npx @pablocm90/visual-review 42
```

## When detection misreads a repo

Stacks are detected: a Cargo workspace at the repo root, and every `package.json` whose source root holds TS/JS files. A `visual-review.config.json` at the repo root overrides that. It is read from the reviewed head revision, or from your checkout when the head has none, and applies to both sides.

```json
{
  "$schema": "https://unpkg.com/@pablocm90/visual-review@0.1/dist/config.schema.json",
  "stacks": {
    "web": { "boxes": ["modules/*"], "label": "Web app" },
    "e2e": false,
    "api": { "reader": "rust", "root": "backend" },
    "gen": { "reader": "typescript", "root": "tools/gen", "sourceRoot": "lib" }
  },
  "linkers": {
    "fetch-axum": { "from": ["web"], "to": ["api"] }
  }
}
```

- Stacks are keyed by the id the page draws: a package's directory, a root package's name, or `rust`.
- `false` drops a stack, and `label` relabels it.
- `reader` with `root` adds a stack that detection missed (`rust` or `typescript`).
- TS stacks also take `sourceRoot`, and `boxes`: folder globs under the source root, each matched folder one box. The deepest match wins, and other files keep one box per first folder.
- `linkers.fetch-axum` draws the `fetch` calls of TS stacks to the routes of Rust crates that depend on axum, and lists calls no route matches. `from` and `to` limit it to those stacks, and `false` turns it off.

A key that names no detected stack, an unknown field, or a field the stack's reader doesn't take fails the review, naming the file and the field.

## Notes

A notes file is JSON in notes version 1, whose schema is [`notes.schema.json`](https://unpkg.com/@pablocm90/visual-review@0.1/dist/notes.schema.json) (give that URL as `$schema`). Beside `version`, `summary` holds a few `{ text, target? }` items on the change as a whole and `tests` a sentence on what the tests pin; `notes` maps a node id, or `<from> -> <to>` for an edge, to `{ text, flag? }`, where `flag` labels a structural concern.

`--notes <file>` with the same argument fills the notes into the page already written for it. A missing or unknown `version`, an unknown key, an id the graph doesn't have, or a changed part without a note fails it, naming the file.

## Where pages go

Pages go to `.reviews/` at the repo root, which git ignores. Each page is named by its range, for example `<sha>..<sha>.html` for a PR, with its data (`.json`) and Claude's notes (`.notes.json`) beside it. Only the 20 most recently written pages are kept. Pages aren't hosted: each person runs the review they want to see.

## License

MIT
