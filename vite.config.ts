import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Dev-only endpoint that writes a captured frame to disk.
 *
 * The visual overhaul is judged on rendered images, and the browser pane composites the page at
 * roughly 175x105 regardless of the canvas being 1600x1000 — so no screenshot of the pane can show
 * a panel seam. The page reads its own backing store with `toDataURL` and POSTs it here.
 *
 * A Vite middleware rather than a download: downloads land wherever the browser decides and may
 * prompt, while this writes a deterministic path that a later run can diff against. It exists only
 * on the dev server, so there is nothing to strip from a production build.
 */
interface CaptureRequest {
  method?: string;
  on(event: 'data', fn: (chunk: Buffer) => void): void;
  on(event: 'end', fn: () => void): void;
}
interface CaptureResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}

function captureEndpoint() {
  return {
    name: 'photon-capture',
    apply: 'serve' as const,
    configureServer(server: { middlewares: { use: (path: string, fn: unknown) => void } }) {
      server.middlewares.use('/__capture', (req: CaptureRequest, res: CaptureResponse) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('POST only'); return; }
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk; });
        req.on('end', () => {
          try {
            const { name, dataUrl } = JSON.parse(body);
            // Refuse anything that escapes the captures folder.
            const safe = String(name).replace(/[^a-zA-Z0-9._-]/g, '_');
            const out = resolve(process.cwd(), 'captures', safe.endsWith('.png') ? safe : safe + '.png');
            mkdirSync(dirname(out), { recursive: true });
            const b64 = String(dataUrl).split(',')[1] ?? '';
            const buf = Buffer.from(b64, 'base64');
            writeFileSync(out, buf);
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, path: out, bytes: buf.length }));
          } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: String(err) }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), captureEndpoint()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5180,
    host: '127.0.0.1',
  },
  build: {
    target: 'esnext',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Keep the heavy engine dependencies in stable chunks so browser cache
        // survives gameplay-code iteration.
        manualChunks: {
          three: ['three'],
          rapier: ['@dimforge/rapier3d-compat'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
  worker: { format: 'es' },
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
  },
});
