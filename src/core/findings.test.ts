import { expect, test } from 'vitest';
import { findingOn } from '../test-support/page-data.ts';
import type { GraphDiff } from './diff-graphs.ts';
import { type Finding, findingsAt, findingsOf } from './findings.ts';
import { parseNotes } from './notes.ts';

const notesWith = (notes: Readonly<Record<string, unknown>>) =>
  parseNotes({
    text: JSON.stringify({ version: 2, summary: [], tests: 'None.', notes }),
    file: 'notes.json',
  });

const webFile = (name: string) => ({
  id: `web/file/${name}`,
  kind: 'file' as const,
  label: name,
  parent: 'web',
  path: `web/src/${name}`,
  state: 'modified' as const,
});

const dataWith = (findings: ReadonlyArray<Finding>) => ({
  findings,
  diff: {
    nodes: [
      { id: 'web', kind: 'stack' as const, label: 'web', path: '', state: 'unchanged' as const },
      webFile('a.ts'),
      webFile('b.ts'),
    ],
    edges: [],
  },
  tests: [{ path: 'web/src/a.test.ts', stack: 'web', statements: [] }],
});

test("a flagged note is a finding to look at on the note's id, in the dimension it names, else structure; a note without a flag raises none", () => {
  const raised = findingOn('web/file/a.ts');
  const notes = notesWith({
    'part web/file/a.ts': { text: 'Calls the api.', flag: 'no retry', dimension: 'failure' },
    'edge web/file/a.ts -> web/file/b.ts': { text: 'Reaches in.', flag: 'layer skipped' },
    'part web/file/b.ts': { text: 'Formats.' },
  });

  expect(findingsOf({ data: dataWith([raised]), notes })).toStrictEqual([
    raised,
    {
      id: 'notes:part web/file/a.ts',
      check: 'flag',
      dimension: 'failure',
      level: 'look',
      target: 'web/file/a.ts',
      title: 'no retry',
    },
    {
      id: 'notes:edge web/file/a.ts -> web/file/b.ts',
      check: 'flag',
      dimension: 'structure',
      level: 'look',
      target: 'web/file/a.ts -> web/file/b.ts',
      title: 'layer skipped',
    },
  ]);
});

test('without notes, the findings are the raised ones', () => {
  const raised = findingOn('web/file/a.ts');

  expect(findingsOf({ data: dataWith([raised]), notes: undefined })).toStrictEqual([raised]);
});

test("a flag on a function or one of its logic lines is a finding on the function's file, and one on a test a finding on the node its file tests", () => {
  const notes = notesWith({
    'symbol web/file/b.ts#run': { text: 'Runs twice.', flag: 'not idempotent' },
    'decision web/file/b.ts#run#ready': { text: 'Waits.', flag: 'never ready' },
    'test web/src/a.test.ts#formats dates': { text: 'Pins it.', flag: 'pins a locale' },
  });

  expect(
    findingsOf({ data: dataWith([]), notes }).map(({ id, target }) => ({ id, target })),
  ).toStrictEqual([
    { id: 'notes:symbol web/file/b.ts#run', target: 'web/file/b.ts' },
    { id: 'notes:decision web/file/b.ts#run#ready', target: 'web/file/b.ts' },
    { id: 'notes:test web/src/a.test.ts#formats dates', target: 'web/file/a.ts' },
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
  const untargeted: Finding = {
    id: 'untargeted',
    check: 'flag',
    dimension: 'structure',
    level: 'look',
    title: 'untargeted',
  };
  const findings = [onHome, onFormat, onEdge, untargeted];

  expect(findingsAt({ diff, expanded: new Set(['pages']), findings })).toStrictEqual(
    new Map([
      ['pages/home', [onHome]],
      ['utils', [onFormat]],
      ['pages/home -> utils', [onEdge]],
    ]),
  );
});
