import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { expect, test, vi } from 'vitest';
import { onPath } from './on-path.ts';

const binHolding = (arrange: (tool: string) => void) => {
  const bin = mkdtempSync(join(tmpdir(), 'visual-review-on-path-'));
  arrange(join(bin, 'tool'));
  return { bin, [Symbol.dispose]: () => rmSync(bin, { recursive: true, force: true }) };
};

const executable = (tool: string): void => {
  writeFileSync(tool, '#!/bin/sh\n');
  chmodSync(tool, 0o755);
};

test.for([
  { holding: 'an executable', arrange: executable, entry: (bin: string) => bin, found: true },
  {
    holding: 'a file it may not run',
    arrange: (tool: string) => writeFileSync(tool, ''),
    entry: (bin: string) => bin,
    found: false,
  },
  {
    holding: 'a directory',
    arrange: (tool: string) => mkdirSync(tool),
    entry: (bin: string) => bin,
    found: false,
  },
  {
    holding: 'an executable, named relative to the working directory',
    arrange: executable,
    entry: (bin: string) => relative(process.cwd(), bin),
    found: false,
  },
])('a PATH entry holding $holding finds the command: $found', ({ arrange, entry, found }) => {
  using tool = binHolding(arrange);
  vi.stubEnv('PATH', entry(tool.bin));

  expect(onPath('tool')).toBe(found);
});

test('with no PATH at all, a command counts as found, since running it falls back to the default path', () => {
  vi.stubEnv('PATH', undefined);

  expect(onPath('tool')).toBe(true);
});
