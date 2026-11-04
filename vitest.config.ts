import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    unstubEnvs: true,
    exclude: [...configDefaults.exclude, '.claude/**'],
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          include: ['**/*.test.ts'],
          globalSetup: './vitest.setup.ts',
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: 'page',
          include: ['**/*.test.tsx'],
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
