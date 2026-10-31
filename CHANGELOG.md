# Changelog

What changed in each release of `@pablocm90/visual-review`, newest first. Versions follow [semver](https://semver.org); while it is 0.x, a minor version may change the exported types.

## Unreleased

### Added

- Rust files are measured: `metrics` also carries, per side, `lines` (non-blank, non-comment), `functions`, `cyclomatic: { highest, total }` over its functions, `abc` (the ABC size of its summed assignments, branches and conditions), and `fanIn` / `fanOut`, the edges into and out of it on that side. Test code isn't measured. A box takes the highest of each inside it. Readers gain an optional `measure(text, path)`, with its types exported; TS and Rails files get churn and fan only, for now.
- `metricFindings` lists each measured file over a threshold on the head side: a function's cyclomatic over `metrics.cyclomatic` (10), a hotspot whose churn and highest cyclomatic both reach `metrics.hotspot` (6 and 8), and, when set, `metrics.lines` and `metrics.abc`. Each is `look` when the file is new, wasn't over on the base, or grew (for a hotspot, its cyclomatic), and `info` otherwise.

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
