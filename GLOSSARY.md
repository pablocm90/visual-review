# visual-review

The language of a review page: what the reader is shown about a change, and how it is sorted for them to look at.

## Language

**Finding**:
One thing about the change worth the reader's attention, raised by the CLI or by a note's flag, with a dimension, a level, a one-line title and, when it is about one node or edge, its target.
_Avoid_: issue, warning, alert
_In code_: `Finding`

**Dimension**:
What a finding is about, one of a fixed list (structure, logic, api, tests, metrics, routes and the rest), so findings can be grouped by it and each counts under its lens.
_Avoid_: category, kind

**Lens**:
One of five groups of dimensions the reader narrows findings to: Behaviour (logic, tests, failure, performance), Contract (api, blast radius, routes, schema), Risk (security, tenancy, deploy, dependencies), Shape (structure, rules, cohesion) and Context (metrics, ownership). Picking one narrows Start here and the rail to it, and dims the other badges. The graph is never filtered.
_Avoid_: category, group, triage
_In code_: `Lens`, `LENS_OF` (`src/viewer/lenses.ts`)

**Coverage**:
What the review could say about a dimension a check raises, across the drawn stacks: it was checked, or it wasn't read, or was read only in part, and why. A changed file outside the graph is read by none of them, and has its own finding.
_Avoid_: support, status
_In code_: `Coverage`, `PageData.coverage` (`src/core/coverage.ts`)

**Level**:
How urgent a finding is: it needs a look, or it is for information.
_Avoid_: severity, priority
_In code_: `'look' | 'info'`

**Fact**:
What the CLI read about the change (a skipped stack, a changed file outside the graph, a call no route matches, a metric), kept in the page data whether or not it raises a finding.
_Avoid_: finding (for the raw reading)

**Part**:
A changed node with no changed node inside it: a module, a file or a class, or a crate or box changed only outside its parts (its `Cargo.toml`, a stylesheet); never a stack.
_Avoid_: component, item
_In code_: an id in `readingOrder.parts`

**Reading order**:
The changed parts in the order to read them: a part after every part it depends on at the head, parts that depend on each other together in id order, then the removed parts in id order. The page numbers the changed files outside the graph after them.
_Avoid_: priority, rank
_In code_: `PageData.readingOrder`

**Group**:
Parts joined by edges of the change that run directly between them, or by a chain of such edges; an unchanged node, a shared box or stack, or an edge between the boxes holding them joins nothing. Two groups that reach `metrics.splitParts` raise the finding that the change may be independent changes.
_Avoid_: cluster, component
_In code_: `SplitSuggestion` (`src/core/split-suggestion.ts`), `Finding['groups']`

**Read mark**:
The reviewer's mark that they have read a part, kept in their browser for the page's range and sent with the review; a part read with no comment on it was read and found fine.
_Avoid_: seen, viewed, done
_In code_: `storedReadMarks` (`src/viewer/read-marks.ts`)

**Check**:
What raised a finding, one of a fixed list, each with its own title for several of them (`exported signatures changed`), so that one check's findings can read as one line. A flag has none: each is Claude's own sentence.
_Avoid_: rule, kind
_In code_: `Finding['check']`, `Check` (`src/core/checks.ts`)

**Start here**:
The few lines to begin with above the graph, at most five, each the findings of one check and level, or one flag. Those that need a look come first; within each level, a line ranks by its best finding: the blind spots, then direct dependency changes, risky migrations, removed tables, removed routes and new targets, then what most depends on, then what changes most. Above those, when the range changed a decision and no lens but Behaviour is picked, one more line that is no finding: how many decisions changed, going to **Logic only**.
_Avoid_: Look first, top findings, priorities
_In code_: `startHere` (`src/core/start-here.ts`)

**Reading column**:
What the inspector reads for one part, top to bottom: its note, What changed (its symbols and logic lines), Why look (the findings on it), then Tested by (its changed tests, and the finding when logic changed with no test alongside). An arrow's holds its note and findings only.
_Avoid_: note panel, sidebar
_In code_: `NotePanel` (`src/viewer/review-page.tsx`)

