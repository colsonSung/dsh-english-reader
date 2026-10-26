import { build } from 'esbuild';

await build({
  entryPoints: ['tools/preview/preview.js'],
  outfile: 'tools/preview/preview.bundle.js',
  bundle: true,
  format: 'iife',
  target: 'es2022',
  platform: 'browser',
  minify: false,
  logLevel: 'info',
  // The preview seeds the local shelf with IndexedDB, so it must be served
  // over http — a file:// origin has no IndexedDB.
});
