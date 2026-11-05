# Changelog

What changed in each release of `@pablocm90/visual-review`, newest first. Versions follow [semver](https://semver.org); while it is 0.x, a minor version may change the exported types.

## 0.29.0 — 2026-11-05

### Added

- Rails methods and classes read their logic: guards, ifs, ternaries, loops, cases, logicals, catches, returns in a branch and throws, each added, removed, changed, the same or moved, so a Rails guard or catch removed needs a look and logic changed with no test alongside says so. A class's callbacks and validations read as guards on it, and `rescue_from` as a catch. What's recognised by a method's name, such as a conditional `render` or an `each` block, carries `foundByName`, and a lost one says so.
- A changed Rails file naming `define_method`, `method_missing`, `send`, `public_send`, `class_eval` or `instance_eval` raises one finding for information, `logic:blind-spot:<node>`.

### Fixed

- A name repeated in a file, as a reopened Ruby class, goes by its own decisions and body when finding what moved, not its first symbol's.

## 0.28.0 — 2026-11-05

### Added

- On a PR's later round, each comment of the last review offers **Resolve**, closing it, and **Reply**, a comment on what it was on, in the Last review section and under its anchor. Replying takes the place of that anchor's Comment. A finding answer takes Resolve only, and an It's fine neither. The tray counts and lists what's resolved, and names it in What Claude gets; a draft on a part, edge, symbol, logic line or test the head no longer holds is listed with nowhere to go.

### Changed

- The review is now format 6, with `resolved`, the anchors closed as they were said.

## 0.27.0 — 2026-11-05

### Added

- A Rails migration the change adds raises a Schema finding that needs a look for each risky operation that runs going up: a column, reference or timestamps removed, a column renamed, a type changed, a column set to `null: false`, a required column added with no default, and an index added without `algorithm: :concurrently`. It names the line and why, ranks in Look first beside direct dependency changes, and opens the file's patch. A migration that doesn't parse raises a finding saying it wasn't read, ranked first.
- The review data carries `migrations`.

## 0.26.0 — 2026-11-05

### Added

- A changed Rails file reads its symbols as a TS/JS file does: a Symbols tab, Kind of change and the `api` findings. Classes and modules go by their full constant; methods, setters, `attr_*`, `delegate` and `scope` go under them, public or not as `private`, `protected`, `module_function`, `private_class_method` and `private_constant` say. A module holding only classes and modules is a namespace and isn't public, so deleting a file under it doesn't raise the module's removal. A method's signature is its parameters. A file that doesn't parse reads `unreadable`. Test files read none, and Rails logic lines come next.

## 0.25.0 — 2026-11-05

### Changed

- A decision a function lost that another symbol gained, in any changed file read, reads **moved to** that symbol, naming its file when that's another one, rather than removed. A moved guard or catch counts in its function's logic finding, for information, which says it was found by text, so extracting a method no longer ranks each of its guards first. Found by text alone: the guard's new home may not be called. Each gain takes one lost line, and a guard the other symbol already had, or whose condition was reworded, still needs a look.

## 0.24.0 — 2026-11-05

### Added

- On a PR's later round, Claude's answers show under what you said: Done with its commit, Answered or Declined, each with its text, in the Last review section and under the anchor. The section also lists what Claude changed that nothing asked for, going to each part or edge. The plugin's skill writes both on the round after it acts on a review.
- Notes take `answers`, keyed `<kind> <id>` by the last review's anchors, and `unasked`, keyed as `notes` are. `--notes` refuses an answer whose anchor the last review doesn't hold (`unknown comment <kind> <id>`), an `unasked` id the graph doesn't have, and `unasked` on a page with no last review. The notes version stays 1.

## 0.23.0 — 2026-11-05

### Added

- On a PR's later round, the page starts from what you asked. The header names the last review's verdict, and a **Last review** section atop the left column holds its general comment, each comment and finding answer, going to what it's on and marked **Changed since**, with the commits that touched its file, or **As it was**, and the parts changed since with no comment on them. Each one also shows under its anchor: the Note panel, also on the arrow drawn in an edge's place, a symbol, logic line or test, a diff line (found by its text, since line numbers drift) or a finding in the rail. When the earlier head can't be compared, as after a force-push and a prune, they show with no mark.
- A finding you called It's fine in any review of the PR stays out of Look first on that PR, and its group tags it "called fine", until a later answer replaces it. It still counts on the triage chips.
- Parts you marked read last round and unchanged since start out ticked, unless this page's range already has marks stored.
- The review data's `sinceReview` carries the last review's `verdict` on every variant, and its `body`, `comments` (each with `target` and `changedSince`) and `calledFine`; a compared one adds `changedWithoutComment` and `stillRead`.

## 0.22.1 — 2026-11-04

### Fixed

- A page, its data and a review replace what stands at their path, rather than writing through it, and a rewritten file keeps the mode it had. The plugin's skill does the same for the notes.
- `serve` keeps its lock in `~/.cache/visual-review/serve/`, keyed by the page's real path, and no longer reads a `.serve` file beside the page. A leftover one from an earlier version does nothing and can be deleted.
- A changed file whose name isn't valid UTF-8 raises a finding that needs a look, saying its patch can't be shown. Before, it was only a name in the list of files outside the graph.
- Pruning counts only regular `.html` files as pages, so a dangling link or a folder at such a name no longer stops it or takes a kept place. A folder at the name of an older page's data goes with the page.

### Changed

- `serve` needs a home that is an absolute path and that it can write its lock under, where before it needed only to write beside the page.
- A review needs a `.git` entry at the repo's root, and git 2.38 or newer is the supported floor. A repo reached only through `GIT_DIR` and `GIT_WORK_TREE`, or a `core.worktree` elsewhere, with no `.git` at that root, is now refused.

## 0.22.0 — 2026-11-04

### Added

- A changed lockfile raises findings in the dependencies dimension: one that needs a look for each direct package added, removed, major-bumped, newly direct or no longer direct, such as `zod 3.25.0 → 4.6.7`, and one for information per lockfile rolling up its transitive packages. `pnpm-lock.yaml` (lockfile version 9), `package-lock.json` (2 or 3), `yarn.lock` (v1), `Cargo.lock` and `Gemfile.lock` are read. A minor or patch bump raises nothing; `0.2.1` to `0.3.0` is major, as `^` and Cargo read it. A lockfile that won't parse, or in another format, raises a finding that needs a look, and the rest of the review stands.
- A dependency finding, in the rail, Look first or the tray, opens its lockfile's patch, on the Diff tab of the part holding it or among the files outside the graph.
- The review data's `dependencyChanges` lists every package changed per lockfile, and a finding gains `file`, the path it opens.

### Changed

- Look first ranks direct dependency changes below what wasn't read and above the findings on parts.

### Fixed

- A changed file whose path holds an accent, a double quote or a tab, or starts with a colon, now reads as itself, and so has its patch.

## 0.21.1 — 2026-11-04

### Security

- A review file the repo supplies no longer drives **Since last review**. A PR's author could force-add a `.reviews/*.review.json` naming the PR and a head just before the part to hide; with that branch checked out, the page offered the narrowed view first, under a forged verdict. Upgrade if you review PRs from people you don't fully trust, and treat a Since last review shown by an earlier version on such a branch as unverified.
- A review file git tracks is no longer compared against, and can't take the place of a PR's newest review when `.reviews/` is pruned. A last review's head must be a full SHA and is compared with the new head as a commit, so `HEAD~0`, a short SHA or a tag object can't pass as an earlier head.
- A review run from inside a folder a branch has laid out as a bare repository now refuses it, instead of taking it for the repo and running what that folder's config names.

## 0.21.0 — 2026-11-04

### Added

- On a PR's later round, the Symbols tab, the Tests tab and screen, and the patches, on the Diff tab and among the files outside the graph, tag what changed since your last review "changed since", whatever **Show** holds. A diff line counts by its file. The unchanged symbols open by themselves when one is tagged, as a symbol the PR has put back is.
- The review data's `sinceReview.changed` also lists the `symbols`, `decisions` and `tests` ids, the ones their comments anchor to, and the `files` paths changed since, with the same lists under `dropped` for what this head's review no longer holds.

### Changed

- The line under **Show** names everything in `dropped`, not only parts and edges, and says "Gone from the PR since the last review": a file the PR has restored hasn't been removed.

## 0.20.0 — 2026-11-04

### Added

- A change whose parts fall into two or more separate groups raises one finding for information, in the cohesion dimension: `may be 2 independent changes`. Parts are in one group when edges of the change join them directly; an unchanged file, a shared box, a shared stack or an edge between the boxes holding them doesn't count, so parts tied that way, or through a dynamic import or Ruby metaprogramming, can look independent, as its detail says. The rail draws a button per group, naming its size and going to its first part in reading order.
- `metrics.splitParts` (4 by default) sets the size a group must reach to count. Smaller groups are left out, and the detail says how many parts they hold.
- The review data's finding gains `groups`, each group's node ids in reading order.

## 0.19.0 — 2026-11-04

### Fixed

- Two tests of one name under one heading are two anchors on a served page, so each keeps its own draft: the second's id gains `#2`, as symbols and logic lines count. A test with no twin keeps its id.
- Tests of one name pair in order across the sides: a second one unchanged in its place no longer reads as edited, a removed one is listed, and a test removed after one no longer vanishes or shows twice. Removing the first of two reads as an edit of the first and the removal of the second.

## 0.18.0 — 2026-11-04

### Added

- On a PR's later round, once you have sent a review of an earlier head, **Show** offers **Since last review** first, with Changes only still the default. It draws what changed since that head, among the parts and paths the PR changes at either head, so merging the base branch in counts only where it touches one of those paths. A part reverted since counts, drawn as unchanged; one added then and removed since can't be drawn, so a line under Show names it. With nothing changed since, a line says so.
- When the commit last reviewed is no longer in your clone, or can't be read, the header says so and the full review is shown, with no Since last review. The reason a read failed sits on the line's tooltip.
- The review data's `sinceReview` holds the `head` last reviewed and either its `verdict` and `changed` (`nodes` and `edges` ids, and `dropped` for those the head can't draw), `gone: true` or `unreadable`. The plugin's skill says in its summary what changed since, or that it can't be told and why.

