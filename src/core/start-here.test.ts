import { expect, test } from 'vitest';
import { findingOn } from '../test-support/page-data.ts';
import type { Check } from './checks.ts';
import type { Finding } from './findings.ts';
import type { GraphNode } from './graph.ts';
import { startHere } from './start-here.ts';

const fileNode = (label: string): GraphNode => ({
  id: `web/file/${label}`,
  kind: 'file',
  label,
  path: label,
});

const raisedOver = (
  check: Check,
  level: Finding['level'],
  count: number,
  files: number,
): ReadonlyArray<Finding> =>
  Array.from({ length: count }, (_, at) =>
    findingOn(`web/file/${at % files}.ts`, { id: `${check}:${at}`, check, level, title: `${at}` }),
  );

const nodes = Array.from({ length: 9 }, (_, at) => fileNode(`${at}.ts`));

test("a check's findings at one level make one line, counted, with the files they fall in", () => {
  const findings = [
    ...raisedOver('api:added', 'info', 30, 9),
    ...raisedOver('api:signature', 'look', 7, 4),
  ];

  const { lines } = startHere({ findings, metrics: {}, nodes });

  expect(lines.map(({ level, title, files }) => ({ level, title, files }))).toStrictEqual([
    { level: 'look', title: '7 exported signatures changed', files: 4 },
    { level: 'info', title: '30 exported symbols added', files: 9 },
  ]);
  expect(lines[0]?.names).toStrictEqual(['0.ts', '1.ts', '2.ts', '3.ts']);
  expect(lines[0]?.findings).toHaveLength(7);
});

test('a line of one finding reads its own title, and a note flag is always a line of its own', () => {
  const flag = (id: string) =>
    findingOn('web/file/0.ts', { id, check: 'flag', title: `said ${id}` });
  const findings = [flag('notes:a'), flag('notes:b'), ...raisedOver('api:added', 'info', 1, 1)];

  const { lines } = startHere({ findings, metrics: {}, nodes });

  expect(lines.map(line => line.title)).toStrictEqual(['0', 'said notes:a', 'said notes:b']);
});

const flagOn = (target: string | undefined, id: string): Finding => ({
  id,
  check: 'flag',
  dimension: 'structure',
  level: 'look',
  ...(target !== undefined && { target }),
  title: id,
});

const measured = (fanIn: number, churn: number) => ({ head: { fanIn, fanOut: 0, churn } });

const keysOf = (options: Parameters<typeof startHere>[0]) =>
  startHere(options).lines.map(line => line.key);

test('lines to look at rank untargeted first, then by the fan-in of their target, or of the busier end of an edge, then by its churn, then by id; one with no metrics last; information comes after them all', () => {
  const findings = [
    findingOn('a', { id: 'info on a', check: 'flag' }),
    flagOn('d', 'on d, unmeasured'),
    flagOn('a', 'on a'),
    flagOn('c', 'on c'),
    flagOn('b', 'on b'),
    flagOn('d -> b', 'on d -> b'),
    flagOn('b -> d', 'on b -> d'),
    flagOn(undefined, 'untargeted z'),
    flagOn(undefined, 'untargeted y'),
  ];
  const metrics = { a: measured(3, 1), b: measured(5, 0), c: measured(3, 4) };

  expect(keysOf({ findings, metrics, nodes: [] }).slice(0, 5)).toStrictEqual([
    'untargeted y',
    'untargeted z',
    'on b',
    'on b -> d',
    'on d -> b',
  ]);
  expect(keysOf({ findings: findings.slice(0, 5), metrics, nodes: [] })).toStrictEqual([
    'on b',
    'on c',
    'on a',
    'on d, unmeasured',
    'info on a',
  ]);
});

test('what was not read ranks ahead of what has no target but was read, which ranks ahead of a target', () => {
  const noTarget = (check: Check, id: string): Finding => ({
    id,
    check,
    dimension: check.startsWith('schema')
      ? 'schema'
      : check.startsWith('dep')
        ? 'dependencies'
        : 'structure',
    level: 'look',
    title: id,
  });
  const findings = [
    flagOn('a', 'on a'),
    noTarget('dependencies:direct', 'a direct dependency'),
    noTarget('dependencies:not-read', 'x lockfile not read'),
    noTarget('structure:skipped', 'x reader skipped'),
  ];

  expect(keysOf({ findings, metrics: {}, nodes: [] })).toStrictEqual([
    'dependencies:not-read look',
    'structure:skipped look',
    'dependencies:direct look',
    'on a',
  ]);
  expect(
    keysOf({
      findings: [
        noTarget('schema:migration-risk', 'a migration risk'),
        noTarget('schema:not-read', 'x migration not read'),
      ],
      metrics: {},
      nodes: [],
    }),
  ).toStrictEqual(['schema:not-read look', 'schema:migration-risk look']);
});

test('at most five lines show, the counts still taking in every finding', () => {
  const kinds: ReadonlyArray<Check> = [
    'api:removed',
    'api:signature',
    'logic:removed',
    'tests:untested-logic',
    'metrics:lines',
    'metrics:abc',
  ];
  const findings = [
    ...kinds.flatMap(check => raisedOver(check, 'look', 2, 1)),
    ...raisedOver('api:added', 'info', 3, 1),
  ];

  const { lines, look, total } = startHere({ findings, metrics: {}, nodes });

  expect(lines).toHaveLength(5);
  expect({ look, total }).toStrictEqual({ look: 12, total: 15 });
});

test.for([
  {
    reason: "a finding's file names it and counts",
    finding: { file: 'pnpm-lock.yaml' },
    names: ['pnpm-lock.yaml'],
    files: 1,
  },
  {
    reason: 'a module is named and counts as a file',
    finding: { target: 'web/module/utils' },
    names: ['utils'],
    files: 1,
  },
  {
    reason: 'a stack is named and is not called a file',
    finding: { target: 'web' },
    names: ['web'],
    files: 0,
  },
  {
    reason: 'a package is named and is not called a file',
    finding: { target: 'rust/crate/core' },
    names: ['core'],
    files: 0,
  },
  {
    reason: 'an edge is named by its ends and is not called a file',
    finding: { target: 'web/module/utils -> web' },
    names: ['utils → web'],
    files: 0,
  },
  {
    reason: 'a target no node holds goes by its id',
    finding: { target: 'gone' },
    names: ['gone'],
    files: 0,
  },
  { reason: 'nothing to name', finding: {}, names: [], files: 0 },
])('$reason', ({ finding, names, files }) => {
  const drawn: ReadonlyArray<GraphNode> = [
    { id: 'web', kind: 'stack', label: 'web', path: '' },
    { id: 'rust/crate/core', kind: 'package', label: 'core', path: 'core' },
    { id: 'web/module/utils', kind: 'module', label: 'utils', path: 'utils' },
  ];
  const raised: Finding = {
    id: 'x',
    check: 'api:added',
    dimension: 'api',
    level: 'info',
    title: 'x',
    ...finding,
  };

  const { lines } = startHere({ findings: [raised], metrics: {}, nodes: drawn });

  expect({ names: lines[0]?.names, files: lines[0]?.files }).toStrictEqual({ names, files });
});
