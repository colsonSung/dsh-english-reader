import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);

/**
 * Wrap a bundle in the shell's module-loader factory.
 * @param {string|null} chunk - chunk file name, or null for the main bundle.
 * @returns {{ banner: { js: string }, footer: { js: string } }}
 */
const wrap = (chunk) => ({
  banner: {
    js: `window.__ModuleLoader__.load({
	id: "@local/reader",
${chunk ? `\tchunk: "${chunk}",\n` : ''}	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;`,
  },
  footer: {
    js: `		return module.exports;
	}
});`,
  },
});

const shared = {
  bundle: true,
  format: 'cjs',
  target: 'es2022',
  platform: 'browser',
  minify: true,
  logLevel: 'info',
  // pdf.js reads `import.meta.url` only in its Node.js branches; in the
  // browser bundle it is empty by design.
  supported: { 'import-meta': false },
};

/**
 * pdf.js loads its worker as a module worker. The worker source is inlined as
 * text and handed to pdf.js as a blob URL, so the worker never needs a second
 * network request or a second served file.
 */
const pdfWorkerText = {
  name: 'pdf-worker-text',
  setup(builder) {
    builder.onResolve({ filter: /pdf\.worker\.min\.mjs$/ }, (args) => ({
      path: args.path,
      namespace: 'pdf-worker-text',
    }));
    builder.onLoad({ filter: /.*/, namespace: 'pdf-worker-text' }, async (args) => ({
      contents: await readFile(require.resolve(args.path), 'utf8'),
      loader: 'text',
    }));
  },
};

// The build stamp lets the page show which bundle it is running, so a window
// that still holds an older bundle is recognisable at a glance.
const BUILD_STAMP = new Date().toISOString().replace('T', ' ').slice(0, 16);

await build({
  ...shared,
  entryPoints: ['src/client-entry.js'],
  outfile: 'client.js',
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
  define: { __ER_BUILD__: JSON.stringify(BUILD_STAMP) },
  ...wrap(null),
});

await build({
  ...shared,
  entryPoints: ['src/pdf-chunk.js'],
  outfile: 'client.pdf.js',
  plugins: [pdfWorkerText],
  ...wrap('client.pdf.js'),
});
