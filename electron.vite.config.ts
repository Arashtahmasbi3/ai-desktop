import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

/**
 * Production build tuning shared by all three targets: esbuild minification,
 * no source maps and dead-code/`debugger` removal. Rollup tree-shaking is on
 * by default once the output is minified.
 */
const optimizeBuild = {
  minify: 'esbuild' as const,
  sourcemap: false as const,
  reportCompressedSize: false,
  rollupOptions: {
    treeshake: true
  }
} as const

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@main': resolve('src/main'),
        '@shared': resolve('src/shared'),
        '@core': resolve('src/core')
      }
    },
    esbuild: { drop: ['debugger'] },
    build: optimizeBuild
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@preload': resolve('src/preload'),
        '@shared': resolve('src/shared'),
        '@core': resolve('src/core')
      }
    },
    esbuild: { drop: ['debugger'] },
    build: optimizeBuild
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
        '@core': resolve('src/core')
      }
    },
    plugins: [react()],
    esbuild: { drop: ['debugger'] },
    build: optimizeBuild
  }
})
