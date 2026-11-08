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
      /*
       * v4.2: `target: 'esnext'` so the chunk-level transpile step never runs.
       *
       * The v4.1 note below split the vendor bundle because esbuild passes a large payload to its native binary
       * through a temp file and removing that file is denied on this machine. Splitting stopped being enough once the
       * app chunk itself grew: `vite:esbuild-transpile` processes every chunk at the end, and that is the step that
       * needs the temp file — so the build failed after all 2283 modules had been transformed.
       *
       * Nothing here needed lowering anyway. The renderer only ever runs in the Chromium that ships inside this
       * Electron (44), which is far newer than Vite's default target, so the transpile step was work with no
       * consumer. Skipping it removes the failure instead of dodging it, and keeps the v4.1 chunking.
       *
       * (It belongs at the `build` level, not inside `rollupOptions` — that is a Rollup option bag, not Vite's, and a
       * `target` there is silently ignored, which is exactly how the first attempt at this fix changed nothing.)
       */
      target: 'esnext',
      rollupOptions: {
        ...optimizeBuild.rollupOptions,
        output: {
          /*
           * Split by area, not by a vendor list.
           *
           * v4.1 split only the vendored libraries, which was enough while the app chunk was small. It no longer is:
           * esbuild hands a large payload to its native binary through a temp file, and on this machine removing that
           * file is denied (Defender holds it), so the build aborted after 2283 modules had been transformed. Keeping
           * every chunk modest is the only lever that reliably avoids the temp file — and it is a better bundle
           * anyway: editing a component no longer invalidates the store and the libraries.
           */
          manualChunks(id: string) {
            if (id.includes('node_modules')) {
              if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react-vendor'
              /*
               * No separate markdown chunk on purpose. The old rule matched a fixed list of package prefixes, so the
               * markdown tree's own helpers (vfile, property-information, devlop, bail, trough, ...) landed in
               * `vendor`; markdown needed vendor and vendor needed markdown, and Vite reported the circular chunk.
               * A name list would have to grow with every transitive dependency; one bucket cannot contain a cycle.
               */
              if (/[\\/]node_modules[\\/](i18next|react-i18next)[\\/]/.test(id)) return 'i18n-vendor'
              if (/[\\/]node_modules[\\/]@xterm[\\/]/.test(id)) return 'terminal-vendor'
              return 'vendor'
            }
            if (id.includes('/src/renderer/src/components/')) return 'app-components'
            /*
             * store and lib import each other, so splitting them by folder produced
             * `app-store -> app-lib -> app-store`. One bucket cannot contain a cycle.
             */
            if (id.includes('/src/renderer/src/store') || id.includes('/src/renderer/src/lib/')) return 'app-core'
            return undefined
          }
        }
      }
    }
  }
})
