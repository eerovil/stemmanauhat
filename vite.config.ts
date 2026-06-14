import { fileURLToPath, URL } from 'node:url'
import { promises as fsp } from 'node:fs'
import * as nodePath from 'node:path'

import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import EncryptSecrets from "./src/vite.encrypt-secrets.plugin";

/**
 * Dev-only endpoint that lets the running app persist crop presets.
 * It writes the updated plaintext to src/stores/secrets/raw/<user>.json; the
 * EncryptSecrets plugin then re-encrypts it into the committed encrypted file.
 * Not registered in production builds (configureServer only runs in dev).
 */
function SavePresetsDev(): Plugin {
  return {
    name: 'save-presets-dev',
    configureServer(server) {
      server.middlewares.use('/__save-presets', (req, res, next) => {
        if (req.method !== 'POST') {
          next();
          return;
        }
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          void (async () => {
            try {
              const { user, data } = JSON.parse(body) as { user?: string; data?: unknown };
              if (typeof user !== 'string' || !/^[a-z0-9_-]+$/i.test(user)) {
                res.statusCode = 400;
                res.end('Invalid user');
                return;
              }
              const rawDir = nodePath.resolve(process.cwd(), 'src/stores/secrets/raw');
              await fsp.mkdir(rawDir, { recursive: true });
              await fsp.writeFile(nodePath.join(rawDir, `${user}.json`), JSON.stringify(data, null, 2));
              res.statusCode = 200;
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({ ok: true }));
            } catch (err) {
              res.statusCode = 500;
              res.end(String(err));
            }
          })();
        });
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    EncryptSecrets({
      // optional:
      // iterations: 300000,
      // prune: true,
      // debounceMs: 300,
      // watchProject: true,
      // failOnMissingPassphraseDev: false,
    }),
    vue(),
    vueDevTools(),
    SavePresetsDev(),
  ],
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
})
