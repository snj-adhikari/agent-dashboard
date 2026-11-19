import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const page = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: { input: { main: page('./index.html'), mascot: page('./desktop-mascot.html') } },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
