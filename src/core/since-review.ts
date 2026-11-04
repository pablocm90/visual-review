import { diffGraphs, type FilePatch, type GraphDiff } from './diff-graphs.ts';
import { edgeId, type Graph } from './graph.ts';
import type { ReviewedHead, ReviewedReading, SymbolFile } from './read-range.ts';
import { isQuiet, qualified } from './symbol-changes.ts';
import { type AnchoredSymbol, anchoredSymbols, decisionsOf } from './symbol-findings.ts';
import {
  type AnchoredStatement,
  type AnchoredTest,
  anchoredTests,
  type TestFile,
  testAnchorId,
} from './test-changes.ts';

type Changed = {
  readonly nodes: ReadonlyArray<string>;
  readonly edges: ReadonlyArray<string>;
  readonly symbols: ReadonlyArray<string>;
  readonly decisions: ReadonlyArray<string>;
  readonly tests: ReadonlyArray<string>;
  readonly files: ReadonlyArray<string>;
};

export type ChangedSince = Changed & { readonly dropped: Changed };

type Said = Pick<ReviewedHead, 'head' | 'verdict' | 'body' | 'comments' | 'calledFine'>;

export type SinceReview = Said &
  ({ readonly gone: true } | { readonly unreadable: string } | { readonly changed: ChangedSince });

type SinceReviewOptions = {
  readonly reviewed: ReviewedReading;
  readonly after: Graph;
  readonly diff: GraphDiff;
  readonly changedPaths: ReadonlyArray<string>;
  readonly patches: ReadonlyArray<FilePatch>;
  readonly symbols: ReadonlyArray<SymbolFile>;
  readonly tests: ReadonlyArray<TestFile>;
};

const saidIn = ({ head, verdict, body, comments, calledFine }: ReviewedHead): Said => ({
  head,
  verdict,
  ...(body === undefined ? {} : { body }),
  comments,
  calledFine,
});

const changedIn = ({ nodes, edges }: GraphDiff) => ({
  nodes: nodes.filter(node => node.state !== 'unchanged').map(node => node.id),
  edges: edges.filter(edge => edge.state !== 'unchanged').map(edgeId),
});

const inTheHead = (ids: ReadonlyArray<string>, head: ReadonlyArray<string>) => ({
  drawn: ids.filter(id => head.includes(id)),
  dropped: ids.filter(id => !head.includes(id)),
});

type NamedInTheHeadOptions = {
  readonly reviewed: Graph;
  readonly after: Graph;
  readonly diff: GraphDiff;
};

const namedInTheHead = ({ reviewed, after, diff }: NamedInTheHeadOptions) => {
  const gone = reviewed.nodes.filter(node => !after.nodes.some(({ id }) => id === node.id));
  const renamedTo = new Map(
    diff.nodes.flatMap(({ id, renamedFrom }) =>
      gone.filter(node => node.path === renamedFrom).map(node => [node.id, id] as const),
    ),
  );
  return (id: string): string => renamedTo.get(id) ?? id;
};

const anchorsIn = (
  files: ReadonlyArray<SymbolFile>,
  nameOf: (node: string) => string = node => node,
): ReadonlyArray<AnchoredSymbol & { readonly node: string }> =>
  files.flatMap(file =>
    'unreadable' in file
      ? []
      : anchoredSymbols(nameOf(file.node), file.symbols).map(symbol => ({
          ...symbol,
          node: file.node,
        })),
  );

const idsChanged = (symbols: ReadonlyArray<AnchoredSymbol>): ReadonlyArray<string> =>
  symbols.filter(({ item }) => !isQuiet(item)).map(({ id }) => id);

const formerId = ({ id, node, item }: AnchoredSymbol & { readonly node: string }): string =>
  item.movedFrom === undefined && item.renamedFrom === undefined
    ? id
    : `${item.movedFrom ?? node}#${item.renamedFrom ?? qualified(item)}`;

type SymbolsSinceOptions = {
  readonly since: ReadonlyArray<SymbolFile>;
  readonly atHead: ReadonlyArray<SymbolFile>;
  readonly atReview: ReadonlyArray<SymbolFile>;
  readonly named: (id: string) => string;
};

