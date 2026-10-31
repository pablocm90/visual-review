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

The review data (the `.json` beside the page) measures the files of changed nodes and their neighbours: lines of code, and each Rust or TS/JS function's or Rails method's cyclomatic complexity and ABC size. Test files aren't measured.

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

Claude builds the page, writes structural notes and flags onto it, and opens it in your browser. Selecting a crate, module or file opens an inspector beside the graph with its note, metrics, patches and tests, and selecting an edge opens its note; drag the divider between them, or focus it and use the arrow keys, to give either side more room.

Without Claude, run the CLI with the same argument. It builds the page with no notes and prints its path:

```sh
npx @pablocm90/visual-review 42
```

## Reading the page

The header names the repo and the range, and is headed by the PR, linked, or else by the range ("Uncommitted work" for uncommitted work). Beside it, the tabs: Structure, which holds the graph and everything listed below, Metrics, and Tests, with how many tests changed. The URL's hash (`#structure`, `#metrics`, `#tests`) names the tab, so back and forward move between tabs. Above the graph, **Colour by** switches its fill, and the legend under it follows. On Change, green is added, red with a dashed outline is removed, amber is modified, and grey is unchanged. A modified crate, module, box or class has a changed file inside it. A renamed one is drawn once, with "was …" under its name.

- **Summary.** With Claude's notes, a strip above the graph holds the change's summary. Click a line to go to the part it's about.
- **Colour by Churn or Complexity** fills each measured part from a four-step blue ramp, and the outline still shows the change. Churn counts the commits that touched it in the window before the head, or the base for a removed part (0–2, 3–5, 6–8, 9+); Complexity is the cyclomatic of its most complex function at the head (0–4, 5–7, 8–10, 11+). A part that wasn't measured stays neutral, and a box takes the highest inside it. Hovering a part shows its value.
- **Findings.** A narrow strip beside the graph counts everything review-wide worth a look: the total, the ones that need a look (a triangle) and the ones for information (a circle). When a reader's tool is missing, such as `cargo`, it also holds a `!`, and the open rail starts with which stacks weren't read. Open it to list the findings in groups, filtered by All / Notes / Metrics / Not drawn chips for the groups holding any: **Flagged in notes** (each a note's flag, needing a look), **Metrics** (each threshold a file crosses at the head, such as `cyclomatic 4 → 14, over 10`, needing a look when the file is new, wasn't over on the base, or grew), and **Not drawn** (the `fetch` calls no axum route matches, and the changed files outside every stack, such as tools, plans, CI and config). Click a note's or a metric finding to go to its part; the outside files open their patches beside the graph, and the calls with no route are only counted. Calls whose path is built at runtime aren't drawn.
- **Graph.** Each stack is a box. Click `+` on a crate, folder or layer to open it, and `−` to close it. Arrows are dependencies or references, dashed when removed. Dotted arrows are `fetch` calls to routes. A `!` badge at a closed part's top-right corner, or at an arrow's middle, marks a flagged note. One at a part's bottom-right corner marks calls no route matches.
- **Zoom and pan.** The graph opens fitted in a frame of its own, never above 100%. Drag anywhere in it, or use the wheel, to pan; at its edge, the wheel scrolls the page instead. Ctrl/⌘ + wheel or a trackpad pinch zooms at the pointer. The toolbar's − / + / Fit / 100% zoom about the centre, up to 400%. With the frame focused, `+` and `−` zoom, `0` fits, `1` goes to 100% and the arrow keys pan. Opening or closing a box keeps it where it was on screen; going to a part centres it at 100%.
- **Changed + 1 hop**, ticked by default, draws only the changed parts and their direct neighbours. Untick it to see everything.
- **All edges**, unticked by default, keeps an opened box readable: unchanged edges between two boxes are merged into one box-to-box arrow, and unchanged edges inside a box are hidden. Edges that are added, removed, noted or touch a changed part are always drawn in full. Tick it to draw every edge as it is.
- **Selecting** a part opens the inspector, headed by its name, kind and stack, change, path and what it was renamed from. Its tabs, each shown only when it has something: **Note**; **Metrics**, each measure before and after with the difference and a bar each (lines, functions, highest and total cyclomatic, ABC size, fan-out, fan-in, churn), a row over a threshold marked by its level, then its functions by cyclomatic, the most complex first; **Diff**, the patches of its files; and **Tests**, the test changes alongside it: at or under it, or named after a file inside it. Selecting an arrow shows its note. Close it with its `×`, and drag the divider, or focus it and use the arrow keys, to resize it.

