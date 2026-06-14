import { fileURLToPath, URL } from 'node:url'
import { promises as fsp, readFileSync, existsSync } from 'node:fs'
import * as nodePath from 'node:path'

import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import EncryptSecrets, {
  encryptUserFile,
  DEFAULT_PBKDF2_ITER,
} from "./src/vite.encrypt-secrets.plugin";

const RAW_DIR = nodePath.resolve(process.cwd(), 'src/stores/secrets/raw');
const ENC_DIR = nodePath.resolve(process.cwd(), 'src/stores/secrets/encrypted');

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
              await fsp.mkdir(RAW_DIR, { recursive: true });
              await fsp.writeFile(nodePath.join(RAW_DIR, `${user}.json`), JSON.stringify(data, null, 2));

              // Encrypt inline (don't wait on the file-watcher, which can miss
              // events on some mounts/containers and leave Vite serving a stale
              // cached module until a dev-server restart).
              const encPath = await encryptUserFile({
                user,
                rawDir: RAW_DIR,
                encDir: ENC_DIR,
                iterations: DEFAULT_PBKDF2_ITER,
              });
              // Drop Vite's cached transform of the encrypted module so the next
              // page load re-reads it from disk. Without this, a missed FS-watch
              // event leaves Vite serving stale ciphertext until a server restart.
              for (const mod of server.moduleGraph.getModulesByFile(encPath) ?? []) {
                server.moduleGraph.invalidateModule(mod);
              }

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

// Enable HTTPS in dev if a self-signed cert exists (certs/). Needed because the
// app uses WebCrypto (crypto.subtle), which browsers only expose in a secure
// context — i.e. HTTPS or localhost, never plain HTTP on a LAN IP.
const certKey = nodePath.resolve(process.cwd(), 'certs/dev-key.pem')
const certCrt = nodePath.resolve(process.cwd(), 'certs/dev-cert.pem')
const httpsOpts =
  existsSync(certKey) && existsSync(certCrt)
    ? { key: readFileSync(certKey), cert: readFileSync(certCrt) }
    : undefined

// https://vite.dev/config/
export default defineConfig({
  server: {
    host: '0.0.0.0',
    https: httpsOpts,
  },
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
