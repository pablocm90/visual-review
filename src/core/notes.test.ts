import { expect, test } from 'vitest';
import { z } from 'zod';
import type { DiffedNode, GraphDiff } from './diff-graphs.ts';
import {
  type Note,
  notesJsonSchema,
  notesProblems,
  parseNotes,
  type ReviewNotes,
  visibleNotes,
} from './notes.ts';
import type { SymbolFile } from './read-range.ts';
import type { TestFile } from './test-changes.ts';

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

const symbols: ReadonlyArray<SymbolFile> = [
  {
    node: 'web/file/pages/home.tsx',
    stack: 'web',
    symbols: [
      {
        name: 'run',
        kind: 'function',
        lines: {},
        exported: {},
        change: 'edited',
        logic: [{ change: 'added', kind: 'if', depth: 0, head: 'ready', line: 3 }],
      },
    ],
    exports: { added: [], removed: [] },
    kind: 'logic',
  },
  { node: 'web/file/pages/header.tsx', stack: 'web', unreadable: 'Unexpected token' },
];

const tests: ReadonlyArray<TestFile> = [
  {
    path: 'web/src/pages/home.test.tsx',
    stack: 'web',
    statements: [
      {
        kind: 'heading',
        name: 'home',
        children: [{ kind: 'test', name: 'formats dates', change: 'added' }],
      },
    ],
  },
];

const notesWith = (overrides: Partial<ReviewNotes> = {}): ReviewNotes => ({
  version: 2,
  summary: [{ text: 'Home formats dates.', target: 'web/module/pages' }, { text: 'Web only.' }],
  tests: 'No test pins the date format.',
  notes: {
    'part web/module/pages': { text: 'Home now formats dates.' },
    'edge web/module/pages -> web/module/utils': { text: 'Pages starts using utils.' },
  },
  ...overrides,
});

test('notes on every touched part of the collapsed view, keyed to nodes or to edges as drawn at any depth, have no problems', () => {
  expect(
    notesProblems({
      symbols,
      tests,
      diff,
      said: [],
      notes: notesWith({
        notes: {
          ...notesWith().notes,
          'part web/file/pages/home.tsx': { text: 'Calls format.' },
          'edge web/file/pages/home.tsx -> web/module/utils': { text: 'Imports format.' },
          'edge web/file/pages/home.tsx -> web/file/utils/format.ts': {
            text: 'Imports format.',
            flag: 'a new dependency',
          },
          'symbol web/file/pages/home.tsx#run': { text: 'Runs once.', why: 'Idempotent.' },
          'decision web/file/pages/home.tsx#run#ready': { text: 'Waits until ready.' },
          'test web/src/pages/home.test.tsx#home › formats dates': { text: 'Pins the format.' },
        },
      }),
    }),
  ).toEqual([]);
});

test('a note on a hidden import covers the edge it is drawn into while its modules are collapsed', () => {
  expect(
    notesProblems({
      symbols,
      tests,
      diff,
      said: [],
      notes: notesWith({
        notes: {
          'part web/module/pages': { text: 'Home now formats dates.' },
          'edge web/file/pages/home.tsx -> web/file/utils/format.ts': { text: 'Imports format.' },
        },
      }),
    }),
  ).toEqual([]);
});

test('a stack that appears in the change is not asked for a note, since notes cannot name a stack', () => {
  expect(
    notesProblems({
      symbols,
      tests,
      diff: { ...diff, nodes: [{ ...stack, state: 'added' }, ...diff.nodes.slice(1)] },
      said: [],
      notes: notesWith(),
    }),
  ).toEqual([]);
});

test('a note may be keyed by an edge between its ends or any of the boxes above them, nested at any depth', () => {
  const deep: GraphDiff = {
    nodes: [
      stack,
      webModule('pages', 'unchanged'),
      { ...webModule('pages/home', 'unchanged'), parent: 'web/module/pages' },
      webFile('pages/home', 'index.tsx', 'unchanged'),
      webModule('utils', 'unchanged'),
    ],
    edges: [{ from: 'web/file/pages/home/index.tsx', to: 'web/module/utils', state: 'added' }],
  };

  expect(
    notesProblems({
      symbols,
      tests,
      diff: deep,
      said: [],
      notes: notesWith({
        notes: {
          'edge web/module/pages -> web/module/utils': { text: 'Pages uses utils.' },
          'edge web/module/pages/home -> web/module/utils': { text: 'Home uses utils.' },
          'edge web/file/pages/home/index.tsx -> web/module/utils': { text: 'Its index does.' },
          'edge web/module/utils -> web/module/pages/home': { text: 'Backwards.' },
        },
      }),
    }),
  ).toEqual(['unknown key edge web/module/utils -> web/module/pages/home']);
});

