import { join } from 'node:path';
import type { Node } from 'web-tree-sitter';
import type { Graph, GraphNode } from '../../core/graph.ts';
import type { SourceFile } from '../sources-in.ts';
import { parseRuby } from './ruby-syntax.ts';

type Place = {
  readonly layer: string;
  readonly folder: string;
  readonly names: ReadonlyArray<string>;
};

const placeOf = (file: string): Place => {
  const [top = '', layer = '', ...rest] = file.split('/');
  if (top === 'lib') return { layer: top, folder: top, names: [layer, ...rest] };
  const folder = join(top, layer);
  return { layer: layer === 'lib' ? folder : layer, folder, names: rest };
};

const camelized = (name: string): string =>
  name
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');

const constantOf = (names: ReadonlyArray<string>): string =>
  names.map(name => camelized(name.replace(/\.rb$/, ''))).join('::');

const DEFINITIONS = new Set(['class', 'module']);

const GENERATED_BASES = new Set([
  'ApplicationRecord',
  'ApplicationController',
  'ApplicationJob',
  'ApplicationMailer',
]);

const definitionsIn = (node: Node, scope: ReadonlyArray<string>): ReadonlyArray<string> =>
  node.namedChildren.flatMap(child => {
    const name = child.childForFieldName('name');
    if (!DEFINITIONS.has(child.type) || name === null) return [];
    const defined = [...scope, name.text];
    const body = child.childForFieldName('body');
    return [defined.join('::'), ...(body === null ? [] : definitionsIn(body, defined))];
  });

const definedConstant = (program: Node | undefined, names: ReadonlyArray<string>): string => {
  const defined = program === undefined ? [] : definitionsIn(program, []);
  const tails = names.map((_, start) => constantOf(names.slice(start)).toLowerCase());
  const [named] = tails.flatMap(tail =>
    defined.filter(constant => constant.toLowerCase() === tail),
  );
  return named ?? constantOf(names);
};

const isDefinedName = ({ parent, id }: Node): boolean =>
  parent?.childForFieldName('name')?.id === id;

const definitionsAround = (node: Node): ReadonlyArray<Node> => {
  const { parent } = node;
  if (parent === null) return [];
  const around = definitionsAround(parent);
  return DEFINITIONS.has(parent.type) ? [...around, parent] : around;
};

const prefixesOf = (parts: ReadonlyArray<string>): ReadonlyArray<string> =>
  parts.map((_, end) => parts.slice(0, parts.length - end).join('::'));

const scopesOf = (node: Node): ReadonlyArray<string> =>
  prefixesOf(
    definitionsAround(node).map(definition => definition.childForFieldName('name')?.text ?? ''),
  );

type ClassNamed = (candidate: string) => string | undefined;

type Classes = { readonly exactly: ClassNamed; readonly ignoringCase: ClassNamed };

const lookedUp = (
  name: string,
  scopes: ReadonlyArray<string>,
  classNamed: ClassNamed,
): string | undefined =>
  [...scopes.map(scope => `${scope}::`), '']
    .flatMap(scope => prefixesOf(name.split('::')).map(prefix => `${scope}${prefix}`))
    .map(classNamed)
    .find(named => named !== undefined);

const resolved = (node: Node, { exactly }: Classes): string | undefined => {
  const fromTop = node.text.startsWith('::');
  return fromTop
    ? lookedUp(node.text.slice(2), [], exactly)
    : lookedUp(node.text, scopesOf(node), exactly);
};

const SINGULAR_ENDINGS: ReadonlyArray<readonly [RegExp, string]> = [
  [/people$/, 'person'],
  [/ies$/, 'y'],
  [/(ss|x|ch|sh)es$/, '$1'],
  [/s$/, ''],
];

const singular = (plural: string): string => {
  const ending = SINGULAR_ENDINGS.find(([pattern]) => pattern.test(plural));
  return ending === undefined ? plural : plural.replace(...ending);
};

const asWritten = (name: string): string => name;

const ASSOCIATIONS: ReadonlyMap<string, (name: string) => string> = new Map([
  ['has_many', singular],
  ['has_and_belongs_to_many', singular],
  ['has_one', asWritten],
  ['belongs_to', asWritten],
]);

const associated = (call: Node, owner: string, { ignoringCase }: Classes): string | undefined => {
  const inflected = ASSOCIATIONS.get(call.childForFieldName('method')?.text ?? '');
  if (inflected === undefined) return undefined;
  const [name] = call.childForFieldName('arguments')?.namedChildren ?? [];
  const candidate = camelized(inflected((name?.text ?? '').slice(1)));
  return lookedUp(candidate, prefixesOf(owner.split('::')), ignoringCase);
};

const namedBy = (node: Node, owner: string, classes: Classes): string | undefined => {
  if (node.type === 'call') return associated(node, owner, classes);
  if (node.parent?.type === 'scope_resolution' || isDefinedName(node)) return undefined;
  return resolved(node, classes);
};

const classesNamedIn = (
  program: Node | undefined,
  owner: string,
  classes: Classes,
): ReadonlyArray<string> => [
  ...new Set(
    (program?.descendantsOfType(['constant', 'scope_resolution', 'call']) ?? []).flatMap(
      node => namedBy(node, owner, classes) ?? [],
    ),
  ),
];

type RailsGraphOptions = {
  readonly stack: string;
  readonly root: string;
  readonly files: ReadonlyArray<SourceFile>;
};

export const railsGraph = ({ stack, root, files }: RailsGraphOptions): Graph => {
  const classes = files
    .toSorted((a, b) => (a.file < b.file ? -1 : 1))
    .map(({ file, text }) => {
      const { layer, folder, names } = placeOf(file);
      const program = parseRuby(text);
      return { file, layer, folder, program, constant: definedConstant(program, names) };
    })
    .filter(
      ({ constant }, index, all) => all.findIndex(other => other.constant === constant) === index,
    );
  const nodes = new Map(
    classes
      .flatMap(({ file, layer, folder, constant }): ReadonlyArray<GraphNode> => {
        const box: GraphNode = {
          id: `${stack}/layer/${layer}`,
          kind: 'module',
          label: layer,
          parent: stack,
          path: join(root, folder),
        };
        return [
          box,
          {
            id: `${stack}/class/${constant}`,
            kind: 'file',
            label: constant,
            parent: box.id,
            path: join(root, file),
          },
        ];
      })
      .map(node => [node.id, node]),
  );
  const constants = new Set(classes.map(({ constant }) => constant));
  const byLowerCase = new Map(classes.map(({ constant }) => [constant.toLowerCase(), constant]));
  const lookups: Classes = {
    exactly: candidate => (constants.has(candidate) ? candidate : undefined),
    ignoringCase: candidate => byLowerCase.get(candidate.toLowerCase()),
  };
  const edges = classes.flatMap(({ constant, program }) =>
    classesNamedIn(program, constant, lookups)
      .filter(named => named !== constant && !GENERATED_BASES.has(named))
      .map(named => ({ from: `${stack}/class/${constant}`, to: `${stack}/class/${named}` })),
  );
  const stackNode: GraphNode = { id: stack, kind: 'stack', label: stack, path: '' };
  return { nodes: [stackNode, ...nodes.values()], edges };
};
