import { expect, test } from 'vitest';
import type { FileSymbols } from '../../core/reader.ts';
import { symbolChanges } from '../../core/symbol-changes.ts';
import { rustReader } from './reader.ts';

const source = (...lines: ReadonlyArray<string>) => lines.join('\n');

const read = (...lines: ReadonlyArray<string>): FileSymbols => {
  const file = rustReader.symbols?.(source(...lines), 'src/shop.rs');
  if (file === undefined) throw new Error('read no symbols');
  return file;
};

const methodsIn = ({ symbols }: FileSymbols) => symbols.filter(({ kind }) => kind === 'method');

test.for([
  { written: 'pub fn open() {}', exported: true },
  { written: 'fn open() {}', exported: false },
  { written: 'pub(crate) fn open() {}', exported: false },
  { written: 'pub(super) fn open() {}', exported: false },
  { written: 'pub(in crate::a) fn open() {}', exported: false },
])('$written is a function, exported: $exported', ({ written, exported }) => {
  expect(read(written).symbols).toMatchObject([{ kind: 'function', name: 'open', exported }]);
});

test('a const, a static, a mod and a use read no symbol', () => {
  expect(
    read(
      'pub const A: u8 = 1;',
      'pub static B: u8 = 1;',
      'pub mod c;',
      'mod d {\n  fn e() {}\n}',
      'pub use f::g;',
    ).symbols,
  ).toEqual([]);
});

test("an impl's const and type read no symbol", () => {
  expect(read('impl Foo {\n  const A: u8 = 1;\n  type B = u8;\n}').symbols).toEqual([]);
});

test('a file that does not parse throws, and so does one too big to read', () => {
  expect(() => read('pub fn open( {')).toThrow('parse');
  expect(() => read(`// ${'x'.repeat(1001)}`)).toThrow('too big');
});

test.for([
  { written: 'fn open() {}', signature: '()' },
  {
    written:
      'pub async unsafe extern "C" fn open<T: Clone, U>(mut x: T, y: &str) -> u32 where T: Send, U: Copy, {}',
    signature:
      'async unsafe extern "C" <T: Clone, U>(mut x: T, y: &str) -> u32 where T: Send, U: Copy',
  },
  {
    written:
      'fn open<\n  T,\n>(\n  // the amount\n  x: T,\n) -> Result<\n  u8,\n  E,\n>\nwhere\n  T: Send,\n{}',
    signature: '<T>(x: T) -> Result< u8, E, > where T: Send',
  },
  {
    written: '#[inline]\n#[cfg(unix)]\n/// why\n#[cfg(feature = "a")]\nasync fn open(x: u8) {}',
    signature: '#[cfg(unix)] #[cfg(feature = "a")] async (x: u8)',
  },
  {
    written: '#[cfg(any(\n  unix,\n  windows,\n))]\nfn open() {}',
    signature: '#[cfg(any( unix, windows, ))] ()',
  },
])('$written reads the signature $signature', ({ written, signature }) => {
  expect(read(written).symbols).toMatchObject([{ signature }]);
});

test.for([
  { edit: 'a comment in the body', before: 'fn a() { b(); }', after: 'fn a() { /* why */ b(); }' },
  {
    edit: 'a comment in the parameters',
    before: 'fn a(x: u8) {}',
    after: 'fn a(/* why */ x: u8) {}',
  },
  { edit: 'a line comment', before: 'fn a() { b(); }', after: 'fn a() {\n  // why\n  b();\n}' },
  { edit: 'a doc attribute', before: 'fn a() {}', after: '#[doc = "why"]\nfn a() {}' },
  { edit: 'spacing', before: 'fn a(x: u8) { b(); }', after: 'fn a( x:u8 ) {\n  b();\n}' },
  { edit: 'a last comma before )', before: 'fn a(x: u8) {}', after: 'fn a(\n  x: u8,\n) {}' },
  { edit: 'a last comma before >', before: 'fn a<T>() {}', after: 'fn a<\n  T,\n>() {}' },
  { edit: 'a last comma before ]', before: 'fn a() { [1, 2]; }', after: 'fn a() { [1, 2,]; }' },
  { edit: 'a last comma before }', before: 'fn a() { B { c }; }', after: 'fn a() { B { c, }; }' },
  {
    edit: 'a where ending in a comma',
    before: 'fn a() where B: C {}',
    after: 'fn a() where B: C, {}',
  },
  {
    edit: 'a comma after a last match arm',
    before: 'fn a() { match b { c => d } }',
    after: 'fn a() { match b { c => d, } }',
  },
  {
    edit: 'a last comma before a comment',
    before: 'fn a(x: u8) {}',
    after: 'fn a(\n  x: u8, // why\n) {}',
  },
  {
    edit: 'a last comma in a tuple of two',
    before: 'fn a() { (b, c); }',
    after: 'fn a() { (b, c,); }',
  },
])('$edit reads as formatting', ({ before, after }) => {
  expect(symbolChanges({ before: read(before), after: read(after) }).symbols).toMatchObject([
    { change: 'formatting' },
  ]);
});

