import { expect, test } from 'vitest';
import {
  LONGEST_SIGNATURE,
  signatureDiff,
  signatureSummary,
  splitSignature,
} from './signature-members.ts';

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

test('an edge with nothing on a side reads no line for it', () => {
  expect(signatureDiff({ base: 'type A = X | Y', head: 'type A = X | Z' })?.closer).toEqual([]);
  expect(signatureDiff({ base: 'type A = X | Y;', head: 'type A = X | Y' })?.closer).toEqual([
    { change: 'removed', text: ';' },
  ]);
  expect(signatureDiff({ base: 'type A = X | Y', head: 'type A = X | Y;' })?.closer).toEqual([
    { change: 'added', text: ';' },
  ]);
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

test('a parameter moved and edited still reads removed and added, its order never crossed', () => {
  expect(signatureDiff({ base: '(a: 1, b: 2)', head: '(b: 3, a: 4)' })?.members).toEqual([
    { change: 'removed', text: 'a: 1' },
    { change: 'changed', base: 'b: 2', head: 'b: 3' },
    { change: 'added', text: 'a: 4' },
  ]);
});

test('a block comment is no place to cut a member, whatever it holds', () => {
  expect(
    signatureDiff({
      base: 'interface I { a: A; }',
      head: "interface I { a: A; /** The id, as sent; it's never (empty. */ c: C; }",
    })?.members,
  ).toEqual([
    { change: 'same', text: 'a: A' },
    { change: 'added', text: "/** The id, as sent; it's never (empty. */ c: C" },
  ]);
});

test('a member goes by its name past a comment holding a colon', () => {
  expect(
    signatureDiff({
      base: 'interface I { /** Note: one */ a: A; }',
      head: 'interface I { /** Note: one */ b: A; }',
    })?.members,
  ).toEqual([
    { change: 'removed', text: '/** Note: one */ a: A' },
    { change: 'added', text: '/** Note: one */ b: A' },
  ]);
});

test('a reworded comment leaves its member as it was, read as the head has it', () => {
  expect(
    signatureDiff({
      base: 'interface I { /** old */ a: A; b: B; }',
      head: 'interface I { /** new */ a: A; b: C; }',
    })?.members,
  ).toEqual([
    { change: 'same', text: '/** new */ a: A' },
    { change: 'changed', base: 'b: B', head: 'b: C' },
  ]);
});

test('a comment put on a member leaves it as it was', () => {
  expect(
    signatureDiff({ base: '{ a: A; b: B }', head: '{ /** new */ a: A; b: C }' })?.members,
  ).toEqual([
    { change: 'same', text: '/** new */ a: A' },
    { change: 'changed', base: 'b: B', head: 'b: C' },
  ]);
});

test('what looks like a comment inside a string is the string', () => {
  expect(
    signatureDiff({ base: "{ a: '/* x */'; b: 1 }", head: "{ a: '/* y */'; b: 1 }" })?.members,
  ).toEqual([
    { change: 'changed', base: "a: '/* x */'", head: "a: '/* y */'" },
    { change: 'same', text: 'b: 1' },
  ]);
});

test.for([
  { what: 'a line comment, with no visible end', text: 'interface I { // one, two\n a: A; }' },
  { what: 'a comment never closed', text: 'interface I { /* one a: A; }' },
])('$what does not split', ({ text }) => {
  expect(splitSignature(text)).toBeUndefined();
});

test('a line comment inside a string still splits', () => {
  expect(splitSignature("{ a: 'http://x'; b: 1 }")?.members).toHaveLength(2);
});

test('a union a formatter reflowed under a leading bar keeps its opener', () => {
  const diff = {
    base: 'type Kind = "a" | "b";',
    head: 'type Kind = | "a" | "b" | "c";',
  };
  expect(signatureDiff(diff)?.opener).toEqual([{ change: 'same', text: 'type Kind =' }]);
  expect(signatureSummary(diff)).toBe('1 member added');
});

test('a union reflowed back from a leading bar keeps its opener', () => {
  const diff = { base: 'type Kind = | "a" | "b" | "c";', head: 'type Kind = "a" | "b";' };
  expect(signatureDiff(diff)?.opener).toEqual([{ change: 'same', text: 'type Kind =' }]);
  expect(signatureSummary(diff)).toBe('1 member removed');
});

test.for([
  {
    what: 'a semicolon before a closing brace',
    base: '(opts: { a: A; b: B }, x: X)',
    head: '(opts: { a: A; b: B; }, x: X, y: Y)',
  },
  {
    what: 'a comma and spaces inside angle brackets',
    base: '(opts: Map<A, B>, x: X)',
    head: '(opts: Map< A, B, >, x: X, y: Y)',
  },
  {
    what: 'spaces inside parentheses and square brackets',
    base: '(opts: [(a: A) => B], x: X)',
    head: '(opts: [ ( a: A ) => B ], x: X, y: Y)',
  },
  {
    what: 'a comment first inside a bracket',
    base: '(opts: { a: A }, x: X)',
    head: '(opts: { /** one */ a: A }, x: X, y: Y)',
  },
])('$what is a reflow, not a change', ({ base, head }) => {
  expect(signatureSummary({ base, head })).toBe('1 member added');
});

test.for(["'", '"', '`'])('what looks like a reflow inside a %s string is the string', quote => {
  expect(
    signatureSummary({ base: `(a: ${quote}{ b; }${quote})`, head: `(a: ${quote}{ b }${quote})` }),
  ).toBe('1 member changed');
});

test('a pairing far along leaves every member before it unpaired', () => {
  expect(signatureDiff({ base: '(a: 1, b: 2, c: 3)', head: '(c: 4, b: 5)' })?.members).toEqual([
    { change: 'removed', text: 'a: 1' },
    { change: 'removed', text: 'b: 2' },
    { change: 'changed', base: 'c: 3', head: 'c: 4' },
    { change: 'added', text: 'b: 5' },
  ]);
});

test('a member added ahead of an edited one leaves it to pair', () => {
  expect(signatureDiff({ base: '(a: 1)', head: '(z: 9, a: 2)' })?.members).toEqual([
    { change: 'added', text: 'z: 9' },
    { change: 'changed', base: 'a: 1', head: 'a: 2' },
  ]);
});

test('members of one name in one gap read as changed, in order, and the rest added or removed', () => {
  expect(
    signatureDiff({
      base: '(a, b: 1, c: 2, c: 3, d: 4, e)',
      head: '(a, b: 5, c: 6, f: 7, e)',
    })?.members,
  ).toEqual([
    { change: 'same', text: 'a' },
    { change: 'removed', text: 'c: 3' },
    { change: 'removed', text: 'd: 4' },
    { change: 'changed', base: 'b: 1', head: 'b: 5' },
    { change: 'changed', base: 'c: 2', head: 'c: 6' },
    { change: 'added', text: 'f: 7' },
    { change: 'same', text: 'e' },
  ]);
});

test('members of one name pair in order', () => {
  expect(signatureDiff({ base: '(a: 1, a: 2)', head: '(a: 3, a: 4)' })?.members).toEqual([
    { change: 'changed', base: 'a: 1', head: 'a: 3' },
    { change: 'changed', base: 'a: 2', head: 'a: 4' },
  ]);
});

test('a member repeated on one side still reads removed for the copy left unpaired', () => {
  expect(signatureDiff({ base: '(c: 2, c: 2)', head: '(c: 3)' })?.members).toEqual([
    { change: 'removed', text: 'c: 2' },
    { change: 'changed', base: 'c: 2', head: 'c: 3' },
  ]);
});

test.for([
  { what: 'a dotted spread', base: '(...rest: 1)', head: '(...rest: 2)' },
  { what: 'a keyword before the name', base: '{ readonly a?: 1 }', head: '{ readonly a?: 2 }' },
  { what: "Ruby's splat", base: '(**opts)', head: '(**opts = {})' },
  { what: 'a generic', base: 'type A = Foo<1> | B;', head: 'type A = Foo<2> | B;' },
  { what: 'a method', base: '{ a(b: 1): 2 }', head: '{ a(b: 3): 2 }' },
  { what: 'a dollar in the name', base: '(a$: 1)', head: '(a$: 2)' },
])('$what pairs by its name', ({ base, head }) => {
  expect(signatureDiff({ base, head })?.members[0]?.change).toBe('changed');
});

test.for([
  { what: 'strings', base: "type A = 'a' | 'c';", head: "type A = 'b' | 'c';" },
  { what: 'destructured parameters', base: '({ a, b }: P)', head: '({ a, b }: Q)' },
  { what: 'a type after destructuring', base: '({ a }: P = 1)', head: '({ a }: P = 2)' },
  { what: 'a default after destructuring', base: '({ a } = P(1))', head: '({ a } = P(2))' },
  {
    what: 'a generic function',
    base: 'type A = <T = 1>() => 2 | C;',
    head: 'type A = <T = 3>() => 2 | C;',
  },
  {
    what: 'a function alternative',
    base: 'type A = (a: 1) => 2 | C;',
    head: 'type A = (a: 3) => 2 | C;',
  },
])('$what have no name to pair by', ({ base, head }) => {
  expect(
    signatureDiff({ base, head })
      ?.members.slice(0, 2)
      .map(({ change }) => change),
  ).toEqual(['removed', 'added']);
});

test("past the alignment's cap, a member of unchanged text still reads removed and added", () => {
  const members = Array.from({ length: 201 }, (_, index) => `m${index}: 1`);
  const lines = signatureDiff({
    base: `(${members.join(', ')})`,
    head: `(${members.toReversed().join(', ')})`,
  })?.members;
  expect(lines?.some(({ change }) => change === 'changed')).toBe(false);
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

test.for([
  { what: 'a base', sides: (long: string) => ({ base: long, head: '(c: 1)' }) },
  { what: 'a head', sides: (long: string) => ({ base: '(c: 1)', head: long }) },
])('$what past the longest signature read reads unsplit', ({ sides }) => {
  const sized = (length: number) => `(${'b'.repeat(length - 2)})`;
  expect(signatureDiff(sides(sized(LONGEST_SIGNATURE)))).toBeDefined();
  expect(signatureDiff(sides(sized(LONGEST_SIGNATURE + 1)))).toBeUndefined();
});

test.for([
  { what: 'a member gained', base: '(a)', head: '(a, b)', summary: '1 member added' },
  { what: 'members lost', base: '(a, b, c)', head: '(a)', summary: '2 members removed' },
  {
    what: 'each kind, the word on the first alone',
    base: '(a: 1, b, c: 1, d: 1)',
    head: '(a: 2, c: 2, d: 2, e, f)',
    summary: '2 members added, 3 changed, 1 removed',
  },
  {
    what: 'a changed opener',
    base: 'type A = { a: 1 }',
    head: 'type B = { a: 1 }',
    summary: 'type A = { → type B = {',
  },
  { what: 'a return type alone', base: '(a): X', head: '(a): Y', summary: '): X → ): Y' },
  {
    what: 'members and both edges',
    base: 'type A = { a: 1 };',
    head: 'type B = { a: 1; b: 2 }',
    summary: '1 member added, type A = { → type B = {, }; → }',
  },
  { what: 'an edge with one side', base: 'type A = X | Y;', head: 'type A = X | Y', summary: ';' },
  {
    what: 'a signature that does not split, whole',
    base: 'extends Y',
    head: 'extends Z',
    summary: 'extends Y → extends Z',
  },
])('$what sums up as $summary', ({ base, head, summary }) => {
  expect(signatureSummary({ base, head })).toBe(summary);
});
