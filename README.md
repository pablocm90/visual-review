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

The review data (the `.json` beside the page) measures the files of changed nodes and their neighbours: lines of code, and each Rust or TS/JS function's or Rails method's cyclomatic complexity and ABC size. A Rust `?` isn't a branch there: each function's `?`s are its `earlyReturns`, listed beside its cyclomatic in `cyclomatic.byFunction`. Test files aren't measured.

In changed TS/JS files it also reads the symbols, functions, methods, getters, setters, classes, types, interfaces and enums, on both sides, and pairs them: added, removed, edited, formatting only, renamed (by an equal body, or "probably" by a similar one) or moved to another changed file. Each file's change gets a kind: an API change when its exports or an exported signature changed, else a logic change, else formatting only. Test files aren't read for symbols, and Rust and Rails symbols are planned. For an edited or renamed function or method it also lists its logic: its decisions (guards, ifs, ternaries, loops, cases, `&&`/`||`/`??`, catches, early returns and throws), each added, removed, changed or the same, by their source text with comments and spacing ignored.

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

Claude builds the page, writes structural notes and flags onto it, and serves it in your browser. Send your review from the page ([Your review](#your-review)) and Claude acts on its verdict and on each comment's kind: on Request changes it does each Change this and Fix this, answers each Question and Explain, and takes or turns down each Suggestion; on Comment it replies to each and changes nothing; and on Approve it answers any comments and stops. Selecting a crate, module or file opens an inspector beside the graph with its note, metrics, patches and tests, and selecting an edge opens its note; drag the divider between them, or focus it and use the arrow keys, to give either side more room.

Without Claude, run the CLI with the same argument. It builds the page with no notes and prints its path:

```sh
npx @pablocm90/visual-review 42
```

## Reading the page

The header names the repo and the range, and is headed by the PR, linked, or else by the range ("Uncommitted work" for uncommitted work). Beside it, the tabs: Structure, which holds the graph and everything listed below, Metrics, and Tests, with how many tests changed. The URL's hash (`#structure`, `#metrics`, `#tests`) names the tab, so back and forward move between tabs. Above the graph, **Colour by** switches its fill, and the legend under it follows. On Change, green is added, red with a dashed outline is removed, amber is modified, and grey is unchanged. A modified crate, module, box or class has a changed file inside it. A renamed one is drawn once, with "was …" under its name.

- **Reading order.** The left column opens with the changed parts numbered in the order to read them: what the others depend on first, the removed parts after the rest, then the changed files outside the graph. Parts that depend on each other are read in name order, and the first of them says so. Each row is marked with its findings, a triangle when one needs a look, and the count. Click a part to go to it; click an outside file to open its patches. Each drawn part carries its number at its top-left corner. `J` and `K` go to the next and previous part, starting at the first, and `A` marks the selected part read, ticking its row, or unread again; the column counts the parts read. The keys do nothing while you type in a comment or with Ctrl, ⌘ or Alt held. Your browser keeps the marks for the range, so a reload keeps them, but a page served again is at a new address and starts with none read.
- **Summary.** With Claude's notes, a strip above the graph holds the change's summary. Click a line to go to the part it's about.
- **Colour by Kind of change** fills each changed part by the strongest kind of change in it: API change darkest, then logic change, then formatting only, faded. A changed part with no symbols read, such as a stylesheet, a test file or a Rust module, says "symbols not read" and stays neutral, as unchanged parts do. Hovering a part names its kind.
- **Colour by Churn or Complexity** fills each measured part from a four-step blue ramp, and the outline still shows the change. Churn counts the commits that touched it in the window before the head, or the base for a removed part (0–2, 3–5, 6–8, 9+); Complexity is the cyclomatic of its most complex function at the head (0–4, 5–7, 8–10, 11+). A part that wasn't measured stays neutral, and a box takes the highest inside it. Hovering a part shows its value.
- **Findings.** Everything review-wide worth a look is a finding: about one dimension (structure, metrics, routes…), and either needing a look (a triangle) or for information (a circle). The review raises them for the stacks that weren't read, the changed files outside every stack (tools, plans, CI, config), the `fetch` calls no axum route matches, each exported symbol removed, renamed, moved away or whose signature changed (needing a look) or added (for information), each guard or catch a function lost (needing a look) and each function's other decision changes (for information), each file whose logic changed with no test changed alongside it (needing a look), the files whose symbols wouldn't parse and the stacks whose symbols aren't read (for information), and each threshold a file crosses at the head, such as `cyclomatic 4 → 14, over 10`, needing a look when the file is new, wasn't over on the base, or grew; each flag in Claude's notes is one too, needing a look.
  - **Triage**, above the graph, has a chip per dimension with findings, marked when one needs a look. Click one to show only its findings in Look first and the rail and to dim the other badges; click it again to show them all. The graph itself is never filtered.
  - **Look first**, under it, lists up to seven findings that need a look: what wasn't read first, then the parts most depended on, then the most churned. Click one to go to its part. **Show all** opens the rail, and the band's title folds it to one line.
  - **The rail**, a narrow strip beside the graph, counts the findings: the total, how many need a look and how many are for information, with a `!` when a reader's tool is missing, such as `cargo`. Open it to list them grouped by dimension, the stacks not read on top. Click a finding to go to its part; the outside files open their patches beside the graph. Calls whose path is built at runtime aren't drawn.
- **Graph.** Each stack is a box. Click `+` on a crate, folder or layer to open it, and `−` to close it. Arrows are dependencies or references, dashed when removed. Dotted arrows are `fetch` calls to routes. A badge at a closed part's top-right corner, or at an arrow's middle, marks its findings, and those of the parts closed inside it: red when one needs a look, grey when they're all for information. Hover it to read them; click it to select its part.
- **Zoom and pan.** The graph opens fitted in a frame of its own, never above 100%. Drag anywhere in it, or use the wheel, to pan; at its edge, the wheel scrolls the page instead. Ctrl/⌘ + wheel or a trackpad pinch zooms at the pointer. The toolbar's − / + / Fit / 100% zoom about the centre, up to 400%. With the frame focused, `+` and `−` zoom, `0` fits, `1` goes to 100% and the arrow keys pan. Opening or closing a box keeps it where it was on screen; going to a part centres it at 100%.
- **Show** picks how much of the graph is drawn. **Changes only**, the default, draws the changed parts and both ends of each added or removed arrow. **Changed + 1 hop** adds every direct neighbour of a changed part. **Everything** draws it all. **Since last review**, offered once you have sent a review of an earlier head of the same PR, draws only what changed since in the files the PR changes, so merging the base branch in counts only where it touches one of those files. When that commit is no longer in your clone, as after a force-push and a prune, the header says so and the full review is shown. Going to a part that isn't drawn widens Show only as far as it needs.
- **All edges**, unticked by default, keeps an opened box readable: unchanged edges between two boxes are merged into one box-to-box arrow, and unchanged edges inside a box are hidden. Edges that are added, removed, noted or touch a changed part are always drawn in full. Tick it to draw every edge as it is.
- **Selecting** a part opens the inspector, headed by its name, kind and stack, change, path and what it was renamed from. Its tabs, each shown only when it has something: **Note**, the findings on the part, each with its detail, then Claude's note; **Metrics**, each measure before and after with the difference and a bar each (lines, functions, highest and total cyclomatic, ABC size, fan-out, fan-in, churn), a row over a threshold marked by its level, then its functions by cyclomatic, the most complex first; **Diff**, the patches of its files; **Tests**, the test changes alongside it: at or under it, or named after a file inside it; and **Symbols**, its changed symbols grouped by change, API changes first, its unchanged and formatting-only ones folded under a count, a changed signature shown base above head, a renamed one with what it was, a moved one with the file it went to or came from (click it to go there), an edited function's logic lines under it, indented by depth, a changed one base then head (click one that changed to see its line in the Diff tab); on a box, each file inside it with symbol changes, and a file that wouldn't parse with the parser's message. Selecting an arrow shows its findings and note. Close it with its `×`, and drag the divider, or focus it and use the arrow keys, to resize it.

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
- `metrics.cyclomatic` (10), `metrics.hotspot` (`{ "churn": 6, "cyclomatic": 8 }`), `metrics.lines` and `metrics.abc` (off unless set) are the thresholds the review's metrics findings are raised against.
- `linkers.fetch-axum` draws the `fetch` calls of TS stacks to the routes of Rust crates that depend on axum, and lists calls no route matches. `from` and `to` limit it to those stacks, and `false` turns it off.

A key that names no detected stack, an unknown field, or a field the stack's reader doesn't take fails the review, naming the file and the field.

## Notes

A notes file is JSON in notes version 1, whose schema is [`notes.schema.json`](https://unpkg.com/@pablocm90/visual-review@0.7/dist/notes.schema.json) (give that URL as `$schema`). Beside `version`, `summary` holds a few `{ text, target? }` items on the change as a whole and `tests` a sentence on what the tests pin; `notes` maps a node id, or `<from> -> <to>` for an edge, to `{ text, flag?, dimension? }`, where `flag` labels a structural concern, shown as a finding in `dimension` (`structure` when left out), and may be left out when there is nothing to note.

`--notes <file>` with the same argument fills the notes into the page already written for it. A missing or unknown `version`, an unknown key, an id the graph doesn't have, or a changed part without a note fails it, naming the file.

## Your review

`serve <page.html>` serves a page that's already written and opens it in your browser; `serve --no-open <page.html>` serves it without opening anything, for when something else hands the URL to a browser:

```sh
npx @pablocm90/visual-review serve .reviews/<sha>..<sha>.html
```

It listens on `127.0.0.1` at a free port and prints the page's URL on stderr; the URL holds a token made for this serve, and any other path or host is refused with 403. On the served page, the inspector's Note tab has a **Your comment** field for the selected node or edge, its Symbols tab a **Comment** toggle opening one on each symbol and logic line, its Diff tab and the changed files outside the graph one on each line of a patch, and its Tests tab and the Tests screen one on each test, the same comment in both, under its kind, **Change this**, **Question** (picked until another is) or **Suggestion**, each finding, in the left rail and under the inspector's note, offers **Fix this**, **It's fine** (with an optional why) and **Explain**, one answer per finding, the last one pressed, withdrawn by pressing it again, and the review tray, a bar at the page's foot on every tab, counts what you've drafted by kind ("2 drafted · 1 change · 1 question"). Its **Review** button opens it: your comments, those on parts in reading order first, then your answers, by the finding's title, each going to what it is on, how many parts of the reading order you marked read and which of them you read with nothing to say, a **General comment** on the whole change, a verdict, **Approve**, **Comment** or **Request changes**, with one marked suggested from your drafts (Request changes once there is a Change this or a Fix this, else Comment once there is a Question or an Explain, else Approve) and picked until you pick another, which then holds, a **What Claude gets** preview of the review as lines, and a **Send to Claude** button, enabled once the general comment or a comment holds more than blanks or a finding has an answer, or at once for an Approve. Sending writes the verdict, the general comment, the parts read, the comments and the answers beside the page as `<name>.review.json`, prints that file's path on stdout, and ends `serve` with exit 0. Nothing is sent until then. A page opened as a file has neither the field, the answers nor the tray.

While the page is open, its tab pings `serve` every 30 seconds. `serve` waits up to a day for the first ping, so a page can wait until you get to it, then ten minutes after the last one: when either runs out, the tab never opened or closed, `serve` exits 1 with `No review sent` on stderr, so nothing is left running. One page has one server: `serve` writes `<name>.serve` beside the page (its pid, port and token, readable by you only) and removes it on exit, and serving a page that is already served opens the live one and exits 0 with nothing on stdout. With `--no-open`, serving a page that is already served prints the live one's URL on stderr instead of opening it. A lock whose server no longer answers is replaced. `VISUAL_REVIEW_IDLE_MS` changes the ten minutes, and `VISUAL_REVIEW_FIRST_PING_MS` the day, both in milliseconds.

A review file is JSON in review version 5, whose schema is [`review.schema.json`](https://unpkg.com/@pablocm90/visual-review@0.16/dist/review.schema.json): `verdict` is `approve`, `comment` or `request-changes`, `body`, when there is one, is the general comment, `reviewed` is what the page was drawn for, `{ range, pullRequest? }`, its PR by number, `read` lists the ids of the parts marked read, in reading order, and `comments` lists one entry per anchor: the comments, `{ anchor, kind: 'change' | 'question' | 'suggestion', text }`, their anchor `{ kind: 'part' | 'edge', id }`, its `id` a node id, or `<from> -> <to>` for an edge, as notes are keyed, `{ kind: 'symbol', id }` for a function, method or class, `<file node id>#<scope.name>`, `#<n>` after it from the second of that name in the file on, `{ kind: 'decision', id, text }` for a logic line of one, `<symbol id>#<text>`, `#<n>` after it from the second line reading the same on, and the line's text, `{ kind: 'test', id }` for a test, `<test file>#<heading › … › name>`, or `{ kind: 'line', id, text }` for a diff line, `<file>@<base|head>:<n>` and the line's text (the page makes part, edge, symbol, decision and test anchors so far), then the answers to findings, `{ anchor: { kind: 'finding', id }, kind: 'fix' | 'fine' | 'explain', text? }`, their `id` the finding's, `text` optional, which the page sends only as a `fine`'s why.

## Where pages go

Pages go to `.reviews/` at the repo root, which git ignores. Each page is named by its range, for example `<sha>..<sha>.html` for a PR, with its data (`.json`), Claude's notes (`.notes.json`) and your review (`.review.json`) beside it. Only the 20 most recently written pages are kept, plus each PR's newest review, which its next round compares against. Pages aren't hosted: each person runs the review they want to see.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) to set up the repo, run its checks, and add a reader for another language. Report a vulnerability privately, as [SECURITY.md](SECURITY.md) says. What changed in each release is in [CHANGELOG.md](CHANGELOG.md).

## License

MIT
