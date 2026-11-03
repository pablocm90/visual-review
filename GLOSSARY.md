# visual-review

The language of a review page: what the reader is shown about a change, and how it is sorted for them to look at.

## Language

**Finding**:
One thing about the change worth the reader's attention, raised by the CLI or by a note's flag, with a dimension, a level, a one-line title and, when it is about one node or edge, its target.
_Avoid_: issue, warning, alert
_In code_: `Finding`

**Dimension**:
What a finding is about, one of a fixed list (structure, logic, api, tests, metrics, routes and the rest), so findings can be grouped and filtered by it.
_Avoid_: category, kind

**Level**:
How urgent a finding is: it needs a look, or it is for information.
_Avoid_: severity, priority
_In code_: `'look' | 'info'`

**Fact**:
What the CLI read about the change (a skipped stack, a changed file outside the graph, a call no route matches, a metric), kept in the page data whether or not it raises a finding.
_Avoid_: finding (for the raw reading)

**Look first**:
The few findings that need a look, ranked so the blind spots come first, then what most depends on, then what changes most.
_Avoid_: top findings, priorities

**Flag**:
A note's short label for a concern; on the page it becomes a finding that needs a look, in the note's dimension.

**Symbol**:
A named function, method, class, type, interface or enum in a file, scoped by what holds it, paired across the sides by scope, name and kind, and marked added, removed, edited, renamed, moved, formatting only or unchanged.
_Avoid_: declaration, member
_In code_: `ReadSymbol` (one side's reading), `SymbolStatement` (paired across the sides)

**Kind of change**:
What a changed file's change is, the strongest that holds: an API change when its exports or an exported symbol's signature changed, else a logic change when its code changed, else formatting only. A box takes the strongest inside it.
_Avoid_: change type, severity
_In code_: `'api' | 'logic' | 'formatting'`

**Decision**:
A point in a function's own code where its path can fork or end early: a guard, an if, a ternary, a loop, a case, an outermost logical, a catch, a return inside a branch, a throw. Read as its normalised source text.
_Avoid_: branch, condition
_In code_: `Decision`, `DecisionKind`

**Logic line**:
One decision of an edited or renamed function, diffed across the sides: the same, added, removed, or changed (a base and a head decision of one kind paired in place).
_Avoid_: logic diff (for one line), branch change
_In code_: `LogicLine`

## Relationships

- A **fact** may raise **findings**; a **finding** is never the only record of a fact.
- Each **finding** has one **dimension** and one **level**; a **flag** is the only way a note raises one.
- **Look first** holds only findings whose **level** is "needs a look".
- A changed exported **symbol** raises a **finding** in the api dimension; a file's **kind of change** raises none of its own.
- A removed guard or catch **logic line** raises a **finding** in the logic dimension that needs a look; a function's other **logic lines** that changed raise one for information; a file with either and no test changed alongside it raises one in the tests dimension.

## Flagged ambiguities

- "Metric finding" meant a threshold crossing before findings existed. Resolved: a crossing raises a **finding** in the metrics dimension; `MetricFinding` in code is the crossing itself, used for the Metrics cells' marks.
