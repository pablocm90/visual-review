import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { writeAnew } from './write-anew.ts';

const folder = () => {
  const path = mkdtempSync(join(tmpdir(), 'visual-review-write-'));
  return { path, [Symbol.dispose]: () => rmSync(path, { recursive: true, force: true }) };
};

test('writers overlapping at one path all succeed, leaving one whole content and nothing else', async () => {
  using directory = folder();
  const path = join(directory.path, 'page.html');
  const contents = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];

  await Promise.all(contents.map(content => writeAnew({ path, content })));

  expect(contents).toContain(readFileSync(path, 'utf8'));
  expect(readdirSync(directory.path)).toEqual(['page.html']);
});

test('a write that fails leaves nothing of its own beside the path', async () => {
  using directory = folder();
  const path = join(directory.path, 'taken');
  mkdirSync(path);

  await expect(writeAnew({ path, content: 'x' })).rejects.toThrow('EISDIR');

  expect(readdirSync(directory.path)).toEqual(['taken']);
});