test.for([
  {
    problem: 'a note on a node that is not in the graph',
    notes: notesWith({
      notes: { ...notesWith().notes, 'part web/module/gone': { text: 'Removed.' } },
    }),
    expected: ['unknown key part web/module/gone'],
  },
  {
    problem: 'a note on a stack',
    notes: notesWith({ notes: { ...notesWith().notes, 'part web': { text: 'One stack.' } } }),
    expected: ['unknown key part web'],
  },
  {
    problem: 'a part note keyed by an edge',
    notes: notesWith({
      notes: {
        ...notesWith().notes,
        'part web/module/pages -> web/module/utils': { text: 'Uses utils.' },
      },
    }),
    expected: ['unknown key part web/module/pages -> web/module/utils'],
  },
  {
    problem: 'an edge note keyed by a node',
    notes: notesWith({
      notes: { ...notesWith().notes, 'edge web/module/pages': { text: 'Formats.' } },
    }),
    expected: ['unknown key edge web/module/pages'],
  },
  {
    problem: 'a note on an edge between parts that no import joins',
    notes: notesWith({
      notes: {
        ...notesWith().notes,
        'edge web/module/utils -> web/module/pages': { text: 'Back.' },
      },
    }),
    expected: ['unknown key edge web/module/utils -> web/module/pages'],
  },
  {
    problem: 'a note on a module importing itself, which is never drawn',
    notes: notesWith({
      notes: {
        ...notesWith().notes,
        'edge web/module/pages -> web/module/pages': { text: 'Header.' },
      },
    }),
    expected: ['unknown key edge web/module/pages -> web/module/pages'],
  },
  {
    problem: 'a note on a symbol its file does not hold',
    notes: notesWith({
      notes: { ...notesWith().notes, 'symbol web/file/pages/home.tsx#stop': { text: 'Stops.' } },
    }),
    expected: ['unknown key symbol web/file/pages/home.tsx#stop'],
  },
  {
    problem: 'a note on a symbol of a file whose symbols were not read',
    notes: notesWith({
      notes: { ...notesWith().notes, 'symbol web/file/pages/header.tsx#run': { text: 'Runs.' } },
    }),
    expected: ['unknown key symbol web/file/pages/header.tsx#run'],
  },
  {
    problem: 'a note on a decision its function does not hold',
    notes: notesWith({
      notes: {
        ...notesWith().notes,
        'decision web/file/pages/home.tsx#run#done': { text: 'Waits.' },
      },
    }),
    expected: ['unknown key decision web/file/pages/home.tsx#run#done'],
  },
  {
    problem: 'a flag on a decision note',
    notes: notesWith({
      notes: {
        ...notesWith().notes,
        'decision web/file/pages/home.tsx#run#ready': { text: 'Waits.', flag: 'never ready' },
      },
    }),
    expected: [
      'flag on decision web/file/pages/home.tsx#run#ready: only a part or edge note takes a flag',
    ],
  },
  {
    problem: 'a note on a test its file does not hold',
    notes: notesWith({
      notes: {
        ...notesWith().notes,
        'test web/src/pages/home.test.tsx#formats dates': { text: 'Pins the format.' },
      },
    }),
    expected: ['unknown key test web/src/pages/home.test.tsx#formats dates'],
  },
  {
    problem: 'a flag on a test note',
    notes: notesWith({
      notes: {
        ...notesWith().notes,
        'test web/src/pages/home.test.tsx#home › formats dates': {
          text: 'Pins the format.',
          flag: 'pins a locale',
        },
      },
    }),
    expected: [
      'flag on test web/src/pages/home.test.tsx#home › formats dates: only a part or edge note takes a flag',
    ],
  },
  {
    problem: 'a flag on a symbol note',
    notes: notesWith({
      notes: {
        ...notesWith().notes,
        'symbol web/file/pages/home.tsx#run': { text: 'Runs twice.', flag: 'not idempotent' },
      },
    }),
    expected: ['flag on symbol web/file/pages/home.tsx#run: only a part or edge note takes a flag'],
  },
  {
    problem: 'a summary item targeting something not in the graph',
    notes: notesWith({ summary: [{ text: 'Gone.', target: 'web/module/gone' }] }),
    expected: ['unknown id web/module/gone'],
  },
  {
    problem: 'a touched module with no note',
    notes: notesWith({
      notes: { 'edge web/module/pages -> web/module/utils': { text: 'Pages starts using utils.' } },
    }),
    expected: ['no note on part web/module/pages'],
  },
  {
    problem: 'a changed edge of the collapsed view with no note',
    notes: notesWith({ notes: { 'part web/module/pages': { text: 'Home now formats dates.' } } }),
    expected: ['no note on edge web/module/pages -> web/module/utils'],
  },
])('$problem is a problem', ({ notes, expected }) => {
  expect(notesProblems({ symbols, tests, diff, notes, said: [] })).toEqual(expected);
});

