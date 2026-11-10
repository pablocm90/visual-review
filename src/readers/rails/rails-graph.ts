import { join, matchesGlob } from 'node:path';
import type { Node } from 'web-tree-sitter';
import type { Graph, GraphNode } from '../../core/graph.ts';
import type { SourceFile } from '../sources-in.ts';
import { singular } from './inflection.ts';
import { readRuby } from './ruby-syntax.ts';

const namesOf = (file: string): ReadonlyArray<string> => {
  const [top = '', layer = '', ...rest] = file.split('/');
  return top === 'lib' ? [layer, ...rest] : rest;
};

const LAYERS = ['app/*', 'lib'];

const boxOf = (file: string, boxes: ReadonlyArray<string>): string => {
  const parts = file.split('/').slice(0, -1);
  const folders = parts.map((_, index) => parts.slice(0, index + 1).join('/'));
  const globs = [...LAYERS, ...boxes];
  return folders.findLast(folder => globs.some(glob => matchesGlob(folder, glob))) ?? '';
};

const labelOf = (box: string): string => box.replace(/^app\/(?!lib(\/|$))/, '');

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

const definedConstant = (program: Node, names: ReadonlyArray<string>): string => {
  const defined = definitionsIn(program, []);
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

export const scopesOf = (node: Node): ReadonlyArray<string> =>
  prefixesOf(
    definitionsAround(node).map(definition => definition.childForFieldName('name')?.text ?? ''),
  );

type ClassNamed = (candidate: string) => string | undefined;

type Classes = { readonly exactly: ClassNamed; readonly ignoringCase: ClassNamed };

export type Wanted = {
  readonly name: string;
  readonly scopes: ReadonlyArray<string>;
  readonly ignoringCase: boolean;
};

export const lookedUp = (
  { name, scopes, ignoringCase }: Wanted,
  classes: Classes,
): string | undefined =>
  [...scopes.map(scope => `${scope}::`), '']
    .flatMap(scope => prefixesOf(name.split('::')).map(prefix => `${scope}${prefix}`))
    .map(ignoringCase ? classes.ignoringCase : classes.exactly)
    .find(named => named !== undefined);

export const written = (node: Node): Wanted =>
  node.text.startsWith('::')
    ? { name: node.text.slice(2), scopes: [], ignoringCase: false }
    : { name: node.text, scopes: scopesOf(node), ignoringCase: false };

const asWritten = (name: string): string => name;

const ASSOCIATIONS: ReadonlyMap<string, (name: string) => string> = new Map([
  ['has_many', singular],
  ['has_and_belongs_to_many', singular],
  ['has_one', asWritten],
  ['belongs_to', asWritten],
]);

const optionsOf = (args: ReadonlyArray<Node>): ReadonlyMap<string, string> =>
  new Map(
    args.map(arg => [
      arg.childForFieldName('key')?.text ?? '',
      arg.childForFieldName('value')?.text ?? '',
    ]),
  );

const associated = (call: Node, owner: string): Wanted | undefined => {
  const inflected = ASSOCIATIONS.get(call.childForFieldName('method')?.text ?? '');
  if (inflected === undefined) return undefined;
  const [name, ...rest] = call.childForFieldName('arguments')?.namedChildren ?? [];
  const options = optionsOf(rest);
  if (options.get('polymorphic') === 'true') return undefined;
  const scopes = prefixesOf(owner.split('::'));
  const className = options.get('class_name') ?? options.get('source_type');
  if (className !== undefined) return { name: className.slice(1, -1), scopes, ignoringCase: true };
  const source = options.get('source');
  const named =
    source === undefined ? inflected((name?.text ?? '').slice(1)) : singular(source.slice(1));
  return { name: camelized(named), scopes, ignoringCase: true };
};

const wantedBy = (node: Node, owner: string): Wanted | undefined => {
  if (node.type === 'call') return associated(node, owner);
  if (node.parent?.type === 'scope_resolution' || isDefinedName(node)) return undefined;
  return written(node);
};

export const namingsIn = (
  program: Node,
  owner: string,
  classes: Classes,
): ReadonlyArray<{ readonly at: Node; readonly named: string }> =>
  program.descendantsOfType(['constant', 'scope_resolution', 'call']).flatMap(at => {
    const wanted = wantedBy(at, owner);
    const named = wanted === undefined ? undefined : lookedUp(wanted, classes);
    return named === undefined ? [] : [{ at, named }];
  });

const wantedIn = (program: Node, owner: string): ReadonlyArray<Wanted> =>
  program
    .descendantsOfType(['constant', 'scope_resolution', 'call'])
    .flatMap(at => wantedBy(at, owner) ?? []);

export const classesOf = (all: ReadonlyArray<string>): Classes => {
  const constants = new Set(all);
  const byLowerCase = new Map(all.map(constant => [constant.toLowerCase(), constant]));
  return {
    exactly: candidate => (constants.has(candidate) ? candidate : undefined),
    ignoringCase: candidate => byLowerCase.get(candidate.toLowerCase()),
  };
};

type RailsGraphOptions = {
  readonly stack: string;
  readonly root: string;
  readonly boxes: ReadonlyArray<string>;
  readonly files: ReadonlyArray<SourceFile>;
};

export const railsGraph = ({ stack, root, boxes, files }: RailsGraphOptions): Graph => {
  const classes = files
    .toSorted((a, b) => (a.file < b.file ? -1 : 1))
    .map(({ file, text }) => {
      const names = namesOf(file);
      return {
        file,
        folder: boxOf(file, boxes),
        ...readRuby(text, program => {
          const constant = definedConstant(program, names);
          return { constant, wanted: wantedIn(program, constant) };
        }),
      };
    })
    .filter(
      ({ constant }, index, all) => all.findIndex(other => other.constant === constant) === index,
    );
  const nodes = new Map(
    classes
      .flatMap(({ file, folder, constant }): ReadonlyArray<GraphNode> => {
        const label = labelOf(folder);
        const box: GraphNode = {
          id: `${stack}/layer/${label}`,
          kind: 'module',
          label,
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
  const lookups = classesOf(classes.map(({ constant }) => constant));
  const edges = classes.flatMap(({ constant, wanted }) =>
    [...new Set(wanted.flatMap(asked => lookedUp(asked, lookups) ?? []))]
      .filter(named => named !== constant && !GENERATED_BASES.has(named))
      .map(named => ({ from: `${stack}/class/${constant}`, to: `${stack}/class/${named}` })),
  );
  const stackNode: GraphNode = { id: stack, kind: 'stack', label: stack, path: '' };
  return { nodes: [stackNode, ...nodes.values()], edges };
};