test.for([
  { edit: 'the body', before: 'fn a() { b(); }', after: 'fn a() { c(); }' },
  { edit: 'an attribute', before: 'fn a() {}', after: '#[inline]\nfn a() {}' },
  { edit: 'doc(hidden)', before: 'fn a() {}', after: '#[doc(hidden)]\nfn a() {}' },
  {
    edit: 'an attribute with a value',
    before: 'fn a() {}',
    after: '#[deprecated = "old"]\nfn a() {}',
  },
  { edit: 'the visibility', before: 'pub(crate) fn a() {}', after: 'pub(super) fn a() {}' },
  {
    edit: 'a comma that sits between',
    before: 'fn a() { b!(c, d); }',
    after: 'fn a() { b!(c d); }',
  },
])('a change to $edit reads as edited, with the signature as it was', ({ before, after }) => {
  const [change] = symbolChanges({ before: read(before), after: read(after) }).symbols;
  expect(change).toMatchObject({ change: 'edited' });
  expect(change).not.toHaveProperty('signature');
});

test.for([
  { edit: 'a qualifier', before: 'fn a() {}', after: 'async fn a() {}' },
  { edit: 'the generics', before: 'fn a<T>() {}', after: 'fn a<U>() {}' },
  { edit: 'a parameter', before: 'fn a(x: u8) {}', after: 'fn a(x: u16) {}' },
  { edit: 'the return', before: 'fn a() -> u8 {}', after: 'fn a() -> u16 {}' },
  { edit: 'the where', before: 'fn a<T>() where T: B {}', after: 'fn a<T>() where T: C {}' },
  {
    edit: 'a tuple of one to a bare type',
    before: 'fn a() -> (u8,) {}',
    after: 'fn a() -> (u8) {}',
  },
  { edit: 'a cfg', before: '#[cfg(unix)]\nfn a() {}', after: '#[cfg(windows)]\nfn a() {}' },
])('a change to $edit reads as a changed signature', ({ before, after }) => {
  const [change] = symbolChanges({ before: read(before), after: read(after) }).symbols;
  expect(change).toMatchObject({ change: 'edited', signature: expect.anything() });
});

test('a function under another name reads as renamed', () => {
  expect(
    symbolChanges({ before: read('fn a() { b(); }'), after: read('fn c() { b(); }') }).symbols,
  ).toMatchObject([{ name: 'c', change: 'renamed', renamedFrom: 'a' }]);
});

test.for([
  { written: 'pub fn open(&self) {}', exported: true },
  { written: 'fn open(&self) {}', exported: false },
  { written: 'pub(crate) fn open(&self) {}', exported: false },
])('$written in an impl is a method of the type, exported: $exported', ({ written, exported }) => {
  expect(read(`pub struct Foo;\nimpl Foo {\n  ${written}\n}`).symbols).toContainEqual(
    expect.objectContaining({
      kind: 'method',
      scope: 'Foo',
      name: 'open',
      exported,
      signature: '(&self)',
    }),
  );
});

test.for([
  { impl: 'impl<T> Foo<T>', scope: 'Foo' },
  { impl: 'impl a::Foo', scope: 'a::Foo' },
  { impl: 'impl<T> a::Foo<T>', scope: 'a::Foo' },
])('$impl scopes its methods to $scope, with no generics', ({ impl, scope }) => {
  expect(read(`${impl} {\n  fn open() {}\n}`).symbols).toMatchObject([{ scope, name: 'open' }]);
});

test('a method changed in an impl reads as edited, its scope kept', () => {
  expect(
    symbolChanges({
      before: read('impl Foo {\n  fn a() { b(); }\n}'),
      after: read('impl Foo {\n  fn a() { c(); }\n}'),
    }).symbols,
  ).toMatchObject([{ scope: 'Foo', name: 'a', kind: 'method', change: 'edited' }]);
});

test.for([
  { impl: 'impl Tr for Foo', scope: 'Foo as Tr' },
  { impl: 'impl<T> Tr<T> for Foo<T>', scope: 'Foo as Tr<T>' },
  { impl: 'impl From<A> for a::Foo', scope: 'a::Foo as From<A>' },
  { impl: 'impl Tr<\n  A,\n> for (\n  B,\n  C,\n)', scope: '( B, C, ) as Tr< A, >' },
])('$impl scopes its methods to $scope', ({ impl, scope }) => {
  expect(read(`${impl} {\n  fn open() {}\n}`).symbols).toMatchObject([
    { kind: 'method', scope, name: 'open' },
  ]);
});

