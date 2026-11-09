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

const TestTree = ({
  statements,
  ...place
}: TestPlace & { readonly statements: ReadonlyArray<AnchoredStatement> }) => (
  <ul>
    {statements.map(statement =>
      statement.kind === 'test' ? (
        <TestLine key={`test ${statement.trail}`} test={statement} {...place} />
      ) : (
        <li
          key={`heading ${statement.trail}`}
          className="heading"
          aria-label={accessibleName([statement.name, statement.label])}
        >
          <span>{statement.name}</span>
          {statement.label && <span className="label">{statement.label}</span>}
          <TestTree statements={statement.children} {...place} />
        </li>
      ),
    )}
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
};

const DrawnFiles = ({ drawn, nodes, ...commenting }: DrawnFilesProps) =>
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
        <TestTree statements={statements} path={file.path} {...commenting} />
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

export const useTestsToRead = (
  files: ReadonlyArray<TestFile>,
  comments: Comments,
): ReadonlyArray<DrawnFile> => {
  const hasSaid = useHasSaid();
  const isChangedSince = useIsChangedSince();
  const { notes } = useContext(RowNotes);
  return files.map(anchoredIn).map(({ file, statements }) => ({
    file,
    statements: kept(statements, ({ change, trail }) => {
      const anchor = { kind: 'test', id: testAnchorId(file.path, trail) } as const;
      return (
        change !== 'unchanged' ||
        comments[anchorKey(anchor)] !== undefined ||
        notes[anchorKey(anchor)] !== undefined ||
        hasSaid(anchor) ||
        isChangedSince('tests', anchor.id)
      );
    }),
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
          <DrawnFiles drawn={shown.map(anchoredIn)} nodes={review.diff.nodes} {...commenting} />
        ) : (
          <p>{forNode ? 'No test changed here.' : 'No test changed.'}</p>
        )}
      </section>
      <ChangedNodes review={review} onGoTo={onGoTo} />
    </div>
  );
};
