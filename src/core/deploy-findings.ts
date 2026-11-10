import type { FilePatch } from './diff-graphs.ts';
import type { Finding } from './findings.ts';
import { lineIdOf, patchHunks } from './patch-lines.ts';

const ENV_READ = /\bENV(?:\[|\.fetch\(|\.key\?\()["'](\w+)["']/g;

const keysOn = ({ path, patch }: FilePatch): ReadonlyArray<Finding> =>
  patchHunks(patch)
    .flatMap(hunk => hunk.rows)
    .filter(row => row.kind === 'added')
    .flatMap(row =>
      [...row.code.matchAll(ENV_READ)].flatMap(([, key]): ReadonlyArray<Finding> => {
        const line = lineIdOf(path, row);
        return key === undefined || line === undefined
          ? []
          : [
              {
                id: `deploy:env:${key}`,
                check: 'deploy:env',
                dimension: 'deploy',
                level: 'look',
                file: path,
                line,
                title: `${path} reads the env key ${key}`,
                detail: 'Set it in every environment before this deploys.',
              },
            ];
      }),
    );

export const deployKeyFindings = (patches: ReadonlyArray<FilePatch>): ReadonlyArray<Finding> =>
  patches.flatMap(keysOn);
