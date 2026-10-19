import { defineConfig } from 'vite';

// base './' damit die statische Seite in jedem Unterverzeichnis (z.B. GitHub Pages) läuft
export default defineConfig({
  base: './',
  build: { target: 'es2022' },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
