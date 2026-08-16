import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const developmentEnv = loadEnv('development', process.cwd(), '')
  // Vercel does not load .env.development for a production build. Fall back
  // only for the NocoDB public config; never carry localhost API settings to
  // production. Deployment environment variables still take precedence.
  const nocoFallbackDefines = Object.fromEntries(
    Object.entries(developmentEnv)
      .filter(([key]) => (key.startsWith('VITE_NOCODB_') || key.startsWith('VITE_TABLE_')) && !env[key])
      .map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])
  )
  const proxyTarget = (env.VITE_API_PROXY_TARGET || env.VITE_API_ORIGIN || 'http://localhost:4000').replace(/\/+$/, '')

  return {
    plugins: [react()],
    define: nocoFallbackDefines,
    server: {
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
          secure: true
        }
      }
    }
  }
})