const symbolsSinceOf = ({ since, atHead, atReview, named }: SymbolsSinceOptions) => {
  const head = anchorsIn(atHead);
  const now = idsChanged(head);
  const then = idsChanged(anchorsIn(atReview, named));
  const kept = anchorsIn(since)
    .filter(({ item }) => !isQuiet(item))
    .filter(symbol => now.includes(symbol.id) || then.includes(formerId(symbol)));
  const headDecisions = head.flatMap(symbol => decisionsOf(symbol).map(({ id }) => id));
  return {
    symbols: inTheHead(
      kept.map(({ id }) => id),
      head.map(({ id }) => id),
    ),
    decisions: inTheHead(
      kept.flatMap(symbol =>
        decisionsOf(symbol)
          .filter(({ line }) => line.change !== 'same')
          .filter(({ line, id }) => line.head === undefined || headDecisions.includes(id))
          .map(({ id }) => id),
      ),
      headDecisions,
    ),
  };
};

const testsUnder = (statements: ReadonlyArray<AnchoredStatement>): ReadonlyArray<AnchoredTest> =>
  statements.flatMap(statement =>
    statement.kind === 'test' ? [statement] : testsUnder(statement.children),
  );

const testAnchorsIn = (files: ReadonlyArray<TestFile>) =>
  files.flatMap(file =>
    'statements' in file
      ? testsUnder(anchoredTests(file.statements)).map(({ trail, change }) => ({
          id: testAnchorId(file.path, trail),
          former: testAnchorId(file.renamedFrom ?? file.path, trail),
          change,
        }))
      : [],
  );

type TestsSinceOptions = {
  readonly since: ReadonlyArray<TestFile>;
  readonly atHead: ReadonlyArray<TestFile>;
  readonly atReview: ReadonlyArray<TestFile>;
};

const testsSinceOf = ({ since, atHead, atReview }: TestsSinceOptions) => {
  const changed = <T extends { readonly change: string }>(tests: ReadonlyArray<T>) =>
    tests.filter(({ change }) => change !== 'unchanged');
  const head = testAnchorsIn(atHead);
  const now = changed(head).map(({ id }) => id);
  const then = changed(testAnchorsIn(atReview)).map(({ id }) => id);
  return inTheHead(
    changed(testAnchorsIn(since))
      .filter(({ id, former }) => now.includes(id) || then.includes(former))
      .map(({ id }) => id),
    head.map(({ id }) => id),
  );
};

export const sinceReviewOf = ({
  reviewed,
  after,
  diff,
  changedPaths,
  patches,
  symbols,
  tests,
}: SinceReviewOptions): SinceReview => {
  const said = saidIn(reviewed);
  if ('gone' in reviewed) return { ...said, gone: true };
  if ('unreadable' in reviewed) return { ...said, unreadable: reviewed.unreadable };
  const { pullRequest, ...side } = reviewed;
  const paths = [...changedPaths, ...pullRequest.changedPaths];
  const pathsSince = side.changedPaths.filter(path => paths.includes(path));
  const sinceDiff = diffGraphs({ ...side, after, changedPaths: pathsSince });
  const since = changedIn(sinceDiff);
  const now = changedIn(diff);
  const named = namedInTheHead({ reviewed: side.before, after, diff: sinceDiff });
  const atReview = diffGraphs({ ...pullRequest, after: side.before });
  const then = changedIn({
    nodes: atReview.nodes.map(node => ({ ...node, id: named(node.id) })),
    edges: atReview.edges.map(edge => ({ ...edge, from: named(edge.from), to: named(edge.to) })),
  });
  const nodes = inTheHead(
    since.nodes.filter(id => now.nodes.includes(id) || then.nodes.includes(id)),
    diff.nodes.map(node => node.id),
  );
  const edges = inTheHead(
    since.edges.filter(id => now.edges.includes(id) || then.edges.includes(id)),
    diff.edges.map(edgeId),
  );
  const files = inTheHead(
    pathsSince.filter(path => !side.renames.some(({ from }) => from === path)),
    patches.map(({ path }) => path),
  );
  const anchors = symbolsSinceOf({
    since: side.symbols,
    atHead: symbols,
    atReview: pullRequest.symbols,
    named,
  });
  const testsSince = testsSinceOf({
    since: side.tests,
    atHead: tests,
    atReview: pullRequest.tests,
  });
  return {
    ...said,
    changed: {
      nodes: nodes.drawn,
      edges: edges.drawn,
      symbols: anchors.symbols.drawn,
      decisions: anchors.decisions.drawn,
      tests: testsSince.drawn,
      files: files.drawn,
      dropped: {
        nodes: nodes.dropped,
        edges: edges.dropped,
        symbols: anchors.symbols.dropped,
        decisions: anchors.decisions.dropped,
        tests: testsSince.dropped,
        files: files.dropped,
      },
    },
  };
};