const file = 'x.notes.json';

test.for([
  {
    problem: 'no version',
    contents: { summary: [], tests: '', notes: {} },
    reason: 'no "version"',
  },
  {
    problem: 'version 1, whose notes are keyed by bare ids',
    contents: { version: 1, summary: [], tests: '', notes: { 'web/module/pages': { text: 'x' } } },
    reason: 'version 1 is unknown',
  },
  {
    problem: 'a later version, whatever its shape',
    contents: { version: 3, comments: [] },
    reason: 'version 3 is unknown',
  },
  {
    problem: 'the version as a string',
    contents: { version: '2', summary: [], tests: '', notes: {} },
    reason: 'version "2" is unknown',
  },
])(
  'a notes file with $problem is rejected naming the file and the version this CLI reads',
  ({ contents, reason }) => {
    expect(() => parseNotes({ text: JSON.stringify(contents), file })).toThrow(
      new Error(`Invalid notes file ${file}: ${reason}; this visual-review reads version 2`),
    );
  },
);

const node = (id: string, kind: DiffedNode['kind'], parent?: string): DiffedNode => ({
  id,
  kind,
  label: id,
  path: id,
  state: 'unchanged',
  ...(parent === undefined ? {} : { parent }),
});

test.for<{
  readonly rule: string;
  readonly notes: Readonly<Record<string, Note>>;
  readonly shown: Readonly<Record<string, Note>>;
}>([
  {
    rule: 'shows a note on a hidden file edge on the module edge it merges into, and keeps node notes',
    notes: {
      'a1 -> b1': { text: 'Reads b1.', flag: 'reaches in' },
      a1: { text: 'Changed.' },
    },
    shown: {
      'A -> B': { text: 'Reads b1.', flag: 'reaches in' },
      a1: { text: 'Changed.' },
    },
  },
  {
    rule: 'joins the notes, their whys, recommendations and flags of the file edges merged into one drawn edge',
    notes: {
      'a1 -> b1': {
        text: 'Reads b1.',
        why: 'It owns the rule.',
        recommendation: 'Import it from B.',
        flag: 'reaches in',
      },
      'a2 -> b1': {
        text: 'Also reads b1.',
        why: 'It needs the total.',
        recommendation: 'Pass the total in.',
        flag: 'cycle',
      },
      'a2 -> root': { text: 'Calls root.' },
    },
    shown: {
      'A -> B': {
        text: 'Reads b1. Also reads b1.',
        why: 'It owns the rule. It needs the total.',
        recommendation: 'Import it from B. Pass the total in.',
        flag: 'reaches in, cycle',
      },
      'A -> root': { text: 'Calls root.' },
    },
  },
  {
    rule: 'keeps the one flag, the one why and the one recommendation among merged notes',
    notes: {
      'a1 -> b1': { text: 'Reads b1.', why: 'It owns the rule.' },
      'a2 -> b1': { text: 'Also reads b1.', recommendation: 'Pass the total in.', flag: 'cycle' },
    },
    shown: {
      'A -> B': {
        text: 'Reads b1. Also reads b1.',
        why: 'It owns the rule.',
        recommendation: 'Pass the total in.',
        flag: 'cycle',
      },
    },
  },
  {
    rule: 'gives merged notes without flags, whys or recommendations none',
    notes: {
      'a1 -> b1': { text: 'Reads b1.' },
      'a2 -> b1': { text: 'Also reads b1.' },
    },
    shown: { 'A -> B': { text: 'Reads b1. Also reads b1.' } },
  },
])('$rule', ({ notes, shown }) => {
  const diff: GraphDiff = {
    nodes: [
      node('web', 'stack'),
      node('A', 'module', 'web'),
      node('B', 'module', 'web'),
      node('a1', 'file', 'A'),
      node('a2', 'file', 'A'),
      node('b1', 'file', 'B'),
      node('root', 'file', 'web'),
    ],
    edges: [
      { from: 'a1', to: 'b1', state: 'added' },
      { from: 'a2', to: 'b1', state: 'added' },
      { from: 'a2', to: 'root', state: 'added' },
    ],
  };
  expect(visibleNotes({ diff, expanded: new Set(), notes })).toEqual(shown);
});

