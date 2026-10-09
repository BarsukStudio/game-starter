import { defineConfig } from 'vite';
import { assertCasBuildPolicy } from './scripts/cas-build-policy.mjs';

export default defineConfig({
  root: './src',
  base: './',
  publicDir: '../public',
  plugins: [{
    name: 'cas-build-policy',
    configResolved(config) {
      // Vite has now merged the actual envDir/mode files and process overrides.
      assertCasBuildPolicy({
        ...config.env,
        CAS_REAL_NETWORK_QA: process.env.CAS_REAL_NETWORK_QA,
        CAS_RELEASE_BUILD: process.env.CAS_RELEASE_BUILD,
      });
    },
  }],
  build: {
    // Keep logical assignment and class fields out of older WebView bundles.
    target: 'es2020',
    outDir: '../dist',
    minify: false,
    emptyOutDir: true,
  },
});