### Changed

- Pruning `.reviews/` keeps each PR's newest review past its page, so the next round has something to compare against, and removes the older ones left without a page.

## 0.17.0 — 2026-11-04

### Added

- On a served page, a comment can now sit on more than a part or an edge. The Symbols tab has a **Comment** toggle on each symbol and logic line, the Tests tab and the Tests screen one on each test (the same comment in both), and a patch one on each of its lines, on the Diff tab and in the changed files outside the graph. A line's comment anchors on its side and number and quotes its code. The review format is unchanged: version 5 already reads these anchors.
- A draft in the review tray goes to where it was written: its tab, the node its test sits on, or its row in a patch, from any screen and each time it is asked. A patch or field closed by hand opens again, and closing the files outside the graph hands the keyboard focus back to the draft.

### Changed

- A patch opens by itself when it holds a line draft, and the unchanged symbols when one holds a draft.
- A logic line's decision id counts every line of its function that reads the same, and same-named symbols in a file count too, so each takes a comment of its own.
- The inspector goes back to Note when it closes or Structure is left, and holds its tab through an edge selected between two parts.

### Fixed

- A method renamed or turned into a getter or setter still pairs across the sides, and keeps the logic it lost; a setter reads against the base's setter, not its getter.
- Two accessors of one name get a finding id each, for an API change and for a logic change.

