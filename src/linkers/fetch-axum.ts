import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { apiRoutes, callGraph, webCalls } from '../api-paths.ts';
import type { GraphNode } from '../graph.ts';
import type { Linker } from '../linker.ts';

const TABLE_HEADER = /^\[([^\]]*)\]/;
const DEPENDENCY_TABLE = /^(target\..+\.)?dependencies$/;
const AXUM_TABLE = /^(target\..+\.)?dependencies\.axum$/;
const AXUM_KEY = /^\s*axum\s*[=.]/;

const declaresAxum = (manifest: string): boolean =>
  manifest.split('\n').reduce<{ readonly table: string; readonly found: boolean }>(
    ({ table, found }, line) => {
      const header = TABLE_HEADER.exec(line)?.[1];
      if (header !== undefined) return { table: header, found: found || AXUM_TABLE.test(header) };
      return { table, found: found || (DEPENDENCY_TABLE.test(table) && AXUM_KEY.test(line)) };
    },
    { table: '', found: false },
  ).found;

const dependsOnAxum = async (directory: string, crate: GraphNode): Promise<boolean> =>
  declaresAxum(await readFile(join(directory, crate.path, 'Cargo.toml'), 'utf8'));

export const fetchAxumLinker: Linker = {
  name: 'fetch-axum',
  from: 'typescript',
  to: 'rust',
  link: async ({ directory, from, to }) => {
    const files = from.flatMap(({ nodes }) => nodes.filter(({ kind }) => kind === 'file'));
    const packages = to.flatMap(({ nodes }) => nodes.filter(({ kind }) => kind === 'package'));
    const axum = await Promise.all(packages.map(crate => dependsOnAxum(directory, crate)));
    const crates = packages.filter((_, index) => axum[index]);
    if (crates.length === 0) return { edges: [], dangling: [] };
    const calls = webCalls(
      await Promise.all(
        files.map(async ({ id, path }) => ({
          from: id,
          text: await readFile(join(directory, path), 'utf8'),
        })),
      ),
    );
    const crateIds = new Set(crates.map(({ id }) => id));
    const modules = to.flatMap(({ nodes }) =>
      nodes.flatMap(({ parent, path }) =>
        parent !== undefined && crateIds.has(parent) ? [{ crate: parent, path }] : [],
      ),
    );
    const routes = (
      await Promise.all(
        modules.map(async ({ crate, path }) =>
          apiRoutes(await readFile(join(directory, path), 'utf8')).map(route => ({
            to: crate,
            path: route,
          })),
        ),
      )
    ).flat();
    return callGraph({ calls, routes });
  },
};
