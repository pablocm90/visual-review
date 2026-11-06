import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { isTooBig } from '../too-big.ts';
import { moduleAt, modulesNamedBy, type Resolution } from './typescript-config.ts';
import { parseTypeScript } from './typescript-syntax.ts';
import { CruiseOutputSchema, isUnder } from './web-graph.ts';

const MAY_REEXPORT_TYPES = /\bexport\s+type\s*[{*]/;

const typeSourcesIn = (path: string, file: string): ReadonlyArray<string> => {
  try {
    const text = readFileSync(file, 'utf8');
    if (!MAY_REEXPORT_TYPES.test(text) || isTooBig(text)) return [];
    return parseTypeScript(text, path).program.body.flatMap(statement =>
      (statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportAllDeclaration') &&
      statement.exportKind === 'type' &&
      statement.source
        ? [statement.source.value]
        : [],
    );
  } catch {
    return [];
  }
};

const SCRIPT_ENDINGS = ['.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mjs', '.cjs'];

const scriptAt = (place: string): string | undefined =>
  [
    ...SCRIPT_ENDINGS.map(ending => `${place}${ending}`),
    ...SCRIPT_ENDINGS.map(ending => join(place, `index${ending}`)),
  ].find(file => existsSync(file));

type TypeReexportsOptions = {
  readonly cruiseJson: string;
  readonly checkout: string;
  readonly root: string;
  readonly resolution: Resolution;
};

export const withTypeReexports = ({
  cruiseJson,
  checkout,
  root,
  resolution,
}: TypeReexportsOptions): string => {
  const directory = join(checkout, root);
  const { modules } = CruiseOutputSchema.parse(JSON.parse(cruiseJson));
  const sourceAt = new Map(modules.map(({ source }) => [moduleAt(directory, source), source]));
  const fileAt = (place: string): string | undefined => {
    const file = isUnder(checkout, place) ? scriptAt(place) : undefined;
    return file === undefined ? undefined : relative(directory, file);
  };
  const fileNamedBy = (specifier: string, importer: string): string | undefined =>
    modulesNamedBy({ head: directory, resolution }, { specifier, importer }).flatMap(
      place => sourceAt.get(place) ?? fileAt(place) ?? [],
    )[0];
  const read = modules.map(module => ({
    module,
    named: typeSourcesIn(module.source, join(directory, module.source)).map(specifier => ({
      specifier,
      file: fileNamedBy(specifier, module.source),
    })),
  }));
  return JSON.stringify({
    modules: [
      ...read.map(({ module, named }) => ({
        ...module,
        dependencies: [
          ...module.dependencies,
          ...named.map(({ specifier, file }) => ({
            module: specifier,
            resolved: file ?? specifier,
          })),
        ],
      })),
      ...read.flatMap(({ named }) =>
        named.flatMap(({ file }) =>
          file === undefined ? [] : [{ source: file, dependencies: [] }],
        ),
      ),
    ],
  });
};
