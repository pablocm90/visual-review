# Changelog

What changed in each release of `@pablocm90/visual-review`, newest first. Versions follow [semver](https://semver.org); while it is 0.x, a minor version may change the exported types.

## 0.4.1 — 2026-10-31

### Changed

- A notes file may leave out `notes` when there is nothing to note, as for a review that touches no drawn part; it no longer has to write `"notes": {}`.

## 0.4.0 — 2026-10-31

### Added

- The page's header reads `<repo> · <range>`, headed by the PR's number and title, linked, or else by the range, and "Uncommitted work" for uncommitted work; the review data's new `repo` is the PR's `owner/name`, else the checkout's folder name. Beside it a `Review` nav links the tabs: Structure, today's page, Metrics and Tests. The URL's hash picks the tab, and back and forward move between tabs.

- Rust files are measured: `metrics` also carries, per side, `lines` (non-blank, non-comment), `functions`, `cyclomatic: { highest, total, byFunction }` over its functions (`byFunction` lists each function's `name` and `cyclomatic` in the file's order; a box has none), `abc` (the ABC size of its summed assignments, branches and conditions), and `fanIn` / `fanOut`, the edges into and out of it on that side. Test code isn't measured. A box takes the highest of each inside it. Readers gain an optional `measure(text, path)`, with its types exported; a file it measures as `undefined` is left unmeasured.
- TS and JS files are measured the same way, parsed with `@babel/parser`, decorators included: functions are declarations, methods, accessors and the functions or arrows assigned to a name or a member (`exports.handler = …`), behind a cast (`as`, `satisfies`, `!`, `<T>`) or not. A module-level anonymous function takes the name of the declarator, assignment or export it sits under (`default` for `export default`), and a callback counts toward the function holding it. Cyclomatic counts as ESLint's `complexity` does; ABC counts a switch's `default` as a condition, as Rust counts `_`. A file that doesn't parse, a file over 256 KB or with a line over 1,000 characters, and the `*.test.*` and `*.spec.*` files tests are read from keep churn and fan only.
- Rails files are measured the same way, parsed with tree-sitter-ruby: every `def` in a class's file is a method (`def self.x` named `self.x`, endless ones and those in `class << self` too), and a block or lambda counts toward the method holding it, while code outside any method isn't measured. Cyclomatic is plain McCabe: 1 plus each `if`, `unless`, `elsif`, modifier, ternary, loop, `when`, `in`, `rescue`, `&&`/`and`, `||`/`or`, `||=`, `&&=` and `&.`. ABC counts `=` and `op=` (a multiple assignment and a setter once), calls, `yield` and `super` but not a bare name, which may be a local, and comparisons, `else`, `elsif`, `when`, `in`, `rescue`, ternary and `&.`. A file with a syntax error, and test files, keep churn and fan only.
- `metricFindings` lists each measured file over a threshold on the head side: a function's cyclomatic over `metrics.cyclomatic` (10), a hotspot whose churn and highest cyclomatic both reach `metrics.hotspot` (6 and 8), and, when set, `metrics.lines` and `metrics.abc`. Each is `look` when the file is new, wasn't over on the base, or grew (for a hotspot, its cyclomatic), and `info` otherwise.
- **Findings rail.** Beside the graph, a strip counts the review's findings: the total, those needing a look (a triangle) and those for information (a circle). Opened, it lists them grouped as Flagged in notes, Metrics and Not drawn, filtered by All / Notes / Metrics / Not drawn chips with their counts. A metric finding reads as a sentence (`application: cyclomatic 4 → 14, over 10`). A note's or a metric finding goes to its node or edge; the changed files outside the graph open their patches beside it; the calls with no route are counted. The alert for stacks that weren't read sits at the rail's top, shown as a `!` while the rail is collapsed.
- **Inspector.** Selecting a node opens it beside the graph, headed by the node's label, kind and stack, change, path and what it was renamed from, with a close button. Its tabs are Note, Metrics, Diff and Tests (with its count), each only when it has something; an edge has Note only. Metrics lists lines, functions, cyclomatic highest and total, ABC size, fan-out, fan-in and churn before and after, with the difference and a bar each, a row over a threshold marked by its level, "highest inside" on a box and "not measured" where a side has no complexity; then the file's functions by cyclomatic, base → head, paired by name, the highest at the head first and removed ones last. Tests lists the test changes alongside the node, as the Tests tab's For does.
- **Colour by.** A Change / Churn / Complexity switch above the graph. Churn (cuts 3, 6, 9) and Complexity (the head's highest cyclomatic, cuts 5, 8, 11) fill each measured node from a four-step blue ramp, unmeasured ones neutral, while the outline keeps the change; the legend shows the scale's title and steps. A node's tooltip and accessible name carry its value. Churn reads the head, else the base.
- **Tests tab.** Its nav link counts the changed tests (a test moved between files once). Under the notes' line on what the tests pin, All / For <selected node> picks the test files shown, beside a count of their tests by change (`+ ✎ − ↷`). A file is alongside a node when its path is at or under the node's, or its name less its test suffix (`.test`, `.spec`, `_test`, `_spec`) and extension matches a file at or under the node in the same stack; a stack holds its own test files. Each file shows its stack's label and "new file" when the base had none. **Changed nodes** lists the added and modified nodes with the changed tests alongside each, those with none first, needing a look; each goes to its node on Structure.
- **Metrics tab.** Three tiles total the change: lines head − base across the changed leaves, functions over the cyclomatic threshold base → head with the head's highest, and the hotspots touched among the head's. A table lists the measured leaves, Changed or Changed + 1 hop, by stack, sorted by Cyclomatic Δ, Churn, Lines Δ or ABC Δ: lines, highest cyclomatic, ABC, fan-out, fan-in and churn, base → head with the Δ, a cell with a metric finding marked by its level; a name goes to its node on Structure. A legend under the table says what each column measures and what the two marks mean. The Hotspots chart draws each changed leaf's churn and highest cyclomatic from base (ring) to head (dot) against the shaded hotspot corner and the cyclomatic threshold, each point named for screen readers, with a line under it per leaf entering the corner or already in it and changed again.
- The review data carries `thresholds`, the config's `metrics` cuts with their defaults applied, and `churnDays`, the churn window.
- The review data's `tests` entries carry `stack`, the id of the stack the file sits in, and `new: true` for a test file with no base side.

### Changed

- The Tests section under the graph is now the Tests tab.
- Claude's summary sits in a strip above the graph, and only its summary lines: flagged notes are the findings rail's.
- The page's "Calls with no route" and "Not in the graph" sections are gone: both are the rail's Not drawn group.
- The selection panel is the inspector, and its note and patches are its Note and Diff tabs.

## 0.3.2 — 2026-10-31

### Added

- The review data (the `.json` beside the page) carries `metrics`: for each changed node and each node one edge from one, on each side it exists on, `churn`, the commits that touched its file in the 90 days before that side's commit (for uncommitted work, before `HEAD`'s). A box gets the highest churn measured inside it, marked `highestInside`. The page doesn't show it yet.
- `metrics.churnDays` in `visual-review.config.json` sets that window.

### Fixed

- Rust is parsed as Rust again when the Rails reader is loaded beside it, which the CLI always does: since 0.2.0 a crate's `mod` files were left out of the graph and its test changes went unread.

## 0.3.1 — 2026-10-30

### Fixed

- A flag badge opens what it marks and says why. Clicking a red `!` selects its node or edge and opens the panel, headed by the flag ("Flagged: …", or "No route for …" for calls with no route); hovering it shows the same reason.

## 0.3.0 — 2026-10-30

### Added

- **Zoom and pan.** The page's graph sits in a frame of its own and opens fitted, never above 100%. Drag or the wheel pans it, and at its edge the wheel scrolls the page; Ctrl/⌘ + wheel or a trackpad pinch zooms at the pointer, up to 400%. A toolbar (− / + / Fit / 100%) and, with the frame focused, `+`, `−`, `0`, `1` and the arrow keys do the same.
- Opening or closing a box keeps the zoom and keeps that box where it was on screen. Going to a part from the summary or a note centres it at 100%, or fits it when it is bigger.

### Changed

- The README lists what each language reads out of the box and walks through the page. CONTRIBUTING.md and SECURITY.md are new.

## 0.2.0 — 2026-10-30

### Added

- **Rails apps.** Every `config/application.rb` outside `vendor/`, `node_modules/`, `test/` and `spec/` is a stack, read as text with no Ruby needed. Its classes are drawn in a box per `app/` layer and `lib`, keyed by constant.
- Rails edges: the constants a class names, resolved through Ruby's lexical scope, and model associations, resolved as ActiveRecord does (`class_name:`, `source:`, `source_type:`).
- Rails tests are compared across the sides: Minitest under `test/` (`test "…"` and `test_` methods) and RSpec under `spec/` (`it`, `specify`, `example`, `scenario` and `it_behaves_like`, under their `describe` and `context` groups).
- Rails stacks take `boxes` in `visual-review.config.json`: `["app/models/*"]` boxes `app/models/billing/invoice.rb` as `models/billing`.
- The page's **All edges** checkbox. Unticked, the default, an opened box's unchanged edges are merged into one arrow per pair of boxes, so large apps stay fast and readable. Edges that changed, are noted, or touch a change are always drawn in full.

### Changed

- **Changed + 1 hop** starts ticked.
- The exported `Reader` type is `roots`, `holds` and `graph`, replacing `open`. The core now names, drops, labels and skips stacks, so readers no longer do.
- The README explains how to update the Claude Code plugin.

### Fixed

- A `stacks.<id>.sourceRoot` set for a renumbered stack such as `web~2` now applies when that package is detected.

## 0.1.1 — 2026-10-28

### Fixed

- TS import edges are drawn again on macOS, where the temp folder is a symlink.

## 0.1.0 — 2026-10-28

First release.

- Reviews a PR by number, a `<from>..<to>` range, or uncommitted work, into one self-contained HTML page under `.reviews/`.
- Reads Rust (Cargo workspaces: crates and their modules) and TypeScript/JavaScript (every package with sources: folders and files), and links `fetch` calls to axum routes.
- Colours added, removed and modified parts, shows renames and tests that moved file, and lists changed files outside the graph with their patches.
- Notes, in notes version 1, filled in with `--notes`. The Claude Code plugin's skill writes them.
- `visual-review.config.json` drops, relabels, adds and boxes stacks, and configures the linker.
- A `.reviews` that isn't a real directory is refused, so no page is written through a symlink.
