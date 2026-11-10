# Changelog

What changed in each release of `@pablocm90/visual-review`, newest first. Versions follow [semver](https://semver.org); while it is 0.x, a minor version may change the exported types.

## Unreleased

### Added

- An env variable or Rails credentials path a line the change adds reads by its literal name, and that the base names nowhere, raises `deploy:env` or `deploy:credentials` to look at, on the first row reading it, for every stack and in files outside the graph too: `ENV["KEY"]`, `ENV.fetch`, `ENV.key?`, `process.env.KEY`, `import.meta.env.KEY`, `env::var("KEY")`, `env::var_os`, `env!` and `option_env!`, and `credentials.aws.key`, `credentials[:aws][:key]`, `credentials.fetch(:aws)` or `credentials.dig(:aws, :key)`, read as `aws.key`. One read only in a test file or fixture is for information. The skill lists them in the summary, so they're set before the merge.
- A feature flag the change starts or stops reading raises `deploy:flag-added` or `deploy:flag-removed` for information, a flag counting only when the rows reading it added and removed differ in number. The calls are Flipper's by default; the config's `deploy.flags`, read from the range's base, replaces them, `*` a wildcard within a name.
- The deploy coverage lists each added line reading an env key through a variable, and says `flags: Flipper only` when no `deploy.flags` is set and no Flipper call is in the patches.

## 0.66.0 — 2026-11-10

### Added

- A secret a line gains raises `security:secret` on its row, for every stack and in files outside the graph too: an AWS access key, a GitHub, Slack or Google token, a Stripe live key or a private key header, and, by heuristic, a long, varied literal assigned under a name such as `password`, `token` or `api_key`. Lockfiles skip the heuristic, their hashes reading as keys. A secret file the change adds (`.env` but an `.example`, `.sample`, `.template` or `.dist` one, `config/master.key`, `config/credentials/*.key`, `*.pem`, a private `id_rsa`) raises one for the file. In a test file or fixture each is for information; a dotfile such as `.env.test.local` is no test file. The detail says to rotate it, since it stays in git history once removed.
- The page data, and the `.json` beside the page, mask every secret value found, in every string they hold (patches, symbols, findings), object keys included, as its first four characters and its length. A private key's body lines are masked too, a key written on one line included, and so is what a secret file the change adds holds: each variable's value, else each line, of 8 characters or more.
- `permit(*FIELDS)`, `permit(FIELDS)`, `permit(address: FIELDS)` and the like are listed under the security coverage (`<node> not read: permit(*FIELDS) in UsersController.create`) when a method gains one, rather than read as permitting nothing.

### Changed

- With no Rails stack, the security coverage reads `authorization and risky calls: Rails only`, since secrets are read for every stack.

## 0.65.0 — 2026-11-10

### Added

- A Rails method or scope gaining a risky call raises a `security` finding to look at on its file's row, one check per kind: a key newly permitted (`security:permit`, nested keys as `address.street`), `permit!`, raw SQL (`find_by_sql`, `execute` and their kin, `Arel.sql`, or `where`, `order`, `pluck` and the like given a string or heredoc, the detail saying whether it is interpolated), HTML marked safe (`html_safe`, bare `raw`, `safe_concat`) and a `send`, `public_send`, `constantize` or `safe_constantize` of a name it doesn't write. Each is found by name, and the detail says so. A call the base method already made raises nothing, nor does a method moved whole to another file.
- A line an `.erb`, `.haml` or `.slim` view gains holding `html_safe`, `raw(` or `<%==` (not `html_safe?`) raises `security:html-safe` on that row, by heuristic, since views aren't parsed; the rail lands on the row.
- The security coverage names each other reader (`risky calls not read for typescript`) and each changed file whose symbols weren't read.
- The skill cites those findings, reading the call before saying what it lets in.

## 0.64.0 — 2026-11-10

### Added

- A note keyed `line <file>@<base|head>:<n>` is on one row of a patch, drawn file or not: a removed row by its base number, a context or added row by its head's, as a comment on that row is anchored. It shows under that row in **Full diff**, which opens by itself with that patch open, in a symbol's **Diff** once toggled, and in the changed files outside the graph, with its why, its recommendation and, on a served page, **Take**, which opens that row's field with **Change this** picked. `--notes` refuses a key naming no row the page's patches hold (`unknown key line <id>`), including the base number of a context row. A flag on one lands on its row from the findings rail and **Start here**: in Full diff on the node holding the file, or, for a file outside the graph, in those files, where the review tray's answer to it goes too. A line change in the last review's `unasked` is named by its row and its text.
- The skill may add a line note, and flag it, where a single diff line holds the point and no function, logic line or test note can name it.

## 0.63.0 — 2026-11-10

### Added

- Rails controller actions with no authorization raise `security:unauthorized`, the first `security` check. When a change touches a controller or a route, every controller is read at both sides, without running Ruby: an action is covered by an authorizing `before_action` or `around_action` reaching it (an `after_action` only when it is `verify_authorized`, since any other runs once the action has; its controller's, a parent's in the app or an included concern's, within `only` and `except`, unless a later skip removes it) or by its own call. A new action with no cover, one that lost its cover, or one a route the change adds now reaches needs a look; one covered only under `if:` / `unless:` is for information. An action already uncovered raises nothing.
- `visual-review.config.json` takes `security.authorize`, the names that authorize, `*` a wildcard (Pundit's and CanCanCan's by default), and `security.open`, `Controller#action` globs of actions meant to be public. Both are read from the range's base, as `notes` is, so a change can't open its own actions.
- Coverage lists `security`: `Rails only` with no Rails app, else what couldn't be read, by file and line (a callback list with a splat, a block calling no authorizing name, a parent or concern outside the controllers, a controller that doesn't parse), and each `open` glob matching no action.
- The skill cites a `security:` finding rather than guessing about access.

## 0.62.0 — 2026-11-10

### Added

- A note on a function, logic line or test takes a `flag`, as a part's or edge's does: `--notes` no longer refuses it. Its finding, `notes:symbol <id>`, `notes:decision <id>` or `notes:test <id>`, needs a look in the note's dimension and sits on the node holding the anchor: the file's node for a symbol or decision, the node whose **Tested by** shows the test for a test. Going to it from the findings rail or **Start here** selects that node and lands on the row, opening the folds around it. A last review's answer to one is placed on its anchor, as a comment on it is, and marked changed since when that function, logic line or test has changed.
- The skill may flag a function, logic line or test note, on the narrowest anchor that shows the concern.

## 0.61.1 — 2026-11-10

### Changed

- A base `visual-review.config.json` that isn't JSON reads as no notes settings (`notesConfig` `{}`) rather than failing the review, so a PR repairing it can be reviewed. A base `notes` entry that doesn't parse still fails, naming the file at the base.

## 0.61.0 — 2026-11-09

### Added

- The config's `notes` entry takes `why` and `recommendation`, booleans left on when left out, read at the base with `guidance`. `--notes` refuses a note carrying a field the page's config switches off, one line per field per note: `recommendation is switched off on <key>`. The review data's `notesConfig` carries them as written.
- The skill leaves a switched-off field out, and with `recommendation` off puts a bug it notices in the note's text.

## 0.60.0 — 2026-11-09

### Added

- `visual-review.config.json` takes `notes.guidance`, free text on what Claude's notes should say and where. It is read from the range's base, from the file committed there only, so a change can't guide its own review, and only that entry is checked there: a base file that isn't JSON, or whose `notes` entry doesn't parse, fails the review naming the file at the base. The review data carries it as `notesConfig`, `{}` with no guidance.
- The skill follows `notesConfig.guidance` when writing notes, within the notes format, the checks and its steps.

## 0.59.0 — 2026-11-09

### Added

- A note may be on a logic line or a test: keyed `decision <id>` or `test <id>`, as a comment's anchor of that kind is, it shows under that logic line in **What changed**, or under that test in **Tested by** and on the **Tests** tab, with its why, its recommendation and, on a served page, **Take**, which puts the recommendation in that row's comment field as a **Change this** draft, open and focused. A noted decision opens its function's rows and the unchanged run holding it, and its file counts as news; Tested by keeps an unchanged test with a note. Neither takes a flag. `unasked` takes both kinds, and the last review lists each by its row, going to its file's node.
- The skill may add a note on a logic line or a test where there's something to say about it.

## 0.58.0 — 2026-11-09

### Added

- Architecture rules: `visual-review.config.json` takes `rules`, keyed by name, each `{ from, notTo, reason }`, `from` and `notTo` a node id glob or a non-empty list of them. A node matches when it or a box holding it does, and an edge whose start matches `notTo` too breaks nothing. Each edge at the head breaking a rule is a `rules` finding on that edge, `breaks <name>` with the reason and, for a web call to an API route, its paths, needing a look when the change adds the edge and for information when it was already there; a removed edge raises none. The rules coverage says `none configured` with no rules, and names each glob that matches no node at the head.
- The skill cites a rule's finding by its name rather than flagging a layer skipped on that edge, and flags one only for a direction no rule covers.

## 0.57.0 — 2026-11-09

### Added

- A folder with no `tsconfig.json` reads its `jsconfig.json`: a JS project's `paths` draw edges, and its `rootDir` or one included folder is its source root. A folder holding both reads `tsconfig.json`, as the TypeScript server does; a project reference still names a folder's `tsconfig.json`.

## 0.56.0 — 2026-11-09

### Fixed

- Reading a Rails or Rust stack frees each file's syntax tree once it's read: the Rails graph, the Ruby and Rust measures, symbols and tests, a crate's modules, migrations, schema dumps and routes kept every tree, so on a big repo the parser's memory filled and the review hung.

## 0.55.0 — 2026-11-09

### Added

- A note may be on a function, method, class or type: keyed `symbol <file node id>#<symbol>`, as a comment's symbol anchor is, it shows under that symbol's row in **What changed**, with its why, its recommendation and, on a served page, **Take**, which puts the recommendation in that row's comment field as a **Change this** draft, open and focused, or in its Reply where the last review said something on it. A file holding a noted symbol counts as news: a box lists it, and the unchanged fold holding the symbol opens. A symbol's note takes no flag.

### Changed

- Notes are version 2: every key in `notes` and `unasked` names its kind, `part <node id>`, `edge <from> -> <to>` or `symbol <id>`, and `notes.schema.json` checks the shape. A version 1 file is refused with "this visual-review reads version 2". Problems name the key: `unknown key part x`, `no note on part x`, `no note on edge a -> b`. A flag's finding is `notes:<kind> <id>`, so a last review's answer to a version 1 flag (`notes:<id>`) lists under the last review with nowhere to go, and an It's fine given to one no longer keeps that flag out of Start here. An unasked change on a symbol goes to its file's node.
- The skill writes version 2 keys, may add a note on a symbol where there's something to say about it, and reads a flag's answer as `notes:<kind> <id>`.

## 0.54.0 — 2026-11-09

### Added

- A Rust stack cargo can't read, such as one whose `Cargo.toml` doesn't parse, is listed as not read with cargo's error, saying the side it couldn't be read at, and is dropped from both graphs, so its crates don't all read as added or removed; the review goes on with the other stacks instead of failing.
- cargo reads no stdin, and one still running after 60 s (`VISUAL_REVIEW_CARGO_MS`) is killed, its stack listed as not read. On Linux it runs under a 2 GB address-space cap, so a manifest linked to `/dev/zero` stops it at that.
- Before cargo runs, the manifests it would read are walked from a Rust stack's `Cargo.toml`, and from each folder above it in the checkout holding one, following each folder they name that holds one: every value under a key named `path`, and `package.workspace` or `project.workspace`, as written, and each `workspace.members` or `default-members` pattern, by its literal folders, must resolve inside the checkout, or the stack is not read, naming the manifest and the value. So is a manifest that isn't TOML or whose workspace keys aren't what cargo reads, and a member climbing out of a glob (`crates/*/../a`), wherever it lands. A crate a glob matches under `workspace.exclude` isn't walked, as cargo doesn't read it.
- A Rust stack whose cargo config, `.cargo/config.toml` or `.cargo/config` in its folder or one above it in the checkout, includes a file outside the checkout, directly or through a file it includes, is not read, naming the config and the include; so is one whose `include` isn't a list, which cargo refuses.

### Changed

- `Skipped` (`PageData.skipped`) is `{ reader, stacks, reason, side? }` in place of `{ reader, tool, stacks }`: `reason` reads `cargo not found on PATH` for a missing tool, and `side` is `base`, `head` or `reviewed` when the stack was read elsewhere.
- A stacks-not-read finding goes by its stacks, `structure:skipped:<stacks>`, not by its reader, so one reader's stacks not read for two reasons are two findings.

## 0.53.0 — 2026-11-09

### Added

- A note may say what Claude would do about its part or edge: an optional `recommendation` in the notes file, still version 1, shown under the note's text and why in the inspector, labelled **Recommendation**. On a served page, **Take** puts it in that part's or edge's comment field as a **Change this** draft, open and focused, to edit and send as any other comment; it hides while the field holds text. Notes merged onto one drawn edge join their recommendations in order, and such an edge, taking no comment, has no Take.

### Changed

- The skill writes a `recommendation` where something warrants one, and puts a bug it sees while reading in as a recommendation on its part, still naming each bug in its reply.

## 0.52.0 — 2026-11-08

### Added

- **Reaches** and the `blast-radius` findings follow a changed Rust function, type or method, by name, to the modules importing from its file and the modules of the crates depending on its crate: at its first use by name, through a `use` (`crate`, `self`, `super`, a relative path or the crate's name, aliases, lists and `*`), or by a path written in full; a method by its type's path, or at the first `.total` in a file importing its type. A use in a `tests/` folder or inside a `#[test]` or `#[cfg(test)]` item is marked `test` and listed last. Coverage says what isn't followed: a module of its own crate with no `use` into its file, a crate named otherwise than by its package, such as through `[lib] name` or a renamed dependency, a binary naming its own package's library, a name re-exported through `pub use`, a path inside a macro, a method of an `impl Trait for`, and a method called on a value in a file not importing its type.
- A note may say **why** its part or edge changed this way, beside what it does: an optional `why` in the notes file, still version 1, shown under the note's text in the inspector, labelled **Why**. Notes merged onto one drawn edge join their whys in order, as their texts are.

### Changed

- The skill writes a `why` where the change has a reason worth giving, and its notes no longer keep to structure: they explain design, behaviour, logic and tests, and name a bug seen while reading in its part's note. The sweep for bugs and style stays with `/code-review`.
- `SymbolUse`, a row `Reader.uses` gives, takes an optional `test`: whether the use sits in test code. Without it, its file being a test file says so, as before.

## 0.51.0 — 2026-11-08

### Added

- **Reaches** and the `blast-radius` findings follow a changed TypeScript export into sibling stacks, through an import of the package's name or of a path under it, by name: coverage no longer says other stacks aren't followed. A default export through the package's name is only marked, since it may be another file's.
- **Reaches** and the `blast-radius` findings follow an exported class's method removed, renamed, moved or with a changed signature, to the files naming the class and reading the member, by name: `.bar` on anything else in such a file counts. Coverage now says a method read other than by `.name` or without importing its class isn't followed, and that a package imported under another name isn't, in place of "methods not followed".
- A patch of a Ruby file is coloured as Ruby: `.rb`, `.rake`, `.gemspec`, `config.ru`, `Gemfile` and `Rakefile`, and so is ERB inside a YAML file, such as `config/database.yml`.
- `export type { Foo } from './a'` and `export type * from './a'` draw their edge, by a relative path, an alias or into a sibling stack, as `import type` does. A page read again gains these edges; node ids don't change, so notes hold. A file over the size limit draws none.
- **Reaches** and the `blast-radius` findings read a stack's script files outside its source root, such as a `test/` beside `src/`, without drawing them. A folder with its own `package.json` or another stack's root isn't that stack's. A stack with over 5,000 such files reads none of them, and coverage names it. Files there that won't parse are one line in coverage, `N files outside the source root not read`; a drawn file keeps its own.
- An edited function's logic in **What changed** shows as a strip of marks, one tick per decision in source order: added, changed and moved above the baseline, removed below it, an unchanged one a flat dash, a moved one hollow and an exit taller. Beside it, how many of its decisions changed and how many of those are exits. A tick opens its row and rings itself; a draft going to a decision rings its tick too.
- `C` on a focused logic row opens that row's comment.
- **Reaches** and the `blast-radius` findings follow a changed Rails class or method, by name, to the classes with an edge into it that name the class: a method at the first `.total`, `&:total`, or symbol or string given to `send`, `public_send`, `__send__`, `try`, `delegate`, `def_delegator` or `def_delegators`, on any receiver in that file but `self`, and a constructor where the class is named. A `send` or `delegate` of a name it can't read, such as a variable, a `%` form or a string with an escape, is marked `may use it, not followed`. A file that won't parse or is too big is named in coverage, which also says what isn't followed: views, tests, rake tasks and other files outside `app/` and `lib/`, another Rails root, a file defining a class another file defines too, a base class such as `ApplicationRecord`, a class other than the one its file is drawn as in a file not naming that one, and a method called on `self` or with no receiver, through a subclass, in a file not naming its class, by `try!`, `method(:x)`, `public_method(:x)`, `instance_method(:x)`, `.()` or as an operator, or with no class around it.
- **Show** offers **Logic only** when a decision changed: the files holding one, their boxes open, with every arrow between them, each a card with a strip of marks per function that changed. A tick opens its row. Start here's first line counts the range's changed decisions, by kind of change and exits, and goes there.

- **What changed**'s heading sums the logic it lists, such as `14 functions decide differently, 45 decisions, 6 exits`, and a legend of the strip's marks sits under it when a strip shows. The same legend sits under Start here on **Logic only**.
- `L`, or the part's **Next logic change**, walks the range's changed decisions across files, in reading order, from the row you're on: it enters reading, lands on the decision's row with focus there, so `C` comments on it, and stays at the last.
- **Colour by Logic**, offered when a decision changed, shades each modified part by the decisions changed in it (0, 1–3, 4–9, 10+), a box by the sum inside it. An added or removed part, or one whose symbols weren't read, stays neutral.

### Changed

- `UsesAsked`, what `Reader.uses` is given, carries `stacks`, each root's stack id, in place of `root`.
- A function's logic rows fold under its strip when its file holds more than 8 changed decisions, unless a row holds a draft, a last comment or a mark changed since. Runs of unchanged decisions fold into `⋯ n unchanged, show`, under the same exception.
- Comment on a logic row shows on hover or focus, always on a device with no hover.
- **Full diff**, once a landing has opened it, stays open while you stay on the part, until you close it: a tick or a finding going elsewhere in the column no longer closes it.

### Removed

- The **Metrics** tab. Each part's **Metrics** fold, **Colour by** and the metrics findings stay, and a link to `#metrics` opens Structure.

### Fixed

- Two unrelated decisions of one kind no longer pair as one changed decision in **What changed** and its strip: a decision now reads changed only against one sharing a name with it, keywords and literal names such as `undefined` or `nil` aside, and otherwise reads removed and added, so a guard or catch so replaced is now named as lost. A decision naming nothing, such as `case 2000:`, still pairs in order, and one whose name is renamed through the function, such as `catch (e)` to `catch (error)`, still reads changed.

## 0.50.0 — 2026-11-06

### Added

- An import through a tsconfig's `paths` draws its edge: wildcard or exact, the longest prefix winning as in TypeScript, the next place taken when the first holds no file. `baseUrl` places them, and finds bare imports. Both come through a relative `extends` (a string or an array, later entries winning). A root holding no files itself (`files` or `include` said, both empty), with no `paths` through `extends`, takes them whole from the first project it `references` that has them, as in Vite's template.
- **Reaches** and the `blast-radius` findings follow an import through a tsconfig alias.

### Changed

- `UsesAsked`, what `Reader.uses` is given, carries the stack's `root`.
- An import landing in a sibling stack's root draws the edge to that stack, by an alias or a relative climb. From a stack whose source root is `.`, a climb used to draw an id such as `apps/web/file/../shared/x.ts`; from any other source root it drew no edge, so that edge is new. A climb to a folder under no stack draws nothing.

### Fixed

- What an import resolves to outside the checkout, by a relative climb, an absolute specifier or an alias, is no longer read or drawn.

## 0.49.0 — 2026-11-06

### Added

- A changed export that unchanged files still use raises a finding to look at in the `blast-radius` dimension, such as `function parseOrder reaches 2 unchanged files`, for TypeScript inside a stack. It counts named, default, namespace and type imports, and follows barrels.
- **Reaches**, in the reading column after **Tested by**, lists those files with each one's first use and its line of source, each going to its file, a test file marked `test` and last. A dynamic import, a `require` or a namespace passed along reads `may use it, not followed`.
- `blast-radius` is listed in coverage, naming a stack not read and a file that wouldn't parse. When something was asked, it says what isn't followed: class methods, other stacks, a removed `export *`, tsconfig aliases, type-only re-exports and files outside the source root.
- The review data carries `reaches`, and `Reader` takes an optional `uses`.

### Fixed

- A link in a reviewed revision that leaves the repo, or points nowhere, is no longer followed: one to `/dev/zero`, `/dev/stdin` or `/proc/self/pagemap` used to hang the CLI or run it out of memory. Its patch still shows, naming the target: among the files outside the graph, or under the box that held it, which reads modified, or the node it replaced, which reads removed.
- A `visual-review.config.json`, a review under `.reviews/` or a page given to `--notes` or `serve` linked to a device or an empty file no longer hangs the CLI. A config so linked stops the review, naming the file, as does a tracked config link leaving the repo; one linking to a plain file outside the repo still applies.
- A tsconfig `rootDir` or `include` leaving the checkout is no longer followed.
- A config `root` or `sourceRoot` written as an absolute path is refused, naming the field.

## 0.48.0 — 2026-11-06

### Added

- A changed symbol under **What changed** has a **Diff** toggle opening its own lines of the file's patch in place, without its neighbours' or those of the symbols inside it. A removed symbol shows its base lines, an added one its head lines, and a moved one its lines from both files, each named by file. It says so when git's hunks leave out the symbol's first line, or hold no line of its own.
- A comment on one of those lines is a comment on the patch line, so the review tray goes to it in **Full diff**.
- The review data carries each symbol's `lines`, its base and head line range.

### Changed

- `ReadSymbol.lines` is required: a custom `Reader.symbols` must return each symbol's line range.

### Fixed

- A long logic line wraps instead of giving the reading column a sideways scrollbar.

## 0.47.0 — 2026-11-05

### Changed

- Walking the parts now reads one at a time. `J`, `K`, **Start reading**, a row of the reading order or a part's **Next** narrow the left column to numbered stops, put the reading column in the middle and shrink the graph to a corner map, with the current part ringed and a click on a node going to it. A click in the graph, a finding or Start here keeps the graph whole.
- Under the map, **Next to it** lists the part's edges, changed or not, each going to its other end, and **All findings** returns to the graph whole with the lens cleared and the rail open. **Open map** or Escape outside a field returns too, the part still selected; the column's `×` returns with nothing selected.
- The header counts and bars the parts read, on every tab; the left column no longer counts them.

### Fixed

- Landing on a row the review tray covers lifts the page clear of it, and one scrolled above the window comes back.

## 0.46.0 — 2026-11-05

### Changed

- The inspector no longer has tabs. It reads top to bottom, with **Metrics** and **Full diff** as closed folds at its foot. Full diff opens by itself when you land on a line or one of its patches holds a draft.
- A part's head holds **Comment**, **Mark read** and **Next**. `C` opens the selected part's comment, or a selected edge's field, and focuses it. An opened comment field now takes focus.

## 0.45.0 — 2026-11-05

### Changed

- **Tested by** joins the inspector's Note tab, after **Why look**: the changed tests alongside the part, counted in the heading, with an unchanged test only when it holds a comment or changed since the last review. The inspector's Tests tab is gone; the **Tests** tab stays, listing every test of a file with a changed one.
- Logic changed with no test changed alongside now shows under **Tested by**, with its answers, rather than under **Why look**.
- Going to a draft on a test, from the review tray or the last review's list, lands on its row in the column.
- A `describe` that gains, loses or swaps `.skip`, `.only` or `.todo` now edits the tests under it, as a test's own label does, so a group that stopped running shows as changed, even when nothing else in the file did.

## 0.44.0 — 2026-11-05

### Changed

- The inspector's Note tab is now the part's reading column: Claude's note, then **What changed**, its changed symbols and logic lines with their count in the heading, then **Why look**, the findings on it with their answers. The Symbols tab is gone. An arrow holds its note and findings only.
- "No note" shows only when the column holds nothing else.
- Going to a draft on a symbol or logic line, from the review tray, lands on its row in the column, opening the fold it sits in.
- Going to a finding, from the rail, Start here or the tray, shows its row under **Why look**; its draft in the tray, or its answer in the last review's list, also takes the focus there. A new part opens at the column's top.

## 0.43.0 — 2026-11-05

### Added

- **Show patch** beside each file's name on the Routes tab opens its patch, so a route file that couldn't be read, or a statement not read, leads to what's left to read.

### Fixed

- A changed route file that doesn't parse or is too big to read is the one its finding and section name. With several route files changed, they named the first that changed, whichever had stopped the reading. A file that stops it unchanged has no patch, so those stay at the first that changed, and the message names it.

## 0.42.0 — 2026-11-05

### Added

- A Routes tab, shown when a change holds a route change: added, removed and changed routes under each route file's name, what's removed first, each with its verb and path, its target before and after, and where it's written. `PATCH` and `PUT` of one path and target read as one line.
- The statements not read that were added or removed are listed above a file's routes, with what they sit under, and a route file that couldn't be read says so.

### Changed

- A route's finding opens the Routes tab, where it opened the file's patch, from the rail, Start here and the review tray: a removed route or a new target at its row, a statement not read at its line, and a file's added routes at its section. The review `.json`'s findings carry `route`, naming the row.

## 0.41.0 — 2026-11-05

### Added

- A changed Rust function reads its logic lines: its guards, ifs, loops, match arms, logicals, returns inside a branch, throws and `?`s. `ensure!`, the asserts, `bail!`, `panic!` and the like count by name. A `?` reads as a new kind of decision, `try`, for information when it changes, its text leaving out closure bodies, blocks and the `?`s inside it, whose logic reads as lines of its own.
- A removed guard or catch in a Rust function needs a look, and a Rust file with logic changes and no changed test alongside raises `tests:untested-logic`, as in TS and Rails, unless all it changed is `?`s.
- A Rust macro or `macro_rules!` holding a real `?`, `return` or `if` is named as hiding logic, for information. A tracing `?field` or a macro's `$(,)?` isn't. Logic in a function nested in another reads no line.

## 0.39.0 — 2026-11-05

### Added

- Each dimension a check raises now says what it read. A picked lens lists its dimensions under the chips, each with what it found, `checked, none`, or why it wasn't read, such as `Rails only`, `no axum crate`, `no stack drawn` or `not read for crates`, and both when it was read in part. A lens with nothing found and nothing unread names what it checked on its chip, as in `Risk · dependencies checked, nothing found`, in place of Start here's "nothing to show".
- The review `.json` carries this as `coverage`, and the skill is told not to claim what a dimension didn't read. It speaks for the stacks drawn: a changed file outside the graph keeps its own finding, and nothing in it was read.
- `routes` speaks for a Rails app's routes and the axum linker together, so a Rails app is never told it has no axum crate; a route file that didn't parse is named.
- A `Linker`'s `Links` can name why it read nothing, in an optional `notRead`.

## 0.38.0 — 2026-11-05

### Added

- A change to a Rails app's routes reads as route changes: `config/routes.rb` and the files it joins with `load` and `draw` are expanded on both sides, with no Ruby run, and compared by app, verb and path. So `only: [:index]` to `only: [:index, :destroy]` is a new endpoint, not an edited line.
- A removed route, and a new target at the same path, each raise a `routes` finding to look at. Added routes raise one finding per file, for information, with their count. Each opens the patch of the file behind it.
- What the reader can't read (`if`, loops, `concern`, `devise_for` and anything under them) is listed by its text and never guessed at. It raises a finding only when that text is added or removed, and a route file that can't be read at all says so, as a blind spot in Start here.

## 0.37.0 — 2026-11-05

### Changed

- Five lens chips replace the triage strip: a chip filters the rail and Start here to its lens, and picking it again clears the filter. A quiet lens's chip stays drawn, so the same five are always there to read, and picked, Start here says there's nothing to show in it.
- Each Start here line names its lens and its dimension.

## 0.36.0 — 2026-11-05

### Added

- A changed Rust file reads its symbols: its functions, the methods of its `impl`s and traits, and its structs, enums, unions, traits and type aliases as types, inside an inline `mod` too. So it gets a Symbols tab, a place in Colour by Kind of change and `api` findings, where it used to say "symbols not read".
- A Rust symbol is exported only when exactly `pub`, not `pub(crate)` or `pub(super)`; a trait impl's methods when their type is `pub` in the file. A private field, a doc or a comment isn't a signature change. A file's exports also list its `pub` consts, statics, mods and `pub use` names.
- Rust test code (`#[test]`, `#[cfg(test)]`) reads no symbols, though a file whose inline tests alone changed reads as a logic change, overstated rather than hidden. A file that doesn't parse says so, as a TS or Rails file does.

## 0.34.0 — 2026-11-05

### Changed

- Start here replaces Look first above the graph. It shows at most five lines, each gathering what one check found, such as `7 exported signatures changed · 4 files`, so one check can't fill it, and its heading counts what needs a look. With nothing to look at, it shows the information lines. **All findings** replaces Show all and is always shown.
- A line of several findings opens in place to list them, each going to its target or file. A line of one goes as before, and a suggested split's line opens the rail, where its groups' buttons are.
- A finding called fine on the last review lowers its line's count; the rail still lists it, tagged.
- Each finding in the page data carries a `check`, so a page's `.json` says what raised it.

## 0.33.0 — 2026-11-05

### Added

- A migration's `add_reference` or `add_belongs_to`, which index by default, and `t.references` or a column's `index: true` in `change_table`, raise the same finding as `add_index`, naming the columns the index covers. `index: false`, `index: nil`, `index: { algorithm: :concurrently }` and a table the migration creates raise none.

## 0.32.0 — 2026-11-05

### Added

- Rails methods and classes read their logic: guards, ifs, ternaries, loops, cases, logicals, catches, returns in a branch and throws, each added, removed, changed, the same or moved, so a Rails guard or catch removed needs a look and logic changed with no test alongside says so. A class's callbacks and validations read as guards on it, and `rescue_from` as a catch, so one replaced in place by another, or dropping a name it held, is lost and added, while an edit to its options or a name added beside it is a change. What's recognised by a method's name, such as a conditional `render` or an `each` block, carries `foundByName`, and a lost one says so.
- A changed Rails file naming `define_method`, `method_missing`, `send`, `public_send`, `class_eval` or `instance_eval` raises one finding for information, `logic:blind-spot:<node>`.

### Fixed

- A name repeated in a file, as a reopened Ruby class, goes by its own decisions and body when finding what moved, not its first symbol's.

## 0.31.0 — 2026-11-05

### Changed

- A changed signature in the Symbols tab shows the members that moved, not both whole: a type's or interface's members, a function's parameters or a union's alternatives, one added `+`, one removed `−` and one changed `~ base → head`, those as they were folded under a count that opens. A parameter that moves reads removed and added, since order matters in a call. A signature with no members to split, such as `extends`, a line comment, or a very long one, shows base above head as before. A block comment doesn't count as a change or cut a member, and neither does a formatter's reflow: a leading bar, a trailing separator or the spacing against a bracket.
- A changed signature's finding sums up what moved, such as `1 member added, 1 changed`, so the rail and Look first stop printing both whole types.

## 0.29.0 — 2026-11-05

### Added

- A change to a Rails `db/schema.rb` or `db/<name>_schema.rb` gets a Schema tab, with a card per changed table showing its columns, indexes and table options before and after. A dump added or removed whole says so with its table count, and one that doesn't parse says it wasn't read.
- Each changed table raises a Schema finding for information, summing up what changed in it, and a removed table one that needs a look. A dump added or removed whole raises one for information. A dump that doesn't parse raises one saying it wasn't read, ranked first. They open the Schema tab, at the table's card.
- The review data carries `schemas`.

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
