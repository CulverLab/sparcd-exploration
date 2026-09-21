import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

const pkg = (name: string) => fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url))
const page = (name: string) => fileURLToPath(new URL(name, import.meta.url))

export default defineConfig({
  base: '/sparcd-exploration/admin/',
  plugins: [react()],
  resolve: {
    alias: {
      '@sparcd/auth-ui': pkg('auth-ui'),
      '@sparcd/s3-safe': pkg('s3-safe'),
      '@sparcd/types': pkg('types'),
    },
  },
  build: { rollupOptions: { input: { main: page('index.html'), join: page('join.html') } } },
})
