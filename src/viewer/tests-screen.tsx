import { useContext, useState } from 'react';
import { anchorKey } from '../core/anchors.ts';
import type { GraphNode } from '../core/graph.ts';
import type { ReviewNotes } from '../core/notes.ts';
import type { PageData } from '../core/page.ts';
import type { Comment } from '../core/review.ts';
import {
  type AnchoredStatement,
  type AnchoredTest,
  anchoredTests,
  type MarkedTest,
  type TestChange,
  type TestCounts,
  type TestFile,
  testAnchorId,
  testCounts,
} from '../core/test-changes.ts';
import { testsAlongside } from '../core/tests-alongside.ts';
import { ChangedSinceTag, sinceLabel, useIsChangedSince } from './changed-since.tsx';
import type { Comments } from './comment-field.tsx';
import { LevelMark } from './finding-display.tsx';
import { FindingRows, type FindingRowsProps } from './finding-rows.tsx';
import { RowNote, RowNotes } from './note-block.tsx';
import { CommentOn, SaidBefore, useHasSaid } from './said-before.tsx';
import { useRowMarks } from './what-changed.tsx';

const TEST_MARKS: Readonly<Record<TestChange, string>> = {
  added: '+',
  removed: '−',
  edited: '✎',
  unchanged: '·',
};

const accessibleName = (parts: ReadonlyArray<string | undefined>): string =>
  parts.filter(Boolean).join(', ');

const movement = ({ movedTo, movedFrom }: MarkedTest) => {
  if (movedTo !== undefined) return { mark: '↷', text: `moved to ${movedTo}` };
  if (movedFrom !== undefined) return { mark: '↶', text: `moved from ${movedFrom}` };
  return undefined;
};

type Commenting = {
  readonly comments: Comments;
  readonly onComment: ((comment: Comment) => void) | undefined;
};

type TestPlace = Commenting & {
  readonly path: string;
};

const TestLine = ({
  test,
  path,
  comments,
  onComment,
}: TestPlace & { readonly test: AnchoredTest }) => {
  const moved = movement(test);
  const id = testAnchorId(path, test.trail);
  const marked = useIsChangedSince()('tests', id);
  const marksOf = useRowMarks();
  return (
    <li
      className="test"
      {...marksOf({ kind: 'test', id })}
      data-state={moved || test.change === 'edited' ? 'modified' : test.change}
      aria-label={sinceLabel(
        accessibleName([`${test.name}: ${moved?.text ?? test.change}`, test.label]),
        marked,
      )}
    >
      <span className="mark" aria-hidden="true">
        {moved?.mark ?? TEST_MARKS[test.change]}
      </span>
      <span className="test-name">{test.name}</span>
      {test.label && <span className="label">{test.label}</span>}
      {moved && <span className="moved">{moved.text}</span>}
      <ChangedSinceTag marked={marked} />
      <RowNote anchor={{ kind: 'test', id }} name={test.trail} comments={comments} />
      <SaidBefore on={{ kind: 'test', id }} />
      {onComment && (
        <CommentOn
          name={test.trail}
          anchor={{ kind: 'test', id }}
          comments={comments}
          onComment={onComment}
        />
      )}
    </li>
  );
};

type IsQuiet = (test: AnchoredTest) => boolean;

type Run =
  | { readonly quiet: false; readonly statement: AnchoredStatement }
  | { readonly quiet: true; readonly tests: ReadonlyArray<AnchoredTest> };

const LEAST_FOLDED = 3;

/** Statements in order, each run of quiet tests long enough to fold taken together. */
const runsIn = (
  statements: ReadonlyArray<AnchoredStatement>,
  isQuiet: IsQuiet | undefined,
): ReadonlyArray<Run> => {
  const runs: Array<Run> = [];
  let quiet: Array<AnchoredTest> = [];
  const flush = () => {
    if (quiet.length >= LEAST_FOLDED) runs.push({ quiet: true, tests: quiet });
    else runs.push(...quiet.map(statement => ({ quiet: false as const, statement })));
    quiet = [];
  };
  for (const statement of statements) {
    if (isQuiet && statement.kind === 'test' && isQuiet(statement)) quiet.push(statement);
    else {
      flush();
      runs.push({ quiet: false, statement });
    }
  }
  flush();
  return runs;
};

