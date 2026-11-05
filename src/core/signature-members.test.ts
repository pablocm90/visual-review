import { expect, test } from 'vitest';
import { signatureDiff, splitSignature } from './signature-members.ts';

const rejoined = (text: string): string | undefined => {
  const split = splitSignature(text);
  return split && `${split.opener}${split.members.join('')}${split.closer}`;
};

test.for([
  {
    what: "an interface's members",
    text: 'interface Reader { readonly name: string; holds(root: string): boolean; }',
    by: '{',
    opener: 'interface Reader {',
    members: [' readonly name: string;', ' holds(root: string): boolean;'],
    closer: ' }',
  },
  {
    what: "a type's members, whatever bracket sits in a heading or a member",
    text: 'type A<T extends { a: 1 }, U> = { b: Map<() => string, T>, c: (d: 1, e: 2) => void };',
    by: '{',
    opener: 'type A<T extends { a: 1 }, U> = {',
    members: [' b: Map<() => string, T>,', ' c: (d: 1, e: 2) => void'],
    closer: ' };',
  },
  {
    what: "a function's parameters, with what follows them left in the closer",
    text: 'async <T>(order: T, { a, b }: Money = ZERO): Map<T, string>',
    by: '(',
    opener: 'async <T>(',
    members: ['order: T,', ' { a, b }: Money = ZERO'],
    closer: '): Map<T, string>',
  },
  {
    what: 'members holding a bracket or separator in a string',
    text: 'type A = { a: \')\', b: "}", c: `,` };',
    by: '{',
    opener: 'type A = {',
    members: [" a: ')',", ' b: "}",', ' c: `,`'],
    closer: ' };',
  },
  { what: 'no parameters', text: '()', by: '(', opener: '(', members: [], closer: ')' },
  {
    what: "a return type's union, which isn't the signature's",
    text: '(a = 1): X | Y',
    by: '(',
    opener: '(',
    members: ['a = 1'],
    closer: '): X | Y',
  },
  {
    what: 'a bar in a generic default, before the real equals',
    text: 'type A<T = 1 | 2> = { a: T };',
    by: '{',
    opener: 'type A<T = 1 | 2> = {',
    members: [' a: T'],
    closer: ' };',
  },
  {
    what: "a union's alternatives",
    text: "type Kind = | 'a' | { b: 1 | 2 } | 'c';",
    by: '|',
    opener: 'type Kind = |',
    members: [" 'a' |", ' { b: 1 | 2 } |', " 'c'"],
    closer: ';',
  },
  {
    what: 'a union with no leading bar',
    text: 'export type Id = string | (() => number)',
    by: '|',
    opener: 'export type Id =',
    members: [' string |', ' (() => number)'],
    closer: '',
  },
])('splits $what', ({ what: _what, text, ...parts }) => {
  expect(splitSignature(text)).toEqual(parts);
  expect(rejoined(text)).toBe(text);
});

test.for([
  { what: 'a closer of another bracket', text: 'type A = { a: [1 } ];' },
  { what: 'a closer that opens nothing', text: ') (a: 1)' },
  { what: 'a bracket left open after the members', text: '(a: 1): { b: 2' },
  { what: 'a lone quote', text: "type A = { a: ' };" },
  { what: 'overloads', text: '(a: 1): X; (b: 2): Y' },
  { what: 'a class heritage', text: 'extends Y<T>' },
  { what: 'a tuple', text: 'type A = [a: 1, b: 2];' },
  { what: 'a superclass', text: '< Base' },
  { what: 'a one-word type', text: 'type Id = string;' },
  { what: 'a bar only before the equals', text: 'const a: 1 | 2 = 3' },
])('leaves $what unsplit', ({ text }) => {
  expect(splitSignature(text)).toBeUndefined();
});

test('a member gained reads added, with the rest as they were', () => {
  expect(
    signatureDiff({
      base: 'interface Reader { readonly name: string; holds(root: string): boolean; }',
      head: 'interface Reader { readonly name: string; readonly symbols?: Read; holds(root: string): boolean; }',
    }),
  ).toEqual({
    opener: [{ change: 'same', text: 'interface Reader {' }],
    members: [
      { change: 'same', text: 'readonly name: string' },
      { change: 'added', text: 'readonly symbols?: Read' },
      { change: 'same', text: 'holds(root: string): boolean' },
    ],
    closer: [{ change: 'same', text: '}' }],
  });
});

test('a return type changing alone marks only the closer', () => {
  expect(signatureDiff({ base: '(a: 1): X', head: '(a: 1): Y' })).toEqual({
    opener: [{ change: 'same', text: '(' }],
    members: [{ change: 'same', text: 'a: 1' }],
    closer: [
      { change: 'removed', text: '): X' },
      { change: 'added', text: '): Y' },
    ],
  });
});

test('a heading changing alone marks only the opener', () => {
  expect(signatureDiff({ base: 'type A<T> = { a: 1 };', head: 'type A<U> = { a: 1 };' })).toEqual({
    opener: [
      { change: 'removed', text: 'type A<T> = {' },
      { change: 'added', text: 'type A<U> = {' },
    ],
    members: [{ change: 'same', text: 'a: 1' }],
    closer: [{ change: 'same', text: '};' }],
  });
});

test('an alternative last on one side and not on the other is the same alternative', () => {
  expect(signatureDiff({ base: 'type A = X | Y;', head: 'type A = X | Y | Z;' })?.members).toEqual([
    { change: 'same', text: 'X' },
    { change: 'same', text: 'Y' },
    { change: 'added', text: 'Z' },
  ]);
});

test('a parameter moved reads removed and added, since order matters in a call', () => {
  expect(signatureDiff({ base: '(a: 1, b: 2)', head: '(b: 2, a: 1)' })?.members).toEqual([
    { change: 'removed', text: 'a: 1' },
    { change: 'same', text: 'b: 2' },
    { change: 'added', text: 'a: 1' },
  ]);
});

test.for([
  { what: 'a base that does not split', base: 'extends Y', head: '(a)' },
  { what: 'a head that does not split', base: '(a)', head: 'extends Z' },
  { what: 'a brace against a union', base: 'type A = { a: 1 };', head: 'type A = { a: 1 } | B;' },
  { what: 'a brace against a parenthesis', base: 'type A = { a: 1 };', head: 'type A = (a: 1);' },
  { what: 'only separators differing', base: '{ a: 1, b: 2 }', head: '{ a: 1; b: 2 }' },
])('$what gets no diff', ({ base, head }) => {
  expect(signatureDiff({ base, head })).toBeUndefined();
});
