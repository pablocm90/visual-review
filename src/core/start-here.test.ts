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
