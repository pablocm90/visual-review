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

## Relationships

- A **fact** may raise **findings**; a **finding** is never the only record of a fact.
- Each **finding** has one **dimension** and one **level**; a **flag** is the only way a note raises one.
- **Look first** holds only findings whose **level** is "needs a look".

## Flagged ambiguities

- "Metric finding" meant a threshold crossing before findings existed. Resolved: a crossing raises a **finding** in the metrics dimension; `MetricFinding` in code is the crossing itself, used for the Metrics cells' marks.
