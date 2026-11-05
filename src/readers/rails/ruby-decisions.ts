import type { Node } from 'web-tree-sitter';
import type { Decision } from '../../core/reader.ts';
import { codeReaderOf } from '../tree-sitter.ts';

type Head = Pick<Decision, 'kind' | 'text' | 'foundByName' | 'subject'>;

type Read = Head & {
  readonly deeper: ReadonlyArray<Node>;
  readonly beside?: ReadonlyArray<Node>;
};

const fieldOf = (node: Node, field: string): Node | undefined =>
  node.childForFieldName(field) ?? undefined;

const statementsOf = (body: Node | undefined): ReadonlyArray<Node> =>
  (body?.namedChildren ?? []).filter(({ type }) => type !== 'comment');

const { codeOf, codeUpTo } = codeReaderOf(new Set(['.', '&.']));

type Walk = { readonly depth: number };

const THROWS = new Set(['raise', 'fail']);

const wordOf = (node: Node): string | undefined => {
  if (node.type === 'identifier') return node.text;
  if (node.type !== 'call' || fieldOf(node, 'receiver') !== undefined) return undefined;
  return fieldOf(node, 'method')?.text;
};

const thrownName = (raised: Node | undefined): string => {
  if (raised === undefined || raised.type === 'string') return '';
  const named = fieldOf(raised, 'method')?.text === 'new' ? fieldOf(raised, 'receiver') : raised;
  return ` ${codeOf(named)}`;
};

const NAMED_EXITS = new Set(['head', 'render', 'redirect_to']);

const THEN_OPERATORS = new Set(['and', '&&']);

const beforeAndReturn = (statement: Node): Node | undefined =>
  THEN_OPERATORS.has(fieldOf(statement, 'operator')?.text ?? '') &&
  fieldOf(statement, 'right')?.type === 'return'
    ? fieldOf(statement, 'left')
    : undefined;

type Exit = Pick<Decision, 'text' | 'foundByName'>;

const namedExitOf = (statement: Node): Exit | undefined => {
  const before = beforeAndReturn(statement);
  const word = wordOf(before ?? statement);
  if (word === undefined || !NAMED_EXITS.has(word)) return undefined;
  return { text: before === undefined ? word : `${word} and return`, foundByName: true };
};

const throwTextOf = (node: Node): string | undefined => {
  const word = wordOf(node);
  if (word === undefined || !THROWS.has(word)) return undefined;
  return `${word}${thrownName(statementsOf(fieldOf(node, 'arguments'))[0])}`;
};

const exitOf = (statement: Node | undefined): Exit | undefined => {
  if (statement === undefined) return undefined;
  if (statement.type === 'return') return { text: 'return' };
  const thrown = throwTextOf(statement);
  return thrown === undefined ? namedExitOf(statement) : { text: thrown };
};

const fieldsOf = (node: Node, ...fields: ReadonlyArray<string>): ReadonlyArray<Node> =>
  fields.flatMap(field => fieldOf(node, field) ?? []);

const conditionOf = (node: Node, word: string): string =>
  `${word} ${codeOf(fieldOf(node, 'condition'))}`;

const ifOf = (text: string, deeper: ReadonlyArray<Node>): Read => ({ kind: 'if', text, deeper });

const guardOr = (branch: Read, statements: ReadonlyArray<Node>): Read => {
  const exit = exitOf(statements[0]);
  return exit === undefined
    ? branch
    : { ...exit, kind: 'guard', text: `${exit.text} ${branch.text}`, deeper: statements.slice(1) };
};

const branchedIf = (node: Node): Read =>
  ifOf(conditionOf(node, node.type), fieldsOf(node, 'consequence', 'alternative'));

const blockIf = (node: Node): Read =>
  fieldOf(node, 'alternative') === undefined
    ? guardOr(branchedIf(node), statementsOf(fieldOf(node, 'consequence')))
    : branchedIf(node);

const modifierIf = (node: Node): Read =>
  guardOr(
    ifOf(conditionOf(node, node.type.replace('_modifier', '')), fieldsOf(node, 'body')),
    fieldsOf(node, 'body'),
  );

const ternaryOf = (node: Node): Read => ({
  kind: 'ternary',
  text: `${codeOf(fieldOf(node, 'condition'))} ?`,
  deeper: fieldsOf(node, 'consequence', 'alternative'),
});

const blockLoop = (node: Node): Read => ({
  kind: 'loop',
  text: codeUpTo(node, fieldOf(node, 'body')),
  deeper: fieldsOf(node, 'body'),
});

const modifierLoop = (node: Node): Read => ({
  kind: 'loop',
  text: conditionOf(node, node.type.replace('_modifier', '')),
  deeper: fieldsOf(node, 'body'),
});

const NAMED_LOOPS = new Set([
  'each',
  'each_with_index',
  'each_slice',
  'find_each',
  'find_in_batches',
  'times',
  'loop',
]);

const namedLoop = (node: Node): Read | undefined => {
  const block = fieldOf(node, 'block');
  const word = fieldOf(node, 'method')?.text;
  if (block === undefined || word === undefined || !NAMED_LOOPS.has(word)) return undefined;
  return {
    kind: 'loop',
    text: `${codeUpTo(node, block)} do`,
    foundByName: true,
    deeper: [block],
    beside: fieldsOf(node, 'receiver', 'arguments'),
  };
};

const clauseOf =
  (kind: Decision['kind']) =>
  (node: Node): Read => {
    const body = fieldOf(node, 'body');
    return { kind, text: codeUpTo(node, body), deeper: body === undefined ? [] : [body] };
  };