## 0.16.0 — 2026-11-03

### Changed

- Review files are review version 5: a comment's `anchor` may also be a `symbol` (`<file node id>#<scope.name>`), a `decision` (`<file node id>#<scope.name>#<text>`, `#<n>` after it for a repeat, with the logic line's `text`; a removed guard's id is its `logic:removed:` finding's without the prefix), a `test` (`<test file>#<heading › … › name>`) or a diff `line` (`<file>@<base|head>:<n>`, with the line's `text`). The page doesn't make these yet. `serve` refuses a version 4 review with 400.
- The plugin's skill reads the new anchors and acts on the narrowest thing each names, finding a diff line by its text when its number has moved.
- The header's Review panel is now the review tray, a bar at the page's foot on every tab. Closed, it counts the drafts by kind ("2 drafted · 1 change · 1 question"). Open, it lists your comments, those on parts in reading order first, then your answers to findings, by the finding's title, each going to what it is on, the parts you read with nothing to say, the general comment, the verdict and Send.
- The verdict starts at the one the drafts suggest, marked suggested: Request changes once there is a Change this or a Fix this, else Comment once there is a Question or an Explain, else Approve. It follows the drafts until you pick one, which then holds.

### Added

- **What Claude gets**, in the open tray, previews the review as lines: the verdict and parts read, each comment's kind and anchor, and how many parts were read with no comment.
- `GLOSSARY.md` defines review tray and suggested verdict, and the anchor's new kinds.

## 0.15.0 — 2026-11-03

### Changed

- Review files are review version 4: after the comments, `comments` lists the answers to findings, each `{ anchor: { kind: 'finding', id }, kind: 'fix' | 'fine' | 'explain', text? }`, its `id` the finding's (`notes:<id>` for a note's flag), `text` the why of a `fine` when one was given. One per finding, as one comment per part or edge. `serve` refuses a version 3 review with 400.
- The plugin's skill reads the answers: under Request changes it does each Fix this and answers each Explain; under Comment and Approve it answers each and changes nothing; a finding called fine is named with its why and nothing more.

