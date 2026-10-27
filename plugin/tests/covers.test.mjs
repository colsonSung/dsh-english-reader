/**
 * The shelf cover tiles.
 *
 * The reference reading app draws a play button and a menu on every cover,
 * and it does not wait for a hover: those two buttons are what a learner does
 * with a book on the shelf. This file pins that behaviour down — the play
 * button is a real glyph rather than an emoji, it is never faded out, and it
 * does not open the book when it is pressed.
 *
 * Run: node --test tests/covers.test.mjs
 */
import './dom-setup.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { dom } from './dom-setup.mjs'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { act } from 'react'

import { LibraryView } from '../src/ui/library.js'
import { STYLE } from '../src/ui/styles.js'

/**
 * Split a stylesheet into its rules.
 *
 * The plugin's stylesheet is one long string, so a test that wants to know
 * how a selector is styled has to read it. A `@media` block is flattened into
 * the rules it holds, and the condition is kept with them.
 *
 * @param {string} css - the stylesheet.
 * @param {string} [media] - the condition the rules sit under.
 * @returns {{ selector: string, declarations: string, media: string }[]}
 */
function parseRules(css, media = '') {
  const rules = []
  // A comment never changes the cascade, so it is taken out before the
  // stylesheet is read; otherwise it would end up inside the selector.
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '')
  let index = 0
  while (index < source.length) {
    const open = source.indexOf('{', index)
    if (open === -1) break
    const selector = source.slice(index, open).trim()
    let depth = 1
    let cursor = open + 1
    while (cursor < source.length && depth > 0) {
      if (source[cursor] === '{') depth += 1
      else if (source[cursor] === '}') depth -= 1
      cursor += 1
    }
    const body = source.slice(open + 1, cursor - 1)
    if (selector.startsWith('@')) {
      const condition = selector.replace(/^@media\s*/, '').trim()
      rules.push(...parseRules(body, media === '' ? condition : `${media} and ${condition}`))
    } else {
      rules.push({ selector, declarations: body, media })
    }
    index = cursor
  }
  return rules
}

const RULES = parseRules(STYLE)

/**
 * The rules that carry one exact selector.
 * @param {string} selector
 * @returns {{ selector: string, declarations: string, media: string }[]}
 */
function rulesFor(selector) {
  return RULES.filter((rule) => rule.selector
    .split(',')
    .map((part) => part.trim())
    .includes(selector))
}

/**
 * The value of one property, for one exact selector.
 * @param {string} selector
 * @param {string} property
 * @returns {string[]} every value the selector declares, in order.
 */
function declared(selector, property) {
  const values = []
  for (const rule of rulesFor(selector)) {
    for (const part of rule.declarations.split(';')) {
      const [name, ...rest] = part.split(':')
      if ((name ?? '').trim() === property) values.push(rest.join(':').trim())
    }
  }
  return values
}

const BOOKS = [
  {
    id: 'b1',
    title: 'Pride and Prejudice',
    author: 'Jane Austen',
    format: 'epub',
    cover: 'data:image/jpeg;base64,AAA',
    chapters: [{ title: 'One', paragraphs: ['a'] }],
    progress: { percent: 0.42, activity: { totalWords: 1200, totalMs: 600000 } },
  },
  {
    id: 'b2',
    title: 'MOVE',
    author: 'Sangram Vajre',
    format: 'epub',
    cover: null,
    chapters: [{ title: 'One', paragraphs: ['a', 'b'] }],
    progress: { percent: 0 },
  },
]

/**
 * Mount the library and hand back the container plus the calls it made.
 * @param {'grid'|'list'} view - the view to render.
 * @returns {Promise<{ container: any, calls: any, root: any }>}
 */
