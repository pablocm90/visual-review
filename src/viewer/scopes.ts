import type { GraphDiff } from '../core/diff-graphs.ts';
import type { PlaceInFile } from '../core/finding.ts';
import { edgeId } from '../core/graph.ts';
import { nodesWithChangedLogic } from '../core/logic-strip.ts';
import type { PageData } from '../core/page.ts';
import type { PreviousComment } from '../core/previous-comments.ts';
import type { ChangedSince } from '../core/since-review.ts';
import {
  changesOnly,
  expandedToShow,
  isDrawn,
  logicOnly,
  mergedDiff,
  nearChanges,
  sinceLastReview,
  visibleDiff,
} from '../core/visible-diff.ts';
import { routesHold } from './routes-screen.tsx';

type DrawnAtOptions = {
  readonly diff: GraphDiff;
  readonly expanded: ReadonlySet<string>;
  readonly noted: ReadonlySet<string>;
  readonly allEdges: boolean;
};

export const drawnAt = ({ diff, expanded, noted, allEdges }: DrawnAtOptions): GraphDiff =>
  allEdges ? visibleDiff({ diff, expanded }) : mergedDiff({ diff, expanded, noted });

type SaidInPlaceOptions = DrawnAtOptions & {
  readonly comments: ReadonlyArray<PreviousComment>;
  readonly arrow: string | undefined;
};

export const edgesSaidInPlace = ({ comments, arrow, diff, ...at }: SaidInPlaceOptions) =>
  comments
    .flatMap(({ target }) => target ?? [])
    .filter(
      target =>
        target !== arrow &&
        drawnAt({
          ...at,
          diff: { ...diff, edges: diff.edges.filter(edge => edgeId(edge) === target) },
        }).edges.some(edge => edgeId(edge) === arrow),
    );

type Keeping = {
  readonly diff: GraphDiff;
  readonly expanded: ReadonlySet<string>;
  readonly drawn: GraphDiff;
};

export type Scope = readonly [name: string, keep: (keeping: Keeping) => GraphDiff];

const SINCE_LAST_REVIEW = 'Since last review';

export const CHANGES_ONLY: Scope = ['Changes only', changesOnly];

export const EVERYTHING: Scope = ['Everything', ({ drawn }) => drawn];

export const LOGIC_ONLY = 'Logic only';

const WIDER_SCOPES: ReadonlyArray<Scope> = [
  ['Changed + 1 hop', ({ drawn }) => nearChanges(drawn)],
  EVERYTHING,
];

export const stillReadIn = ({ sinceReview }: PageData): ReadonlyArray<string> =>
  sinceReview !== undefined && 'stillRead' in sinceReview ? sinceReview.stillRead : [];

export const changedSinceIn = ({ sinceReview }: PageData): ChangedSince | undefined =>
  sinceReview !== undefined && 'changed' in sinceReview ? sinceReview.changed : undefined;

export const changedSinceShown = ([name]: Scope, review: PageData) =>
  name === SINCE_LAST_REVIEW ? changedSinceIn(review) : undefined;

export const unmergedWith = (noted: ReadonlySet<string>, since: ChangedSince | undefined) =>
  new Set([...noted, ...(since?.edges ?? [])]);

export const scopesOf = (review: PageData): ReadonlyArray<Scope> => {
  const changed = changedSinceIn(review);
  const files = nodesWithChangedLogic(review.symbols);
  return [
    ...(changed === undefined
      ? []
      : [
          [
            SINCE_LAST_REVIEW,
            (keeping: Keeping) => sinceLastReview({ ...keeping, changed }),
          ] satisfies Scope,
        ]),
    CHANGES_ONLY,
    ...(files.length === 0
      ? []
      : [[LOGIC_ONLY, ({ diff }: Keeping) => logicOnly({ diff, files })] satisfies Scope]),
    ...WIDER_SCOPES,
  ];
};

export const scopesFrom = (scopes: ReadonlyArray<Scope>, scope: Scope): ReadonlyArray<Scope> => [
  scope,
  ...scopes.slice(scopes.indexOf(scope[0] === LOGIC_ONLY ? CHANGES_ONLY : scope), -1),
];

type ViewToShowOptions = DrawnAtOptions & {
  readonly scopes: ReadonlyArray<Scope>;
  readonly scope: Scope;
  readonly id: string;
};

export type ViewShowing = {
  readonly expanded: ReadonlySet<string>;
  readonly allEdges: boolean;
  readonly scope: Scope;
};

/**
 * What going to an id changes so the graph draws it: the boxes opened around it, All edges ticked
 * when only that draws it, and Show widened from the current choice as far as it needs, never past
 * Everything.
 */
export const viewToShow = ({
  diff,
  expanded,
  noted,
  allEdges,
  scopes,
  scope,
  id,
}: ViewToShowOptions): ViewShowing => {
  const opened = expandedToShow({ diff, expanded, id });
  const at = { diff, expanded: opened, noted };
  const all = allEdges || !isDrawn({ diff: drawnAt({ ...at, allEdges: false }), id });
  const drawn = drawnAt({ ...at, allEdges: all });
  return {
    expanded: opened,
    allEdges: all,
    scope:
      scopesFrom(scopes, scope).find(([, keep]) => isDrawn({ diff: keep({ ...at, drawn }), id })) ??
      EVERYTHING,
  };
};

/** Where a file a finding names opens: a line's patch row, its schema card, its route, else its patch. */
export type FilePlace =
  | { readonly to: 'patch'; readonly line?: string }
  | { readonly to: 'schema'; readonly table?: string }
  | { readonly to: 'routes'; readonly route?: string };

export const placeOfFile = (
  { schemas, routes }: Pick<PageData, 'schemas' | 'routes'>,
  path: string,
  { table, route, line }: PlaceInFile,
): FilePlace => {
  if (line !== undefined) return { to: 'patch', line };
  if (schemas.some(({ file }) => file === path))
    return { to: 'schema', ...(table !== undefined && { table }) };
  if (routesHold(routes, path)) return { to: 'routes', ...(route !== undefined && { route }) };
  return { to: 'patch' };
};
