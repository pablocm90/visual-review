import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { z } from 'zod';

const repoFile = (path: string): string =>
  readFileSync(join(import.meta.dirname, '..', path), 'utf8');

const versionOf = (path: string): string =>
  z.object({ version: z.string() }).parse(JSON.parse(repoFile(path))).version;

test('the plugin, and every CLI run its skill pins, carry the version package.json says', () => {
  const version = versionOf('package.json');
  const pins = [
    ...repoFile('plugin/skills/visual-review/SKILL.md').matchAll(
      /@pablocm90\/visual-review@([^}"'\s]+)/g,
    ),
  ].map(([, pinned]) => pinned);

  expect(versionOf('plugin/.claude-plugin/plugin.json')).toBe(version);
  expect(pins).not.toEqual([]);
  expect(new Set(pins)).toEqual(new Set([version]));
});
