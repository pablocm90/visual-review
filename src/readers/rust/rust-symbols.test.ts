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
