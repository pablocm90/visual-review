import type { Check } from './checks.ts';
import type { FilePatch } from './diff-graphs.ts';
import type { Finding } from './findings.ts';
import { lineIdOf, patchHunks } from './patch-lines.ts';
import { levelOf } from './secret-findings.ts';

type Read = { readonly kind: 'env' | 'credentials'; readonly key: string };

const ENV_READS: ReadonlyArray<RegExp> = [
  /\bENV(?:\[|\.fetch\(|\.key\?\()["'](\w+)["']/g,
  /\b(?:process|import\.meta)\.env(?:\.|\[["'])(\w+)/g,
  /\benv::var(?:_os)?\("(\w+)"\)/g,
  /\b(?:option_)?env!\("(\w+)"\)/g,
];

const envReads = (code: string): ReadonlyArray<Read> =>
  ENV_READS.flatMap(read => [...code.matchAll(read)]).flatMap(([, key]) =>
    key === undefined ? [] : [{ kind: 'env', key }],
  );

const NAME = String.raw`[:"']?(\w+)["']?`;

const STEP = new RegExp(String.raw`\.dig\(([^)]*)\)|\.fetch\(${NAME}|\.(\w+)!?|\[${NAME}\]`, 'g');

const CHAIN = new RegExp(String.raw`\bcredentials((?:${STEP.source})+)`, 'g');

const namesIn = (args: string): ReadonlyArray<string> =>
  [...args.matchAll(new RegExp(NAME, 'g'))].flatMap(([, name]) =>
    name === undefined ? [] : [name],
  );

const pathOf = (chain: string): string =>
  [...chain.matchAll(STEP)]
    .flatMap(([, dug, fetched, called, indexed]) =>
      dug === undefined ? [fetched ?? called ?? indexed ?? ''] : namesIn(dug),
    )
    .join('.');

const credentialReads = (code: string): ReadonlyArray<Read> =>
  [...code.matchAll(CHAIN)].map(([, chain]) => ({ kind: 'credentials', key: pathOf(chain ?? '') }));

const keysOn = ({ path, patch }: FilePatch): ReadonlyArray<Finding> =>
  patchHunks(patch)
    .flatMap(hunk => hunk.rows)
    .filter(row => row.kind === 'added')
    .flatMap(row =>
      [...envReads(row.code), ...credentialReads(row.code)].flatMap(
        ({ kind, key }): ReadonlyArray<Finding> => {
          const line = lineIdOf(path, row);
          const check: Check = `deploy:${kind}`;
          return line === undefined
            ? []
            : [
                {
                  id: `${check}:${key}`,
                  check,
                  dimension: 'deploy',
                  level: levelOf(path),
                  file: path,
                  line,
                  title: `${path} reads the ${kind} key ${key}`,
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