test.for([
  { type: 'pub struct Foo;', exported: true },
  { type: 'pub struct Foo<T>(T);', exported: true },
  { type: 'struct Foo;', exported: false },
  { type: 'pub(crate) struct Foo;', exported: false },
  { type: 'pub struct Bar;', exported: false },
])('a trait method on Foo beside $type has exported: $exported', ({ type, exported }) => {
  expect(methodsIn(read(type, 'impl Tr for Foo<u8> {\n  fn open() {}\n}'))).toMatchObject([
    { name: 'open', exported },
  ]);
});

test('a type with both Display and Debug has each fmt read, and changed, apart', () => {
  const impls = (debug: string) =>
    read(
      'impl fmt::Display for Foo {\n  fn fmt() { a(); }\n}',
      `impl fmt::Debug for Foo {\n  fn fmt() { ${debug}; }\n}`,
    );
  expect(symbolChanges({ before: impls('b()'), after: impls('c()') }).symbols).toMatchObject([
    { scope: 'Foo as fmt::Display', name: 'fmt', change: 'unchanged' },
    { scope: 'Foo as fmt::Debug', name: 'fmt', change: 'edited' },
  ]);
});

test.for([
  { trait: 'pub trait Tr', exported: true },
  { trait: 'trait Tr', exported: false },
  { trait: 'pub(crate) trait Tr', exported: false },
  { trait: 'pub trait Tr<T>: Send', exported: true },
])('$trait has its methods scoped to its name, exported: $exported', ({ trait, exported }) => {
  expect(
    methodsIn(read(`${trait} {\n  fn a(&self) -> u8;\n  fn b(&self) { c(); }\n  type D;\n}`)),
  ).toMatchObject([
    { name: 'a', scope: 'Tr', exported, signature: '(&self) -> u8' },
    { name: 'b', scope: 'Tr', exported, signature: '(&self)' },
  ]);
});

const typesIn = ({ symbols }: FileSymbols) => symbols.filter(({ kind }) => kind === 'type');

test.for([
  { written: 'pub trait Tr {}', exported: true },
  { written: 'trait Tr {}', exported: false },
  { written: 'pub(crate) trait Tr {}', exported: false },
])('$written is a type, exported: $exported', ({ written, exported }) => {
  expect(typesIn(read(written))).toMatchObject([{ name: 'Tr', exported }]);
});

test('a trait with no attribute reads from its keyword', () => {
  expect(typesIn(read('pub trait Tr {}'))).toMatchObject([{ signature: 'trait Tr {}' }]);
});

test('a trait reads as its text with no visibility, comments, doc or default bodies', () => {
  const written = [
    '/// top',
    '#[doc = "top"]',
    '#[async_trait]',
    'pub trait Tr<T>: Send where T: Copy {',
    '  /// doc',
    '  #[inline]',
    '  fn a(&self) -> u8;',
    '  // plain',
    '  fn b(&self) { c(); }',
    '  type D;',
    '}',
  ];
  expect(typesIn(read(...written))).toMatchObject([
    {
      signature:
        '#[async_trait] trait Tr<T>: Send where T: Copy { #[inline] fn a(&self) -> u8; fn b(&self); type D; }',
    },
  ]);
});

const traitChange = (before: string, after: string) =>
  symbolChanges({ before: read(before), after: read(after) }).symbols.find(
    ({ kind }) => kind === 'type',
  );

test.for([
  { edit: 'its generics', before: 'trait Tr<T> {}', after: 'trait Tr<U> {}' },
  { edit: 'its bounds', before: 'trait Tr: A {}', after: 'trait Tr: B {}' },
  { edit: 'its where', before: 'trait Tr where A: B {}', after: 'trait Tr where A: C {}' },
  { edit: 'an attribute', before: 'trait Tr {}', after: '#[async_trait]\ntrait Tr {}' },
  {
    edit: "a method's return",
    before: 'trait Tr { fn a() -> u8; }',
    after: 'trait Tr { fn a() -> u16; }',
  },
  { edit: "a method's name", before: 'trait Tr { fn a(); }', after: 'trait Tr { fn b(); }' },
  {
    edit: "a default body's signature",
    before: 'trait Tr { fn a() {} }',
    after: 'trait Tr { fn a(x: u8) {} }',
  },
  { edit: 'a member type', before: 'trait Tr { type A; }', after: 'trait Tr { type B; }' },
  {
    edit: "a method's attribute",
    before: 'trait Tr { fn a(); }',
    after: 'trait Tr { #[inline] fn a(); }',
  },
])('a change to $edit reads as a changed signature on the trait', ({ before, after }) => {
  expect(traitChange(before, after)).toMatchObject({
    change: 'edited',
    signature: expect.anything(),
  });
});

