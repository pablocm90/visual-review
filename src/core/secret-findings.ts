import { countingRepeats } from './counted-id.ts';
import type { FilePatch } from './diff-graphs.ts';
import type { Finding } from './findings.ts';
import { lineIdOf, patchHunks } from './patch-lines.ts';

const FORMATS = [
  { name: 'aws-access-key', said: 'an AWS access key', pattern: /AKIA[0-9A-Z]{16}/ },
];

const ROTATE = 'Rotate it: it stays in git history once removed.';

const masked = (value: string): string => `${value.slice(0, 4)}…(${value.length} chars)`;

export const secretFindings = (patches: ReadonlyArray<FilePatch>): ReadonlyArray<Finding> =>
  patches.flatMap(({ path, patch }) =>
    countingRepeats(
      patchHunks(patch)
        .flatMap(hunk => hunk.rows)
        .filter(row => row.kind === 'added')
        .flatMap(row =>
          FORMATS.flatMap(format => {
            const value = format.pattern.exec(row.code)?.[0];
            return value === undefined ? [] : [{ row, format, value }];
          }),
        ),
      ({ format }) => `security:secret:${path}#${format.name}`,
    ).flatMap(({ item: { row, format, value }, id }): ReadonlyArray<Finding> => {
      const line = lineIdOf(path, row);
      return line === undefined
        ? []
        : [
            {
              id,
              check: 'security:secret',
              dimension: 'security',
              level: 'look',
              file: path,
              line,
              title: `${path} adds ${format.said}`,
              detail: `${masked(value)}. ${ROTATE}`,
            },
          ];
    }),
  );
