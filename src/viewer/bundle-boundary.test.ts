import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { expect, test } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..');

/** The modules a file loads when it runs: imports and re-exports that aren't type-only. */
const runtimeImports = (source: string): ReadonlyArray<string> =>
  [
    ...source.matchAll(
      /^\s*(?:import(?!\s+type\b)[\s\S]*?from\s*|import\s*|export(?!\s+type\b)\s*(?:\*|\{[\s\S]*?\})\s*from\s*)'([^']+)';/gm,
    ),
  ].flatMap(([, specifier]) => (specifier === undefined ? [] : [specifier]));

const loadedFrom = (entry: string): ReadonlyMap<string, ReadonlyArray<string>> => {
  const loaded = new Map<string, ReadonlyArray<string>>();
  const visit = (file: string) => {
    if (loaded.has(file)) return;
    const imports = runtimeImports(readFileSync(file, 'utf8'));
    loaded.set(file, imports);
    for (const specifier of imports) {
      if (specifier.startsWith('.')) visit(join(dirname(file), specifier));
    }
  };
  visit(entry);
  return loaded;
};

test('nothing the page loads, from its entry through the core, imports a Node module', () => {
  const loaded = loadedFrom(join(ROOT, 'src/viewer/main.tsx'));
  const nodeImports = [...loaded].flatMap(([file, imports]) =>
    imports
      .filter(specifier => specifier.startsWith('node:'))
      .map(specifier => `${relative(ROOT, file)} imports ${specifier}`),
  );

  expect(loaded.size).toBeGreaterThan(40);
  expect(nodeImports).toStrictEqual([]);
});

test('the walk sees a runtime import, a re-export and a mixed import, and skips a type-only one', () => {
  expect(
    runtimeImports(
      [
        "import { a } from './a.ts';",
        "import type { B } from './b.ts';",
        "import { type C, d } from './c.ts';",
        "export { e } from './e.ts';",
        "export type { F } from './f.ts';",
        "import './g.css';",
        'import {\n  h,\n  type I,\n} from "./ignored-double-quotes";',
      ].join('\n'),
    ),
  ).toStrictEqual(['./a.ts', './c.ts', './e.ts', './g.css']);
});
