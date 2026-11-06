import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { moduleOf } from './typescript-config.ts';
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

type TypeReexportsOptions = { readonly cruiseJson: string; readonly directory: string };

export const withTypeReexports = ({ cruiseJson, directory }: TypeReexportsOptions): string => {
  const { modules } = CruiseOutputSchema.parse(JSON.parse(cruiseJson));
  const sourceAt = new Map(modules.map(({ source }) => [moduleOf(source), source]));
  return JSON.stringify({
    modules: modules.map(module => ({
      ...module,
      dependencies: [
        ...module.dependencies,
        ...typeSourcesIn(module.source, join(directory, module.source)).map(specifier => ({
          module: specifier,
          resolved: sourceAt.get(moduleOf(join(dirname(module.source), specifier))) ?? specifier,
        })),
      ],
    })),
  });
};
