import { expect, test } from 'vitest';
import { splitSignature } from './signature-members.ts';

const rejoined = (text: string): string | undefined => {
  const split = splitSignature(text);
  return split && `${split.opener}${split.members.join('')}${split.closer}`;
};

test.for([
  {
    what: "an interface's members",
    text: 'interface Reader { readonly name: string; holds(root: string): boolean; }',
    opener: 'interface Reader {',
    members: [' readonly name: string;', ' holds(root: string): boolean;'],
    closer: ' }',
  },
  {
    what: "a type's members, whatever bracket sits in a heading or a member",
    text: 'type A<T extends { a: 1 }, U> = { b: Map<() => string, T>, c: (d: 1, e: 2) => void };',
    opener: 'type A<T extends { a: 1 }, U> = {',
    members: [' b: Map<() => string, T>,', ' c: (d: 1, e: 2) => void'],
    closer: ' };',
  },
  {
    what: "a function's parameters, with what follows them left in the closer",
    text: 'async <T>(order: T, { a, b }: Money = ZERO): Map<T, string>',
    opener: 'async <T>(',
    members: ['order: T,', ' { a, b }: Money = ZERO'],
    closer: '): Map<T, string>',
  },
  {
    what: 'members holding a bracket or separator in a string',
    text: 'type A = { a: \')\', b: "}", c: `,` };',
    opener: 'type A = {',
    members: [" a: ')',", ' b: "}",', ' c: `,`'],
    closer: ' };',
  },
  { what: 'no parameters', text: '()', opener: '(', members: [], closer: ')' },
  {
    what: "a return type's union, which isn't the signature's",
    text: '(a = 1): X | Y',
    opener: '(',
    members: ['a = 1'],
    closer: '): X | Y',
  },
  {
    what: 'a bar in a generic default, before the real equals',
    text: 'type A<T = 1 | 2> = { a: T };',
    opener: 'type A<T = 1 | 2> = {',
    members: [' a: T'],
    closer: ' };',
  },
  {
    what: "a union's alternatives",
    text: "type Kind = | 'a' | { b: 1 | 2 } | 'c';",
    opener: 'type Kind = |',
    members: [" 'a' |", ' { b: 1 | 2 } |', " 'c'"],
    closer: ';',
  },
  {
    what: 'a union with no leading bar',
    text: 'export type Id = string | (() => number)',
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
