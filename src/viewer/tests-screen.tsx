import { useState } from 'react';
import type { GraphNode } from '../core/graph.ts';
import type { ReviewNotes } from '../core/notes.ts';
import type { PageData } from '../core/page.ts';
import {
  type MarkedTest,
  type TestChange,
  type TestCounts,
  type TestFile,
  type TestStatement,
  testCounts,
} from '../core/test-changes.ts';
import { deepestStackHolding, testsAlongside } from '../core/tests-alongside.ts';
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

const TestLine = ({ test }: { readonly test: MarkedTest }) => {
  const moved = movement(test);
  return (
    <li
      className="test"
      data-state={moved || test.change === 'edited' ? 'modified' : test.change}
      aria-label={accessibleName([`${test.name}: ${moved?.text ?? test.change}`, test.label])}
    >
      <span className="mark" aria-hidden="true">
        {moved?.mark ?? TEST_MARKS[test.change]}
      </span>
      {test.name}
      {test.label && <span className="label">{test.label}</span>}
      {moved && <span className="moved">{moved.text}</span>}
    </li>
  );
};

const TestTree = ({ statements }: { readonly statements: ReadonlyArray<TestStatement> }) => (
  <ul>
    {statements.map(statement =>
      statement.kind === 'test' ? (
        <TestLine key={`test ${statement.name} ${statement.change}`} test={statement} />
      ) : (
        <li
          key={`heading ${statement.name}`}
          className="heading"
          aria-label={accessibleName([statement.name, statement.label])}
        >
          <span>{statement.name}</span>
          {statement.label && <span className="label">{statement.label}</span>}
          <TestTree statements={statement.children} />
        </li>
      ),
    )}
  </ul>
);

type TestFilesProps = {
  readonly files: ReadonlyArray<TestFile>;
  readonly nodes: ReadonlyArray<GraphNode>;
};

export const TestFiles = ({ files, nodes }: TestFilesProps) =>
  files.map(file => (
    <section key={file.path} aria-label={file.path}>
      <h3>
        <code>{file.path}</code>
        {file.renamedFrom && <span className="renamed">renamed from {file.renamedFrom}</span>}
        <span className="stack">{deepestStackHolding(nodes, file.path)?.label}</span>
        {file.new && <span className="new">new file</span>}
      </h3>
      {'statements' in file ? (
        <TestTree statements={file.statements} />
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

const ChangedNodes = ({ review }: { readonly review: PageData }) => {
  const changed = review.diff.nodes
    .filter(node => node.kind !== 'stack' && (node.state === 'added' || node.state === 'modified'))
    .map(node => ({
      node,
      count: changedCount(testsAlongside({ nodes: review.diff.nodes, node, tests: review.tests })),
    }))
    .toSorted((one, other) => Number(one.count > 0) - Number(other.count > 0));
  return (
    <section className="changed-nodes" aria-label="Changed nodes">
      <h2>Changed nodes</h2>
      <p>Changed tests alongside each: at or under it, or named after a file in it.</p>
      <ul>
        {changed.map(({ node, count }) => (
          <li
            key={node.id}
            data-state={node.state}
            aria-label={`${node.label}: ${node.state}, tests alongside: ${count || 'none'}`}
          >
            <span className="mark" aria-hidden="true">
              {node.state === 'added' ? TEST_MARKS.added : TEST_MARKS.edited}
            </span>
            {node.label}
            <span className="count">
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

type TestsScreenProps = {
  readonly review: PageData;
  readonly notes: ReviewNotes | undefined;
  readonly selected: GraphNode | undefined;
};

export const TestsScreen = ({ review, notes, selected }: TestsScreenProps) => {
  const [forSelected, setForSelected] = useState(false);
  const alongside =
    selected && testsAlongside({ nodes: review.diff.nodes, node: selected, tests: review.tests });
  const forNode = forSelected ? alongside : undefined;
  const shown = forNode ?? review.tests;
  return (
    <div className="tests-screen">
      {notes && (
        <section className="summary" aria-label="What they pin">
          <h2 className="summary-title">What they pin</h2>
          <p>{notes.tests}</p>
        </section>
      )}
      <div role="group" aria-label="Tests shown">
        <button
          type="button"
          aria-pressed={forNode === undefined}
          onClick={() => setForSelected(false)}
        >
          All {changedCount(review.tests)}
        </button>
        {selected && alongside && (
          <button
            type="button"
            aria-pressed={forNode !== undefined}
            onClick={() => setForSelected(true)}
          >
            For {selected.label} {changedCount(alongside)}
          </button>
        )}
      </div>
      <Counts files={shown} />
      <section className="tests" aria-label="Test changes">
        {shown.length > 0 ? (
          <TestFiles files={shown} nodes={review.diff.nodes} />
        ) : (
          <p>{forNode ? 'No test changed here.' : 'No test changed.'}</p>
        )}
      </section>
      <ChangedNodes review={review} />
    </div>
  );
};
