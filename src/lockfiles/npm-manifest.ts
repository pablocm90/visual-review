import { z } from 'zod';

const Declarations = z.record(z.string(), z.string()).optional();

export const Manifest = z.object({
  dependencies: Declarations,
  devDependencies: Declarations,
  optionalDependencies: Declarations,
  peerDependencies: Declarations,
});

export const declarationsOf = ({
  dependencies,
  devDependencies,
  optionalDependencies,
  peerDependencies,
}: z.infer<typeof Manifest>): ReadonlyArray<[string, string]> => [
  ...Object.entries(dependencies ?? {}),
  ...Object.entries(devDependencies ?? {}),
  ...Object.entries(optionalDependencies ?? {}),
  ...Object.entries(peerDependencies ?? {}),
];

export const aliasOf = (spec: string): string | undefined =>
  spec.match(/^npm:((?:@[^/]+\/)?[^@]+)/)?.[1];
