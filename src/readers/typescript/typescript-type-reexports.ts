import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { moduleAt, modulesNamedBy, type Resolution } from './typescript-config.ts';
import { parseTypeScript } from './typescript-syntax.ts';
import { CruiseOutputSchema } from './web-graph.ts';

const MAY_REEXPORT_TYPES = /\bexport\s+type\s*[{*]/;

const typeSourcesIn = (path: string, file: string): ReadonlyArray<string> => {
  try {
    const text = readFileSync(file, 'utf8');
    if (!MAY_REEXPORT_TYPES.test(text)) return [];
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

type TypeReexportsOptions = {
  readonly cruiseJson: string;
  readonly directory: string;
  readonly resolution: Resolution;
};

export const withTypeReexports = ({
  cruiseJson,
  directory,
  resolution,
}: TypeReexportsOptions): string => {
  const { modules } = CruiseOutputSchema.parse(JSON.parse(cruiseJson));
  const sourceAt = new Map(modules.map(({ source }) => [moduleAt(directory, source), source]));
  const resolved = (specifier: string, importer: string): string =>
    modulesNamedBy({ head: directory, resolution }, { specifier, importer }).flatMap(
      place => sourceAt.get(place) ?? [],
    )[0] ?? specifier;
  return JSON.stringify({
    modules: modules.map(module => ({
      ...module,
      dependencies: [
        ...module.dependencies,
        ...typeSourcesIn(module.source, join(directory, module.source)).map(specifier => ({
          module: specifier,
          resolved: resolved(specifier, module.source),
        })),
      ],
    })),
  });
};
