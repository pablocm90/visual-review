import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import type { GraphDiff } from './diff-graphs.ts';
import { notesJsonSchema, notesProblems, type ReviewNotes, readNotes } from './notes.ts';

type NodeState = GraphDiff['nodes'][number]['state'];

const stack = { id: 'web', kind: 'stack', label: 'web', path: '', state: 'unchanged' } as const;

const webModule = (name: string, state: NodeState) => ({
  id: `web/module/${name}`,
  kind: 'module' as const,
  label: name,
  parent: 'web',
  path: `web/src/${name}`,
  state,
});

const webFile = (module: string, name: string, state: NodeState) => ({
  id: `web/file/${module}/${name}`,
  kind: 'file' as const,
  label: name,
  parent: `web/module/${module}`,
  path: `web/src/${module}/${name}`,
  state,
});

const diff: GraphDiff = {
  nodes: [
    stack,
    webModule('pages', 'modified'),
    webFile('pages', 'home.tsx', 'modified'),
    webFile('pages', 'header.tsx', 'unchanged'),
    webModule('utils', 'unchanged'),
    webFile('utils', 'format.ts', 'unchanged'),
    webModule('api', 'unchanged'),
    webFile('api', 'client.ts', 'unchanged'),
  ],
  edges: [
    { from: 'web/file/pages/home.tsx', to: 'web/file/utils/format.ts', state: 'added' },
    { from: 'web/file/pages/home.tsx', to: 'web/file/pages/header.tsx', state: 'unchanged' },
    { from: 'web/file/utils/format.ts', to: 'web/file/api/client.ts', state: 'unchanged' },
  ],
};

const notesWith = (overrides: Partial<ReviewNotes> = {}): ReviewNotes => ({
  version: 1,
  summary: [{ text: 'Home formats dates.', target: 'web/module/pages' }, { text: 'Web only.' }],
  tests: 'No test pins the date format.',
  notes: {
    'web/module/pages': { text: 'Home now formats dates.' },
    'web/module/pages -> web/module/utils': { text: 'Pages starts using utils.' },
  },
  ...overrides,
});

test('notes on every touched part of the collapsed view, keyed to nodes or to edges as drawn at any depth, have no problems', () => {
  expect(
    notesProblems({
      diff,
      notes: notesWith({
        notes: {
          ...notesWith().notes,
          'web/file/pages/home.tsx': { text: 'Calls format.' },
          'web/file/pages/home.tsx -> web/module/utils': { text: 'Imports format.' },
          'web/file/pages/home.tsx -> web/file/utils/format.ts': { text: 'Imports format.' },
        },
      }),
    }),
  ).toEqual([]);
});

test('a note on a hidden import covers the edge it is drawn into while its modules are collapsed', () => {
  expect(
    notesProblems({
      diff,
      notes: notesWith({
        notes: {
          'web/module/pages': { text: 'Home now formats dates.' },
          'web/file/pages/home.tsx -> web/file/utils/format.ts': { text: 'Imports format.' },
        },
      }),
    }),
  ).toEqual([]);
});

test('a stack that appears in the change is not asked for a note, since notes cannot name a stack', () => {
  expect(
    notesProblems({
      diff: { ...diff, nodes: [{ ...stack, state: 'added' }, ...diff.nodes.slice(1)] },
      notes: notesWith(),
    }),
  ).toEqual([]);
});