### Added

- On a served page each finding, in the left rail and under the inspector's note, offers **Fix this**, **It's fine** and **Explain**. It's fine opens an optional why; a blank one is not sent. A finding keeps the last answer pressed, and pressing it again withdraws it. An answer alone lets a Comment or Request changes be sent.
- `GLOSSARY.md` defines finding answer.

## 0.14.0 — 2026-11-03

### Changed

- A review file is in review version 3: `reviewed` says what the page was drawn for, `{ range, pullRequest? }`, its PR by number, and `read` lists the parts marked read, by node id, in reading order. A review in version 2 is refused.

### Added

- The Review panel says how many parts of the reading order were marked read before you send.
- The skill takes a part read with no comment on it as read and found fine, and names the parts that were neither read nor commented on.

- **J** and **K** walk the reading order, going to the next or previous part as a click on its row does; with no part selected they start at the first. **A** marks the selected part read, or unread again; read rows are ticked and the Reading order counts how many of its parts are read. The keys do nothing while you type in a comment or with Ctrl, ⌘ or Alt held.
- Read marks are kept in the browser per range, so reloading the page keeps them; with the browser's storage blocked they last until the page closes. A served page is at a new address each time it is served, so a new serve starts with none read.

## 0.13.0 — 2026-11-03

### Changed

- A Rust `?` no longer counts toward a function's cyclomatic complexity, so straight-line code that propagates errors stays under the threshold; a `match` still counts one per arm.

### Added

- Each function in `metrics.*.cyclomatic.byFunction` carries its `earlyReturns`, its count of `?`, when its reader counts them (Rust).

## 0.12.0 — 2026-11-03

### Added

