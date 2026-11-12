import { countingRepeats } from './counted-id.ts';
import type { FilePatch } from './diff-graphs.ts';
import { type Finding, levelOf } from './finding.ts';
import { lineIdOf, patchHunks } from './patch-lines.ts';

type Format = {
  readonly name: string;
  readonly said: string;
  readonly pattern: RegExp;
  readonly shown?: true;
};

const KEY_HEADER = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const KEY_EDGE = /(-----(?:BEGIN|END) [A-Z ]*PRIVATE KEY-----)/;

const FORMATS: ReadonlyArray<Format> = [
  { name: 'aws-access-key', said: 'an AWS access key', pattern: /AKIA[0-9A-Z]{16}/ },
  {
    name: 'github-token',
    said: 'a GitHub token',
    pattern: /gh[pousr]_[A-Za-z0-9]{36}|github_pat_\w{22,}/,
  },
  { name: 'slack-token', said: 'a Slack token', pattern: /xox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'stripe-key', said: 'a Stripe live key', pattern: /[rs]k_live_[A-Za-z0-9]{16,}/ },
  { name: 'google-api-key', said: 'a Google API key', pattern: /AIza[\w-]{35}/ },
  {
    name: 'private-key',
    said: 'a private key',
    pattern: KEY_HEADER,
    shown: true,
  },
];

const ROTATE = 'Rotate it: it stays in git history once removed.';

export const masked = (value: string): string => `${value.slice(0, 4)}…(${value.length} chars)`;

type Found = {
  readonly name: string;
  readonly said: string;
  readonly detail: string;
  readonly hidden: ReadonlyArray<string>;
};

const knownFormat = (code: string): ReadonlyArray<Found> =>
  FORMATS.flatMap(({ name, said, pattern, shown }) =>
    [...code.matchAll(new RegExp(pattern, 'g'))].map(([value]): Found => {
      const detail = `${shown ? value : masked(value)}. ${ROTATE}`;
      return { name, said, detail, hidden: shown ? [] : [value] };
    }),
  );

const ASSIGNED =
  /(\w*(?:password|secret|token|api_?key)\w*)["']?\s*(?:=>|:|=)\s*["']([^"'\s]{16,})["']/gi;

const MOST_ORDERLY = 3.5;

const entropy = (value: string): number =>
  [...Map.groupBy(value, char => char).values()]
    .map(({ length }) => length / value.length)
    .reduce((sum, share) => sum - share * Math.log2(share), 0);

const assignedSecret = (code: string): ReadonlyArray<Found> =>
  [...code.matchAll(ASSIGNED)].flatMap(
    ([, name, value]): ReadonlyArray<Found> =>
      name === undefined || value === undefined || entropy(value) <= MOST_ORDERLY
        ? []
        : [
            {
              name: 'assigned-secret',
              said: `a secret-like value for ${name}`,
              detail: `${masked(value)}, heuristic: a long, varied literal under a secret-like name. ${ROTATE}`,
              hidden: [value],
            },
          ],
  );

const SECRET_FILE =
  /(?:^|\/)(?:\.env(?![^/]*\.(?:example|sample|template|dist)$)[^/]*|config\/master\.key|config\/credentials\/[^/]+\.key|[^/]+\.pem|id_rsa(?!\.pub)[^/]*)$/;

const isAddedSecretFile = ({ path, patch }: FilePatch): boolean =>
  SECRET_FILE.test(path) && /^new file mode /m.test(patch);

const secretFile = ({ path, patch }: FilePatch): ReadonlyArray<Finding> =>
  isAddedSecretFile({ path, patch })
    ? [
        {
          id: `security:secret:${path}#secret-file`,
          check: 'security:secret',
          dimension: 'security',
          level: levelOf(path),
          file: path,
          title: `${path} is a secret file the change adds`,
          detail:
            'Keep it out of git and rotate what it holds: it stays in git history once removed.',
        },
      ]
    : [];

const LOCKFILE = /(?:\.lock|-lock\.json|-lock\.yaml|npm-shrinkwrap\.json)$/;

const foundIn = (code: string, path: string): ReadonlyArray<Found> => {
  const known = knownFormat(code);
  return known.length > 0 || LOCKFILE.test(path) ? known : assignedSecret(code);
};

const foundOn = ({ path, patch }: FilePatch) =>
  patchHunks(patch)
    .flatMap(hunk => hunk.rows)
    .filter(row => row.kind === 'added')
    .flatMap(row => foundIn(row.code, path).map(found => ({ row, found })));

const secretLines = ({ path, patch }: FilePatch): ReadonlyArray<Finding> =>
  countingRepeats(
    foundOn({ path, patch }),
    ({ found }) => `security:secret:${path}#${found.name}`,
  ).flatMap(({ item: { row, found }, id }): ReadonlyArray<Finding> => {
    const line = lineIdOf(path, row);
    return line === undefined
      ? []
      : [
          {
            id,
            check: 'security:secret',
            dimension: 'security',
            level: levelOf(path),
            file: path,
            line,
            title: `${path} adds ${found.said}`,
            detail: found.detail,
          },
        ];
  });

export const secretFindings = (patches: ReadonlyArray<FilePatch>): ReadonlyArray<Finding> =>
  patches.flatMap(patch => [...secretFile(patch), ...secretLines(patch)]);

const KEY_LINE = /^[A-Za-z0-9+/]{16,}={0,2}$/;

type KeyBody = { readonly inKey: boolean; readonly lines: ReadonlyArray<string> };

const bodyLinesIn = (text: string): ReadonlyArray<string> =>
  text
    .split('\\n')
    .map(line => line.trim())
    .filter(line => KEY_LINE.test(line));

const keyBodies = ({ patch }: FilePatch): ReadonlyArray<string> =>
  patchHunks(patch)
    .flatMap(hunk => hunk.rows)
    .filter(row => row.kind === 'added')
    .flatMap(({ code }) => code.split(KEY_EDGE))
    .reduce<KeyBody>(
      ({ inKey, lines }, piece) => {
        if (KEY_EDGE.test(piece)) return { inKey: piece.includes('BEGIN'), lines };
        return { inKey, lines: inKey ? [...lines, ...bodyLinesIn(piece)] : lines };
      },
      { inKey: false, lines: [] },
    ).lines;

const VARIABLE = /^(?:export\s+)?\w+\s*[=:]\s*["']?(.*?)["']?$/;

const SHORTEST_HELD = 8;

const heldIn = (patch: FilePatch): ReadonlyArray<string> =>
  isAddedSecretFile(patch)
    ? patchHunks(patch.patch)
        .flatMap(hunk => hunk.rows)
        .filter(row => row.kind === 'added')
        .map(({ code }) => code)
        .filter(line => !line.startsWith('#'))
        .map(line => VARIABLE.exec(line)?.[1] ?? line)
        .filter(value => value.length >= SHORTEST_HELD)
    : [];

export const secretValues = (patches: ReadonlyArray<FilePatch>): ReadonlyArray<string> =>
  patches.flatMap(patch => [
    ...foundOn(patch).flatMap(({ found }) => found.hidden),
    ...keyBodies(patch),
    ...heldIn(patch),
  ]);
