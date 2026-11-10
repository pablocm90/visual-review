import { countingRepeats } from './counted-id.ts';
import type { FilePatch } from './diff-graphs.ts';
import type { Finding } from './findings.ts';
import { lineIdOf, patchHunks } from './patch-lines.ts';

type Format = {
  readonly name: string;
  readonly said: string;
  readonly pattern: RegExp;
  readonly shown?: (value: string) => string;
};

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
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    shown: header => header,
  },
];

const ROTATE = 'Rotate it: it stays in git history once removed.';

const masked = (value: string): string => `${value.slice(0, 4)}…(${value.length} chars)`;

type Found = {
  readonly name: string;
  readonly said: string;
  readonly detail: string;
};

const knownFormat = (code: string): ReadonlyArray<Found> =>
  FORMATS.flatMap(({ name, said, pattern, shown = masked }) => {
    const value = pattern.exec(code)?.[0];
    return value === undefined ? [] : [{ name, said, detail: `${shown(value)}. ${ROTATE}` }];
  });

const ASSIGNED =
  /(\w*(?:password|secret|token|api_?key)\w*)["']?\s*(?:=>|:|=)\s*["']([^"'\s]{16,})["']/i;

const MOST_ORDERLY = 3.5;

const entropy = (value: string): number =>
  [...Map.groupBy(value, char => char).values()]
    .map(({ length }) => length / value.length)
    .reduce((sum, share) => sum - share * Math.log2(share), 0);

const assignedSecret = (code: string): ReadonlyArray<Found> => {
  const [, name, value] = ASSIGNED.exec(code) ?? [];
  return name === undefined || value === undefined || entropy(value) <= MOST_ORDERLY
    ? []
    : [
        {
          name: 'assigned-secret',
          said: `a secret-like value for ${name}`,
          detail: `${masked(value)}, heuristic: a long, varied literal under a secret-like name. ${ROTATE}`,
        },
      ];
};

const SECRET_FILE =
  /(?:^|\/)(?:\.env(?!\.example)[^/]*|config\/master\.key|config\/credentials\/[^/]+\.key|[^/]+\.pem|id_rsa(?!\.pub)[^/]*)$/;

const secretFile = ({ path, patch }: FilePatch): ReadonlyArray<Finding> =>
  SECRET_FILE.test(path) && /^new file mode /m.test(patch)
    ? [
        {
          id: `security:secret:${path}#secret-file`,
          check: 'security:secret',
          dimension: 'security',
          level: 'look',
          file: path,
          title: `${path} is a secret file the change adds`,
          detail:
            'Keep it out of git and rotate what it holds: it stays in git history once removed.',
        },
      ]
    : [];

const secretLines = ({ path, patch }: FilePatch): ReadonlyArray<Finding> =>
  countingRepeats(
    patchHunks(patch)
      .flatMap(hunk => hunk.rows)
      .filter(row => row.kind === 'added')
      .flatMap(row =>
        (knownFormat(row.code).length > 0 ? knownFormat(row.code) : assignedSecret(row.code)).map(
          found => ({ row, found }),
        ),
      ),
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
            level: 'look',
            file: path,
            line,
            title: `${path} adds ${found.said}`,
            detail: found.detail,
          },
        ];
  });

const LOCKFILE = /(?:\.lock|-lock\.json|-lock\.yaml|npm-shrinkwrap\.json)$/;

export const secretFindings = (patches: ReadonlyArray<FilePatch>): ReadonlyArray<Finding> =>
  patches
    .filter(({ path }) => !LOCKFILE.test(path))
    .flatMap(patch => [...secretFile(patch), ...secretLines(patch)]);
