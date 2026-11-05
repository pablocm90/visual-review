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
    read('pub const A: u8 = 1;', 'pub static B: u8 = 1;', 'pub mod c;', 'pub use f::g;').symbols,
  ).toEqual([]);
});

test.for([
  { written: 'mod inner {\n  fn z() {}\n}', name: 'inner::z', scope: undefined },
  { written: 'mod a {\n  mod b {\n    fn z() {}\n  }\n}', name: 'a::b::z', scope: undefined },
  { written: 'mod inner {\n  struct Foo;\n}', name: 'inner::Foo', scope: undefined },
  { written: 'mod inner {\n  impl Foo {\n    fn z() {}\n  }\n}', name: 'z', scope: 'inner::Foo' },
  {
    written: 'mod inner {\n  impl T for Foo {\n    fn z() {}\n  }\n}',
    name: 'z',
    scope: 'inner::Foo as T',
  },
])('$written reads as $name in scope $scope', ({ written, name, scope }) => {
  const [symbol] = read(written).symbols;
  expect({ name: symbol?.name, scope: symbol?.scope }).toEqual({ name, scope });
});

test.for([
  { written: 'pub mod inner {\n  pub fn z() {}\n}', exported: true },
  { written: 'pub mod inner {\n  fn z() {}\n}', exported: false },
  { written: 'mod inner {\n  pub fn z() {}\n}', exported: false },
  { written: 'mod inner {\n  impl Foo {\n    pub fn z() {}\n  }\n}', exported: false },
  { written: 'pub(crate) mod inner {\n  pub fn z() {}\n}', exported: false },
  { written: 'pub mod a {\n  mod b {\n    pub fn z() {}\n  }\n}', exported: false },
  { written: 'mod a {\n  pub mod b {\n    pub fn z() {}\n  }\n}', exported: false },
  { written: 'pub mod a {\n  pub mod b {\n    pub fn z() {}\n  }\n}', exported: true },
])('$written reads exported: $exported', ({ written, exported }) => {
  expect(read(written).symbols).toMatchObject([{ exported }]);
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

const typeChange = (before: string, after: string) =>
  symbolChanges({ before: read(before), after: read(after) }).symbols.find(
    ({ kind }) => kind === 'type',
  );

test.for([
  { edit: 'its generics', before: 'trait Tr<T> {}', after: 'trait Tr<U> {}' },
  { edit: 'its bounds', before: 'trait Tr: A {}', after: 'trait Tr: B {}' },
  { edit: 'its where', before: 'trait Tr where A: B {}', after: 'trait Tr where A: C {}' },
  { edit: 'an attribute', before: 'trait Tr {}', after: '#[async_trait]\ntrait Tr {}' },
  { edit: 'being unsafe', before: 'trait Tr {}', after: 'unsafe trait Tr {}' },
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
  expect(typeChange(before, after)).toMatchObject({
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
  expect(typeChange(before, after)).toMatchObject({ change: 'formatting' });
});

test('a change of visibility reads as edited, with the signature as it was', () => {
  const change = typeChange('pub(crate) trait Tr {}', 'pub(super) trait Tr {}');
  expect(change).toMatchObject({ change: 'edited' });
  expect(change).not.toHaveProperty('signature');
});

test('a trait under another name reads as renamed', () => {
  expect(typeChange('trait Tr { type A; }', 'trait Ur { type A; }')).toMatchObject({
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

test.for([
  { edit: 'a derive', before: 'struct A;', after: '#[derive(Debug)]\nstruct A;' },
  { edit: 'the generics', before: 'struct A<T>;', after: 'struct A<U>;' },
  { edit: 'the where', before: 'struct A<T> where T: B {}', after: 'struct A<T> where T: C {}' },
  {
    edit: "a pub field's type",
    before: 'struct A { pub b: u8 }',
    after: 'struct A { pub b: u16 }',
  },
  { edit: 'a field made pub', before: 'struct A { b: u8 }', after: 'struct A { pub b: u8 }' },
  { edit: "a tuple's pub field", before: 'struct A(pub u8);', after: 'struct A(pub u16);' },
  { edit: 'a tuple field made pub', before: 'struct A(u8);', after: 'struct A(pub u8);' },
  { edit: 'the keyword', before: 'struct A { b: u8 }', after: 'union A { b: u8 }' },
])('a change to $edit reads as a changed signature on the struct', ({ before, after }) => {
  expect(typeChange(before, after)).toMatchObject({
    change: 'edited',
    signature: expect.anything(),
  });
});

test.for([
  { edit: 'its visibility', before: 'pub(crate) struct A;', after: 'pub(super) struct A;' },
  { edit: 'a private field', before: 'struct A { b: u8 }', after: 'struct A { b: u16 }' },
  {
    edit: 'a private field added',
    before: 'struct A { pub b: u8 }',
    after: 'struct A { pub b: u8, c: u8 }',
  },
  {
    edit: "a field's restriction",
    before: 'struct A { pub(crate) b: u8 }',
    after: 'struct A { pub(super) b: u8 }',
  },
  { edit: "a tuple's private field", before: 'struct A(u8);', after: 'struct A(u16);' },
  {
    edit: "a field's attribute",
    before: 'struct A { pub b: u8 }',
    after: 'struct A { #[serde(skip)] pub b: u8 }',
  },
  { edit: 'a unit to no fields', before: 'struct A;', after: 'struct A {}' },
  { edit: 'a tuple to named fields', before: 'struct A();', after: 'struct A {}' },
])('a change to $edit reads as edited, with the signature as it was', ({ before, after }) => {
  const change = typeChange(before, after);
  expect(change).toMatchObject({ change: 'edited' });
  expect(change).not.toHaveProperty('signature');
});

test.for([
  { edit: 'a comment', before: 'struct A { b: u8 }', after: 'struct A {\n  // why\n  b: u8,\n}' },
  {
    edit: 'a line of docs',
    before: 'struct A { pub b: u8 }',
    after: 'struct A {\n  /// why\n  pub b: u8,\n}',
  },
  {
    edit: "a field's doc",
    before: 'struct A { b: u8 }',
    after: 'struct A { #[doc = "why"] b: u8 }',
  },
  { edit: 'its doc', before: 'struct A;', after: '#[doc = "why"]\nstruct A;' },
  { edit: 'a last comma', before: 'struct A { pub b: u8 }', after: 'struct A { pub b: u8, }' },
  { edit: "a tuple's last comma", before: 'struct A(pub u8);', after: 'struct A(pub u8,);' },
])('$edit on a struct reads as formatting', ({ before, after }) => {
  expect(typeChange(before, after)).toMatchObject({ change: 'formatting' });
});

test('a struct under another name reads as renamed', () => {
  expect(typeChange('struct A { pub b: u8 }', 'struct C { pub b: u8 }')).toMatchObject({
    name: 'C',
    change: 'renamed',
    renamedFrom: 'A',
  });
});

test.for([
  { written: 'pub enum Foo { A }', exported: true },
  { written: 'enum Foo { A }', exported: false },
  { written: 'pub(crate) enum Foo { A }', exported: false },
  { written: 'pub type Foo = u8;', exported: true },
  { written: 'type Foo = u8;', exported: false },
])('$written is a type, exported: $exported', ({ written, exported }) => {
  expect(typesIn(read(written))).toMatchObject([{ name: 'Foo', exported }]);
});

test.for([
  { written: 'pub(crate) enum Foo { A, B(u8) }', signature: 'enum Foo { A, B(u8) }' },
  {
    written:
      '/// doc\n#[doc = "doc"]\n#[derive(Debug,\n  Clone)]\npub enum Foo<T> where T: Send {\n  /// a\n  #[doc = "a"]\n  #[serde(skip)]\n  A { b: T }, // why\n  /* c */ C = 1,\n}',
    signature:
      '#[derive(Debug, Clone)] enum Foo<T> where T: Send { #[serde(skip)] A { b: T }, C = 1, }',
  },
  { written: 'pub type Foo<T> = Vec<\n  T,\n>;', signature: 'type Foo<T> = Vec< T, >;' },
  {
    written: '/// doc\n#[cfg(x)]\ntype Foo = /* a */ u8 /* b */;',
    signature: '#[cfg(x)] type Foo = u8;',
  },
])('$written reads the signature $signature', ({ written, signature }) => {
  expect(typesIn(read(written))).toMatchObject([{ signature }]);
});

test.for([
  { edit: 'a derive', before: 'enum A {}', after: '#[derive(Debug)]\nenum A {}' },
  { edit: 'the generics', before: 'enum A<T> {}', after: 'enum A<U> {}' },
  { edit: 'the where', before: 'enum A<T> where T: B {}', after: 'enum A<T> where T: C {}' },
  { edit: 'a variant added', before: 'enum A { B }', after: 'enum A { B, C }' },
  { edit: "a variant's private field", before: 'enum A { B(u8) }', after: 'enum A { B(u16) }' },
  { edit: "a variant's value", before: 'enum A { B = 1 }', after: 'enum A { B = 2 }' },
  { edit: "a variant's attribute", before: 'enum A { B }', after: 'enum A { #[serde(skip)] B }' },
  { edit: 'the keyword', before: 'type A = B;', after: 'enum A { B }' },
  { edit: "an alias's type", before: 'type A = u8;', after: 'type A = u16;' },
  { edit: "an alias's generics", before: 'type A<T> = B;', after: 'type A<U> = B;' },
])('a change to $edit reads as a changed signature on the type', ({ before, after }) => {
  expect(typeChange(before, after)).toMatchObject({
    change: 'edited',
    signature: expect.anything(),
  });
});

test.for([
  { edit: "an enum's visibility", before: 'pub(crate) enum A {}', after: 'pub(super) enum A {}' },
  {
    edit: "an alias's visibility",
    before: 'pub(crate) type A = B;',
    after: 'pub(super) type A = B;',
  },
])('a change to $edit reads as edited, with the signature as it was', ({ before, after }) => {
  const change = typeChange(before, after);
  expect(change).toMatchObject({ change: 'edited' });
  expect(change).not.toHaveProperty('signature');
});

test.for([
  { edit: 'a comment', before: 'enum A { B }', after: 'enum A {\n  // why\n  B,\n}' },
  { edit: "a variant's doc", before: 'enum A { B }', after: 'enum A { #[doc = "why"] B }' },
  { edit: 'its doc', before: 'enum A {}', after: '#[doc = "why"]\nenum A {}' },
  { edit: "an alias's reflow", before: 'type A = B<u8>;', after: 'type A = B<\n  u8,\n>;' },
  { edit: "an alias's comment", before: 'type A = u8;', after: 'type A = /* why */ u8;' },
])('$edit reads as formatting', ({ before, after }) => {
  expect(typeChange(before, after)).toMatchObject({ change: 'formatting' });
});

test.for([
  { before: 'enum A { B }', after: 'enum C { B }' },
  { before: 'type A = B;', after: 'type C = B;' },
])('$before under another name reads as renamed', ({ before, after }) => {
  expect(typeChange(before, after)).toMatchObject({
    name: 'C',
    change: 'renamed',
    renamedFrom: 'A',
  });
});

test.for([
  { written: 'pub fn a() {}', exports: ['a'] },
  { written: 'fn a() {}', exports: [] },
  { written: 'pub(crate) fn a() {}', exports: [] },
  {
    written:
      'pub struct A;\npub enum B {}\npub union C { d: u8 }\npub trait E {}\npub type F = u8;\npub const G: u8 = 1;\npub static H: u8 = 1;\npub mod i;\npub mod j {}',
    exports: ['A', 'B', 'C', 'E', 'F', 'G', 'H', 'i', 'j'],
  },
  { written: 'pub extern crate a as b;', exports: ['b'] },
  { written: 'pub extern "C" { fn a(); }', exports: [] },
  { written: 'use a::b;', exports: [] },
  { written: 'pub(crate) use a::b;', exports: [] },
  { written: 'pub use b;', exports: ['b'] },
  { written: 'pub use a::b;', exports: ['b'] },
  { written: 'pub use a::b as c;', exports: ['c'] },
  { written: 'pub use a::{d, e as f, g::{h}};', exports: ['d', 'f', 'h'] },
  { written: 'pub use {a, b::c};', exports: ['a', 'c'] },
  { written: 'pub use a::{b, /* c */ d};', exports: ['b', 'd'] },
  { written: 'pub use a::{self};', exports: ['a'] },
  { written: 'pub use a::b::{self};', exports: ['b'] },
  { written: 'pub use a::{b::{self}};', exports: ['b'] },
  { written: 'pub use a::{self as c};', exports: ['c'] },
  { written: 'pub use a::*;', exports: ['* from a'] },
  { written: 'pub use a::{b::*};', exports: ['* from a::b'] },
  { written: 'pub use a::{b::{c::*}};', exports: ['* from a::b::c'] },
  { written: 'pub use {a::*};', exports: ['* from a'] },
  { written: 'pub mod a {\n  pub const B: u8 = 1;\n}', exports: ['a', 'a::B'] },
  { written: 'pub mod a {\n  pub use b::c;\n}', exports: ['a', 'a::c'] },
  { written: 'pub mod a {\n  pub use b::*;\n}', exports: ['a', 'a::* from b'] },
  { written: 'pub mod a {\n  const B: u8 = 1;\n}', exports: ['a'] },
  { written: 'pub struct A {\n  pub b: u8,\n}', exports: ['A'] },
  { written: 'pub mod a {\n  #[cfg(test)]\n  pub mod tests {}\n}', exports: ['a'] },
  { written: 'mod a {\n  pub const B: u8 = 1;\n}', exports: [] },
  { written: 'pub(crate) mod a {\n  pub const B: u8 = 1;\n}', exports: [] },
  {
    written: 'pub mod a {\n  pub mod b {\n    pub const C: u8 = 1;\n  }\n}',
    exports: ['a', 'a::b', 'a::b::C'],
  },
  { written: 'pub mod a {\n  mod b {\n    pub const C: u8 = 1;\n  }\n}', exports: ['a'] },
])('$written exports $exports', ({ written, exports }) => {
  expect(read(written).exports).toEqual(exports);
});

test.for([
  { written: '#[test]\nfn a() {}' },
  { written: '#[cfg(test)]\npub use a::b;' },
  { written: '#[cfg(test)]\nimpl Foo {\n  pub fn a() {}\n}' },
  { written: '#[cfg(test)]\npub mod tests {\n  pub fn a() {}\n}' },
  { written: 'mod a {\n  #[test]\n  fn b() {}\n}' },
  { written: 'mod a {\n  #[cfg(test)]\n  mod tests {\n    fn b() {}\n  }\n}' },
])('$written reads no symbol and no export', ({ written }) => {
  expect(read(written)).toMatchObject({ symbols: [], exports: [] });
});

test.for([
  { written: 'impl Foo {\n  #[test]\n  fn a() {}\n}' },
  { written: 'trait Foo {\n  #[cfg(test)]\n  fn a();\n}' },
])('$written reads no method', ({ written }) => {
  expect(methodsIn(read(written))).toEqual([]);
});

test('a file where only inline tests changed reads as logic, with no symbol changed', () => {
  const changes = symbolChanges({
    before: read('pub fn a() {}', '#[test]', 'fn b() { x(); }'),
    after: read('pub fn a() {}', '#[test]', 'fn b() { y(); }'),
  });
  expect(changes.kind).toBe('logic');
  expect(changes.symbols.map(({ change }) => change)).toEqual(['unchanged']);
});

test.for([
  { path: 'README.md' },
  { path: 'tests/orders.rs' },
  { path: 'crates/shop/tests/orders.rs' },
])('$path reads no symbols', ({ path }) => {
  expect(rustReader.symbols?.('pub fn open() {}', path)).toBeUndefined();
});

test('a file whose name only holds the word tests reads its symbols', () => {
  expect(rustReader.symbols?.('pub fn open() {}', 'src/my_tests/orders.rs')).toMatchObject({
    symbols: [{ name: 'open' }],
  });
});
