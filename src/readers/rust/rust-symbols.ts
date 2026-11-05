import type { Node } from 'web-tree-sitter';
import type { FileSymbols, ReadSymbol } from '../../core/reader.ts';
import { isTooBig, TOO_BIG } from '../too-big.ts';
import { hashesOf, hashOf, isComment, ownText, shapeOf } from '../tree-sitter.ts';
import { attributesOf, isDocText, isTestItem, parseRust, pathOf } from './rust-syntax.ts';

const textOf = (node: Node | null | undefined): string => node?.text ?? '';

const nameOf = (item: Node): string => textOf(item.childForFieldName('name'));

const isExactlyPub = (item: Node): boolean => item.namedChildren[0]?.text === 'pub';

const collapsed = (text: string): string => text.replace(/\s+/g, ' ');

const writtenIn = (list: Node | null): string =>
  (list?.namedChildren ?? [])
    .filter(child => !isComment(child))
    .map(({ text }) => collapsed(text))
    .join(', ');

const childOfType = (item: Node, wanted: string): Node | null =>
  item.namedChildren.find(({ type }) => type === wanted) ?? null;

const signedPartsOf = (item: Node) => ({
  modifiers: childOfType(item, 'function_modifiers'),
  generics: item.childForFieldName('type_parameters'),
  parameters: item.childForFieldName('parameters'),
  returned: item.childForFieldName('return_type'),
  bounds: childOfType(item, 'where_clause'),
});

const cfgsOf = (item: Node): ReadonlyArray<Node> =>
  attributesOf(item).filter(attribute => pathOf(attribute) === 'cfg');

const writtenAttributesOf = (item: Node): ReadonlyArray<Node> =>
  attributesOf(item).filter(attribute => !isDocText(attribute));

const signatureOf = (item: Node): string => {
  const { modifiers, generics, parameters, returned, bounds } = signedPartsOf(item);
  return [
    ...cfgsOf(item).map(({ text }) => collapsed(text)),
    ...(modifiers === null ? [] : [modifiers.text]),
    `${generics === null ? '' : `<${writtenIn(generics)}>`}(${writtenIn(parameters)})`,
    ...(returned === null ? [] : [`-> ${collapsed(returned.text)}`]),
    ...(bounds === null ? [] : [`where ${writtenIn(bounds)}`]),
  ].join(' ');
};

const writtenWhole = (item: Node): string =>
  [...attributesOf(item), item].map(({ text }) => text).join('\n');

const present = (nodes: ReadonlyArray<Node | null>): ReadonlyArray<Node> =>
  nodes.filter(node => node !== null);

const functionSymbol = (item: Node): ReadSymbol => ({
  name: nameOf(item),
  kind: 'function',
  exported: isExactlyPub(item),
  signature: signatureOf(item),
  ...hashesOf({
    signed: [...cfgsOf(item), ...present(Object.values(signedPartsOf(item)))],
    body: [
      ...writtenAttributesOf(item),
      ...present([childOfType(item, 'visibility_modifier'), item.childForFieldName('body')]),
    ],
    text: writtenWhole(item),
  }),
});

const FUNCTIONS: ReadonlySet<string> = new Set(['function_item', 'function_signature_item']);

const codeIn = (item: Node): ReadonlyArray<Node> =>
  (item.childForFieldName('body')?.namedChildren ?? []).filter(member => !isTestItem(member));

const functionsIn = (item: Node): ReadonlyArray<ReadSymbol> =>
  codeIn(item)
    .filter(({ type }) => FUNCTIONS.has(type))
    .map(functionSymbol);

const typeOfImpl = (item: Node): string => {
  const type = item.childForFieldName('type');
  return (type?.childForFieldName('type') ?? type)?.text ?? '';
};

const isPubBeside = (item: Node, name: string): boolean =>
  (item.parent?.namedChildren ?? []).some(
    sibling => nameOf(sibling) === name && isExactlyPub(sibling),
  );

const methodsOfImpl = (item: Node): ReadonlyArray<ReadSymbol> => {
  const type = typeOfImpl(item);
  const trait = item.childForFieldName('trait');
  const place =
    trait === null
      ? { scope: type }
      : { scope: collapsed(`${type} as ${trait.text}`), exported: isPubBeside(item, type) };
  return functionsIn(item).map(method => ({ ...method, kind: 'method', ...place }));
};

