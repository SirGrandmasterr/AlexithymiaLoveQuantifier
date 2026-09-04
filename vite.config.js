import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // ONNX Runtime's WebAssembly binary, aliased because `onnxruntime-web`'s exports
      // map does not expose its own dist files and Vite refuses a deep import without
      // one. It is imported with `?url` in `src/journal/inference/web.js`, so it lands
      // in `dist/assets/` as a **same-origin** asset.
      //
      // That is the whole point of it. Left alone, transformers.js points ONNX Runtime
      // at `https://cdn.jsdelivr.net/npm/onnxruntime-web@.../dist/`, which would put a
      // CDN request in the network tab of a page whose Vault entry says every request
      // goes to this app's own origin, and which `connect-src 'self'` would refuse a
      // layer lower anyway. The version is the lockfile's, so the binary and the
      // JavaScript that drives it can never be a mismatched pair.
      //
      // The `asyncify` binary, which is the one transformers.js itself points at and the
      // one C3 measured transcribing. Pointing at the smaller plain build instead was
      // tried and **made the output bigger**, not smaller: ONNX Runtime's own bundle
      // carries a `new URL(...)` reference to the asyncify binary, so Vite emits it
      // whatever this alias says, and naming a second one only added 12 MB beside it.
      //
      // The *device* is a separate decision and it is WASM — see `web.js`. This binary
      // serves both; only one of them runs.
      // The `?url` lives on the target rather than at the import site: Vite matches an
      // alias key against the whole specifier, query included, so `'alq-ort-wasm?url'`
      // would not match the key at all.
      'alq-ort-wasm': `${fileURLToPath(new URL(
        './node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm', import.meta.url))}?url`,
      'alq-ort-mjs': `${fileURLToPath(new URL(
        './node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs', import.meta.url))}?url`
    }
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.js',
    exclude: ['tests/**', 'node_modules/**'],
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
      '/uploads': 'http://localhost:8080',
    }
  }
})
