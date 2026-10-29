import { parse } from '@babel/parser';
import type { Node, Statement } from '@babel/types';
import type { ReadTest, TestLabel } from '../../core/test-changes.ts';

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
