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

const TYPESCRIPT: Array<ParserPlugin> = [
  'typescript',
  'decorators-legacy',
  'decoratorAutoAccessors',
];

const pluginsFor = (path: string): Array<ParserPlugin> => {
  if (path.endsWith('.tsx')) return [...TYPESCRIPT, 'jsx'];
  return /\.[cm]?ts$/.test(path) ? TYPESCRIPT : ['jsx'];
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

const unwrapped = (node: Node): Node =>
  node.type === 'TSAsExpression' ||
  node.type === 'TSSatisfiesExpression' ||
  node.type === 'TSNonNullExpression' ||
  node.type === 'TSTypeAssertion'
    ? unwrapped(node.expression)
    : node;

const functionValue = (value: Node | null | undefined): Node | undefined => {
  const node = value ? unwrapped(value) : undefined;
  return node?.type === 'ArrowFunctionExpression' || node?.type === 'FunctionExpression'
    ? node
    : undefined;
};

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
    case 'AssignmentExpression':
      return assigned(text, node.left, node.right);
    case 'ClassProperty':
    case 'ClassPrivateProperty':
    case 'ObjectProperty':
      return assigned(text, node.key, node.value);
    default:
      return undefined;
  }
};

const holderOf = (text: string, node: Node): string | undefined => {
  if (node.type === 'VariableDeclarator') return sourceOf(text, node.id);
  if (node.type === 'AssignmentExpression') return sourceOf(text, node.left);
  return node.type === 'ExportDefaultDeclaration' ? 'default' : undefined;
};

type Scope = { readonly inFunction: boolean; readonly holder: string | undefined };

const heldFunction = (node: Node, holder: string | undefined): OwnFunction | undefined =>
  holder === undefined || functionValue(node) === undefined
    ? undefined
    : { name: holder, fn: node };

const functionsIn = (text: string, node: Node, scope: Scope): ReadonlyArray<OwnFunction> => {
  const own = ownFunction(text, node) ?? heldFunction(node, scope.holder);
  const inner = childrenOf(node).flatMap(child =>
    functionsIn(
      text,
      child,
      own !== undefined || scope.inFunction
        ? { inFunction: true, holder: undefined }
        : { inFunction: false, holder: holderOf(text, node) ?? scope.holder },
    ),
  );
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

const isOptionalLink = (node: Node): boolean =>
  (node.type === 'OptionalMemberExpression' || node.type === 'OptionalCallExpression') &&
  node.optional;

const isCase = (node: Node): boolean => node.type === 'SwitchCase' && node.test !== null;

const isDecision = (node: Node): boolean =>
  DECISIONS.has(node.type) ||
  isCase(node) ||
  (node.type === 'AssignmentExpression' && LOGICAL_ASSIGNMENTS.has(node.operator)) ||
  isOptionalLink(node);

const isAssignment = (node: Node): boolean =>
  node.type === 'AssignmentExpression' ||
  node.type === 'UpdateExpression' ||
  (node.type === 'VariableDeclarator' && node.init !== null);

const CALLS = new Set(['CallExpression', 'OptionalCallExpression', 'NewExpression']);

const COMPARISONS = new Set(['==', '!=', '===', '!==', '<', '>', '<=', '>=']);

const CONDITIONS = new Set(['CatchClause', 'ConditionalExpression', 'SwitchCase']);

const isCondition = (node: Node): boolean =>
  CONDITIONS.has(node.type) ||
  isOptionalLink(node) ||
  (node.type === 'IfStatement' && node.alternate !== null) ||
  (node.type === 'BinaryExpression' && COMPARISONS.has(node.operator));

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
  const functions = functionsIn(text, program, { inFunction: false, holder: undefined });
  const bodies = new Set(functions.map(({ fn }) => fn));
  return {
    lines: new Set(code.flatMap(rowsOf)).size,
    functions: functions.map(({ name, fn }) => {
      const nodes = ownNodes(fn, bodies);
      return {
        name,
        cyclomatic: 1 + nodes.filter(isDecision).length,
        abc: {
          assignments: nodes.filter(isAssignment).length,
          branches: nodes.filter(node => CALLS.has(node.type)).length,
          conditions: nodes.filter(isCondition).length,
        },
      };
    }),
  };
};
