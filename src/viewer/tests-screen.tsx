import {
  type MarkedTest,
  type TestChange,
  type TestFile,
  type TestStatement,
  testCounts,
} from '../core/test-changes.ts';

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

export const TestFiles = ({ files }: { readonly files: ReadonlyArray<TestFile> }) =>
  files.map(file => (
    <section key={file.path} aria-label={file.path}>
      <h3>
        <code>{file.path}</code>
        {file.renamedFrom && <span className="renamed">renamed from {file.renamedFrom}</span>}
      </h3>
      {'statements' in file ? (
        <TestTree statements={file.statements} />
      ) : (
        <p>Couldn't read its tests: {file.unreadable}</p>
      )}
    </section>
  ));

export const changedCount = (files: ReadonlyArray<TestFile>): number =>
  Object.values(testCounts(files)).reduce((sum, count) => sum + count, 0);
