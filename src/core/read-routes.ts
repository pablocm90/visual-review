import { gitUntrimmed } from './git.ts';
import { diffRoutes, type RouteChange, type UnreadChange } from './route-diff.ts';
import type { RouteReader, RouteTable } from './routes.ts';

export type RouteRow = RouteChange & { readonly patch: string };

export type UnreadRow = UnreadChange & { readonly patch: string };

export type RoutesReading =
  | {
      readonly routes: ReadonlyArray<RouteRow>;
      readonly unread: ReadonlyArray<UnreadRow>;
    }
  | { readonly file: string; readonly notRead: string };

type Changes = ReadonlyArray<ReadonlyArray<string>>;

type ReadRoutesOptions = {
  readonly repo: string;
  readonly base: string;
  readonly head: string;
  readonly changes: Changes;
  readonly routes: ReadonlyArray<RouteReader>;
};

const fileOf = (change: RouteChange): string =>
  change.state === 'removed' ? change.base.file : change.head.file;

const lastOf = (paths: ReadonlyArray<string> | undefined): string => paths?.at(-1) ?? '';

export const readRoutes = async ({
  repo,
  base,
  head,
  changes,
  routes,
}: ReadRoutesOptions): Promise<ReadonlyArray<RoutesReading>> => {
  const tableAt = async (revision: string, reader: RouteReader): Promise<RouteTable> => {
    const listed = await gitUntrimmed(repo, 'ls-tree', '-r', '-z', '--name-only', revision);
    const files = await Promise.all(
      listed
        .split('\0')
        .filter(reader.holds)
        .map(
          async file => [file, await gitUntrimmed(repo, 'show', `${revision}:${file}`)] as const,
        ),
    );
    return reader.routes(new Map(files));
  };
  const readingOf = async (
    reader: RouteReader,
    changed: Changes,
  ): Promise<ReadonlyArray<RoutesReading>> => {
    const patchOf = (file: string): string =>
      lastOf(changed.find(paths => paths.includes(file)) ?? changed[0]);
    try {
      const diff = diffRoutes({
        base: await tableAt(base, reader),
        head: await tableAt(head, reader),
      });
      return diff.routes.length === 0 && diff.unread.length === 0
        ? []
        : [
            {
              routes: diff.routes.map(change => ({ ...change, patch: patchOf(fileOf(change)) })),
              unread: diff.unread.map(change => ({ ...change, patch: patchOf(change.item.file) })),
            },
          ];
    } catch (error) {
      return [
        {
          file: lastOf(changed[0]),
          notRead: error instanceof Error ? error.message : String(error),
        },
      ];
    }
  };
  const readings = await Promise.all(
    routes.map(reader => {
      const changed = changes.filter(paths => paths.some(reader.holds));
      return changed.length === 0 ? [] : readingOf(reader, changed);
    }),
  );
  return readings.flat();
};
