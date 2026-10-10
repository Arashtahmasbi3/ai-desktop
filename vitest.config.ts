import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(process.cwd(), 'src/shared'),
      '@core': resolve(process.cwd(), 'src/core'),
      '@main': resolve(process.cwd(), 'src/main')
    }
  },
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    environment: 'node',
    clearMocks: true
  }
})
