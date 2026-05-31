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
        about: resolve(root, 'about/index.html'),
        publications: resolve(root, 'publications/index.html'),
        cv: resolve(root, 'cv/index.html'),
        mathCircles: resolve(root, 'math-circles/index.html'),
        project1: resolve(root, 'projects/project1/index.html'),
        project2: resolve(root, 'projects/project2/index.html'),
        // Unlinked tool route — built/deployed but not in src/nav.ts.
        fire: resolve(root, 'fire/index.html'),
      },
    },
  },
});
