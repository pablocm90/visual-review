import type { AccessReader, AccessTable } from './access.ts';
import { gitUntrimmed } from './git.ts';

export type AccessReading = { readonly base: AccessTable; readonly head: AccessTable };

type ReadAccessOptions = {
  readonly repo: string;
  readonly base: string;
  readonly head: string;
  readonly changes: ReadonlyArray<ReadonlyArray<string>>;
  readonly access: ReadonlyArray<AccessReader>;
  readonly authorize: ReadonlyArray<string>;
};

export const readAccess = async ({
  repo,
  base,
  head,
  changes,
  access,
  authorize,
}: ReadAccessOptions): Promise<ReadonlyArray<AccessReading>> => {
  const tableAt = async (revision: string, reader: AccessReader): Promise<AccessTable> => {
    const listed = await gitUntrimmed(repo, 'ls-tree', '-r', '-z', '--name-only', revision);
    const files = await Promise.all(
      listed
        .split('\0')
        .filter(reader.holds)
        .map(
          async file => [file, await gitUntrimmed(repo, 'show', `${revision}:${file}`)] as const,
        ),
    );
    return reader.actions({ files: new Map(files), authorize });
  };
  return Promise.all(
    access
      .filter(reader => changes.some(paths => paths.some(reader.holds)))
      .map(async reader => ({
        base: await tableAt(base, reader),
        head: await tableAt(head, reader),
      })),
  );
};