const methodsOfTrait = (item: Node): ReadonlyArray<ReadSymbol> =>
  functionsIn(item).map(method => ({
    ...method,
    kind: 'method',
    scope: nameOf(item),
    exported: isExactlyPub(item),
  }));

const typeNamed = (item: Node): Pick<ReadSymbol, 'name' | 'kind' | 'exported'> => ({
  name: nameOf(item),
  kind: 'type',
  exported: isExactlyPub(item),
});

const signedPartsOfMember = (member: Node): ReadonlyArray<Node> =>
  FUNCTIONS.has(member.type)
    ? present([member.childForFieldName('name'), ...Object.values(signedPartsOf(member))])
    : [member];

const idsOf = (nodes: ReadonlyArray<Node | null>): ReadonlySet<number> =>
  new Set(present(nodes).map(({ id }) => id));

const commentsIn = (item: Node): ReadonlyArray<Node> =>
  item.descendantsOfType(['line_comment', 'block_comment']);

const saidOnOneLine = (attributes: ReadonlyArray<Node>, own: string): string =>
  collapsed([...attributes.map(({ text }) => text), own.trim()].join(' ')).replace(/\s+;/g, ';');

const traitSymbol = (item: Node): ReadSymbol => {
  const attributes = attributesOf(item);
  const written = writtenAttributesOf(item);
  const members = item.childForFieldName('body')?.namedChildren ?? [];
  const defaults = idsOf(
    members.filter(({ type }) => FUNCTIONS.has(type)).map(m => m.childForFieldName('body')),
  );
  const unsaid = new Set([
    ...defaults,
    ...idsOf([childOfType(item, 'visibility_modifier')]),
    ...idsOf(commentsIn(item)),
  ]);
  const own = ownText(item, unsaid, ({ id }) => (defaults.has(id) ? ';' : ''));
  return {
    ...typeNamed(item),
    signature: saidOnOneLine(written, own),
    ...hashesOf({
      signed: [
        ...written,
        ...present([
          item.childForFieldName('type_parameters'),
          item.childForFieldName('bounds'),
          childOfType(item, 'where_clause'),
        ]),
        ...members
          .filter(member => !isComment(member) && !isDocText(member))
          .flatMap(signedPartsOfMember),
      ],
      body: present([childOfType(item, 'visibility_modifier')]),
      text: [...attributes.map(({ text }) => text), ownText(item, defaults)].join('\n'),
    }),
  };
};

const isPubField = (field: Node): boolean =>
  isExactlyPub(field) || field.previousNamedSibling?.text === 'pub';

const pubFieldsOf = (fields: Node | null): ReadonlyArray<Node> =>
  (fields?.namedChildren ?? []).filter(isPubField);

const pubFieldsWritten = (fields: Node | null): string => {
  const written = pubFieldsOf(fields).map(({ text }) => collapsed(text));
  if (written.length === 0) return '';
  return fields?.type === 'field_declaration_list'
    ? ` { ${written.join(', ')} }`
    : `(${written.map(type => `pub ${type}`).join(', ')})`;
};

const keywordOf = (item: Node): Node | null =>
  item.children.find(({ isNamed }) => !isNamed) ?? null;

const structSignature = (item: Node): string => {
  const generics = item.childForFieldName('type_parameters');
  const fields = item.childForFieldName('body');
  const bounds = childOfType(item, 'where_clause');
  const opener = `${keywordOf(item)?.text} ${nameOf(item)}${generics === null ? '' : `<${writtenIn(generics)}>`}`;
  const where = bounds === null ? '' : ` where ${writtenIn(bounds)}`;
  const written = pubFieldsWritten(fields);
  return [
    ...writtenAttributesOf(item).map(({ text }) => collapsed(text)),
    fields?.type === 'ordered_field_declaration_list'
      ? `${opener}${written}${where}`
      : `${opener}${where}${written}`,
  ].join(' ');
};

const structSymbol = (item: Node): ReadSymbol => {
  const fields = item.childForFieldName('body');
  return {
    ...typeNamed(item),
    signature: structSignature(item),
    ...hashesOf({
      signed: [
        ...writtenAttributesOf(item),
        ...present([
          keywordOf(item),
          item.childForFieldName('type_parameters'),
          childOfType(item, 'where_clause'),
        ]),
        ...pubFieldsOf(fields),
      ],
      body: [
        ...present([childOfType(item, 'visibility_modifier'), fields?.firstChild ?? null]),
        ...(fields?.namedChildren ?? []).filter(field => !isComment(field) && !isDocText(field)),
      ],
      text: writtenWhole(item),
    }),
  };
};

