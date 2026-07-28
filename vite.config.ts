import { fileURLToPath, URL } from 'node:url'

import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'WBE_')
  const devProxyTarget = env.WBE_DEV_PROXY_TARGET

  return {
    plugins: [
      vue(),
      ...(command === 'serve' && mode !== 'production' ? [vueDevTools()] : []),
    ],
    server: {
      host: '127.0.0.1',
      ...(devProxyTarget
        ? {
            proxy: {
              '/api': {
                target: devProxyTarget,
                changeOrigin: true,
              },
            },
          }
        : {}),
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
  }
})
