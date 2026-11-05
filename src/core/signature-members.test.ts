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
])('splits $what', ({ what: _what, text, ...parts }) => {
  expect(splitSignature(text)).toEqual(parts);
  expect(rejoined(text)).toBe(text);
});

test.for([
  { what: 'a closer of another bracket', text: 'type A = { a: [1 } ];' },
  { what: 'a closer that opens nothing', text: ') (a: 1)' },
  { what: 'a bracket left open after the members', text: '(a: 1): { b: 2' },
  { what: 'a lone quote', text: "type A = { a: ' };" },
])('leaves $what unsplit', ({ text }) => {
  expect(splitSignature(text)).toBeUndefined();
});
