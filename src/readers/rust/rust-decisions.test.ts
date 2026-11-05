import { expect, test } from 'vitest';
import { rustReader } from './reader.ts';

const decisionsIn = (...lines: ReadonlyArray<string>) =>
  rustReader
    .symbols?.(['fn charge() {', ...lines, '}'].join('\n'), 'src/shop.rs')
    ?.symbols.find(({ name }) => name === 'charge')?.decisions;

test('an if that returns first reads as a guard, on its own line', () => {
  expect(decisionsIn('go();', 'if c { return 1; }')).toEqual([
    { kind: 'guard', text: 'if c return', depth: 0, line: 3 },
  ]);
});

test('an if that does something before it returns is no guard', () => {
  expect(decisionsIn('if c { go(); return 1; }')?.map(({ kind }) => kind)).not.toContain('guard');
});

test.for(['bail!("no");', 'anyhow::bail!("no")'])(
  'an if that opens with %s reads as a guard, found by name',
  exit => {
    expect(decisionsIn(`if c { ${exit} }`)).toEqual([
      { kind: 'guard', text: 'if c return', foundByName: true, depth: 0, line: 2 },
    ]);
  },
);

test('a macro of another name is no exit', () => {
  expect(decisionsIn('if c { log!("no"); }')?.map(({ kind }) => kind)).not.toContain('guard');
});

test('an if that returns first but has an else is no guard', () => {
  expect(decisionsIn('if c { return 1; } else { go(); }')?.map(({ kind }) => kind)).not.toContain(
    'guard',
  );
});

test('an if reads on its own line, and what its branches hold one deeper', () => {
  expect(decisionsIn('if c {', 'if d { go(); }', '} else {', 'if e { go(); }', '}')).toEqual([
    { kind: 'if', text: 'if c', depth: 0, line: 2 },
    { kind: 'if', text: 'if d', depth: 1, line: 3 },
    { kind: 'if', text: 'if e', depth: 1, line: 5 },
  ]);
});

test.for(['let Some(x) = y', 'let Some(x) = y && z'])('an if on %s reads as written', condition => {
  expect(decisionsIn(`if ${condition} { go(); }`)).toEqual([
    { kind: 'if', text: `if ${condition}`, depth: 0, line: 2 },
  ]);
});

test('an exit after a leading comment is still first', () => {
  expect(decisionsIn('if c {', '// why', 'return 1;', '}')?.map(({ kind }) => kind)).toEqual([
    'guard',
  ]);
});

test('what the exit itself holds reads one deeper, and what follows it is dead', () => {
  expect(decisionsIn('if c {', 'return if d { 1 } else { 2 };', 'if e { go(); }', '}')).toEqual([
    { kind: 'guard', text: 'if c return', depth: 0, line: 2 },
    { kind: 'if', text: 'if d', depth: 1, line: 3 },
  ]);
});

test('a condition reads without its comments, line breaks and spacing, strings as written', () => {
  expect(
    decisionsIn('if a', '  .b( /* why */ "x  y",', '  c, )', '{ go(); }')?.map(({ text }) => text),
  ).toEqual(['if a.b("x  y", c)']);
});

test('an else if reads as an if at the depth of the if it follows, and is never a guard', () => {
  expect(
    decisionsIn('if c {', 'go();', '} else if d {', 'return 1;', '} else {', 'if e { go(); }', '}'),
  ).toEqual([
    { kind: 'if', text: 'if c', depth: 0, line: 2 },
    { kind: 'if', text: 'else if d', depth: 0, line: 4 },
    { kind: 'if', text: 'if e', depth: 1, line: 7 },
  ]);
});

test('a last else if that returns first is no guard', () => {
  expect(decisionsIn('if c { go(); } else if d { return 1; }')?.map(({ kind }) => kind)).toEqual([
    'if',
    'if',
  ]);
});

test.for(['Err(e)', 'std::result::Result::Err(e)'])('an if let on %s reads as a catch', pattern => {
  expect(decisionsIn(`if let ${pattern} = x {`, 'if d { go(); }', '}')).toEqual([
    { kind: 'catch', text: `if let ${pattern} = x`, depth: 0, line: 2 },
    { kind: 'if', text: 'if d', depth: 1, line: 3 },
  ]);
});

test.for(['let Err(e) = x && y', 'let Err(e) | Ok(e) = x', 'let Error(e) = x'])(
  'an if on %s is no catch',
  condition => {
    expect(decisionsIn(`if ${condition} { go(); }`)?.map(({ kind }) => kind)).toEqual(['if']);
  },
);

test('an if let on Err that returns first stays a guard', () => {
  expect(decisionsIn('if let Err(e) = x { return 1; }')).toEqual([
    { kind: 'guard', text: 'if let Err(e) = x return', depth: 0, line: 2 },
  ]);
});

test('a let else reads as a guard, and its block one deeper', () => {
  expect(decisionsIn('let Some(a) = b else {', 'if d { go(); }', 'return;', '};')).toEqual([
    { kind: 'guard', text: 'let Some(a) = b else', depth: 0, line: 2 },
    { kind: 'if', text: 'if d', depth: 1, line: 3 },
  ]);
});

test('a plain let reads what its value holds', () => {
  expect(decisionsIn('let a = if d { 1 } else { 2 };')).toEqual([
    { kind: 'if', text: 'if d', depth: 0, line: 2 },
  ]);
});

test.for([
  { written: 'ensure!(a, "no")', text: 'ensure!(a)' },
  { written: 'anyhow::ensure!(a)', text: 'ensure!(a)' },
  { written: 'assert!(f(a, b), "no {}", c)', text: 'assert!(f(a, b))' },
  { written: 'assert_eq!(a, f(b, c), "no")', text: 'assert_eq!(a, f(b, c))' },
  { written: 'assert_ne!(a, b)', text: 'assert_ne!(a, b)' },
  { written: 'assert![a, "no"]', text: 'assert![a]' },
])('$written reads as a guard found by name, with no message', ({ written, text }) => {
  expect(decisionsIn(`${written};`)).toEqual([
    { kind: 'guard', text, foundByName: true, depth: 0, line: 2 },
  ]);
});

test('debug_assert! is no guard', () => {
  expect(decisionsIn('debug_assert!(a);')).toEqual([]);
});

test('a match arm reads as a case with its guard, what its value holds one deeper', () => {
  expect(
    decisionsIn(
      'match if a { b } else { c } {',
      'Some(x) if y => if d { 1 } else { 2 },',
      '_ => 3,',
      '}',
    ),
  ).toEqual([
    { kind: 'if', text: 'if a', depth: 0, line: 2 },
    { kind: 'case', text: 'Some(x) if y =>', depth: 0, line: 3 },
    { kind: 'if', text: 'if d', depth: 1, line: 3 },
    { kind: 'case', text: '_ =>', depth: 0, line: 4 },
  ]);
});

test.for(['Err(e)', 'Err(e) if y', 'Result::Err(e)', 'Err(a) | Err(b) | Ok(c)'])(
  'an arm on %s reads as a catch',
  pattern => {
    expect(decisionsIn('match x {', `${pattern} => 1,`, '}')).toEqual([
      { kind: 'catch', text: `${pattern} =>`, depth: 0, line: 3 },
    ]);
  },
);

test('an arm whose first pattern is another reads as a case', () => {
  expect(decisionsIn('match x { Ok(a) | Err(a) => 1 }')?.map(({ kind }) => kind)).toEqual(['case']);
});