test('a method changed in a trait reads changed on the method too', () => {
  expect(
    symbolChanges({
      before: read('trait Tr { fn a() -> u8; }'),
      after: read('trait Tr { fn a() -> u16; }'),
    }).symbols,
  ).toMatchObject([
    { name: 'Tr', change: 'edited', signature: expect.anything() },
    { name: 'a', scope: 'Tr', change: 'edited', signature: expect.anything() },
  ]);
});

test('an edit inside a default body leaves the trait unchanged and edits the method', () => {
  expect(
    symbolChanges({
      before: read('trait Tr { fn a() { b(); } }'),
      after: read('trait Tr { fn a() { c(); } }'),
    }).symbols,
  ).toMatchObject([
    { name: 'Tr', change: 'unchanged' },
    { name: 'a', scope: 'Tr', change: 'edited' },
  ]);
});

test.for([
  {
    edit: 'a comment',
    before: 'trait Tr { fn a(); }',
    after: 'trait Tr {\n  // why\n  fn a();\n}',
  },
  {
    edit: "a method's doc",
    before: 'trait Tr { fn a(); }',
    after: 'trait Tr { #[doc = "why"] fn a(); }',
  },
  { edit: 'its doc', before: 'trait Tr {}', after: '#[doc = "why"]\ntrait Tr {}' },
  {
    edit: 'a comment beside an edit in a default body',
    before: 'trait Tr { fn a() { b(); } }',
    after: 'trait Tr {\n  // why\n  fn a() { c(); }\n}',
  },
])('$edit on a trait reads as formatting', ({ before, after }) => {
  expect(traitChange(before, after)).toMatchObject({ change: 'formatting' });
});

test('a change of visibility reads as edited, with the signature as it was', () => {
  const change = traitChange('pub(crate) trait Tr {}', 'pub(super) trait Tr {}');
  expect(change).toMatchObject({ change: 'edited' });
  expect(change).not.toHaveProperty('signature');
});

test('a trait under another name reads as renamed', () => {
  expect(traitChange('trait Tr { type A; }', 'trait Ur { type A; }')).toMatchObject({
    name: 'Ur',
    change: 'renamed',
    renamedFrom: 'Tr',
  });
});

test.for([
  { written: 'pub struct Foo { a: u8 }', exported: true },
  { written: 'struct Foo(u8);', exported: false },
  { written: 'pub(crate) struct Foo;', exported: false },
  { written: 'pub union Foo { a: u8 }', exported: true },
  { written: 'union Foo { a: u8 }', exported: false },
])('$written is a type, exported: $exported', ({ written, exported }) => {
  expect(typesIn(read(written))).toMatchObject([{ name: 'Foo', exported }]);
});

test.for([
  { written: 'struct Foo;', signature: 'struct Foo' },
  { written: 'pub(crate) struct Foo { a: u8 }', signature: 'struct Foo' },
  { written: 'union Foo { pub a: u8 }', signature: 'union Foo { pub a: u8 }' },
  {
    written:
      'struct Foo {\n  pub a: Vec<\n    u8,\n  >,\n  b: u8,\n  pub(crate) c: u8,\n  pub d: u8,\n}',
    signature: 'struct Foo { pub a: Vec< u8, >, pub d: u8 }',
  },
  { written: 'struct Foo(u8);', signature: 'struct Foo' },
  {
    written: 'struct Foo(pub u8, u16, pub(crate) u32, pub u64);',
    signature: 'struct Foo(pub u8, pub u64)',
  },
  {
    written: '/// doc\n#[doc = "doc"]\n#[derive(Debug,\n  Clone)]\n#[repr(C)]\npub struct Foo;',
    signature: '#[derive(Debug, Clone)] #[repr(C)] struct Foo',
  },
  {
    written: 'struct Foo<T,\n  U> where T: Send, U: Copy { pub a: T }',
    signature: 'struct Foo<T, U> where T: Send, U: Copy { pub a: T }',
  },
  {
    written: 'struct Foo<T>(pub T) where T: Send;',
    signature: 'struct Foo<T>(pub T) where T: Send',
  },
])('$written reads the signature $signature', ({ written, signature }) => {
  expect(typesIn(read(written))).toMatchObject([{ signature }]);
});
