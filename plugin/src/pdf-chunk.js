/**
 * The pdf.js chunk.
 *
 * pdf.js is far too large to ship in the main bundle, so it is loaded on
 * demand the first time a learner imports a PDF. The worker source is inlined
 * as text and published as a blob URL: pdf.js creates its worker as a module
 * worker, and a blob URL keeps that worker same-origin without a second
 * served file.
 */
import workerText from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
  const workerUrl = URL.createObjectURL(new Blob([workerText], { type: 'text/javascript' }));
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
}

export * from 'pdfjs-dist/legacy/build/pdf.mjs';
