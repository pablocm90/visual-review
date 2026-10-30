# visual-review

Draws what a change did to the structure of a repo: the Rust crates and their dependencies, the web modules and files and their imports, the classes of a Rails app in a box per layer, and the web calls to API routes, before and after, with added, removed and modified parts coloured. A renamed crate, module or file is one node that says what it was called ("was domain"), and a test that moved to another file says where it went. Changed files outside those (tools, plans, CI, config) are listed below the graph with their patches.

## What it reads

Out of the box, it reads these, with nothing to configure:

| Language | Detected from | Drawn as | Edges | Tests compared |
|---|---|---|---|---|
| Rust | a Cargo workspace at the repo root | crates, holding their modules | crate dependencies, and the modules' `use` paths | `#[test]` functions, in `#[cfg(test)]` modules too |
| TypeScript and JavaScript | every `package.json` whose source root holds TS/JS files | one box per first folder under the source root (or per `boxes` glob), holding its files | imports, including a sibling package's by its name | `test`/`it` calls, grouped by `describe`, in `*.test.*` and `*.spec.*` files |
| Ruby on Rails | every `config/application.rb` outside `vendor/`, `node_modules/`, `test/` and `spec/` | one box per `app/` layer (`models`, `controllers`…) and `lib` (or per `boxes` glob), holding its classes | the constants a class names, and model associations | Minitest under `test/`, RSpec under `spec/` |

Across stacks, `fetch` calls in TS/JS are linked to the routes of Rust crates that use axum.

Each language is read as text, with no compiler or runtime for it, except Rust's crate list, which comes from `cargo metadata`. Ruby doesn't need to be installed, and nothing in the reviewed repo is built or run. Other languages are planned.

## Before the first run

- Node `^22.20.0 || >=24.8.0`.
- macOS or Linux. It doesn't run on Windows yet.
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

Claude builds the page, writes structural notes and flags onto it, and opens it in your browser. Selecting a crate, module or file opens its note and patches in a panel beside the graph, and selecting an edge opens its note; drag the divider between them, or focus it and use the arrow keys, to give either side more room.

Without Claude, run the CLI with the same argument. It builds the page with no notes and prints its path:

```sh
npx @pablocm90/visual-review 42
```

## Reading the page

The header names the range (and the PR, linked) and gives the legend: green is added, red with a dashed outline is removed, amber is modified, and grey is unchanged. A modified crate, module, box or class has a changed file inside it. A renamed one is drawn once, with "was …" under its name. When a reader's tool is missing, such as `cargo`, an alert says which stacks weren't read.

- **Summary.** With Claude's notes, the change's summary and every flagged concern come first. Click one to go to the part it's about.
- **Graph.** Each stack is a box. Click `+` on a crate, folder or layer to open it, and `−` to close it. Arrows are dependencies or references, dashed when removed. Dotted arrows are `fetch` calls to routes. A `!` badge at a closed part's top-right corner, or at an arrow's middle, marks a flagged note. One at a part's bottom-right corner marks calls no route matches.
- **Zoom and pan.** The graph opens fitted in a frame of its own, never above 100%. Drag anywhere in it, or use the wheel, to pan; Ctrl/⌘ + wheel or a trackpad pinch zooms at the pointer. The toolbar's − / + / Fit / 100% zoom about the centre, up to 400%. With the frame focused, `+` and `−` zoom, `0` fits, `1` goes to 100% and the arrow keys pan. Opening or closing a box keeps it where it was on screen; going to a part centres it at 100%.
- **Changed + 1 hop**, ticked by default, draws only the changed parts and their direct neighbours. Untick it to see everything.
- **All edges**, unticked by default, keeps an opened box readable: unchanged edges between two boxes are merged into one box-to-box arrow, and unchanged edges inside a box are hidden. Edges that are added, removed, noted or touch a changed part are always drawn in full. Tick it to draw every edge as it is.
- **Selecting** a part opens a panel with its note and the patches of its files. Selecting an arrow shows its note. Drag the divider, or focus it and use the arrow keys, to resize it.
- **Tests** lists the test files whose tests changed, or the selected part's, as a tree: `+` added, `−` removed, `✎` edited, `·` unchanged, with "moved to" or "moved from" for a test that changed file.
- **Calls with no route** lists `fetch` calls no axum route matches. Calls whose path is built at runtime aren't drawn.
- **Not in the graph** holds the patches of changed files outside every stack (tools, plans, CI, config).

## When detection misreads a repo

Stacks are detected: a Cargo workspace at the repo root, every `package.json` whose source root holds TS/JS files, and every Rails app (a `config/application.rb` outside `vendor/`, `node_modules/`, `test/` and `spec/`). A `visual-review.config.json` at the repo root overrides that. It is read from the reviewed head revision, or from your checkout when the head has none, and applies to both sides.

```json
{
  "$schema": "https://unpkg.com/@pablocm90/visual-review@0.2/dist/config.schema.json",
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

- Stacks are keyed by the id the page draws: a package's or Rails app's directory, a root package's name, the repo's folder name for a Rails app at the root, or `rust`.
- `false` drops a stack, and `label` relabels it.
- `reader` with `root` adds a stack that detection missed (`rust`, `typescript` or `rails`).
- TS stacks also take `sourceRoot`, and `boxes`: folder globs under the source root, each matched folder one box. The deepest match wins, and other files keep one box per first folder.
- Rails stacks take `boxes` too, as folder globs under the app root: `["app/models/*"]` puts `app/models/billing/invoice.rb` in a `models/billing` box. Other classes keep their layer's box (`models`, `lib`).
- `linkers.fetch-axum` draws the `fetch` calls of TS stacks to the routes of Rust crates that depend on axum, and lists calls no route matches. `from` and `to` limit it to those stacks, and `false` turns it off.

A key that names no detected stack, an unknown field, or a field the stack's reader doesn't take fails the review, naming the file and the field.

## Notes

A notes file is JSON in notes version 1, whose schema is [`notes.schema.json`](https://unpkg.com/@pablocm90/visual-review@0.2/dist/notes.schema.json) (give that URL as `$schema`). Beside `version`, `summary` holds a few `{ text, target? }` items on the change as a whole and `tests` a sentence on what the tests pin; `notes` maps a node id, or `<from> -> <to>` for an edge, to `{ text, flag? }`, where `flag` labels a structural concern.

`--notes <file>` with the same argument fills the notes into the page already written for it. A missing or unknown `version`, an unknown key, an id the graph doesn't have, or a changed part without a note fails it, naming the file.

## Where pages go

Pages go to `.reviews/` at the repo root, which git ignores. Each page is named by its range, for example `<sha>..<sha>.html` for a PR, with its data (`.json`) and Claude's notes (`.notes.json`) beside it. Only the 20 most recently written pages are kept. Pages aren't hosted: each person runs the review they want to see.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) to set up the repo, run its checks, and add a reader for another language. Report a vulnerability privately, as [SECURITY.md](SECURITY.md) says. What changed in each release is in [CHANGELOG.md](CHANGELOG.md).

## License

MIT