const wholeTypeSymbol = (item: Node): ReadSymbol => {
  const visibility = present([childOfType(item, 'visibility_modifier')]);
  const written = writtenAttributesOf(item);
  const body = item.childForFieldName('body');
  const members = body?.namedChildren ?? [];
  const left = idsOf([item.childForFieldName('name'), body, ...visibility]);
  const said = ownText(
    item,
    idsOf([...visibility, ...members.filter(isDocText), ...commentsIn(item)]),
  );
  return {
    ...typeNamed(item),
    signature: saidOnOneLine(written, said),
    ...hashesOf({
      signed: [
        ...written,
        ...item.children.filter(child => !left.has(child.id) && !isComment(child)),
        ...members.filter(member => !isComment(member) && !isDocText(member)),
      ],
      body: visibility,
      text: writtenWhole(item),
    }),
  };
};

const WHOLE_TYPES: ReadonlySet<string> = new Set(['enum_item', 'type_item']);

const joined = (path: string, part: string): string => (path === '' ? part : `${path}::${part}`);

const insideMod =
  (mod: Node) =>
  (symbol: ReadSymbol): ReadSymbol => {
    const name = nameOf(mod);
    const exported = symbol.exported && isExactlyPub(mod);
    return symbol.scope === undefined
      ? { ...symbol, exported, name: joined(name, symbol.name) }
      : { ...symbol, exported, scope: joined(name, symbol.scope) };
  };

const symbolsOfMod = (item: Node): ReadonlyArray<ReadSymbol> =>
  codeIn(item).flatMap(symbolsOfItem).map(insideMod(item));

const symbolsOfItem = (item: Node): ReadonlyArray<ReadSymbol> => {
  if (item.type === 'mod_item') return symbolsOfMod(item);
  if (item.type === 'function_item') return [functionSymbol(item)];
  if (item.type === 'struct_item' || item.type === 'union_item') return [structSymbol(item)];
  if (WHOLE_TYPES.has(item.type)) return [wholeTypeSymbol(item)];
  if (item.type === 'trait_item') return [traitSymbol(item), ...methodsOfTrait(item)];
  return item.type === 'impl_item' ? methodsOfImpl(item) : [];
};

const namesUsedIn = (node: Node, path: string): ReadonlyArray<string> => {
  if (isComment(node)) return [];
  if (node.type === 'use_wildcard')
    return [`* from ${joined(path, node.namedChildren[0]?.text ?? '')}`];
  if (node.type === 'use_as_clause') return [node.childForFieldName('alias')?.text ?? ''];
  if (node.type === 'self') return [path.split('::').at(-1) ?? ''];
  if (node.type === 'use_list')
    return node.namedChildren.flatMap(child => namesUsedIn(child, path));
  const list = node.childForFieldName('list');
  if (list !== null)
    return namesUsedIn(list, joined(path, node.childForFieldName('path')?.text ?? ''));
  return [(node.childForFieldName('name') ?? node).text];
};

const namesInMod = (item: Node): ReadonlyArray<string> =>
  item.type === 'mod_item'
    ? codeIn(item)
        .flatMap(namesExportedBy)
        .map(name => joined(nameOf(item), name))
    : [];

const namesExportedBy = (item: Node): ReadonlyArray<string> => {
  if (!isExactlyPub(item)) return [];
  const argument = item.childForFieldName('argument');
  if (argument !== null) return namesUsedIn(argument, '');
  return [
    ...present([item.childForFieldName('alias') ?? item.childForFieldName('name')]).map(
      ({ text }) => text,
    ),
    ...namesInMod(item),
  ];
};

export const symbolsOfRust = (text: string): FileSymbols => {
  if (isTooBig(text)) throw new Error(TOO_BIG);
  const root = parseRust(text);
  if (root === undefined || root.hasError) throw new Error('Rust that does not parse');
  const items = root.namedChildren.filter(item => !isTestItem(item));
  return {
    symbols: items.flatMap(symbolsOfItem),
    exports: items.flatMap(namesExportedBy),
    astHash: hashOf(shapeOf(root)),
  };
};
