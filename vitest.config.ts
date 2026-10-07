import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(process.cwd(), 'src/shared'),
      '@core': resolve(process.cwd(), 'src/core')
    }
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    clearMocks: true
  }
})
