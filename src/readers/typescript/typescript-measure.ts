import { type ParserPlugin, parse } from '@babel/parser';
import type { Node } from '@babel/types';
import { z } from 'zod';
import type { FileMeasures } from '../../core/reader.ts';

const RowSchema = z.object({ line: z.number() });

const TokenSchema = z.object({
  type: z.union([z.string(), z.object({ label: z.string() }).transform(({ label }) => label)]),
  loc: z.object({ start: RowSchema, end: RowSchema }),
});

const NOT_CODE = new Set(['CommentLine', 'CommentBlock', 'eof']);

const rowsOf = ({ loc: { start, end } }: z.infer<typeof TokenSchema>): ReadonlyArray<number> =>
  Array.from({ length: end.line - start.line + 1 }, (_, index) => start.line + index);

const pluginsFor = (path: string): Array<ParserPlugin> => {
  if (path.endsWith('.tsx')) return ['typescript', 'jsx'];
  return /\.[cm]?ts$/.test(path) ? ['typescript'] : ['jsx'];
};

const isNode = (value: unknown): value is Node =>
  typeof value === 'object' && value !== null && 'type' in value;

const childrenOf = (node: Node): ReadonlyArray<Node> =>
  Object.values(node)
    .flatMap((value: unknown) => (Array.isArray(value) ? value : [value]))
    .filter(isNode);

type OwnFunction = { readonly name: string; readonly fn: Node };

const sourceOf = (text: string, node: Node): string =>
  text.slice(node.start ?? undefined, node.end ?? undefined);

const functionValue = (node: Node | null | undefined): Node | undefined =>
  node?.type === 'ArrowFunctionExpression' || node?.type === 'FunctionExpression'
    ? node
    : undefined;

const assigned = (text: string, name: Node, value: Node | null | undefined) => {
  const fn = functionValue(value);
  return fn === undefined ? undefined : { name: sourceOf(text, name), fn };
};

const ownFunction = (text: string, node: Node): OwnFunction | undefined => {
  switch (node.type) {
    case 'FunctionDeclaration':
      return { name: node.id ? sourceOf(text, node.id) : 'default', fn: node };
    case 'ClassMethod':
    case 'ClassPrivateMethod':
    case 'ObjectMethod':
      return { name: sourceOf(text, node.key), fn: node };
    case 'VariableDeclarator':
      return assigned(text, node.id, node.init);
    case 'ClassProperty':
    case 'ClassPrivateProperty':
    case 'ObjectProperty':
      return assigned(text, node.key, node.value);
    default:
      return undefined;
  }
};

const functionsIn = (text: string, node: Node): ReadonlyArray<OwnFunction> => {
  const own = ownFunction(text, node);
  const inner = childrenOf(node).flatMap(child => functionsIn(text, child));
  return own === undefined ? inner : [own, ...inner];
};

const DECISIONS = new Set([
  'IfStatement',
  'ConditionalExpression',
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
  'CatchClause',
  'LogicalExpression',
  'AssignmentPattern',
]);

const LOGICAL_ASSIGNMENTS = new Set(['&&=', '||=', '??=']);

const isDecision = (node: Node): boolean =>
  DECISIONS.has(node.type) ||
  (node.type === 'SwitchCase' && node.test !== null) ||
  (node.type === 'AssignmentExpression' && LOGICAL_ASSIGNMENTS.has(node.operator)) ||
  ((node.type === 'OptionalMemberExpression' || node.type === 'OptionalCallExpression') &&
    node.optional);

const ownNodes = (node: Node, functions: ReadonlySet<Node>): ReadonlyArray<Node> =>
  childrenOf(node).flatMap(child =>
    functions.has(child) ? [] : [child, ...ownNodes(child, functions)],
  );

export const measureTypeScript = (text: string, path: string): FileMeasures => {
  const { program, tokens } = parse(text, {
    sourceType: 'module',
    plugins: pluginsFor(path),
    tokens: true,
  });
  const code = z
    .array(TokenSchema)
    .parse(tokens)
    .filter(({ type }) => !NOT_CODE.has(type));
  const functions = functionsIn(text, program);
  const bodies = new Set(functions.map(({ fn }) => fn));
  return {
    lines: new Set(code.flatMap(rowsOf)).size,
    functions: functions.map(({ name, fn }) => ({
      name,
      cyclomatic: 1 + ownNodes(fn, bodies).filter(isDecision).length,
      abc: { assignments: 0, branches: 0, conditions: 0 },
    })),
  };
};
