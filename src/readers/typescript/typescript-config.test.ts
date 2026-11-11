import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { writeFiles } from '../../test-support/repos.ts';
import { resolutionIn } from './typescript-config.ts';

test('a tsconfig extends chain long enough to overflow the stack is followed only so far, and its own paths still apply', () => {
  const checkout = mkdtempSync(join(tmpdir(), 'visual-review-tsconfig-'));
  try {
    writeFiles(checkout, {
      'tsconfig.json': JSON.stringify({
        extends: './level-1.json',
        compilerOptions: { paths: { '@/*': ['./src/*'] } },
      }),
      ...Object.fromEntries(
        Array.from({ length: 5000 }, (_, level) => [
          `level-${level + 1}.json`,
          JSON.stringify({ extends: `./level-${level + 2}.json` }),
        ]),
      ),
    });

    const { alias } = resolutionIn({ checkout, root: '.' });

    expect(alias).toStrictEqual({ '@/*': [join(checkout, 'src/*')] });
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
});
