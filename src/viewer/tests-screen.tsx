import { useState } from 'react';
import type { GraphNode } from '../core/graph.ts';
import type { ReviewNotes } from '../core/notes.ts';
import type { PageData } from '../core/page.ts';
import type { Comment } from '../core/review.ts';
import {
  type MarkedTest,
  type TestChange,
  type TestCounts,
  type TestFile,
  type TestStatement,
  testCounts,
} from '../core/test-changes.ts';
import { testsAlongside } from '../core/tests-alongside.ts';
import { CommentOn, type Comments } from './comment-field.tsx';
import { LevelMark } from './finding-display.tsx';

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
  readonly headings: ReadonlyArray<string>;
};

const TestLine = ({
  test,
  path,
  headings,
  comments,
  onComment,
}: TestPlace & { readonly test: MarkedTest }) => {
  const moved = movement(test);
  const trail = [...headings, test.name].join(' › ');
  return (
    <li
      className="test"
      data-state={moved || test.change === 'edited' ? 'modified' : test.change}
      aria-label={accessibleName([`${test.name}: ${moved?.text ?? test.change}`, test.label])}
    >
      <span className="mark" aria-hidden="true">
        {moved?.mark ?? TEST_MARKS[test.change]}
      </span>
      <span className="test-name">{test.name}</span>
      {test.label && <span className="label">{test.label}</span>}
      {moved && <span className="moved">{moved.text}</span>}
      {onComment && (
        <CommentOn
          name={trail}
          anchor={{ kind: 'test', id: `${path}#${trail}` }}
          comments={comments}
          onComment={onComment}
        />
      )}
    </li>
  );
};

const TestTree = ({
  statements,
  headings,
  ...place
}: TestPlace & { readonly statements: ReadonlyArray<TestStatement> }) => (
  <ul>
    {statements.map(statement =>
      statement.kind === 'test' ? (
        <TestLine
          key={`test ${statement.name} ${statement.change}`}
          test={statement}
          headings={headings}
          {...place}
        />
      ) : (
        <li
          key={`heading ${statement.name}`}
          className="heading"
          aria-label={accessibleName([statement.name, statement.label])}
        >
          <span>{statement.name}</span>
          {statement.label && <span className="label">{statement.label}</span>}
          <TestTree
            statements={statement.children}
            headings={[...headings, statement.name]}
            {...place}
          />
        </li>
      ),
    )}
  </ul>
);

type TestFilesProps = Commenting & {
  readonly files: ReadonlyArray<TestFile>;
  readonly nodes: ReadonlyArray<GraphNode>;
};

export const TestFiles = ({ files, nodes, ...commenting }: TestFilesProps) =>
  files.map(file => (
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
        <TestTree statements={file.statements} path={file.path} headings={[]} {...commenting} />
      ) : (
        <p>Couldn't read its tests: {file.unreadable}</p>
      )}
    </section>
  ));

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
          <TestFiles files={shown} nodes={review.diff.nodes} {...commenting} />
        ) : (
          <p>{forNode ? 'No test changed here.' : 'No test changed.'}</p>
        )}
      </section>
      <ChangedNodes review={review} onGoTo={onGoTo} />
    </div>
  );
};
