import type { FilePatch } from './diff-graphs.ts';
import type { Finding } from './findings.ts';
import { lineIdOf, patchHunks } from './patch-lines.ts';
import { levelOf } from './secret-findings.ts';

const ENV_READS: ReadonlyArray<RegExp> = [
  /\bENV(?:\[|\.fetch\(|\.key\?\()["'](\w+)["']/g,
  /\b(?:process|import\.meta)\.env(?:\.|\[["'])(\w+)/g,
  /\benv::var(?:_os)?\("(\w+)"\)/g,
  /\b(?:option_)?env!\("(\w+)"\)/g,
];

const keysOn = ({ path, patch }: FilePatch): ReadonlyArray<Finding> =>
  patchHunks(patch)
    .flatMap(hunk => hunk.rows)
    .filter(row => row.kind === 'added')
    .flatMap(row =>
      ENV_READS.flatMap(read => [...row.code.matchAll(read)]).flatMap(
        ([, key]): ReadonlyArray<Finding> => {
          const line = lineIdOf(path, row);
          return key === undefined || line === undefined
            ? []
            : [
                {
                  id: `deploy:env:${key}`,
                  check: 'deploy:env',
                  dimension: 'deploy',
                  level: levelOf(path),
                  file: path,
                  line,
                  title: `${path} reads the env key ${key}`,
                  detail: 'Set it in every environment before this deploys.',
                },
              ];
        },
      ),
    );

export const deployKeyFindings = (patches: ReadonlyArray<FilePatch>): ReadonlyArray<Finding> =>
  patches
    .flatMap(keysOn)
    .filter((finding, index, all) => all.findIndex(({ id }) => id === finding.id) === index);