async function mountLibrary(view = 'grid') {
  const container = dom.window.document.createElement('div')
  dom.window.document.body.appendChild(container)
  const root = ReactDOM.createRoot(container)
  const calls = { listened: [], opened: [], deleted: [], renamed: [] }
  const render = () => React.createElement(LibraryView, {
    t: (key) => key,
    books: BOOKS,
    busy: false,
    error: '',
    view,
    onViewChange: () => {},
    onFiles: () => {},
    onOpen: (id) => { calls.opened.push(id) },
    onDelete: (id) => { calls.deleted.push(id) },
    onRename: (id, title) => { calls.renamed.push([id, title]) },
    onListen: (id) => { calls.listened.push(id) },
  })
  await act(async () => { root.render(render()) })
  return { container, calls, root }
}

/**
 * Press a button the way a learner would.
 * @param {any} element
 */
async function press(element) {
  await act(async () => {
    element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  })
}

test('封面上的播放按钮是一个真正的图形按钮，不再是表情', async () => {
  const { container, root } = await mountLibrary('grid')
  const covers = container.querySelectorAll('.er-shelf-cover')
  assert.equal(covers.length, 2)

  for (const cover of covers) {
    const listen = cover.querySelector('.er-cover-listen')
    assert.ok(listen, 'the cover carries a play button')
    // The glyph is drawn, not typed.
    assert.equal(listen.querySelectorAll('svg').length, 1, 'the play button holds an SVG glyph')
    const path = listen.querySelector('svg path')
    assert.ok(path, 'the glyph is a filled triangle')
    assert.equal(path.getAttribute('fill'), 'currentColor')
    assert.equal(listen.textContent, '', 'the play button has no text of its own')
    assert.ok(!listen.innerHTML.includes('🎧'), 'the headphone emoji is gone')
  }

  await act(async () => { root.unmount() })
})

test('播放按钮和菜单按钮是两个不同的元素，都不是打开书的那一层', async () => {
  const { container, root } = await mountLibrary('grid')
  const cover = container.querySelector('.er-shelf-cover')

  const listen = cover.querySelector('.er-cover-listen')
  const menu = cover.querySelector('.er-cover-menu')
  const open = cover.querySelector('.er-cover-open')

  assert.ok(listen && menu && open, 'the cover has all three layers')
  assert.notEqual(listen, menu, 'the play button and the menu are different elements')
  assert.equal(container.querySelectorAll('.er-cover-action').length, 4, 'two buttons on each cover')
  assert.equal(container.querySelectorAll('.er-cover-open').length, 2, 'one overlay per cover')

  // Neither round button is the overlay that opens the book.
  assert.ok(!listen.classList.contains('er-cover-open'))
  assert.ok(!menu.classList.contains('er-cover-open'))
  assert.ok(!open.classList.contains('er-cover-action'))

  await act(async () => { root.unmount() })
})

test('播放按钮一直都在，不靠悬停才出现', async () => {
  // The buttons are never faded out, in any rule that touches them.
  for (const rule of RULES) {
    const touches = rule.selector.split(',').some((part) => part.trim().includes('.er-cover-action'))
    if (!touches) continue
    assert.ok(
      !/opacity\s*:\s*0(\D|$)/.test(rule.declarations),
      `the rule "${rule.selector}" hides the cover buttons`,
    )
  }
  assert.deepEqual(declared('.er-cover-action', 'opacity'), [], 'the buttons carry no opacity at all')

  // They are discs with a drop shadow, so they read on a pale cover.
  assert.match(declared('.er-cover-action', 'border-radius').join(''), /50%/)
  assert.ok(declared('.er-cover-action', 'box-shadow').length > 0, 'the discs cast a shadow')
  // The shell draws every box with a soft superellipse, so the disc has to
  // ask for a plain circle or it comes out as a rounded square.
  assert.match(declared('.er-cover-action', 'corner-shape').join(''), /round/)
  // The native button chrome would round the box as well.
  assert.match(declared('.er-cover-action', 'appearance').join(''), /none/)

  // The play button is the larger of the two.
  const listen = Number.parseFloat(declared('.er-cover-listen', 'width')[0]);
  const menu = Number.parseFloat(declared('.er-cover-menu', 'width')[0]);
  assert.ok(listen > menu, 'the play button is bigger than the menu button')
  assert.ok(listen >= 30 && listen <= 36, 'the play button is about 34 pixels across')
})

