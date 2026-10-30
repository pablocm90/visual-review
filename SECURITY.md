# Security

## Supported versions

Fixes go into the latest release only. While visual-review is 0.x, that is the latest minor version on npm.

## Reporting a vulnerability

Report it privately through GitHub: on this repository's **Security** tab, choose **Report a vulnerability**. Please don't open a public issue for it.

Say what you ran, on which version, and what happened. A reproducing repo or range helps most. You'll get a reply within a week. Once a fix is released, the advisory credits you if you want.

## What visual-review trusts

It is built to review changes you didn't write, so these are its guarantees. A way around any of them is a vulnerability:

- **It never builds or runs code from the reviewed repo.** TS/JS and Ruby are parsed as text. Rust's crate list comes from `cargo metadata --no-deps`, run with your own toolchain rather than the checkout's `rust-toolchain.toml`.
- **It runs `git`, `gh`, `cargo` and `rustup` without a shell**, so no branch, path or file name from the repo can become a command.
- **It writes its pages only under `.reviews/` at the repo root**, and refuses a `.reviews` that is a symlink or not a directory. The two sides are checked out as git worktrees in a temp folder and removed afterwards; a PR's refs are fetched as `git fetch` would.
- **The page is one local file**, with no server and no network requests. Data and notes are embedded as JSON that can't close its `<script>` tag, and patches and notes are rendered as text, never as HTML.

The reviewed checkout's `.cargo/config.toml` does apply to `cargo metadata`, as it has to for the crate list to be right. Running visual-review on a repo is as safe as running `git` and `cargo metadata` on it yourself.
