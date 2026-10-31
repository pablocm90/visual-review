import { type ParserPlugin, parse } from '@babel/parser';
import type { Node } from '@babel/types';
import type { FileMeasures } from '../../core/reader.ts';

type Row = { readonly line: number };

type Token = {
  readonly type: string | { readonly label: string };
  readonly loc: { readonly start: Row; readonly end: Row };
};

const isRow = (value: unknown): value is Row =>
  typeof value === 'object' && value !== null && 'line' in value && typeof value.line === 'number';

const isLabel = (value: unknown): value is { readonly label: string } =>
  typeof value === 'object' &&
  value !== null &&
  'label' in value &&
  typeof value.label === 'string';

const isToken = (value: unknown): value is Token =>
  typeof value === 'object' &&
  value !== null &&
  'type' in value &&
  (typeof value.type === 'string' || isLabel(value.type)) &&
  'loc' in value &&
  typeof value.loc === 'object' &&
  value.loc !== null &&
  'start' in value.loc &&
  isRow(value.loc.start) &&
  'end' in value.loc &&
  isRow(value.loc.end);

const NOT_CODE = new Set(['CommentLine', 'CommentBlock', 'eof']);

const isCode = ({ type }: Token): boolean =>
  !NOT_CODE.has(typeof type === 'string' ? type : type.label);

const rowsOf = ({ loc: { start, end } }: Token): ReadonlyArray<number> =>
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

const MOST_CHARACTERS = 262_144;

const LONGEST_LINE = 1000;

const isTooBig = (text: string): boolean =>
  text.length > MOST_CHARACTERS || text.split('\n').some(line => line.length > LONGEST_LINE);

export const measureTypeScript = (text: string, path: string): FileMeasures | undefined => {
  if (isTooBig(text)) return undefined;
  const { program, tokens } = parse(text, {
    sourceType: 'module',
    plugins: pluginsFor(path),
    tokens: true,
  });
  const tokenList: ReadonlyArray<unknown> = tokens ?? [];
  const code = tokenList.filter(isToken).filter(isCode);
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
