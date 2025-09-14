import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import EncryptSecrets from "./src/vite.encrypt-secrets.plugin";

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
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
})