test("an answer is known by its anchor's kind and id in the last review, whatever else the review holds", () => {
  const answer = { status: 'answered', text: 'It keeps the old format.' } as const;
  const said = [
    { anchor: { kind: 'part', id: 'web/module/pages' } },
    { anchor: { kind: 'finding', id: 'logic:changed:web/file/pages/home.tsx#render' } },
  ];

  expect(
    notesProblems({
      symbols,
      tests,
      diff,
      said,
      notes: notesWith({
        answers: {
          'part web/module/pages': answer,
          'finding logic:changed:web/file/pages/home.tsx#render': answer,
          'edge web/module/pages': answer,
          'part web/module/utils': answer,
        },
      }),
    }),
  ).toEqual(['unknown comment edge web/module/pages', 'unknown comment part web/module/utils']);
});

test('a notes file keeps its answers, each status with what it carries', () => {
  const answers = {
    'part web/module/pages': { status: 'done', commit: 'abc123', text: 'Split it.' },
    'edge web/module/pages -> web/module/utils': {
      status: 'answered',
      text: 'It keeps the format.',
    },
    'finding logic:changed:x': { status: 'declined', text: 'It would widen the port.' },
  } as const;
  const text = JSON.stringify(notesWith({ answers }));

  expect(parseNotes({ text, file }).answers).toEqual(answers);
});

test('an unasked change is keyed as a note is, by a part, an edge, a symbol, a decision or a test', () => {
  const text = JSON.stringify(
    notesWith({
      unasked: {
        'part web/module/pages': { text: 'Renamed the helper.' },
        'edge web/module/pages -> web/module/utils': { text: 'Dropped a cast.' },
        'symbol web/file/pages/home.tsx#run': { text: 'Inlined a guard.' },
        'decision web/file/pages/home.tsx#run#ready': { text: 'Kept the guard.' },
        'test web/src/pages/home.test.tsx#home › formats dates': { text: 'Pinned the zone.' },
        'part web/module/gone': { text: 'Removed it.' },
        'decision web/file/pages/home.tsx#run#gone': { text: 'Dropped it.' },
        'test web/src/pages/home.test.tsx#home › gone': { text: 'Dropped it.' },
      },
    }),
  );

  expect(
    notesProblems({ symbols, tests, diff, said: [], notes: parseNotes({ text, file }) }),
  ).toEqual([
    'unknown key part web/module/gone',
    'unknown key decision web/file/pages/home.tsx#run#gone',
    'unknown key test web/src/pages/home.test.tsx#home › gone',
  ]);
});

test('an unasked change needs a last review to show under, even one that said nothing', () => {
  const notes = notesWith({
    unasked: { 'part web/module/pages': { text: 'Renamed the helper.' } },
  });

  expect(notesProblems({ symbols, tests, diff, said: undefined, notes })).toEqual([
    'unasked changes show under the last review, and this page has none',
  ]);
  expect(notesProblems({ symbols, tests, diff, said: undefined, notes: notesWith() })).toEqual([]);
  expect(notesProblems({ symbols, tests, diff, said: [], notes })).toEqual([]);
});

