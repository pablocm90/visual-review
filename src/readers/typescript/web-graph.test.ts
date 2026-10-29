import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { webGraph } from './web-graph.ts';

const recordedAt11bbc5d = readFileSync(
  join(import.meta.dirname, '..', '..', 'fixtures', 'depcruise-web-11bbc5d.json'),
  'utf8',
);

const moduleNode = (label: string) => ({
  id: `web/module/${label}`,
  kind: 'module',
  label,
  parent: 'web',
  path: `web/src/${label}`,
});

const fileNode = (label: string) => ({
  id: `web/file/${label}`,
  kind: 'file',
  label,
  parent: 'web',
  path: `web/src/${label}`,
});

const fileInModule = (module: string, label: string) => ({
  id: `web/file/${module}/${label}`,
  kind: 'file',
  label,
  parent: `web/module/${module}`,
  path: `web/src/${module}/${label}`,
});

test('web/src files sit in a module per top-level directory, root files directly under a web stack, without packages, and imports join files', () => {
  const graph = webGraph({
    stack: 'web',
    directory: 'web',
    sourceRoot: 'src',
    boxes: [],
    cruiseJson: recordedAt11bbc5d,
    packages: new Map(),
  });

  expect(graph.nodes).toEqual([
    { id: 'web', kind: 'stack', label: 'web', path: '' },
    fileNode('App.tsx'),
    moduleNode('modules'),
    fileInModule('modules', 'AppInfo/api/app-info.ts'),
    fileNode('main.tsx'),
    moduleNode('utils'),
    fileInModule('utils', 'add-action-name-to-mutation-result.ts'),
    fileInModule('utils', 'add-resource-name-to-infinite-query-result.ts'),
    fileInModule('utils', 'add-resource-name-to-query-result.ts'),
    fileNode('vite-env.d.ts'),
  ]);
  expect(graph.edges).toEqual([
    { from: 'web/file/App.tsx', to: 'web/file/modules/AppInfo/api/app-info.ts' },
    { from: 'web/file/main.tsx', to: 'web/file/App.tsx' },
  ]);
});

test.for([
  { reason: 'a box glob matches it', boxes: ['modules/*'] },
  { reason: 'the deepest of the box globs matching it', boxes: ['modules', 'modules/*'] },
  {
    reason: 'a box glob matches it, though another matches a file',
    boxes: ['modules/*', '**/*.ts'],
  },
])(
  'a folder is its own box, labelled with its path, when $reason, and files under no matched folder keep their first folder',
  ({ boxes }) => {
    const graph = webGraph({
      stack: 'web',
      directory: 'web',
      sourceRoot: 'src',
      cruiseJson: recordedAt11bbc5d,
      packages: new Map(),
      boxes,
    });

    expect(graph.nodes).toEqual([
      { id: 'web', kind: 'stack', label: 'web', path: '' },
      fileNode('App.tsx'),
      moduleNode('modules/AppInfo'),
      fileInModule('modules/AppInfo', 'api/app-info.ts'),
      fileNode('main.tsx'),
      moduleNode('utils'),
      fileInModule('utils', 'add-action-name-to-mutation-result.ts'),
      fileInModule('utils', 'add-resource-name-to-infinite-query-result.ts'),
      fileInModule('utils', 'add-resource-name-to-query-result.ts'),
      fileNode('vite-env.d.ts'),
    ]);
  },
);
