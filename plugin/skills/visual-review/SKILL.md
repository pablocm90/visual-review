---
name: visual-review
description: Visual review of a pull request by number, a commit range, or uncommitted work when given none — draws the Rust crates and modules, the web modules and the Rails layers and classes before and after the PR's merge base and head, `<from>..<to>`, or `HEAD` and the working tree, with added, removed and modified nodes and edges coloured, annotates it with Claude's notes and structural flags, and opens it in the browser. Use when the user runs /visual-review or asks to see what a PR, a range or their uncommitted work changed structurally.
argument-hint: [<pr number> | <from>..<to>]
---

# Visual review

Each `visual-review` below is shorthand for this command: run the command in full in its place, since nothing puts `visual-review` on `PATH`:

```sh
npx -y --prefix="$(mktemp -d)" --package="${VISUAL_REVIEW_PACKAGE:-@pablocm90/visual-review@0.3.0}" visual-review
```

The empty `--prefix` keeps the reviewed checkout's own `node_modules` and `.npmrc` from choosing what runs; the command still runs in the repo.

Range: `$ARGUMENTS`. With a PR number, the CLI fetches the PR and reviews it from its merge base to its head: run step 1 with the number in place of `'<range>'`, then use the data's `range` (a `<sha>..<sha>`) as the range from step 2 on, so the notes land on the page you read. In step 2 also read `gh pr view <n>` for the PR's title and description, as context for what each part is meant to do; the notes stay on structure and say nothing of the description itself.

With no argument, review the uncommitted work: the range is `HEAD..worktree`, run every `visual-review` below without `'<range>'`, and in step 2 read `git diff HEAD` plus each untracked file `git status --short` lists.

Run every command from the repository root (`git rev-parse --show-toplevel`, which is the worktree's root inside a worktree).

1. Run `visual-review '<range>'`. It takes a few seconds, longer the first time while npx fetches the package. On a non-zero exit, relay its stderr (for example `Unknown revision: <rev>`) and stop: no page was written. On success, stdout is exactly the page's absolute path, and the review data sits beside it with `.json` in place of `.html`. Done when it exits 0.
2. Read the review data and `git diff <from>..<to>`. The data's `diff.nodes` and `diff.edges` carry a `state`; every one that isn't `unchanged` is a touched part. A node with `renamedFrom` (its old path) or `formerLabel` (its old name) is one renamed node, not a removal and an addition: call it a rename. The data's `dangling` lists web calls whose path matches no route after the change; each one is a touched part on its calling file. The data's `undrawn` holds the patches of changed files outside the graph (tools, plans, CI, config); read them too, for the summary. The data's `tests` lists each changed test file with every test in it, marked `added`, `removed`, `edited` or `unchanged`, or with `unreadable` and the parser's message in place of its tests. A removed test with `movedTo` and an added one with `movedFrom` are one test that moved between those files. Done when you can say, for each touched part and each undrawn file, what it does in this change.
3. Write the notes beside the page as `<name>.notes.json` (the page's path with `.notes.json` in place of `.html`), in this shape:

   ```json
   {
     "version": 1,
     "summary": [{ "text": "http-adapter now calls application directly", "target": "rust/crate/http-adapter" }],
     "tests": "The new serve test pins /api/info; nothing pins the AppInfo module.",
     "notes": {
       "rust/crate/http-adapter": { "text": "Adds the /api/info route.", "flag": "layer skipped" },
       "web/file/App.tsx -> web/module/modules/AppInfo": { "text": "App reads app info through the module." }
     }
   }
   ```

   - `notes` are keyed by a crate's, module's or file's `id`, or by an edge's `<from> -> <to>` ids. A stack (`rust`, `web`) takes no note.
   - A file inside a web module has its own id, such as `web/file/modules/AppInfo/api/app-info.ts`; its note shows once the module is expanded.
   - A Rust module has its own id inside its crate, such as `rust/mod/application/sign_up`, and so does the crate's root file (`rust/mod/application/lib.rs`, or `main.rs` for a binary); its note shows once the crate is expanded. Edges between modules are their `use` lines.
   - A Rails class has its own id, keyed by its constant, such as `shop/class/Admin::UsersController`, inside its layer (`shop/layer/controllers`); its note shows once the layer is expanded.
   - Each note says what that part does in the change, in one or two sentences.
   - `summary` holds two to five items on the change's shape as a whole, undrawn files included. Give an item a `target` when it is about one node or edge.
   - `tests` is one or two sentences on the tests as a whole: what the listed tests pin, and what the change leaves untested, such as a modified part with no test change under it. When no test changed, say what that leaves unpinned. It heads the page's Tests section.
   - Set `flag` to a short label only for a structural concern the graph shows: a new dependency direction, a layer reaching past its neighbour, a cycle, or coupling across the stack edge.
   - Keep to structure. Line-level findings belong to `/code-review`.

   Done when every touched crate, module, root file, Rails layer and class, and every added or removed edge between them as drawn with modules collapsed, has a note. A note on a file import counts for the module edge it is drawn into.
4. Run `visual-review '<range>' --notes '<notes file>'`. It fills the notes into the page from step 1 without reading the range again. A non-zero exit names the notes file and either the contract error or one line per problem (`unknown id <id>`, `no note on <id>`): fix the file and rerun. Done when it exits 0.
5. Open the page with `xdg-open <path>` on Linux, or `open <path>` on macOS. Done when the opener has returned.
6. Reply with the page's path and the flags you raised, one line each, or "no flags".
