import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  base: '/personal-website/',
  build: {
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        publications: resolve(root, 'publications/index.html'),
      },
    },
  },
});
