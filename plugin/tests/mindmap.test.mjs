/**
 * The mind map: the layout is a pure function, so it is checked without a
 * browser; the view is driven in jsdom.
 *
 * Run: node --test tests/mindmap.test.mjs
 */
import './dom-setup.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { dom } from './dom-setup.mjs'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { act } from 'react'
import { layoutMindMap, MindMapView } from '../src/ui/mindmap.js'

/** The translator of the tests: the key itself is enough to assert on. */
const t = (key) => key

/** A small tree, of the shape the model returns. */
const TREE = {
  title: 'The Great Gatsby',
  branches: [
    {
      label: 'Characters',
      items: [
        { label: 'Nick Carraway', note: 'the narrator' },
        { label: 'Daisy Buchanan' },
      ],
    },
    {
      label: 'Settings',
      items: [
        { label: 'West Egg' },
        { label: 'East Egg' },
        { label: 'The Valley of Ashes' },
      ],
    },
  ],
}

/** A tree whose points carry the place they were found in the book. */
const PLACED = {
  title: 'The Great Gatsby',
  branches: [
    {
      label: 'Characters',
      items: [
        { label: 'Nick Carraway', note: 'the narrator', quote: 'In my younger and more vulnerable years', target: 12 },
        { label: 'Daisy Buchanan' },
      ],
    },
    {
      label: 'Settings',
      items: [
        { label: 'West Egg', quote: 'West Egg was always where people went', target: 30 },
      ],
    },
  ],
}

/**
 * Render the mind map into a container of the test document.
 *
 * The view is taken down again when the test ends, also when the test
 * failed: a view that stays mounted keeps the event of the document busy and
 * the run would never finish.
 *
 * @param {object} props - the props of the view
 * @param {object} context - the context of the test
 * @returns {Promise<{ container: Element, root: object }>} the container and the root
 */
async function renderView(props, context) {
  const container = dom.window.document.createElement('div')
  dom.window.document.body.appendChild(container)
  const root = ReactDOM.createRoot(container)
  await act(async () => { root.render(React.createElement(MindMapView, { t, ...props })) })
  context.after(async () => {
    await act(async () => { root.unmount() })
    container.remove()
  })
  return { container, root }
}

/**
 * Click a button of the rendered view.
 *
 * @param {Element} container - the rendered view
 * @param {string} label - the text of the button
 * @returns {Promise<void>} the click
 */
