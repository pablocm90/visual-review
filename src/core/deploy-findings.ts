import type { Check } from './checks.ts';
import type { FilePatch } from './diff-graphs.ts';
import { type Finding, levelOf } from './finding.ts';
import { lineIdOf, patchHunks } from './patch-lines.ts';
import { literally } from './wildcard.ts';

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

const NAME = String.raw`(?::|["'])(\w+)["']?`;

const NOT_A_KEY = String.raw`(?:presence|freeze|dup|map|keys|values|to_\w+|each\w*)\b`;

const DOT = String.raw`\.(?!${NOT_A_KEY})(\w+)!?(?![\w?(])`;

const INDEX = String.raw`\.dig\(([^)]*)\)|\.fetch\(${NAME}|\[${NAME}\]`;

const STEP = new RegExp(`${DOT}|${INDEX}`, 'g');

const CHAIN = new RegExp(
  String.raw`\bRails\.app(?:lication)?\.credentials((?:${DOT})*(?:${INDEX})*)`,
  'g',
);

const namesIn = (args: string): ReadonlyArray<string> =>
  [...args.matchAll(new RegExp(NAME, 'g'))].flatMap(([, name]) =>
    name === undefined ? [] : [name],
  );

const pathOf = (chain: string): string =>
  [...chain.matchAll(STEP)]
    .flatMap(([, called, dug, fetched, indexed]) =>
      dug === undefined ? [called ?? fetched ?? indexed ?? ''] : namesIn(dug),
    )
    .join('.');

const credentialReads = (code: string): ReadonlyArray<Read> =>
  [...code.matchAll(CHAIN)]
    .map(([, chain]) => pathOf(chain ?? ''))
    .flatMap(key => (key === '' ? [] : [{ kind: 'credentials', key }]));

const CODE = /\.(?:rb|rake|erb|rs|[cm]?[jt]sx?)$/;

const rowsOf = ({ path, patch }: FilePatch, kind: 'added' | 'removed') =>
  CODE.test(path)
    ? patchHunks(patch)
        .flatMap(hunk => hunk.rows)
        .filter(row => row.kind === kind)
    : [];

const keysOn = ({
  path,
  patch,
}: FilePatch): ReadonlyArray<{ readonly key: string; readonly finding: Finding }> =>
  rowsOf({ path, patch }, 'added').flatMap(row =>
    [...envReads(row.code), ...credentialReads(row.code)].flatMap(({ kind, key }) => {
      const line = lineIdOf(path, row);
      const check: Check = `deploy:${kind}`;
      return line === undefined
        ? []
        : [
            {
              key,
              finding: {
                id: `${check}:${key}`,
                check,
                dimension: 'deploy',
                level: levelOf(path),
                file: path,
                line,
                title: `${path} reads the ${kind} key ${key}`,
                detail: 'Set it in every environment before this deploys.',
              },
            },
          ];
    }),
  );

export const deployKeysIn = (patches: ReadonlyArray<FilePatch>): ReadonlyArray<string> => [
  ...new Set(patches.flatMap(keysOn).map(({ key }) => key)),
];

export const credentialKeysIn = (code: string): ReadonlyArray<string> =>
  credentialReads(code).map(({ key }) => key);

type DeployKeysOptions = {
  readonly patches: ReadonlyArray<FilePatch>;
  readonly keysAtBase: ReadonlyArray<string>;
};

export const deployKeyFindings = ({
  patches,
  keysAtBase,
}: DeployKeysOptions): ReadonlyArray<Finding> =>
  patches
    .flatMap(patch => keysOn(patch).filter(({ key }) => !keysAtBase.includes(key)))
    .map(({ finding }) => finding)
    .toSorted((a, b) => Number(a.level === 'info') - Number(b.level === 'info'))
    .filter((finding, index, all) => all.findIndex(({ id }) => id === finding.id) === index);

