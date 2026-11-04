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
