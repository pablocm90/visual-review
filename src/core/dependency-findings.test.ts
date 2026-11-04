import { expect, test } from 'vitest';
import type { PackageChange } from './dependency-changes.ts';
import { dependencyFindings } from './dependency-findings.ts';

const packageChange = (overrides: Partial<PackageChange> = {}): PackageChange => ({
  name: 'zod',
  change: 'major',
  direct: true,
  from: ['3.25.0'],
  to: ['4.6.7'],
  ...overrides,
});

const inLockfile = (packages: ReadonlyArray<PackageChange>, lockfile = 'web/pnpm-lock.yaml') => [
  { lockfile, ecosystem: 'npm', packages },
];

test.for([
  {
    change: 'added' as const,
    from: [],
    to: ['4.14.7'],
    title: 'zod added at 4.14.7',
  },
  {
    change: 'removed' as const,
    from: ['2.41.3'],
    to: [],
    title: 'zod removed, was 2.41.3',
  },
  {
    change: 'major' as const,
    from: ['17.0.2'],
    to: ['16.13.1', '17.0.2'],
    title: 'zod 17.0.2 → 16.13.1, 17.0.2',
  },
  {
    change: 'now-direct' as const,
    from: ['2.5.8'],
    to: ['2.5.8'],
    title: 'zod 2.5.8 now direct',
  },
  {
    change: 'no-longer-direct' as const,
    from: ['2.5.8'],
    to: ['2.5.8'],
    title: 'zod 2.5.8 no longer direct',
  },
])('a direct package $change is one finding to look at: $title', ({ change, from, to, title }) => {
  expect(dependencyFindings(inLockfile([packageChange({ change, from, to })]))).toStrictEqual([
    {
      id: 'dependencies:web/pnpm-lock.yaml:zod',
      dimension: 'dependencies',
      level: 'look',
      file: 'web/pnpm-lock.yaml',
      title,
      detail: 'web/pnpm-lock.yaml',
    },
  ]);
});

const transitive = (name: string, change: PackageChange['change'] = 'added') =>
  packageChange({ name, change, direct: false });

test('transitive packages are one finding for information per lockfile, counting each kind', () => {
  const [finding] = dependencyFindings(
    inLockfile([
      transitive('a'),
      transitive('b', 'removed'),
      transitive('c', 'major'),
      transitive('d'),
    ]),
  );

  expect(finding).toStrictEqual({
    id: 'dependencies:transitive:web/pnpm-lock.yaml',
    dimension: 'dependencies',
    level: 'info',
    file: 'web/pnpm-lock.yaml',
    title:
      '4 transitive packages changed in web/pnpm-lock.yaml: 2 added, 1 removed, 1 major-bumped',
    detail: 'a, b, c, d',
  });
});

test('a roll-up says one package in the singular, and leaves out kinds with none', () => {
  const [finding] = dependencyFindings(inLockfile([transitive('a', 'removed')]));

  expect(finding?.title).toBe('1 transitive package changed in web/pnpm-lock.yaml: 1 removed');
});

test.for([
  { count: 20, detailEnd: 'p19' },
  { count: 21, detailEnd: 'p19, and 1 more' },
])('a roll-up of $count names the first 20: …$detailEnd', ({ count, detailEnd }) => {
  const packages = Array.from({ length: count }, (_, index) => transitive(`p${index}`));

  const [finding] = dependencyFindings(inLockfile(packages));

  expect(finding?.detail?.startsWith('p0, p1, ')).toBe(true);
  expect(finding?.detail?.endsWith(`, ${detailEnd}`)).toBe(true);
});

test("direct packages come before their lockfile's roll-up, and each lockfile rolls up apart", () => {
  const findings = dependencyFindings([
    ...inLockfile([transitive('a'), packageChange({ name: 'b' })], 'a/yarn.lock'),
    ...inLockfile([transitive('c')], 'b/yarn.lock'),
  ]);

  expect(findings.map(({ id }) => id)).toStrictEqual([
    'dependencies:a/yarn.lock:b',
    'dependencies:transitive:a/yarn.lock',
    'dependencies:transitive:b/yarn.lock',
  ]);
});

test('a lockfile not read is a finding to look at, naming the format', () => {
  expect(
    dependencyFindings([{ lockfile: 'web/yarn.lock', notRead: 'Yarn 2+ format' }]),
  ).toStrictEqual([
    {
      id: 'dependencies:not-read:web/yarn.lock',
      dimension: 'dependencies',
      level: 'look',
      file: 'web/yarn.lock',
      title: 'web/yarn.lock not read: Yarn 2+ format',
    },
  ]);
});