const CASES = new Set(['case', 'case_match']);

const caseElse = (node: Node): Read | undefined =>
  CASES.has(node.parent?.type ?? '')
    ? { kind: 'case', text: 'else', deeper: node.namedChildren }
    : undefined;

const LOGICALS = new Set(['&&', '||', 'and', 'or', '||=', '&&=']);

const logicalOf = (node: Node): Read | undefined => {
  const operator = fieldOf(node, 'operator')?.text ?? '';
  if (!LOGICALS.has(operator)) return undefined;
  return {
    kind: 'logical',
    text: `${codeOf(fieldOf(node, 'left'))} ${operator}`,
    deeper: fieldsOf(node, 'right'),
  };
};

const modifierRescue = (node: Node): Read => ({
  kind: 'catch',
  text: `rescue ${codeOf(fieldOf(node, 'handler'))}`,
  deeper: fieldsOf(node, 'handler'),
  beside: fieldsOf(node, 'body'),
});

const returnOf = (node: Node, walk: Walk): Read | undefined =>
  walk.depth > 0 ? { kind: 'return', text: 'return', deeper: node.namedChildren } : undefined;

const throwOf = (node: Node): Read | undefined => {
  const text = throwTextOf(node);
  return text === undefined ? undefined : { kind: 'throw', text, deeper: [] };
};

const READS = new Map<string, (node: Node, walk: Walk) => Read | undefined>([
  ['if', blockIf],
  ['unless', blockIf],
  ['if_modifier', modifierIf],
  ['unless_modifier', modifierIf],
  ['elsif', branchedIf],
  ['conditional', ternaryOf],
  ['while', blockLoop],
  ['until', blockLoop],
  ['for', blockLoop],
  ['while_modifier', modifierLoop],
  ['until_modifier', modifierLoop],
  ['call', node => throwOf(node) ?? namedLoop(node)],
  ['identifier', throwOf],
  ['when', clauseOf('case')],
  ['in_clause', clauseOf('case')],
  ['rescue', clauseOf('catch')],
  ['rescue_modifier', modifierRescue],
  ['return', returnOf],
  ['else', caseElse],
  ['binary', logicalOf],
  ['operator_assignment', logicalOf],
]);

const partsOf = (node: Node): ReadonlyArray<Node> => {
  const method = fieldOf(node, 'method')?.id;
  return node.namedChildren.filter(({ id }) => id !== method);
};

const decisionsUnder = (walk: Walk, nodes: ReadonlyArray<Node>): ReadonlyArray<Decision> =>
  nodes.flatMap(node => {
    const read = READS.get(node.type)?.(node, walk);
    if (read === undefined) return decisionsUnder(walk, partsOf(node));
    const { deeper, beside = [], ...head } = read;
    const depth = node.type === 'elsif' ? walk.depth - 1 : walk.depth;
    return [
      ...decisionsUnder(walk, beside),
      { ...head, depth, line: node.startPosition.row + 1 },
      ...decisionsUnder({ depth: depth + 1 }, deeper),
    ];
  });

export const decisionsOfMethod = (method: Node): ReadonlyArray<Decision> =>
  decisionsUnder({ depth: 0 }, fieldsOf(method, 'body'));

export const decisionsOfBody = (nodes: ReadonlyArray<Node>): ReadonlyArray<Decision> =>
  decisionsUnder({ depth: 0 }, nodes);

const CALLBACKS = /^((prepend|append|skip)_)?(before_\w+|around_action)$/;
const VALIDATIONS = /^validates?$|^validates_\w+$/;

const NAMES_NOTHING = new Set([
  'pair',
  'hash',
  'hash_splat_argument',
  'block_argument',
  'lambda',
  'call',
]);

const subjectOf = (word: string, call: Node): ReadonlyArray<string> => [
  word,
  ...statementsOf(fieldOf(call, 'arguments'))
    .filter(({ type }) => !NAMES_NOTHING.has(type))
    .map(codeOf),
];

const macroOf = (call: Node): Head | undefined => {
  const word = fieldOf(call, 'receiver') === undefined ? fieldOf(call, 'method')?.text : undefined;
  if (word === undefined) return undefined;
  if (word === 'rescue_from')
    return { kind: 'catch', text: codeOf(call), subject: subjectOf(word, call) };
  return CALLBACKS.test(word) || VALIDATIONS.test(word)
    ? { kind: 'guard', text: codeOf(call), foundByName: true, subject: subjectOf(word, call) }
    : undefined;
};

export const decisionsOfClass = (
  definition: Node,
  holes: ReadonlySet<number>,
): ReadonlyArray<Decision> => {
  const under = (node: Node): ReadonlyArray<Decision> => {
    if (holes.has(node.id)) return [];
    const macro = macroOf(node);
    return macro === undefined
      ? node.namedChildren.flatMap(under)
      : [{ ...macro, depth: 0, line: node.startPosition.row + 1 }];
  };
  return fieldsOf(definition, 'body').flatMap(under);
};

const HIDING_CALLS = new Set([
  'define_method',
  'send',
  'public_send',
  'class_eval',
  'instance_eval',
]);

const hidingNameOf = (node: Node): string | undefined => {
  const called = fieldOf(node, 'method')?.text;
  if (called !== undefined && HIDING_CALLS.has(called)) return called;
  return fieldOf(node, 'name')?.text === 'method_missing' ? 'method_missing' : undefined;
};

export const blindSpotsIn = (node: Node): ReadonlyArray<string> => [
  ...new Set(
    node
      .descendantsOfType(['call', 'method', 'singleton_method'])
      .flatMap(each => hidingNameOf(each) ?? []),
  ),
];