- A **Reading order** opens the page's left column: the changed parts numbered in the order to read them, what the others depend on first, the removed parts after the rest, then the changed files outside the graph. Parts that depend on each other are read in name order, and the first of them says so. Each row carries its findings' worst level and count; a click goes to the part, or opens the outside files' patches. Each drawn part carries its number.
- The review data's `readingOrder` (`{ parts, cycles }`) holds that order, and the skill reads the parts in it.

## 0.11.0 — 2026-11-03

### Changed

- Review files are review version 2: `comments` is a list, each `{ anchor: { kind: 'part' | 'edge', id }, kind: 'change' | 'question' | 'suggestion', text }`, its `id` a node id or `<from> -> <to>` as notes are keyed, in place of version 1's map of `{ text }` by id. A review with two comments on one anchor is refused, naming the anchor. `serve` refuses a version 1 review with 400.
- The served page's Note tab picks a comment's kind above **Your comment**: **Change this**, **Question** (picked until another is) or **Suggestion**, kept per part or edge with its text. A comment typed then cleared is not sent.
- The plugin's skill reads each comment's kind: under Request changes it does each Change this, answers each Question and takes or turns down each Suggestion, saying which; under Comment and Approve it answers each and changes nothing.

### Added

- `GLOSSARY.md` defines anchor and comment kind.

## 0.10.0 — 2026-11-03

### Added

- The TS reader reads each function's and method's decisions, its guards, ifs, ternaries, loops, cases, outermost logicals, catches, returns inside a branch and throws, as source text with comments and spacing ignored, and the review data gives an edited or renamed function whose decisions changed its `logic`: every decision, each `same`, `added`, `removed` or `changed`, with its kind, base and head text, depth and line.
- Findings in the `logic` dimension: a guard or catch a function lost needs a look; a function's other decision changes are one finding for information. A file with either and no test changed alongside it is a `tests` finding that needs a look.
- The **Symbols** tab lists an edited function's logic lines under it, indented by depth, a changed one base then head; clicking one that changed opens the **Diff** tab on its file's patch at its line, or at the patch's top when the line is outside every hunk.

## 0.9.0 — 2026-11-03

### Changed

- The Structure graph opens on **Changes only**: the changed parts and both ends of each added or removed arrow, an added import into a closed box keeping that box even where an unchanged import shares its arrow. The **Changed + 1 hop** checkbox is now a **Show** choice of Changes only, Changed + 1 hop or Everything, and going to a part that isn't drawn widens it only as far as it needs.

## 0.8.0 — 2026-11-02

### Added

- The TS reader reads each changed file's symbols on both sides, functions, methods, classes, types, interfaces and enums, and the review pairs them: added, removed, edited, formatting only, renamed (probably, when only the bodies are alike) or moved between changed files, with both signatures when one changed. The review data's `symbols` lists them per file, with the export names added and removed and the file's kind of change (`api`, `logic` or `formatting`), or `unreadable` with the parser's message. A `Reader` may read symbols through an optional `symbols`.
- `parsers` in the review data names the parser packages the CLI read with, and their versions.
- Findings in the `api` dimension: an exported symbol removed, renamed or moved away, or whose signature changed, needs a look; one added is for information; export names changed with no symbol behind them are one finding on the file. A file whose symbols wouldn't parse, and a stack with changed files whose reader reads no symbols, are `structure` findings for information.
- The inspector's **Symbols** tab lists a part's changed symbols grouped by change, API changes first, with signatures base above head, what a symbol was renamed from and where it moved (a link to that file), and whether it is exported; on a box, each file inside it.
- **Colour by Kind of change** shades each changed part API change, logic change or formatting only, a box by the strongest inside it, and names "symbols not read" where none were read.

### Fixed

- A function held by a typed const (`const handler: Handler = () => {}`) is named `handler` in the Metrics tab and its findings, not `handler: Handler`.

## 0.7.0 — 2026-11-02

### Added

