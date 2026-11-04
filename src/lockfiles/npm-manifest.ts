import { z } from 'zod';

const Declarations = z.record(z.string(), z.string()).optional();

export const Manifest = z.object({
  dependencies: Declarations,
  devDependencies: Declarations,
  optionalDependencies: Declarations,
});

export const declarationsOf = ({
  dependencies,
  devDependencies,
  optionalDependencies,
}: z.infer<typeof Manifest>): ReadonlyArray<[string, string]> => [
  ...Object.entries(dependencies ?? {}),
  ...Object.entries(devDependencies ?? {}),
  ...Object.entries(optionalDependencies ?? {}),
];

export const aliasOf = (spec: string): string | undefined =>
  spec.match(/^npm:((?:@[^/]+\/)?[^@]+)/)?.[1];
