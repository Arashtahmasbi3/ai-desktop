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
    clearMocks: true,
    /**
     * Vitest's 5s default is a wall-clock budget for a test that may be sharing the machine with a
     * dozen other workers, and this suite contains tests that drive a **real** local sandbox: one
     * file's cases each take ~3.2s alone, so under parallel load they crossed 5s and failed as
     * "Test timed out in 5000ms" rather than as regressions. Two such flakes were found and fixed
     * one at a time before this; a test that is genuinely hung still fails, just 20 seconds later
     * instead of 5, which is a cheap price for a suite whose failures mean something.
     */
    testTimeout: 20_000
  }
})
