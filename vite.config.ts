import { join } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const root = join(import.meta.dirname, 'src', 'viewer');

export default defineConfig({
  root,
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: join(import.meta.dirname, 'dist'),
    emptyOutDir: false,
    rollupOptions: { input: join(root, 'viewer.html') },
  },
});
