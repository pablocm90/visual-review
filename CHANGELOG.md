# Changelog

What changed in each release of `@pablocm90/visual-review`, newest first. Versions follow [semver](https://semver.org); while it is 0.x, a minor version may change the exported types.

## Unreleased

- The page's graph zooms and pans inside a frame of its own: drag, wheel, Ctrl/⌘ + wheel or pinch, a toolbar and keys. It opens fitted, keeps a toggled box in place, and going to a part centres it readable.
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