The **Metrics** tab measures the changed files and their neighbours, base → head. Three tiles total the change: the lines it adds or removes across the changed parts, the functions over the cyclomatic threshold before and after (naming the most complex at the head), and the hotspots it touches among the head's. The table lists each measured file, the changed ones by default or **Changed + 1 hop** for their neighbours too, narrowed to one stack and sorted by Cyclomatic Δ, Churn, Lines Δ or ABC Δ: its lines, highest cyclomatic, ABC size, fan-out, fan-in and churn, each base → head with the difference ("new" or "gone" for a missing side, "—" where a side has no complexity), a cell over a threshold marked by its level; a legend under the table says what each column measures. Click a file's name to go to it on Structure. The **Hotspots** chart plots churn against highest cyclomatic for the changed files: each moves from its base (a ring) to its head (a dot), an added one is its dot alone, and the shaded corner holds the hotspots, past both cuts, under the cyclomatic threshold's dashed line. Under it, a line names each file entering the corner and each one already in it that changed again.

The **Tests** tab lists the test files whose tests changed, under Claude's line on what they pin. **All** shows every one; while a part is selected on Structure, **For** that part shows those alongside it: at or under it, or named after a file inside it in the same stack (`refund.test.ts` beside `refund.ts`, `test/models/user_test.rb` beside `app/models/user.rb`). Beside them, the shown tests are counted by change: `+` added, `✎` edited, `−` removed, `↷` moved, a test moved between files counting once. Each file names its stack, says "new file" when the base had none, and shows its tests as a tree: `+` added, `−` removed, `✎` edited, `·` unchanged, with "moved to" or "moved from" for a test that changed file. **Changed nodes** lists the added and modified parts with the changed tests alongside each, those with none first, marked as needing a look; click one to go to it on Structure.

## When detection misreads a repo

Stacks are detected: a Cargo workspace at the repo root, every `package.json` whose source root holds TS/JS files, and every Rails app (a `config/application.rb` outside `vendor/`, `node_modules/`, `test/` and `spec/`). A `visual-review.config.json` at the repo root overrides that. It is read from the reviewed head revision, or from your checkout when the head has none, and applies to both sides.

```json
{
  "$schema": "https://unpkg.com/@pablocm90/visual-review@0.3/dist/config.schema.json",
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
- `metrics.churnDays` sets how many days before each side's commit the review data's churn counts commits over (90 when left out).
- `metrics.cyclomatic` (10), `metrics.hotspot` (`{ "churn": 6, "cyclomatic": 8 }`), `metrics.lines` and `metrics.abc` (off unless set) are the thresholds the review data's `metricFindings` are raised against.
- `linkers.fetch-axum` draws the `fetch` calls of TS stacks to the routes of Rust crates that depend on axum, and lists calls no route matches. `from` and `to` limit it to those stacks, and `false` turns it off.

A key that names no detected stack, an unknown field, or a field the stack's reader doesn't take fails the review, naming the file and the field.

## Notes

A notes file is JSON in notes version 1, whose schema is [`notes.schema.json`](https://unpkg.com/@pablocm90/visual-review@0.4/dist/notes.schema.json) (give that URL as `$schema`). Beside `version`, `summary` holds a few `{ text, target? }` items on the change as a whole and `tests` a sentence on what the tests pin; `notes` maps a node id, or `<from> -> <to>` for an edge, to `{ text, flag? }`, where `flag` labels a structural concern, and may be left out when there is nothing to note.

`--notes <file>` with the same argument fills the notes into the page already written for it. A missing or unknown `version`, an unknown key, an id the graph doesn't have, or a changed part without a note fails it, naming the file.

## Where pages go

Pages go to `.reviews/` at the repo root, which git ignores. Each page is named by its range, for example `<sha>..<sha>.html` for a PR, with its data (`.json`) and Claude's notes (`.notes.json`) beside it. Only the 20 most recently written pages are kept. Pages aren't hosted: each person runs the review they want to see.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) to set up the repo, run its checks, and add a reader for another language. Report a vulnerability privately, as [SECURITY.md](SECURITY.md) says. What changed in each release is in [CHANGELOG.md](CHANGELOG.md).

## License

MIT
