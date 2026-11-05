import { expect, test } from 'vitest';
import type { FileSymbols } from '../../core/reader.ts';
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
    read('pub const A: u8 = 1;', 'pub static B: u8 = 1;', 'pub mod c;', 'pub use d::e;').symbols,
  ).toEqual([]);
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
])('$written reads the signature $signature', ({ written, signature }) => {
  expect(read(written).symbols).toMatchObject([{ signature }]);
});
