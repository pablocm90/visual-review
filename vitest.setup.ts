import { join } from 'node:path';
import { build } from 'vite';

export default async (): Promise<void> => {
  await build({ configFile: join(import.meta.dirname, 'vite.config.ts'), logLevel: 'silent' });
};