const TestTree = ({
  statements,
  isQuiet,
  ...place
}: TestPlace & {
  readonly statements: ReadonlyArray<AnchoredStatement>;
  readonly isQuiet?: IsQuiet | undefined;
}) => (
  <ul>
    {runsIn(statements, isQuiet).map(run => {
      if (run.quiet)
        return (
          <li key={`quiet ${run.tests[0]?.trail}`} className="test-run">
            <details>
              <summary>{run.tests.length} unchanged</summary>
              <ul>
                {run.tests.map(test => (
                  <TestLine key={`test ${test.trail}`} test={test} {...place} />
                ))}
              </ul>
            </details>
          </li>
        );
      const { statement } = run;
      return statement.kind === 'test' ? (
        <TestLine key={`test ${statement.trail}`} test={statement} {...place} />
      ) : (
        <li
          key={`heading ${statement.trail}`}
          className="heading"
          aria-label={accessibleName([statement.name, statement.label])}
        >
          <span>{statement.name}</span>
          {statement.label && <span className="label">{statement.label}</span>}
          <TestTree statements={statement.children} isQuiet={isQuiet} {...place} />
        </li>
      );
    })}
  </ul>
);

type DrawnFile = {
  readonly file: TestFile;
  readonly statements: ReadonlyArray<AnchoredStatement>;
};

const anchoredIn = (file: TestFile): DrawnFile => ({
  file,
  statements: 'statements' in file ? anchoredTests(file.statements) : [],
});

type DrawnFilesProps = Commenting & {
  readonly drawn: ReadonlyArray<DrawnFile>;
  readonly nodes: ReadonlyArray<GraphNode>;
  /** Folds each run of tests this says are quiet, as the Tests screen does with unchanged ones. */
  readonly quietIn?: (path: string) => IsQuiet;
};

const DrawnFiles = ({ drawn, nodes, quietIn, ...commenting }: DrawnFilesProps) =>
  drawn.map(({ file, statements }) => (
    <section key={file.path} aria-label={file.path}>
      <h3>
        <code>{file.path}</code>
        {file.renamedFrom && <span className="renamed">renamed from {file.renamedFrom}</span>}
        <span className="stack">
          {nodes.find(({ id }) => id === file.stack)?.label ?? file.stack}
        </span>
        {file.new && <span className="new">new file</span>}
      </h3>
      {'statements' in file ? (
        <TestTree
          statements={statements}
          path={file.path}
          isQuiet={quietIn?.(file.path)}
          {...commenting}
        />
      ) : (
        <p>Couldn't read its tests: {file.unreadable}</p>
      )}
    </section>
  ));

const kept = (
  statements: ReadonlyArray<AnchoredStatement>,
  keeps: (test: AnchoredTest) => boolean,
): ReadonlyArray<AnchoredStatement> =>
  statements.flatMap<AnchoredStatement>(statement => {
    if (statement.kind === 'test') return keeps(statement) ? [statement] : [];
    const children = kept(statement.children, keeps);
    return children.length > 0 ? [{ ...statement, children }] : [];
  });

/** Whether a test is news: changed, or holding a draft, a note, a last comment or a change since. */
const useTestNews = (comments: Comments) => {
  const hasSaid = useHasSaid();
  const isChangedSince = useIsChangedSince();
  const { notes } = useContext(RowNotes);
  return (path: string) =>
    ({ change, trail, movedTo, movedFrom }: AnchoredTest): boolean => {
      const anchor = { kind: 'test', id: testAnchorId(path, trail) } as const;
      return (
        change !== 'unchanged' ||
        movedTo !== undefined ||
        movedFrom !== undefined ||
        comments[anchorKey(anchor)] !== undefined ||
        notes[anchorKey(anchor)] !== undefined ||
        hasSaid(anchor) ||
        isChangedSince('tests', anchor.id)
      );
    };
};

export const useTestsToRead = (
  files: ReadonlyArray<TestFile>,
  comments: Comments,
): ReadonlyArray<DrawnFile> => {
  const isNews = useTestNews(comments);
  return files.map(anchoredIn).map(({ file, statements }) => ({
    file,
    statements: kept(statements, isNews(file.path)),
  }));
};

type TestedByProps = DrawnFilesProps & FindingRowsProps;

export const TestedBy = ({ drawn, found, answers, onAnswer, ...shown }: TestedByProps) => {
  const count = changedCount(drawn.map(({ file }) => file));
  return (
    <section className="column-section tests" aria-label="Tested by">
      <h3>Tested by{count > 0 && ` ${count}`}</h3>
      {found.length > 0 && <FindingRows found={found} answers={answers} onAnswer={onAnswer} />}
      <DrawnFiles drawn={drawn} {...shown} />
    </section>
  );
};