const THROUGH_A_VARIABLE =
  /\b(?:ENV(?:\[|\.fetch\(|\.key\?\()|(?:process|import\.meta)\.env\[|env::var(?:_os)?\()(?!["'])/;

export const deployKeysNotRead = (patches: ReadonlyArray<FilePatch>): ReadonlyArray<string> =>
  patches.flatMap(filePatch =>
    rowsOf(filePatch, 'added')
      .filter(row => THROUGH_A_VARIABLE.test(row.code))
      .map(row => `${filePatch.path}:${row.head} reads an env key through a variable`),
  );

type FlagRead = { readonly name: string; readonly path: string; readonly line: string };

const callSource = (flag: string): string =>
  flag.split('*').map(literally).join(String.raw`[\w?!]*`);

const flagCalls = (flags: ReadonlyArray<string>): RegExp =>
  new RegExp(
    String.raw`(?<!\w)(?:${flags.map(callSource).join('|')})(?:\(\s*|\s+|\[)(?::(\w+)|["'](\w+)["'])`,
    'g',
  );

const flagReads = ({
  patches,
  flags,
  kind,
}: {
  readonly patches: ReadonlyArray<FilePatch>;
  readonly flags: RegExp;
  readonly kind: 'added' | 'removed';
}): ReadonlyArray<FlagRead> =>
  patches.flatMap(filePatch =>
    rowsOf(filePatch, kind).flatMap(row => {
      const { path } = filePatch;
      const line = lineIdOf(path, row);
      return line === undefined
        ? []
        : [...row.code.matchAll(flags)].map(([, symbol, quoted]) => ({
            name: symbol ?? quoted ?? '',
            path,
            line,
          }));
    }),
  );

type DeployFlagsOptions = {
  readonly patches: ReadonlyArray<FilePatch>;
  readonly flags: ReadonlyArray<string>;
};

const flagFinding = (
  { name, path, line }: FlagRead,
  check: 'deploy:flag-added' | 'deploy:flag-removed',
): Finding => ({
  id: `${check}:${name}`,
  check,
  dimension: 'deploy',
  level: 'info',
  file: path,
  line,
  ...(check === 'deploy:flag-added'
    ? {
        title: `${path} reads the flag ${name}`,
        detail: 'Check it is set as this needs wherever this deploys.',
      }
    : {
        title: `${path} no longer reads the flag ${name}`,
        detail: 'Check nothing still reads it before deleting it.',
      }),
});

export const FLIPPER_FLAGS: ReadonlyArray<string> = [
  'Flipper.enabled?',
  'Flipper.enable',
  'Flipper.disable',
  'Flipper',
];

export const deployFlagFindings = ({
  patches,
  flags,
}: DeployFlagsOptions): ReadonlyArray<Finding> => {
  if (flags.length === 0) return [];
  const calls = flagCalls(flags);
  const added = flagReads({ patches, flags: calls, kind: 'added' });
  const removed = flagReads({ patches, flags: calls, kind: 'removed' });
  const named = (reads: ReadonlyArray<FlagRead>, name: string) =>
    reads.filter(read => read.name === name);
  return [...new Set([...added, ...removed].map(({ name }) => name))].flatMap(name => {
    const gained = named(added, name);
    const lost = named(removed, name);
    const gains = gained.length > lost.length;
    const [first] = gains ? gained : lost;
    return first === undefined || gained.length === lost.length
      ? []
      : [flagFinding(first, gains ? 'deploy:flag-added' : 'deploy:flag-removed')];
  });
};

type DeployNotReadOptions = {
  readonly patches: ReadonlyArray<FilePatch>;
  readonly flags: ReadonlyArray<string> | undefined;
};

export const deployNotRead = ({ patches, flags }: DeployNotReadOptions): ReadonlyArray<string> => [
  ...deployKeysNotRead(patches),
  ...(flags === undefined && !patches.some(({ patch }) => flagCalls(FLIPPER_FLAGS).test(patch))
    ? ['flags: Flipper only']
    : []),
];