async function clickButton(container, label) {
  const button = [...container.querySelectorAll('button')].find((entry) => entry.textContent === label)
  assert.ok(button, `the button ${label} must exist`)
  await act(async () => { button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
}

test('the layout draws the tree and keeps the root in the middle', () => {
  const layout = layoutMindMap(TREE)

  assert.ok(layout.width > 0, 'the canvas must have a width')
  assert.ok(layout.height > 0, 'the canvas must have a height')

  const ids = new Set(layout.nodes.map((node) => node.id))
  const root = layout.nodes.find((node) => node.kind === 'root')
  assert.ok(root, 'the tree must have a root')
  assert.equal(root.label, 'The Great Gatsby')

  assert.ok(
    Math.abs((root.x + root.w / 2) - layout.width / 2) < 1,
    'the root must sit in the middle of the canvas',
  )
  assert.ok(
    Math.abs((root.y + root.h / 2) - layout.height / 2) < 1,
    'the root must sit in the middle of the canvas',
  )

  const branches = layout.nodes.filter((node) => node.kind === 'branch')
  const items = layout.nodes.filter((node) => node.kind === 'item')
  assert.equal(branches.length, 2, 'both branches must be drawn')
  assert.equal(items.length, 5, 'every point must be drawn')

  assert.equal(layout.links.length, 2 + 5, 'every branch and every point needs a link')
  for (const link of layout.links) {
    assert.ok(ids.has(link.from), `the link must start at a known node: ${link.from}`)
    assert.ok(ids.has(link.to), `the link must end at a known node: ${link.to}`)
    assert.match(link.path, /^M -?[\d.]+ -?[\d.]+ C /, 'a link must be a curve')
  }
})

test('every box of the drawing stays inside the canvas', () => {
  const layout = layoutMindMap(TREE)
  for (const node of layout.nodes) {
    assert.ok(node.x >= 0, `the box ${node.id} must not leave the canvas on the left`)
    assert.ok(node.y >= 0, `the box ${node.id} must not leave the canvas on the top`)
    assert.ok(node.x + node.w <= layout.width, `the box ${node.id} must not leave the canvas on the right`)
    assert.ok(node.y + node.h <= layout.height, `the box ${node.id} must not leave the canvas on the bottom`)
  }
})

test('the points of a branch stay on the side of their branch', () => {
  const layout = layoutMindMap(TREE)
  const root = layout.nodes.find((node) => node.kind === 'root')
  const middle = root.x + root.w / 2
  const items = layout.nodes.filter((node) => node.kind === 'item')
  assert.ok(items.length > 0)
  for (const item of items) {
    const center = item.x + item.w / 2
    if (item.side === 'right') {
      assert.ok(center > middle, `the point ${item.id} must stay on the right of the root`)
    } else if (item.side === 'left') {
      assert.ok(center < middle, `the point ${item.id} must stay on the left of the root`)
    } else {
      assert.fail('a point must know its side')
    }
  }
})

test('no two boxes of the map touch', () => {
  const branches = []
  for (let index = 0; index < 8; index += 1) {
    const items = []
    for (let item = 0; item < 6; item += 1) {
      items.push({ label: `A rather long point ${item} of branch ${index}` })
    }
    branches.push({ label: `A rather long branch ${index}`, items })
  }
  const layout = layoutMindMap({ title: 'A crowded map', branches })
  for (let i = 0; i < layout.nodes.length; i += 1) {
    for (let j = i + 1; j < layout.nodes.length; j += 1) {
      const first = layout.nodes[i]
      const second = layout.nodes[j]
      const overlapX = Math.min(first.x + first.w, second.x + second.w) - Math.max(first.x, second.x)
      const overlapY = Math.min(first.y + first.h, second.y + second.h) - Math.max(first.y, second.y)
      assert.ok(
        overlapX <= 1 || overlapY <= 1,
        `the boxes ${first.id} and ${second.id} must not touch`,
      )
    }
  }
})

test('a branch with more points owns more room on the circle', () => {
  const branches = []
  for (let index = 0; index < 6; index += 1) {
    const count = index === 2 ? 4 : 1
    const items = []
    for (let item = 0; item < count; item += 1) {
      items.push({ label: `point ${item}` })
    }
    branches.push({ label: `branch ${index}`, items })
  }
  const layout = layoutMindMap({ title: 'root', branches })
  const root = layout.nodes.find((node) => node.kind === 'root')
  const middleX = root.x + root.w / 2
  const middleY = root.y + root.h / 2
  const angles = layout.nodes
    .filter((node) => node.kind === 'branch')
    .map((node) => Math.atan2(node.y + node.h / 2 - middleY, node.x + node.w / 2 - middleX))
    .sort((a, b) => a - b)
  const gaps = angles.map((angle, index) => {
    const next = angles[(index + 1) % angles.length]
    return next - angle
  })
  const widest = Math.max(...gaps)
  const narrowest = Math.min(...gaps)
  // The angles are in radians; a fifth of a radian is about a quarter of
  // the circle, which the branch with four points clearly owns.
  assert.ok(
    widest - narrowest > 0.2,
    'the branch with four points must own a wider sector than the others',
  )
})

test('an empty or broken tree draws nothing and does not throw', () => {
  const broken = [null, undefined, {}, { title: 'only a title' }, { title: 'x', branches: [] }, { branches: 'no' }, 42, 'text']
  for (const input of broken) {
    const layout = layoutMindMap(input)
    assert.equal(layout.nodes.length, 0, 'a broken tree must not draw any node')
    assert.equal(layout.links.length, 0, 'a broken tree must not draw any link')
  }
})

test('the map keeps only what it can show', () => {
  const branches = []
  for (let index = 0; index < 12; index += 1) {
    const items = []
    for (let item = 0; item < 9; item += 1) {
      items.push({ label: item === 0 ? '' : `point ${item}`, note: 'n'.repeat(400) })
    }
    branches.push({ label: `branch ${index}`, items })
  }
  const layout = layoutMindMap({ title: 'root', branches })
  assert.equal(layout.nodes.filter((node) => node.kind === 'branch').length, 8, 'at most eight branches')
  assert.equal(layout.nodes.filter((node) => node.kind === 'item').length, 48, 'at most six points per branch')
  for (const node of layout.nodes) {
    assert.ok(node.note.length <= 200, 'a note must be cut')
  }
})

test('the same tree always draws the same map', () => {
  assert.deepEqual(layoutMindMap(TREE), layoutMindMap(TREE))
})

test('every layout draws a map whose boxes stand apart', () => {
  for (const layout of ['radial', 'tree', 'vertical']) {
    const result = layoutMindMap(TREE, { layout })
    assert.ok(result.width > 0 && result.height > 0, `${layout} must have a canvas`)
    assert.ok(result.nodes.length > 0, `${layout} must draw nodes`)
    assert.ok(result.links.length > 0, `${layout} must draw links`)

    for (const node of result.nodes) {
      assert.ok(node.x >= 0 && node.y >= 0, `the box ${node.id} must stay in the canvas`)
      assert.ok(node.x + node.w <= result.width, `the box ${node.id} must stay in the canvas`)
      assert.ok(node.y + node.h <= result.height, `the box ${node.id} must stay in the canvas`)
    }
    for (let i = 0; i < result.nodes.length; i += 1) {
      for (let j = i + 1; j < result.nodes.length; j += 1) {
        const first = result.nodes[i]
        const second = result.nodes[j]
        const overlapX = Math.min(first.x + first.w, second.x + second.w) - Math.max(first.x, second.x)
        const overlapY = Math.min(first.y + first.h, second.y + second.h) - Math.max(first.y, second.y)
        assert.ok(
          overlapX <= 1 || overlapY <= 1,
          `the boxes ${first.id} and ${second.id} must not touch in the ${layout} layout`,
        )
      }
    }
    for (const link of result.links) {
      assert.match(link.path, /^M -?[\d.]+ -?[\d.]+ C /, `${layout} must join with a curve`)
    }
  }
})

test('the tree layouts stand in the middle of the cross axis', () => {
  const tree = layoutMindMap(TREE, { layout: 'tree' })
  const treeRoot = tree.nodes.find((node) => node.kind === 'root')
  assert.ok(
    Math.abs((treeRoot.y + treeRoot.h / 2) - tree.height / 2) < 1,
    'the root of a tree stands in the middle of the picture',
  )
  assert.ok(treeRoot.x < tree.width / 2, 'the root of a tree stands on the left')

  const vertical = layoutMindMap(TREE, { layout: 'vertical' })
  const verticalRoot = vertical.nodes.find((node) => node.kind === 'root')
  assert.ok(
    Math.abs((verticalRoot.x + verticalRoot.w / 2) - vertical.width / 2) < 1,
    'the root of a vertical tree stands in the middle of the width',
  )
  assert.ok(verticalRoot.y < vertical.height / 2, 'the root of a vertical tree stands on top')
})

test('the layouts draw the same nodes', () => {
  const radial = layoutMindMap(TREE, { layout: 'radial' })
  const tree = layoutMindMap(TREE, { layout: 'tree' })
  const vertical = layoutMindMap(TREE, { layout: 'vertical' })
  assert.equal(tree.nodes.length, radial.nodes.length)
  assert.equal(vertical.nodes.length, radial.nodes.length)
  assert.deepEqual(tree.nodes.map((node) => node.id), radial.nodes.map((node) => node.id))
  assert.deepEqual(vertical.nodes.map((node) => node.id), radial.nodes.map((node) => node.id))
})

test('a picked node shows the bar and can be jumped to', async (t) => {
  const jumped = []
  const { container, root } = await renderView({
    scope: 'Chapter 3',
    data: PLACED,
    loading: false,
    error: '',
    onClose: () => {},
    onRegenerate: () => {},
    onJump: (node) => { jumped.push(node) },
  }, t)
  assert.ok(container.querySelector('.er-mm-bar'), 'the bar stands at the foot of the panel')
  assert.match(container.textContent, /mindmap\.jumpHint/, 'the bar waits for a pick')

  const nodes = [...container.querySelectorAll('.er-mm-node')]
  const item = nodes.find((node) => node.getAttribute('class').includes('is-item'))
  await act(async () => { item.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })

  const bar = container.querySelector('.er-mm-bar')
  assert.ok(bar, 'the bar must appear after a pick')
  assert.match(bar.textContent, /Nick Carraway/, 'the bar names the picked node')
  assert.match(bar.textContent, /In my younger and more vulnerable years/, 'the bar shows the sentence')
  assert.ok(item.getAttribute('class').includes('is-selected'), 'the picked node must be marked')

  await clickButton(container, 'mindmap.jump')
  assert.equal(jumped.length, 1, 'the jump button must report the node')
  assert.equal(jumped[0].id, 'item-0-0', 'the reported node must be the picked one')
  assert.equal(jumped[0].target, 12, 'the reported node must carry its place')
})

test('a node without a place cannot be jumped to', async (t) => {
  const { container, root } = await renderView({
    scope: 'Chapter 3',
    data: PLACED,
    loading: false,
    error: '',
    onClose: () => {},
    onRegenerate: () => {},
    onJump: () => {},
  }, t)
  const nodes = [...container.querySelectorAll('.er-mm-node')]
  const item = nodes.find((node) => node.getAttribute('class').includes('is-item') && node.textContent.includes('Daisy'))
  await act(async () => { item.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })

  const bar = container.querySelector('.er-mm-bar')
  assert.ok(bar, 'the bar must appear after a pick')
  assert.match(bar.textContent, /mindmap\.jumpMissing/, 'the bar must say that there is no place')
  assert.equal(
    [...container.querySelectorAll('button')].some((button) => button.textContent === 'mindmap.jump'),
    false,
    'the jump button must not be there',
  )
})

test('without a jump the button is never shown', async (t) => {
  const { container, root } = await renderView({
    scope: 'Chapter 3',
    data: PLACED,
    loading: false,
    error: '',
    onClose: () => {},
    onRegenerate: () => {},
  }, t)
  const nodes = [...container.querySelectorAll('.er-mm-node')]
  const item = nodes.find((node) => node.getAttribute('class').includes('is-item'))
  await act(async () => { item.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })

  const bar = container.querySelector('.er-mm-bar')
  assert.ok(bar, 'the bar must appear after a pick')
  assert.equal(
    [...container.querySelectorAll('button')].some((button) => button.textContent === 'mindmap.jump'),
    false,
    'the panel cannot jump on its own',
  )
})

test('the layout switch redraws the map without asking for a new one', async (t) => {
  let regenerated = 0
  const { container, root } = await renderView({
    scope: 'Chapter 3',
    data: PLACED,
    loading: false,
    error: '',
    onClose: () => {},
    onRegenerate: () => { regenerated += 1 },
  }, t)
  const before = container.querySelectorAll('.er-mm-node').length
  const radial = container.querySelector('svg').getAttribute('viewBox')
  await clickButton(container, 'mindmap.layoutTree')
  const after = container.querySelectorAll('.er-mm-node').length
  const tree = container.querySelector('svg').getAttribute('viewBox')
  assert.equal(after, before, 'the switch must not change the map')
  assert.notEqual(tree, radial, 'the switch must redraw the map')
  assert.equal(regenerated, 0, 'the switch must not ask the model for a new map')
})

test('the view draws the map with the title of the topic', async (t) => {
  const { container, root } = await renderView({
    scope: 'Chapter 3',
    data: TREE,
    loading: false,
    error: '',
    onClose: () => {},
    onRegenerate: () => {},
  }, t)
  const svg = container.querySelector('svg')
  assert.ok(svg, 'the map must be an svg')
  assert.match(svg.getAttribute('viewBox'), /^0 0 \d+ \d+$/, 'the svg must show the whole map')
  assert.match(container.textContent, /The Great Gatsby/, 'the topic must be on the map')
  assert.match(container.textContent, /Chapter 3/, 'the scope must be shown')
})

test('the view shows the generating state', async (t) => {
  const { container, root } = await renderView({
    scope: 'Chapter 3',
    data: null,
    loading: true,
    error: '',
    onClose: () => {},
    onRegenerate: () => {},
  }, t)
  assert.match(container.textContent, /mindmap\.generating/, 'the generating state must be shown')
  assert.match(container.textContent, /mindmap\.empty/, 'the empty state must be shown instead of a map')
})

test('the view shows the error and keeps the map', async (t) => {
  const { container, root } = await renderView({
    scope: 'Chapter 3',
    data: TREE,
    loading: false,
    error: 'the model did not answer',
    onClose: () => {},
    onRegenerate: () => {},
  }, t)
  assert.match(container.textContent, /the model did not answer/, 'the error must be shown')
  assert.ok(container.querySelector('svg'), 'the map must stay visible')
})

test('the view asks for a new map and closes on request', async (t) => {
  let regenerated = 0
  let closed = 0
  const { container, root } = await renderView({
    scope: 'Chapter 3',
    data: TREE,
    loading: false,
    error: '',
    onClose: () => { closed += 1 },
    onRegenerate: () => { regenerated += 1 },
  }, t)
  await clickButton(container, 'mindmap.generate')
  assert.equal(regenerated, 1, 'the regenerate button must ask for a new map')

  const close = container.querySelector('.er-modal-head .er-round-button')
  assert.ok(close, 'the modal must carry a close button')
  await act(async () => { close.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  assert.equal(closed, 1, 'the close button must close the panel')})