const COUNT_MARKS: ReadonlyArray<readonly [keyof TestCounts, string]> = [
  ['added', TEST_MARKS.added],
  ['edited', TEST_MARKS.edited],
  ['removed', TEST_MARKS.removed],
  ['moved', '↷'],
];

const Counts = ({ files }: { readonly files: ReadonlyArray<TestFile> }) => {
  const counts = testCounts(files);
  return (
    <ul className="test-counts" aria-label="Changed tests">
      {COUNT_MARKS.map(([change, mark]) => (
        <li key={change} aria-label={`${counts[change]} ${change}`}>
          {mark}
          {counts[change]}
        </li>
      ))}
    </ul>
  );
};

export const changedCount = (files: ReadonlyArray<TestFile>): number =>
  Object.values(testCounts(files)).reduce((sum, count) => sum + count, 0);

type ChangedNodesProps = {
  readonly review: PageData;
  readonly onGoTo: (id: string) => void;
};

const ChangedNodes = ({ review, onGoTo }: ChangedNodesProps) => {
  const changed = review.diff.nodes
    .filter(node => node.kind !== 'stack' && (node.state === 'added' || node.state === 'modified'))
    .map(node => ({
      node,
      count: changedCount(testsAlongside({ nodes: review.diff.nodes, node, tests: review.tests })),
    }))
    .toSorted((one, other) => Number(one.count > 0) - Number(other.count > 0));
  return (
    <section className="changed-nodes" aria-label="Changed nodes">
      <h2 className="changed-nodes-title">Changed nodes</h2>
      <p className="changed-nodes-caveat">
        Changed tests alongside each: at or under it, or named after a file in it.
      </p>
      <ul className="changed-nodes-list">
        {changed.map(({ node, count }) => (
          <li
            key={node.id}
            className="changed-node"
            data-state={node.state}
            aria-label={`${node.label}: ${node.state}, tests alongside: ${count || 'none'}`}
          >
            <span className="changed-node-mark" aria-hidden="true">
              {node.state === 'added' ? TEST_MARKS.added : TEST_MARKS.edited}
            </span>
            <button type="button" className="changed-node-name" onClick={() => onGoTo(node.id)}>
              {node.label}
            </button>
            <span className="changed-node-count">
              {count > 0 ? (
                count
              ) : (
                <>
                  <LevelMark level="look" /> none
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
};

type TestsScreenProps = Commenting & {
  readonly review: PageData;
  readonly notes: ReviewNotes | undefined;
  readonly selected: GraphNode | undefined;
  readonly onGoTo: (id: string) => void;
};

export const TestsScreen = ({
  review,
  notes,
  selected,
  onGoTo,
  ...commenting
}: TestsScreenProps) => {
  const [forSelected, setForSelected] = useState(false);
  const isNews = useTestNews(commenting.comments);
  const alongside =
    selected && testsAlongside({ nodes: review.diff.nodes, node: selected, tests: review.tests });
  const forNode = forSelected ? alongside : undefined;
  const shown = forNode ?? review.tests;
  return (
    <div className="tests-screen">
      {notes && (
        <section className="summary tests-pin" aria-label="What they pin">
          <h2 className="summary-title">What they pin</h2>
          <p>{notes.tests}</p>
        </section>
      )}
      <div className="tests-controls">
        <div className="segmented" role="group" aria-label="Tests shown">
          <button
            className="segmented-button"
            type="button"
            aria-pressed={forNode === undefined}
            onClick={() => setForSelected(false)}
          >
            All {changedCount(review.tests)}
          </button>
          {selected && alongside && (
            <button
              className="segmented-button"
              type="button"
              aria-pressed={forNode !== undefined}
              onClick={() => setForSelected(true)}
            >
              For {selected.label} {changedCount(alongside)}
            </button>
          )}
        </div>
        <Counts files={shown} />
      </div>
      <section className="tests tests-files" aria-label="Test changes">
        {shown.length > 0 ? (
          <DrawnFiles
            drawn={shown.map(anchoredIn)}
            nodes={review.diff.nodes}
            quietIn={path => test => !isNews(path)(test)}
            {...commenting}
          />
        ) : (
          <p>{forNode ? 'No test changed here.' : 'No test changed.'}</p>
        )}
      </section>
      <ChangedNodes review={review} onGoTo={onGoTo} />
    </div>
  );
};
