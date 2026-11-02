import { expect, test } from 'vitest';
import { findingOn } from '../test-support/page-data.ts';
import type { GraphDiff } from './diff-graphs.ts';
import { type Finding, findingsAt, findingsOf, lookFirst } from './findings.ts';
import { parseNotes } from './notes.ts';

const notesWith = (notes: Readonly<Record<string, unknown>>) =>
  parseNotes({
    text: JSON.stringify({ version: 1, summary: [], tests: 'None.', notes }),
    file: 'notes.json',
  });

test("a flagged note is a finding to look at on the note's id, in the dimension it names, else structure; a note without a flag raises none", () => {
  const raised = findingOn('web/file/a.ts');
  const notes = notesWith({
    'web/file/a.ts': { text: 'Calls the api.', flag: 'no retry', dimension: 'failure' },
    'web -> api': { text: 'Reaches in.', flag: 'layer skipped' },
    'web/file/b.ts': { text: 'Formats.' },
  });

  expect(findingsOf({ data: { findings: [raised] }, notes })).toStrictEqual([
    raised,
    {
      id: 'notes:web/file/a.ts',
      dimension: 'failure',
      level: 'look',
      target: 'web/file/a.ts',
      title: 'no retry',
    },
    {
      id: 'notes:web -> api',
      dimension: 'structure',
      level: 'look',
      target: 'web -> api',
      title: 'layer skipped',
    },
  ]);
});

test('without notes, the findings are the raised ones', () => {
  const raised = findingOn('web/file/a.ts');

  expect(findingsOf({ data: { findings: [raised] }, notes: undefined })).toStrictEqual([raised]);
});

const look = (target: string | undefined, id: string): Finding => ({
  id,
  dimension: 'structure',
  level: 'look',
  ...(target !== undefined && { target }),
  title: id,
});

const measured = (fanIn: number, churn: number) => ({ head: { fanIn, fanOut: 0, churn } });

test('look first holds the findings to look at: untargeted ones first, then by the fan-in of their target, or of the busier end of an edge, then by its churn, then by id; one with no metrics last', () => {
  const findings = [
    findingOn('a', { id: 'info on a' }),
    look('d', 'on d, unmeasured'),
    look('a', 'on a'),
    look('c', 'on c'),
    look('b', 'on b'),
    look('d -> b', 'on d -> b'),
    look('b -> d', 'on b -> d'),
    look(undefined, 'untargeted z'),
    look(undefined, 'untargeted y'),
  ];
  const metrics = { a: measured(3, 1), b: measured(5, 0), c: measured(3, 4) };

  expect(lookFirst({ findings, metrics }).map(finding => finding.id)).toStrictEqual([
    'untargeted y',
    'untargeted z',
    'on b',
    'on b -> d',
    'on d -> b',
    'on c',
    'on a',
    'on d, unmeasured',
  ]);
});

const boxed = (id: string, parent: string) => ({
  id,
  kind: 'module' as const,
  label: id,
  parent,
  path: id,
  state: 'unchanged' as const,
});

test('a finding is drawn on its node, or on the closed box holding it, an edge finding on the edge drawn in its place, and an untargeted one nowhere', () => {
  const diff: GraphDiff = {
    nodes: [
      { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' },
      boxed('pages', 'web'),
      boxed('pages/home', 'pages'),
      boxed('utils', 'web'),
      boxed('utils/format', 'utils'),
    ],
    edges: [{ from: 'pages/home', to: 'utils/format', state: 'added' }],
  };
  const onHome = findingOn('pages/home');
  const onFormat = findingOn('utils/format');
  const onEdge = findingOn('pages/home -> utils/format', { id: 'edge' });
  const untargeted = look(undefined, 'untargeted');
  const findings = [onHome, onFormat, onEdge, untargeted];

  expect(findingsAt({ diff, expanded: new Set(['pages']), findings })).toStrictEqual(
    new Map([
      ['pages/home', [onHome]],
      ['utils', [onFormat]],
      ['pages/home -> utils', [onEdge]],
    ]),
  );
});
