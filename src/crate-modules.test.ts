import { expect, test } from 'vitest';
import { crateModules } from './crate-modules.ts';

const moduleNode = (label: string, path: string) => ({
  id: `rust/mod/app/${label}`,
  kind: 'file',
  label,
  parent: 'rust/crate/app',
  path: `crates/app/src/${path}`,
});

const modulesOf = (sources: Readonly<Record<string, string>>) =>
  crateModules({
    crate: 'app',
    roots: ['crates/app/src/lib.rs'],
    sources: Object.fromEntries(
      Object.entries(sources).map(([path, text]) => [`crates/app/src/${path}`, text]),
    ),
  });

test('each `mod x;` whose file exists is a module, at x.rs or x/mod.rs, a nested one labelled by its path', () => {
  const graph = modulesOf({
    'lib.rs': 'mod a;\npub mod b;\nmod gone;\n',
    'a.rs': 'mod inner;\n',
    'a/inner.rs': '',
    'b/mod.rs': 'mod deep;\n',
    'b/deep.rs': '',
  });

  expect(graph.nodes).toEqual([
    moduleNode('lib.rs', 'lib.rs'),
    moduleNode('a', 'a.rs'),
    moduleNode('a::inner', 'a/inner.rs'),
    moduleNode('b', 'b/mod.rs'),
    moduleNode('b::deep', 'b/deep.rs'),
  ]);
});

test('test modules, inline modules and other items are not drawn', () => {
  const graph = modulesOf({
    'lib.rs': '#[cfg(test)]\nmod tests;\nmod inline {\n    mod nested;\n}\nstruct shape;\n',
    'tests.rs': '',
    'inline.rs': '',
    'inline/nested.rs': '',
    'shape.rs': '',
  });

  expect(graph.nodes).toEqual([moduleNode('lib.rs', 'lib.rs')]);
});

const edgesWith = (file: string, text: string) => {
  const base: Readonly<Record<string, string>> = {
    'lib.rs': 'mod a;\nmod b;\n',
    'a.rs': '',
    'b.rs': 'mod c;\n',
    'b/c.rs': '',
  };
  return modulesOf({ ...base, [file]: `${base[file]}${text}` }).edges.map(
    ({ from, to }) => `${from.replace('rust/mod/app/', '')} -> ${to.replace('rust/mod/app/', '')}`,
  );
};

test.for([
  {
    reason: 'a crate:: path to the module it names',
    file: 'b/c.rs',
    text: 'use crate::a::Thing;\n',
    edges: ['b::c -> a'],
  },
  {
    reason: 'a crate:: path to an item of the root',
    file: 'a.rs',
    text: 'use crate::Thing;\n',
    edges: ['a -> lib.rs'],
  },
  {
    reason: 'super:: to the parent',
    file: 'a.rs',
    text: 'use super::*;\n',
    edges: ['a -> lib.rs'],
  },
  {
    reason: 'super::super:: to the grandparent',
    file: 'b/c.rs',
    text: 'use super::super::a;\n',
    edges: ['b::c -> a'],
  },
  {
    reason: 'self:: to a child',
    file: 'b.rs',
    text: 'use self::c::Thing;\n',
    edges: ['b -> b::c'],
  },
  {
    reason: 'a bare child name to the child',
    file: 'lib.rs',
    text: 'pub use a::Thing;\n',
    edges: ['lib.rs -> a'],
  },
  {
    reason: 'a brace group to each branch',
    file: 'b/c.rs',
    text: 'use crate::{a::One, b::Two as Three};\n',
    edges: ['b::c -> a', 'b::c -> b'],
  },

  {
    reason: 'two uses of one module to one edge',
    file: 'b.rs',
    text: 'use crate::a::One;\nuse crate::a::Two;\n',
    edges: ['b -> a'],
  },
  {
    reason: 'another crate or std to nothing',
    file: 'b.rs',
    text: 'use std::fmt;\nuse a::Thing;\n',
    edges: [],
  },
  {
    reason: 'a leading :: to nothing, since it names another crate',
    file: 'lib.rs',
    text: 'use ::a::Thing;\nuse ::{b};\n',
    edges: [],
  },
  {
    reason: 'a use of its own module to nothing',
    file: 'a.rs',
    text: 'use crate::a::Thing;\n',
    edges: [],
  },
  {
    reason: 'a test-only use to nothing',
    file: 'b.rs',
    text: '#[cfg(test)]\nuse crate::a::Thing;\n',
    edges: [],
  },
])('a use joins modules: $reason', ({ file, text, edges }) => {
  expect(edgesWith(file, text)).toEqual(edges);
});
