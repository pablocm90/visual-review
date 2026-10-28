import { parse } from '@babel/parser';
import type { Node, Statement } from '@babel/types';

export type TestChange = 'added' | 'removed' | 'edited' | 'unchanged';

export type TestLabel = 'skip' | 'only' | 'todo';

export type TestStatement =
  | {
      readonly kind: 'test';
      readonly name: string;
      readonly change: TestChange;
      readonly label?: TestLabel | undefined;
      readonly movedTo?: string;
      readonly movedFrom?: string;
    }
  | {
      readonly kind: 'heading';
      readonly name: string;
      readonly label?: TestLabel | undefined;
      readonly children: ReadonlyArray<TestStatement>;
    };

export type TestFile = { readonly path: string; readonly renamedFrom?: string | undefined } & (
  | { readonly statements: ReadonlyArray<TestStatement> }
  | { readonly unreadable: string }
);

export type ReadTest =
  | {
      readonly kind: 'test';
      readonly name: string;
      readonly label?: TestLabel | undefined;
      readonly source: string;
    }
  | {
      readonly kind: 'heading';
      readonly name: string;
      readonly label?: TestLabel | undefined;
      readonly children: ReadonlyArray<ReadTest>;
    };

const TEST_CALLS = new Set(['test', 'it']);

const HEADING_CALLS = new Set(['describe', 'test.describe']);

const LABELS = new Map<string, TestLabel>([
  ['skip', 'skip'],
  ['only', 'only'],
  ['todo', 'todo'],
]);

const TABLES = new Set(['each', 'for']);

const calleeParts = (callee: Node): ReadonlyArray<string> => {
  if (callee.type === 'Identifier') return [callee.name];
  if (callee.type === 'CallExpression') return calleeParts(callee.callee);
  if (callee.type === 'TaggedTemplateExpression') return calleeParts(callee.tag);
  if (callee.type !== 'MemberExpression' || callee.property.type !== 'Identifier') return [];
  return [...calleeParts(callee.object), callee.property.name];
};

export const readTypeScriptTests = (text: string): ReadonlyArray<ReadTest> => {
  const statementsIn = (body: ReadonlyArray<Statement>): ReadonlyArray<ReadTest> =>
    body.flatMap<ReadTest>(statement => {
      if (statement.type !== 'ExpressionStatement') return [];
      const call = statement.expression;
      if (call.type !== 'CallExpression') return [];
      const parts = calleeParts(call.callee);
      const callee = parts.filter(part => !LABELS.has(part) && !TABLES.has(part)).join('.');
      const label = parts.map(part => LABELS.get(part)).find(Boolean);
      const [name, callback] = call.arguments;
      if (name === undefined) return [];
      const isTable = call.callee.type !== 'MemberExpression' && call.callee.type !== 'Identifier';
      const shown =
        name.type === 'StringLiteral' && !isTable
          ? name.value
          : text.slice(name.start ?? undefined, name.end ?? undefined);
      if (TEST_CALLS.has(callee)) {
        const source = text.slice(statement.start ?? undefined, statement.end ?? undefined);
        return [{ kind: 'test', name: shown, label, source }];
      }
      if (!HEADING_CALLS.has(callee)) return [];
      if (callback?.type !== 'ArrowFunctionExpression' || callback.body.type !== 'BlockStatement') {
        return [];
      }
      return [{ kind: 'heading', name: shown, label, children: statementsIn(callback.body.body) }];
    });
  return statementsIn(
    parse(text, { sourceType: 'module', plugins: ['typescript', 'jsx'] }).program.body,
  );
};

const allMarked = (
  tests: ReadonlyArray<ReadTest>,
  change: TestChange,
): ReadonlyArray<TestStatement> =>
  tests.map(test =>
    test.kind === 'test'
      ? { kind: 'test', name: test.name, change, label: test.label }
      : {
          kind: 'heading',
          name: test.name,
          label: test.label,
          children: allMarked(test.children, change),
        },
  );

const sameTest = (one: ReadTest, other: ReadTest): boolean =>
  one.kind === other.kind && one.name === other.name;

const comparedPair = (old: ReadTest | undefined, test: ReadTest): ReadonlyArray<TestStatement> => {
  if (old?.kind === 'heading' && test.kind === 'heading') {
    return [
      {
        kind: 'heading',
        name: test.name,
        label: test.label,
        children: compared(old.children, test.children),
      },
    ];
  }
  if (old?.kind !== 'test' || test.kind !== 'test') return allMarked([test], 'added');
  return [
    {
      kind: 'test',
      name: test.name,
      change: old.source === test.source ? 'unchanged' : 'edited',
      label: test.label,
    },
  ];
};

const compared = (
  before: ReadonlyArray<ReadTest>,
  after: ReadonlyArray<ReadTest>,
): ReadonlyArray<TestStatement> => {
  const kept = (test: ReadTest): boolean => after.some(candidate => sameTest(candidate, test));
  const removedAfter = (anchor: ReadTest | undefined): ReadonlyArray<TestStatement> =>
    allMarked(
      before.filter(
        (test, index) => !kept(test) && before.slice(0, index).findLast(kept) === anchor,
      ),
      'removed',
    );
  return [
    ...removedAfter(undefined),
    ...after.flatMap(test => {
      const old = before.find(candidate => sameTest(candidate, test));
      return [...comparedPair(old, test), ...(old === undefined ? [] : removedAfter(old))];
    }),
  ];
};

type TestChangesOptions = {
  readonly read: (text: string) => ReadonlyArray<ReadTest>;
  readonly before?: string | undefined;
  readonly after?: string | undefined;
};

const anyChanged = (statements: ReadonlyArray<TestStatement>): boolean =>
  statements.some(statement =>
    statement.kind === 'test' ? statement.change !== 'unchanged' : anyChanged(statement.children),
  );

export const testChanges = ({
  read,
  before,
  after,
}: TestChangesOptions): ReadonlyArray<TestStatement> => {
  const readTests = (text: string | undefined) => (text === undefined ? [] : read(text));
  const statements = compared(readTests(before), readTests(after));
  return anyChanged(statements) ? statements : [];
};

export type MarkedTest = Extract<TestStatement, { kind: 'test' }>;

const testsUnder = (statements: ReadonlyArray<TestStatement>): ReadonlyArray<MarkedTest> =>
  statements.flatMap(statement =>
    statement.kind === 'test' ? [statement] : testsUnder(statement.children),
  );

export const withMovedTests = (files: ReadonlyArray<TestFile>): ReadonlyArray<TestFile> => {
  const pathsWhere = (name: string, change: TestChange): ReadonlyArray<string> =>
    files.flatMap(file =>
      'statements' in file
        ? testsUnder(file.statements)
            .filter(test => test.name === name && test.change === change)
            .map(() => file.path)
        : [],
    );
  const otherEnd = (test: MarkedTest) => {
    const [from, ...moreFrom] = pathsWhere(test.name, 'removed');
    const [to, ...moreTo] = pathsWhere(test.name, 'added');
    if (from === undefined || to === undefined || from === to) return {};
    if (moreFrom.length > 0 || moreTo.length > 0) return {};
    if (test.change === 'removed') return { movedTo: to };
    return test.change === 'added' ? { movedFrom: from } : {};
  };
  const marked = (statement: TestStatement): TestStatement =>
    statement.kind === 'test'
      ? { ...statement, ...otherEnd(statement) }
      : { ...statement, children: statement.children.map(marked) };
  return files.map(file =>
    'statements' in file ? { ...file, statements: file.statements.map(marked) } : file,
  );
};
