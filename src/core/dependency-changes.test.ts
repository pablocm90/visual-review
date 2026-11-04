import { expect, test } from 'vitest';
import { packageChanges } from './dependency-changes.ts';
import type { LockedPackages } from './lockfile.ts';

const locked = (
  versions: Readonly<Record<string, ReadonlyArray<string>>>,
  direct: ReadonlyArray<string> = [],
): LockedPackages => ({
  versions: new Map(Object.entries(versions)),
  direct: new Set(direct),
});

const changeOf = (from: ReadonlyArray<string>, to: ReadonlyArray<string>) =>
  packageChanges({ before: locked({ zod: from }), after: locked({ zod: to }) }).map(
    ({ change }) => change,
  );

test.for([
  { move: 'across the first number', from: '1.4.0', to: '2.0.0' },
  { move: 'down across the first number', from: '2.0.0', to: '1.4.0' },
  { move: 'across a 0.x minor', from: '0.2.1', to: '0.3.0' },
  { move: 'across a 0.0.x patch', from: '0.0.3', to: '0.0.4' },
  { move: 'between non-numeric versions', from: 'abc123', to: 'def456' },
  { move: 'between hashes that start alike', from: '1abc', to: '1def' },
  { move: 'from an all-zero version', from: '0.0.0', to: '0.0.1' },
])('a bump $move is major', ({ from, to }) => {
  expect(changeOf([from], [to])).toEqual(['major']);
});

test.for([
  { move: 'a minor', from: '1.4.0', to: '1.9.2' },
  { move: 'a 0.x patch', from: '0.2.1', to: '0.2.9' },
  { move: 'a prerelease to its release', from: '5-rc.1', to: '5.0.0' },
  { move: 'a Ruby prerelease to its release', from: '8.0.0.rc1', to: '8.0.1' },
  { move: 'a build to another', from: '5+a', to: '5+b' },
  { move: 'an all-zero prerelease to another', from: '0.0.0-canary.1', to: '0.0.0-canary.2' },
  { move: 'an all-zero prerelease to its release', from: '0.0.0-canary.1', to: '0.0.0' },
])('$move raises nothing', ({ from, to }) => {
  expect(changeOf([from], [to])).toEqual([]);
});

test('a copy of a package on a new line is major, and so is dropping one', () => {
  expect(changeOf(['17.0.2'], ['16.13.1', '17.0.2'])).toEqual(['major']);
  expect(changeOf(['16.13.1', '17.0.2'], ['17.0.2'])).toEqual(['major']);
});

test('moves within the lines a package holds raise nothing', () => {
  expect(changeOf(['16.13.1', '17.0.2'], ['16.14.0', '17.0.3'])).toEqual([]);
});

test('a package added or removed says so, with its versions, direct or not', () => {
  expect(
    packageChanges({
      before: locked({ gone: ['1.0.0'] }),
      after: locked({ fresh: ['2.0.0'], jodit: ['4.14.7'] }, ['jodit']),
    }),
  ).toEqual([
    { name: 'fresh', change: 'added', direct: false, from: [], to: ['2.0.0'] },
    { name: 'gone', change: 'removed', direct: false, from: ['1.0.0'], to: [] },
    { name: 'jodit', change: 'added', direct: true, from: [], to: ['4.14.7'] },
  ]);
});

test('a package is direct if the project declares it on either side', () => {
  const directnessOf = (before: ReadonlyArray<string>, after: ReadonlyArray<string>) =>
    packageChanges({
      before: locked({ zod: ['3.0.0'] }, before),
      after: locked({ zod: ['4.0.0'] }, after),
    }).map(({ direct }) => direct);
  expect(directnessOf(['zod'], [])).toEqual([true]);
  expect(directnessOf([], ['zod'])).toEqual([true]);
  expect(directnessOf([], [])).toEqual([false]);
});

test('a declaration changing at one line says the package is now direct, or no longer', () => {
  const declared = (before: ReadonlyArray<string>, after: ReadonlyArray<string>) =>
    packageChanges({
      before: locked({ url: ['2.5.8'] }, before),
      after: locked({ url: ['2.5.9'] }, after),
    });
  expect(declared([], ['url'])).toEqual([
    { name: 'url', change: 'now-direct', direct: true, from: ['2.5.8'], to: ['2.5.9'] },
  ]);
  expect(declared(['url'], [])).toEqual([
    { name: 'url', change: 'no-longer-direct', direct: true, from: ['2.5.8'], to: ['2.5.9'] },
  ]);
  expect(declared(['url'], ['url'])).toEqual([]);
});

test('a name only declared, with no version locked, is no change: a local package', () => {
  expect(packageChanges({ before: locked({}), after: locked({}, ['sibling']) })).toEqual([]);
});