test('暗色主题下按钮也跟着换色：颜色全部来自主题变量', async () => {
  const background = declared('.er-cover-action', 'background').join('')
  const color = declared('.er-cover-action', 'color').join('')
  assert.match(background, /var\(--dsw-alias-/, 'the disc takes a theme surface colour')
  assert.match(color, /var\(--dsw-alias-/, 'the glyph takes a theme label colour')
  // A hardcoded light surface would vanish on a white cover in the dark theme.
  assert.ok(!/background:[^;]*#fff\b/i.test(background), 'no hardcoded white surface')
})

test('点击播放按钮会开始朗读，但不会打开书', async () => {
  const { container, calls, root } = await mountLibrary('grid')
  const cover = container.querySelector('.er-shelf-cover')

  await press(cover.querySelector('.er-cover-listen'))
  assert.deepEqual(calls.listened, ['b1'], 'the book is spoken')
  assert.deepEqual(calls.opened, [], 'the book is not opened')

  // The menu button opens the menu, and it does not open the book either.
  assert.equal(container.querySelectorAll('.er-book-menu').length, 0)
  await press(cover.querySelector('.er-cover-menu'))
  assert.ok(container.querySelector('.er-book-menu'), 'the menu opens')
  assert.deepEqual(calls.opened, [], 'the book is still not opened')

  // The overlay is the one that opens the book.
  await press(cover.querySelector('.er-cover-open'))
  assert.deepEqual(calls.opened, ['b1'])

  await act(async () => { root.unmount() })
})

test('进度条和封面下方的标题、百分比都还在', async () => {
  const { container, root } = await mountLibrary('grid')
  const card = container.querySelector('.er-shelf-card')

  const progress = card.querySelector('.er-cover-progress')
  assert.ok(progress, 'the cover keeps its progress bar')
  assert.match(progress.querySelector('span').getAttribute('style'), /width:\s*42%/)

  assert.match(card.querySelector('.er-shelf-title').textContent, /Pride and Prejudice/)
  assert.match(card.querySelector('.er-shelf-percent').textContent, /42%/)

  await act(async () => { root.unmount() })
})

test('没有封面的书还是渐变加首字母的占位封面', async () => {
  const { container, root } = await mountLibrary('grid')
  const fallback = container.querySelector('.er-cover-fallback')
  assert.ok(fallback, 'the book without a cover gets a placeholder')
  assert.equal(fallback.textContent, 'MO', 'the placeholder shows the initials')

  // The gradient is still the placeholder's own look.
  assert.match(declared('.er-cover-fallback', 'background').join(''), /gradient/)
  // The placeholder sits behind the buttons, so it must not swallow them.
  assert.ok(container.querySelector('.er-cover-fallback').parentElement.querySelector('.er-cover-listen'))

  await act(async () => { root.unmount() })
})

test('列表视图里两个圆按钮会跟着缩小', async () => {
  const { container, root } = await mountLibrary('list')
  const cover = container.querySelector('.er-book-cover-small')
  assert.ok(cover, 'the list row shows a small cover')
  assert.ok(cover.querySelector('.er-cover-listen'), 'the small cover keeps the play button')
  assert.ok(cover.querySelector('.er-cover-menu'), 'the small cover keeps the menu button')

  // The small cover gets its own, smaller discs.
  const small = Number.parseFloat(declared('.er-book-cover-small .er-cover-action', 'width')[0]);
  const grid = Number.parseFloat(declared('.er-cover-listen', 'width')[0]);
  assert.ok(small < grid, 'the discs shrink on the thumbnail')
  assert.ok(small > 0, 'the discs are still there')

  // The glyph is a share of the disc, so it shrinks with it.
  assert.match(declared('.er-cover-listen svg', 'width')[0], /%/)

  await act(async () => { root.unmount() })
})