**Reading** (the page's state):
Walking the parts one at a time: the left column narrows to numbered stops, the reading column takes the middle, and the aside holds the corner map and Next to it. `J`, `K`, Start reading, a row of the reading order and the head's Next enter it, as `L` and Next logic change do, walking the changed decisions instead; a click in the graph, a finding or Start here keep the graph whole.
_In code_: `reading` (`src/viewer/review-page.tsx`)

**Corner map**:
The graph while reading: the same layout fitted into the aside, with the current part ringed. It says where you are, and a click on a node goes there; it doesn't zoom, pan or open boxes, and its labels aren't promised at that scale. Open map returns to the graph whole.
_Avoid_: minimap, thumbnail
_In code_: `map` in `useGraphView`, `mapHeight` (`src/viewer/view.ts`)

**Dependency change**:
A package added to or removed from a lockfile, or major-bumped, or one that became or stopped being direct at the same version. Major-bumped means its set of compatibility lines differs across the sides: a version's numbers up to the first non-zero one, as `^` and Cargo read them, so `0.2.1` to `0.3.0` counts and `1.4.0` to `1.9.2` doesn't.
_Avoid_: dependency update, upgrade
_In code_: `PackageChange` (`src/core/dependency-changes.ts`)

**Table change**:
A table added to, removed from or changed in a schema dump, with its table options, columns and indexes before and after; a column or index pairs by name, so a rename is one removed and one added.
_Avoid_: migration, schema diff
_In code_: `TableChange` (`src/core/schema-diff.ts`)

**Route change**:
A route added to or removed from a Rails app's routes, or a verb and path that now goes to another target. Routes are compared as they expand, keyed by app, verb and path, so `only: [:index]` to `only: [:index, :destroy]` is one route added, and moving a line changes nothing.
_Avoid_: routes diff, endpoint change
_In code_: `RouteChange` (`src/core/route-diff.ts`)

**Direct**:
Declared by the project itself on either side of the change, as a lockfile says or, for `yarn.lock`, as the `package.json` files at or under its folder say. Any other package in a lockfile is transitive.
_Avoid_: top-level, first-level

**Flag**:
A note's short label for a concern; on the page it becomes a finding that needs a look, in the note's dimension.

**Symbol**:
A named function, method, getter, setter, class, type, interface or enum in a file, scoped by what holds it, paired across the sides by scope, name and kind (a method turned into a getter or setter stays paired), and marked added, removed, edited, renamed, moved, formatting only or unchanged.
_Avoid_: declaration, member
_In code_: `ReadSymbol` (one side's reading), `SymbolStatement` (paired across the sides)

**Kind of change**:
What a changed file's change is, the strongest that holds: an API change when its exports or an exported symbol's signature changed, else a logic change when its code changed, else formatting only. A box takes the strongest inside it.
_Avoid_: change type, severity
_In code_: `'api' | 'logic' | 'formatting'`

**Decision**:
A point in a function's own code where its path can fork or end early: a guard, an if, a ternary, a loop, a case, an outermost logical, a catch, a return inside a branch, a throw, a Rust `?`. In Rails, a class's callbacks, validations and `rescue_from` are decisions of the class. Read as its normalised source text.
_Avoid_: branch, condition
_In code_: `Decision`, `DecisionKind`

**Found by name**:
A decision known only from what a call is named, such as `render`, `before_action`, `each` or `ensure!`: the reader can't see what the call does, so a lost one's finding says so.
_Avoid_: heuristic, guessed
_In code_: `Decision['foundByName']`

**Logic not read through**:
A changed file calls something that hides logic from its reading, such as `send`, `define_method` or a Rust macro holding a `?`, which one finding for information names. It isn't one of Start here's blind spots, which are what the review couldn't read at all, though its id says `blind-spot`.
_Avoid_: unread logic
_In code_: `FileSymbols['blindSpots']`, `logic:blind-spot:<node>`

**Logic line**:
One decision of an edited or renamed symbol, diffed across the sides: the same, added, removed, changed (a base and a head decision of one kind paired in place, the head's subject holding all of the base's), or moved (one it lost whose kind and text another symbol gained at the head, found by text alone).
_Avoid_: logic diff (for one line), branch change
_In code_: `LogicLine`

**Logic strip**:
A function's logic lines drawn as marks in source order, one tick each, above What changed's rows of it: the way to see a function's changes at a glance and go to one.
_In code_: `LogicStrip`

**Logic only**:
A choice of Show drawing only the files with a changed decision, their boxes open, with every edge between them, each file a card holding a logic strip per function with a changed decision. It's offered only when there is one.
_In code_: `logicOnly`, `LogicCardBody`

**Anchor**:
What a reviewer's comment or answer is on, by its kind and id: a part the graph draws (a crate, module, file, class or box) or an edge, by the id notes are keyed by; a **symbol** in a file (`<file>#<scope.name>`, `#<n>` after it from the second of that name in the file on, as a getter and its setter are); a **logic line** (`<symbol id>#<text>`, `#<n>` after it from the second reading the same on, carrying its text; a removed guard's or catch's id is its finding's without `logic:removed:`); a test (`<test file>#<heading › … › name>`, `#<n>` after it from the second of those headings and that name in the file on); a diff line (`<file>@<base|head>:<n>`, carrying its text, since its number drifts); or, for an answer, a finding, by its id. Two anchors of different kinds never share a comment, whatever their ids.
_Avoid_: target (a finding's), key
_In code_: `Review['comments'][number]['anchor']`, `{ kind: 'part' | 'edge' | 'symbol' | 'decision' | 'test' | 'line' | 'finding', id }`; `anchorKey`, `anchorName`, `anchorTarget` (`anchors.ts`)

**Comment kind**:
What a reviewer's comment asks of Claude: Change this (a task), Question (an answer) or Suggestion (a thought to weigh, saying what was done with it). Question unless the reviewer picks another.
_Avoid_: comment type, severity
_In code_: `'change' | 'question' | 'suggestion'`

**Finding answer**:
A reviewer's one-click reply to a finding: Fix this (a task), It's fine (nothing to do, with an optional why) or Explain (an answer). A finding holds the last one given, and pressing it again withdraws it.
_Avoid_: resolution, dismissal, comment (for an answer)
_In code_: `Answer`, `'fix' | 'fine' | 'explain'`

**Review tray**:
The bar at the page's foot that gathers the review before it goes: closed, what is drafted, counted by kind; open, the drafts, the parts read with nothing to say, the general comment, the verdict and what Claude gets. Nothing goes until Send.
_Avoid_: review panel, drawer, cart
_In code_: `ReviewTray` (`src/viewer/review-tray.tsx`)

**Suggested verdict**:
The verdict the drafts point to: Request changes once any is a Change this or a Fix this, else Comment once any is a Question or an Explain, else Approve. The tray picks it until the reviewer picks one, which then holds.
_Avoid_: default verdict, auto verdict

**Round**:
One pass of a reviewer over a pull request, ending in a review sent from its page. The next round is the same pull request at another head, with an earlier review to compare against. Reviews of ranges and uncommitted work have no next round.
_Avoid_: iteration, pass, cycle
_In code_: `PageData.sinceReview`

**Changed since**:
What differs between the head last reviewed and the new head, in the paths the pull request itself changes, so a merge of its base branch counts only where it touches one of them. When the commit last reviewed can't be read there is nothing to compare, and the full review is shown.
_Avoid_: new changes, delta
_In code_: `ChangedSince`, `sinceReviewOf` (`src/core/since-review.ts`); `sinceLastReview` (`visible-diff.ts`)

**As it was**:
What an earlier comment or finding answer reads when nothing changed under its anchor since the last review, its opposite being "Changed since", shown with the commits that touched its file. A part or edge goes by what changed at or inside it; a symbol, logic line or test by its own anchor id; a diff line by its file. The commits always go by file, so one may touch the file and not the symbol commented on.
_Avoid_: unchanged, not addressed, ignored
_In code_: `PreviousComment` (`src/core/previous-comments.ts`), its `changedSince` absent

**Claude's answer**:
What Claude says became of an earlier comment or finding answer on a later round: Done, with its commit, Answered or Declined, each with its text. It's keyed by the anchor as said, and shows under it wherever it shows.
_Avoid_: answer alone (a finding answer is the reviewer's), reply, resolution
_In code_: `ReviewNotes['answers']`

**Resolve**:
Closing an earlier comment or finding answer from the last review: nothing more is asked of it, and Claude does nothing for it. A finding answer of kind It's fine has none, since it asks for nothing. The review lists it as said, under `resolved`, and it doesn't change the suggested verdict.
_Avoid_: dismiss, close, done
_In code_: `Review['resolved']`, `Resolve` (`src/viewer/said-before.tsx`)

**Reply**:
A comment on what an earlier comment was on, written beside it, so that anchor offers Reply in place of Comment. It's an ordinary comment on the anchor at the head, read with Claude's earlier answer. A finding answer has none: the finding's answer buttons are its reply.
_Avoid_: follow-up, Claude's answer (that's Claude's)
_In code_: `Reply` (`src/viewer/said-before.tsx`), a `Comment`

**Unasked change**:
A change Claude made on a later round that nothing in the last review asked for, by part or edge, listed in the last review so it isn't read as asked for.
_Avoid_: extra, drive-by
_In code_: `ReviewNotes['unasked']`

**Called fine**:
A finding whose newest answer in any review of its pull request is It's fine. It holds for the rest of that pull request, whatever changes under it, until a later answer replaces it.
_Avoid_: dismissed, suppressed
_In code_: `SinceReview['calledFine']`

## Relationships

- A **fact** may raise **findings**; a **finding** is never the only record of a fact.
- Each **finding** has one **dimension** and one **level**; a **flag** is the only way a note raises one.
- Each **dimension** belongs to one **lens**, so a **flag** counts under its dimension's lens whether or not a check raises that dimension.
- A **dimension** has **coverage** when a check raises it. One with none is listed under its **lens** only for the **findings** a **flag** gave it, and is never called checked.
- The **reading order** holds every **part** once; a **finding** whose target is a part marks its row.
- A **read mark** is on a **part**; the count of parts read counts only the parts in the **reading order**.
- **Start here** leaves out any finding **called fine**, so its line's count drops by one; the rail still lists it, tagged.
- Each **finding** but a **flag** has one **check**, and one **check** at one **level** is one line of **Start here**.
- A changed exported **symbol** raises a **finding** in the api dimension, under that symbol's id; a file's **kind of change** raises none of its own.
- A review holds at most one comment or **finding answer** per **anchor**, and each comment has one **comment kind**; the **suggested verdict** follows the kinds and the answers, and the verdict the reviewer picks overrides it.
- A **round** after the first compares against the newest review of its pull request at another head; **changed since** is always a subset of what the pull request changes at either head, so a part it has reverted counts; a symbol, logic line, test or file is **changed since** by its own anchor id, a diff line by its file.
- A **direct** package's **dependency change** raises its own **finding** that needs a look; a lockfile's transitive ones roll up into one **finding** for information.
- A **table change** raises a **finding** in the schema dimension, for information, or needing a look when the table is removed; a dump added or removed whole raises one for the file, and none per table.
- A removed route or a new target at one verb and path raises its own **finding** in the routes dimension that needs a look; a file's added routes raise one for information, with the count. PATCH and PUT of one path and target count as one. A statement not read raises a **finding** that needs a look only when its text is added or removed, so one that stays raises none.
- A **flag** is answered like any other **finding**, under the id `notes:<node or edge id>`.
- A removed guard or catch **logic line** raises a **finding** in the logic dimension that needs a look; a function's other **logic lines** that changed, a moved one among them, raise one for information; a file with either and no test changed alongside it raises one in the tests dimension.

## Flagged ambiguities

- "Metric finding" meant a threshold crossing before findings existed. Resolved: a crossing raises a **finding** in the metrics dimension; `MetricFinding` in code is the crossing itself, used for the marks on the Metrics fold's rows.
