import { expect, test } from 'vitest';
import { secretFindings } from './secret-findings.ts';

const FILE = 'config/initializers/aws.rb';

const patchAdding = (...added: ReadonlyArray<string>) => ({
  path: FILE,
  patch: [
    `diff --git a/${FILE} b/${FILE}`,
    `--- a/${FILE}`,
    `+++ b/${FILE}`,
    `@@ -1,1 +1,${added.length + 1} @@`,
    ' Aws.config.update(',
    ...added.map(line => `+${line}`),
  ].join('\n'),
});

test('an AWS access key a line gains needs a look on its row, masked, saying to rotate it', () => {
  expect(secretFindings([patchAdding("  access_key_id: 'AKIAIOSFODNN7EXAMPLE',")])).toStrictEqual([
    {
      id: `security:secret:${FILE}#aws-access-key`,
      check: 'security:secret',
      dimension: 'security',
      level: 'look',
      file: FILE,
      line: `${FILE}@head:2`,
      title: `${FILE} adds an AWS access key`,
      detail: 'AKIA…(20 chars). Rotate it: it stays in git history once removed.',
    },
  ]);
});

test.for([' ', '-'])('a key on a line the change keeps or removes (%s) raises nothing', prefix => {
  const patch = patchAdding();
  expect(
    secretFindings([{ ...patch, patch: `${patch.patch}\n${prefix}  AKIAIOSFODNN7EXAMPLE` }]),
  ).toEqual([]);
});