test('a done answer names its commit', () => {
  const answers = { 'part web/module/pages': { status: 'done', text: 'Split it.' } };
  const text = JSON.stringify({ ...notesWith(), answers });

  expect(() => parseNotes({ text, file })).toThrow('Invalid notes file');
});

test('a notes file that is not JSON is rejected naming the file', () => {
  expect(() => parseNotes({ text: '{ "version": 2,', file })).toThrow(
    `Invalid notes file ${file}: SyntaxError`,
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
    overrides: { notes: { 'part web/module/pages': { text: 'Formats.', flags: 'cycle' } } },
    key: 'flags',
  },
  {
    level: 'the notes, a key of a kind no note takes',
    overrides: { notes: { 'line web/src/a.ts@head:12': { text: 'Guards.' } } },
    key: 'line web/src/a.ts@head:12',
  },
  {
    level: 'the notes, a bare id',
    overrides: { notes: { 'web/module/pages': { text: 'Formats.' } } },
    key: 'web/module/pages',
  },
  {
    level: 'the unasked changes, a bare id',
    overrides: { unasked: { 'web/module/pages': { text: 'Renamed the helper.' } } },
    key: 'web/module/pages',
  },
])('an unknown key on $level is rejected naming the file and the key', ({ overrides, key }) => {
  expect(() =>
    parseNotes({ text: JSON.stringify({ ...notesWith(), ...overrides }), file }),
  ).toThrow(new RegExp(`^Invalid notes file ${file}: .*"${key}"`, 's'));
});

test('a note keeps why it changed this way and what to do about it, beside what it does', () => {
  const notes = {
    'part web/module/pages': {
      text: 'Home now formats dates.',
      why: 'The API sends ISO strings.',
      recommendation: 'Format them in one helper.',
    },
  };

  expect(parseNotes({ text: JSON.stringify(notesWith({ notes })), file }).notes).toEqual(notes);
});

test('a note may be keyed by a symbol, a decision or a test', () => {
  const notes = {
    'symbol web/file/pages/home.tsx#run': { text: 'Runs once.' },
    'decision web/file/pages/home.tsx#run#ready': { text: 'Waits.' },
    'test web/src/pages/home.test.tsx#home › formats dates': { text: 'Pins the format.' },
  };

  expect(parseNotes({ text: JSON.stringify(notesWith({ notes })), file }).notes).toEqual(notes);
});

test('a notes file may name its schema', () => {
  const text = JSON.stringify({
    $schema: 'https://unpkg.com/@pablocm90/visual-review@0.1/dist/notes.schema.json',
    ...notesWith(),
  });

  expect(parseNotes({ text, file })).toMatchObject(notesWith());
});

test('a notes file with nothing to note may leave out notes', () => {
  const { notes: _, ...rest } = notesWith();

  expect(parseNotes({ text: JSON.stringify(rest), file })).toEqual({ ...rest, notes: {} });
});

test('the published notes schema marks no field read-only, since notes are written by hand or by agents', () => {
  expect(JSON.stringify(notesJsonSchema())).not.toContain('readOnly');
});

test('the published notes schema says version 2 and keys notes and unasked changes by part, edge, symbol, decision or test', () => {
  const schema = z.object({
    properties: z.object({
      version: z.object({ const: z.number() }),
      notes: z.object({ propertyNames: z.object({ pattern: z.string() }) }),
      unasked: z.object({ propertyNames: z.object({ pattern: z.string() }) }),
    }),
  });
  const { properties } = schema.parse(notesJsonSchema());
  const keys = [
    'part web/a.ts',
    'edge a -> b',
    'symbol web/a.ts#run',
    'decision web/a.ts#run#x',
    'test web/a.ts#x',
    'line web/a.ts@head:1',
    'web/a.ts',
  ];

  expect(properties.version.const).toBe(2);
  expect(
    [properties.notes, properties.unasked].map(({ propertyNames: { pattern } }) =>
      keys.filter(key => new RegExp(pattern).test(key)),
    ),
  ).toEqual([
    [
      'part web/a.ts',
      'edge a -> b',
      'symbol web/a.ts#run',
      'decision web/a.ts#run#x',
      'test web/a.ts#x',
    ],
    [
      'part web/a.ts',
      'edge a -> b',
      'symbol web/a.ts#run',
      'decision web/a.ts#run#x',
      'test web/a.ts#x',
    ],
  ]);
});