- One findings model: the review data's `findings` lists everything worth the reader's attention, each `{ id, dimension, level, target?, title, detail? }`, with a stable `id` (`<dimension>:<check>[:<target>]`). The review raises them for each threshold a file crosses at the head (`metrics`), the stacks not read and the changed files outside the graph (`structure`) and each file's calls with no route (`routes`); on the page, each note's flag is one more, needing a look.
- A note takes an optional `dimension` (the same list, `structure` when left out), the dimension its flag's finding is filed under. Notes stay version 1.
- Above the graph, a triage strip with a chip per dimension with findings, which filters Look first and the rail and dims the other badges, and a **Look first** band listing up to seven findings that need a look, ranked, with **Show all** opening the rail.
- `GLOSSARY.md` defines finding, dimension, level, fact and Look first.

### Changed

- **Breaking for readers of the `.json`:** `metricFindings` is gone; its crossings are `findings` in the `metrics` dimension.
- The findings rail groups the findings by dimension; its All / Notes / Metrics / Not drawn chips moved to the triage strip.
- One badge per drawn node or edge names its findings, under the worst level, replacing the flag and no-route badges; the inspector's Note tab lists the selected part's findings in place of its "Flagged" and "No route for" headings.

## 0.6.0 — 2026-11-02

### Added

- The served page's header has a **Review** button opening a review panel, as GitHub's "Finish your review" does: a General comment on the whole change, the verdict and Send to Claude. The general comment goes in the review as `body`, an optional string; a non-blank one alone enables Send for Comment and Request changes.
- `serve --no-open <page.html>` serves the page and prints `Serving <url>` on stderr without opening a browser; for an already-served page it prints the live server's URL on stderr and exits 0, nothing on stdout.

### Changed

- `serve` waits up to 24 hours for the page's first ping, then 10 minutes after each ping, so a page can wait for its reader; an unopened page now ends `serve` after the day, not 10 minutes. `VISUAL_REVIEW_FIRST_PING_MS` changes the day; `VISUAL_REVIEW_IDLE_MS` still changes the 10 minutes.
- The plugin's skill reads the review's general comment first and answers it under the verdict, as it does a node's comment.

## 0.5.0 — 2026-11-02

### Added

- `visual-review serve <page.html>` serves a written page on `127.0.0.1` at a free port, under a URL holding a token made for that serve, opens it, and prints the URL on stderr; any other path or `Host` gets 403, and a missing `xdg-open` / `open` isn't fatal. On the served page, the inspector's Note tab has a "Your comment" field per node or edge, kept across selections, and the header a verdict (Approve, Comment or Request changes; Comment until another is picked) beside a "Send to Claude" button, enabled once a comment holds more than blanks, or at once for an Approve. Sending writes the verdict and the non-blank comments as `<name>.review.json` beside the page, prints its path on stdout and exits 0; a failed send shows why and keeps the button. A body the server can't read as a review gets 400 naming the problem, and it keeps serving. A page opened as a file has no comment field and no button.
- `serve` ends by itself: the served page pings it every 30 s, and after 10 minutes with no ping (`VISUAL_REVIEW_IDLE_MS` to change it) it exits 1 with "No review sent". One server per page: a lock `<name>.serve` (pid, port, token; mode 600) is written beside the page and removed on exit; serving an already-served page opens that server and exits 0, printing nothing on stdout; a lock whose server no longer answers, or that isn't a lock, is replaced. Locks are pruned with their page.
- Review files are versioned and validated like notes: `{ "version": 1, "verdict": "approve" | "comment" | "request-changes", "comments": { "<id>": { "text": "…" } } }`, keyed by node id or `<from> -> <to>`. `pnpm build` writes its JSON schema as `dist/review.schema.json`.

### Changed

- The Claude Code plugin's skill serves the page with `serve` in the background instead of opening the file, and acts on the review sent from it: on Request changes it works through each comment, on Comment it replies to each and changes nothing, and on Approve it answers any comments and stops.

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
