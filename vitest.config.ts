import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    unstubEnvs: true,
    globalSetup: './vitest.setup.ts',
    exclude: [...configDefaults.exclude, '.claude/**'],
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          exclude: ['**/*.test.tsx'],
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: 'page',
          include: ['**/*.test.tsx'],
          fileParallelism: false,
          testTimeout: 15_000,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
