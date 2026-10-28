import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    unstubEnvs: true,
    exclude: [...configDefaults.exclude, '.claude/**'],
    globalSetup: './vitest.setup.ts',
  },
});