test.for([
  {
    problem: 'a note on a node that is not in the graph',
    notes: notesWith({ notes: { ...notesWith().notes, 'web/module/gone': { text: 'Removed.' } } }),
    expected: ['unknown id web/module/gone'],
  },
  {
    problem: 'a note on a stack',
    notes: notesWith({ notes: { ...notesWith().notes, web: { text: 'One stack.' } } }),
    expected: ['unknown id web'],
  },
  {
    problem: 'a note on an edge between parts that no import joins',
    notes: notesWith({
      notes: { ...notesWith().notes, 'web/module/utils -> web/module/pages': { text: 'Back.' } },
    }),
    expected: ['unknown id web/module/utils -> web/module/pages'],
  },
  {
    problem: 'a note on a module importing itself, which is never drawn',
    notes: notesWith({
      notes: { ...notesWith().notes, 'web/module/pages -> web/module/pages': { text: 'Header.' } },
    }),
    expected: ['unknown id web/module/pages -> web/module/pages'],
  },
  {
    problem: 'a summary item targeting something not in the graph',
    notes: notesWith({ summary: [{ text: 'Gone.', target: 'web/module/gone' }] }),
    expected: ['unknown id web/module/gone'],
  },
  {
    problem: 'a touched module with no note',
    notes: notesWith({
      notes: { 'web/module/pages -> web/module/utils': { text: 'Pages starts using utils.' } },
    }),
    expected: ['no note on web/module/pages'],
  },
  {
    problem: 'a changed edge of the collapsed view with no note',
    notes: notesWith({ notes: { 'web/module/pages': { text: 'Home now formats dates.' } } }),
    expected: ['no note on web/module/pages -> web/module/utils'],
  },
])('$problem is a problem', ({ notes, expected }) => {
  expect(notesProblems({ diff, notes })).toEqual(expected);
});

const notesFile = (text: string) => {
  const directory = mkdtempSync(join(tmpdir(), 'visual-review-notes-'));
  const file = join(directory, 'x.notes.json');
  writeFileSync(file, text);
  return { file, [Symbol.dispose]: () => rmSync(directory, { recursive: true, force: true }) };
};

test.for([
  {
    problem: 'no version',
    contents: { summary: [], tests: '', notes: {} },
    reason: 'no "version"',
  },
  {
    problem: 'a later version, whatever its shape',
    contents: { version: 2, comments: [] },
    reason: 'version 2 is unknown',
  },
  {
    problem: 'the version as a string',
    contents: { version: '1', summary: [], tests: '', notes: {} },
    reason: 'version "1" is unknown',
  },
])(
  'a notes file with $problem is rejected naming the file and the version this CLI reads',
  async ({ contents, reason }) => {
    using notes = notesFile(JSON.stringify(contents));

    await expect(readNotes(notes.file)).rejects.toThrow(
      new Error(`Invalid notes file ${notes.file}: ${reason}; this visual-review reads version 1`),
    );
  },
);

test('a notes file that is not JSON is rejected naming the file', async () => {
  using notes = notesFile('{ "version": 1,');

  await expect(readNotes(notes.file)).rejects.toThrow(
    `Invalid notes file ${notes.file}: SyntaxError`,
  );
});

test.for([
  { level: 'the file', overrides: { note: {} }, key: 'note' },
  {
    level: 'a summary item',
    overrides: { summary: [{ text: 'Web only.', targets: 'web' }] },
    key: 'targets',
  },
  {
    level: 'a note',
    overrides: { notes: { 'web/module/pages': { text: 'Formats.', flags: 'cycle' } } },
    key: 'flags',
  },
])(
  'an unknown key on $level is rejected naming the file and the key',
  async ({ overrides, key }) => {
    using notes = notesFile(JSON.stringify({ ...notesWith(), ...overrides }));

    await expect(readNotes(notes.file)).rejects.toThrow(
      new RegExp(`^Invalid notes file ${notes.file}: .*"${key}"`, 's'),
    );
  },
);

test('a notes file may name its schema', async () => {
  using notes = notesFile(
    JSON.stringify({
      $schema: 'https://unpkg.com/@pablocm90/visual-review@0.1/dist/notes.schema.json',
      ...notesWith(),
    }),
  );

  await expect(readNotes(notes.file)).resolves.toMatchObject(notesWith());
});

test('the published notes schema marks no field read-only, since notes are written by hand or by agents', () => {
  expect(JSON.stringify(notesJsonSchema())).not.toContain('readOnly');
});
