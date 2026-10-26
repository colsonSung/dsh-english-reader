/**
 * The import progress tests.
 *
 * An import is slow, so the learner has to see it happening: a card with the
 * file, the stage and a bar that moves. These tests cover the three pieces
 * that make that true — the progress model, the parsers that report their
 * work, and the page that shows the card.
 *
 * Run: node --test tests/import-progress.test.mjs
 */
import './dom-setup.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { dom } from './dom-setup.mjs'
import { strToU8, zipSync } from 'fflate'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { act } from 'react'

globalThis.DOMParser = dom.window.DOMParser

/** The translator of the tests: the key is enough to assert on. */
const t = (key) => key

/**
 * A translator that speaks, so the card's own sentences can be asserted on.
 * @param {string} key
 * @returns {string}
 */
const spoken = (key) => ({
  'library.importing': 'Importing…',
  'library.importStage.read': 'Reading the file',
  'library.importStage.parse': 'Parsing the text',
  'library.importStage.cover': 'Preparing the cover',
  'library.importStage.save': 'Saving to the shelf',
  'library.importPages': 'Page {current} of {total}',
  'library.importChapters': 'Chapter {current} of {total}',
}[key] ?? key)

/**
 * Wait for the given number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

test('the progress model turns the stages into one honest fraction', async () => {
  const { IMPORT_STAGES, stageFraction, overallFraction, progressPercent } = await import('../src/lib/import-progress.js')

  // The stages own disjoint slices of the bar, and the bar never goes back.
  let previous = 0
  for (const stage of IMPORT_STAGES) {
    const value = stageFraction(stage.id, 1)
    assert.ok(value > previous, `${stage.id} must add to the bar`)
    previous = value
  }
  assert.equal(stageFraction('read', 0), 0)
  assert.equal(stageFraction('read', 1), 0.05)
  assert.equal(stageFraction('save', 1), 1)
  // A ratio outside [0, 1] cannot push the bar out of its track.
  assert.ok(Math.abs(stageFraction('parse', 5) - 0.85) < 1e-9)
  assert.equal(stageFraction('parse', -1), 0.05)

  // Two files: the first one counts for half of the bar.
  assert.equal(progressPercent({ index: 0, total: 2, stage: 'save', ratio: 1 }), 50)
  assert.equal(progressPercent({ index: 1, total: 2, stage: 'save', ratio: 1 }), 100)
  // The parse stage is 80% of a file, so half of it is 45% of one file.
  assert.equal(progressPercent({ index: 0, total: 1, stage: 'parse', ratio: 0.5 }), 45)
  assert.equal(progressPercent(null), 0)
  assert.equal(overallFraction({ index: 0, total: 1, stage: 'save', ratio: 1 }), 1)
})

test('the import card shows the file, the stage and a moving bar', async () => {
  const { ImportCard } = await import('../src/ui/import-card.js')
  const container = dom.window.document.createElement('div')
  dom.window.document.body.appendChild(container)
  const root = ReactDOM.createRoot(container)

  await act(async () => {
    root.render(React.createElement(ImportCard, {
      t: spoken,
      progress: { name: 'alice.epub', index: 0, total: 2, stage: 'parse', ratio: 0.5, detail: { current: 12, total: 300, unit: 'page' } },
    }))
  })

  const card = container.querySelector('.er-import')
  assert.ok(card, 'the card must be rendered')
  assert.match(card.textContent, /alice\.epub/)
  assert.match(card.textContent, /1 \/ 2/)
  // The parser can count its own work, so the card says where it is.
  assert.match(card.textContent, /Page 12 of 300/)
  // The bar has a width, and it is a real one: two files, and the first one
  // is halfway through its parse stage.
  const bar = container.querySelector('.er-import-bar')
  assert.ok(bar, 'the card must have a progress bar')
  assert.equal(bar.style.width, '23%')

  // A stage without a counter falls back to the name of the stage.
  await act(async () => {
    root.render(React.createElement(ImportCard, {
      t: spoken,
      progress: { name: 'alice.epub', index: 0, total: 1, stage: 'cover', ratio: 0, detail: null },
    }))
  })
  assert.match(container.querySelector('.er-import-stage').textContent, /Preparing the cover/)

  await act(async () => { root.unmount() })
})

test('the EPUB parser reports the chapter it is on', async () => {
  const { parseBook } = await import('../src/lib/parsers/index.js')
  const container = `<?xml version="1.0" encoding="UTF-8"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`
  const chapter = (title) => `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head>
<body><h1>${title}</h1><p>Some text for the chapter.</p></body></html>`
  const files = {
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(container),
    'OEBPS/ch1.xhtml': strToU8(chapter('One')),
    'OEBPS/ch2.xhtml': strToU8(chapter('Two')),
    'OEBPS/content.opf': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Two Chapters</dc:title><dc:language>en</dc:language></metadata>
<manifest><item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/></manifest>
<spine><itemref idref="c1"/><itemref idref="c2"/></spine>
</package>`),
  }
  const file = new File([zipSync(files)], 'two.epub', { type: 'application/epub+zip' })

  const reports = []
  await parseBook(file, (info) => { reports.push(info) })

  assert.ok(reports.length >= 2, 'the EPUB parser must report its progress')
  const last = reports[reports.length - 1]
  assert.equal(last.unit, 'chapter')
  assert.equal(last.total, 2)
  assert.equal(last.current, 2)
  assert.equal(last.ratio, 1)
  // The ratio only moves forward.
  let previous = -1
  for (const report of reports) {
    assert.ok(report.ratio >= previous)
    previous = report.ratio
  }
})

test('the PDF parser reports the page it is on', async () => {
  const { parsePdf } = await import('../src/lib/parsers/pdf.js')
  const page = (text) => [{ str: text, hasEOL: true, transform: [1, 0, 0, 1, 0, 700] }]
  const fakePdfjs = {
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 3,
        getMetadata: async () => ({ info: { Title: 'Fake', Author: 'Fake' } }),
        getPage: async (number) => ({ getTextContent: async () => ({ items: page(`Page ${number}.`) }) }),
      }),
    }),
  }

  const reports = []
  await parsePdf(new Uint8Array([1, 2, 3]), {
    loadChunk: async () => fakePdfjs,
    onProgress: (info) => { reports.push(info) },
  })

  assert.equal(reports.length, 4)
  assert.deepEqual(reports.map((report) => report.current), [0, 1, 2, 3])
  assert.deepEqual(reports.map((report) => report.unit), ['page', 'page', 'page', 'page'])
  assert.equal(reports[reports.length - 1].ratio, 1)
})

test('the page shows the import card while a book is being imported', async () => {
  const { EnglishReaderPage } = await import('../src/ui/page.js')
  const container = dom.window.document.createElement('div')
  dom.window.document.body.appendChild(container)
  const root = ReactDOM.createRoot(container)
  await act(async () => { root.render(React.createElement(EnglishReaderPage, { t })) })

  // No import, no card.
  assert.equal(container.querySelector('.er-import'), null)

  // A file whose content only arrives when the test says so: the import is
  // parked in the middle of the parse, which is where the card has to be.
  let release = () => {}
  const parked = new Promise((resolve) => {
    release = () => resolve(new TextEncoder().encode('Chapter one\n\nHello there.').buffer)
  })
  const file = { name: 'slow-book.txt', type: 'text/plain', arrayBuffer: () => parked }

  const input = container.querySelector('input[type=file]')
  assert.ok(input, 'the page must have a file input')
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  await act(async () => { input.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })

  const card = container.querySelector('.er-import')
  assert.ok(card, 'the import card must be on screen while the import runs')
  assert.match(card.textContent, /slow-book\.txt/)
  assert.match(card.textContent, /library\.importing/)
  // The stage is the one the import is in.
  assert.match(card.querySelector('.er-import-stage').textContent, /library\.importStage\.parse/)
  // The bar is not empty.
  const bar = card.querySelector('.er-import-bar')
  assert.ok(bar, 'the card must have a progress bar')
  assert.notEqual(bar.style.width, '0%')
  // The shelf makes room for the card, so it never hides a book.
  assert.match(container.querySelector('.er-page').className, /is-importing/)

  // The import finishes; the card goes away.
  await act(async () => { release() })
  await act(async () => { await sleep(900) })
  assert.equal(container.querySelector('.er-import'), null, 'the card must go away when the import is done')

  await act(async () => { root.unmount() })
})
