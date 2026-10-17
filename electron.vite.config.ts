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
    build: {
      ...optimizeBuild,
      rollupOptions: {
        ...optimizeBuild.rollupOptions,
        /*
         * v4.1: split the renderer bundle.
         *
         * esbuild passes any payload above an internal size limit to its native binary through a temp file. The
         * renderer used to be a single ~2 MB chunk, and on this machine removing that temp file is denied by the
         * OS, which aborted the build after all 2265 modules had been transformed. Keeping each chunk under the
         * threshold avoids the temp file entirely — and a stable vendor chunk is better for updates anyway: app
         * code changes no longer invalidate the whole bundle.
         */
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom', 'react/jsx-runtime'],
            'markdown-vendor': ['react-markdown', 'remark-parse', 'remark-rehype', 'unified'],
            'i18n-vendor': ['i18next', 'react-i18next'],
            'terminal-vendor': ['@xterm/xterm', '@xterm/addon-fit']
          }
        }
      }
    }
  }
})
