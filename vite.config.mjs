import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The development server needs its own address in the Content-Security-Policy; the installed
// program must not allow it.
const devOrigins = /\s+http:\/\/127\.0\.0\.1:5173\s+ws:\/\/127\.0\.0\.1:5173/;
const productionCSP = {
  name: 'production-csp',
  apply: 'build',
  transformIndexHtml(html) {
    if (!devOrigins.test(html)) throw new Error('index.html: a CSP mudou; ajuste vite.config.mjs.');
    return html.replace(devOrigins, '');
  },
};

export default defineConfig({
  root: 'frontend',
  base: './',
  plugins: [react(), productionCSP],
  build: { outDir: '../dist/frontend', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
