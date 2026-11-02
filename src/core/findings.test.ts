import { expect, test } from 'vitest';
import { findingOn } from '../test-support/page-data.ts';
import { findingsOf } from './findings.ts';
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
