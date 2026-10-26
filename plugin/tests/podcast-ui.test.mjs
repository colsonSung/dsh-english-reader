/**
 * The podcast view.
 *
 * The view is controlled by its parent, so the tests drive it the way the
 * learner does: they render it in jsdom, click the episode list, the
 * transcript and the player, and check that every action is reported back
 * with the right arguments.
 *
 * Run: node --test tests/podcast-ui.test.mjs
 */
import './dom-setup.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { dom } from './dom-setup.mjs'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { act } from 'react'
import { PodcastView } from '../src/ui/podcast.js'

/** The translator used by the tests: the key itself is enough to assert on. */
const t = (key) => {
  if (key === 'podcast.lineCounter') return 'Line {current} / {total}'
  return key
}

/** Two episodes: the newest one first, as the parent hands them over. */
const EPISODES = [
  {
    id: 'ep-2',
    title: 'The White Room',
    scope: 'Chapter 4',
    summary: 'Two hosts talk about the locked room of chapter four.',
    createdAt: 1767225600000,
    dialogue: [
      { speaker: 'host', text: 'Welcome back to the show.' },
      { speaker: 'guest', text: 'Today we read chapter four.' },
      { speaker: 'host', text: 'Let us look at the locked room.' },
    ],
  },
  {
    id: 'ep-1',
    title: 'The Long Bridge',
    scope: 'Chapter 3',
    summary: 'A short episode about the bridge.',
    createdAt: 1767139200000,
    dialogue: [
      { speaker: 'host', text: 'Chapter three is about a bridge.' },
    ],
  },
]

/** The callbacks every render starts with. */
function defaultProps() {
  return {
    t,
    scope: 'Chapter 5',
    episodes: EPISODES,
    activeId: null,
    lineIndex: -1,
    playing: false,
    loading: false,
    error: '',
    rate: 1,
    onClose: () => {},
    onGenerate: () => {},
    onSelect: () => {},
    onPlay: () => {},
    onStop: () => {},
    onRate: () => {},
    onDelete: () => {},
  }
}

/**
 * Render the podcast view in jsdom.
 *
 * @param {object} patch - the props that differ from the defaults.
 * @returns {Promise<{container: Element, root: object, rerender: Function}>}
 */
async function renderPodcast(patch = {}) {
  const props = { ...defaultProps(), ...patch }
  const container = dom.window.document.createElement('div')
  dom.window.document.body.appendChild(container)
  const root = ReactDOM.createRoot(container)
  const draw = async (next) => {
    await act(async () => {
      root.render(React.createElement(PodcastView, { ...props, ...next }))
    })
  }
  await draw({})
  return {
    container,
    root,
    rerender: (next) => draw(next),
  }
}

/**
 * Click an element the way the learner does.
 *
 * @param {Element} element - the element to click.
 */
async function click(element) {
  await act(async () => {
    element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  })
}

/**
 * Pick a value in a select the way the learner does.
 *
 * @param {Element} select - the select to change.
 * @param {string} value - the value to pick.
 */
async function changeSelect(select, value) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value').set
    setter.call(select, value)
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  })
}

/**
 * Type a value into a controlled field the way the learner does.
 *
 * @param {Element} field - the field to type into.
 * @param {string} value - the value to type.
 */
async function typeInto(field, value) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
    setter.call(field, value)
    field.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true }))
  })
}

/**
 * Press a key in a field the way the learner does.
 *
 * @param {Element} field - the focused field.
 * @param {string} key - the key to press.
 */
async function pressKey(field, key) {
  await act(async () => {
    field.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true }))
  })
}

test('the episode list shows every episode and reports the one that is clicked', async () => {
  const selected = []
  const { container, root } = await renderPodcast({
    onSelect: (id) => { selected.push(id) },
  })

  const rows = container.querySelectorAll('.er-pod-episode')
  assert.equal(rows.length, 2)
  assert.match(rows[0].textContent, /The White Room/)
  assert.match(rows[0].textContent, /Chapter 4/)
  assert.match(rows[0].textContent, /Two hosts talk about the locked room/)
  assert.match(rows[1].textContent, /The Long Bridge/)

  await click(rows[1])
  assert.deepEqual(selected, ['ep-1'])

  await act(async () => { root.unmount() })
})

test('the active episode is marked in the list', async () => {
  const { container, root } = await renderPodcast({ activeId: 'ep-1' })

  const rows = container.querySelectorAll('.er-pod-episode')
  assert.equal(rows[0].className.includes('is-active'), false)
  assert.equal(rows[1].className.includes('is-active'), true)

  await act(async () => { root.unmount() })
})

test('the delete button removes an episode without opening it', async () => {
  const selected = []
  const removed = []
  const { container, root } = await renderPodcast({
    onSelect: (id) => { selected.push(id) },
    onDelete: (id) => { removed.push(id) },
  })

  await click(container.querySelector('.er-pod-episode-delete'))
  assert.deepEqual(removed, ['ep-2'])
  assert.deepEqual(selected, [])

  await act(async () => { root.unmount() })
})

test('the transcript shows every line of the active episode', async () => {
  const { container, root } = await renderPodcast({ activeId: 'ep-2' })

  const lines = container.querySelectorAll('.er-pod-line')
  assert.equal(lines.length, 3)
  assert.match(lines[0].textContent, /podcast.host/)
  assert.match(lines[0].textContent, /Welcome back to the show\./)
  assert.match(lines[1].textContent, /podcast.guest/)
  assert.match(lines[1].textContent, /Today we read chapter four\./)
  assert.match(lines[2].textContent, /Let us look at the locked room\./)

  await act(async () => { root.unmount() })
})

test('clicking a line plays that line of the active episode', async () => {
  const played = []
  const { container, root } = await renderPodcast({
    activeId: 'ep-2',
    onPlay: (id, index) => { played.push([id, index]) },
  })

  await click(container.querySelectorAll('.er-pod-line')[1])
  assert.deepEqual(played, [['ep-2', 1]])

  await act(async () => { root.unmount() })
})

test('the line being spoken is marked and the counter follows', async () => {
  const { container, root } = await renderPodcast({ activeId: 'ep-2', lineIndex: 1 })

  const current = container.querySelector('.er-pod-line.is-current')
  assert.ok(current, 'the spoken line must be marked')
  assert.equal(current.getAttribute('data-line-index'), '1')
  assert.match(container.querySelector('.er-pod-counter').textContent, /Line 2 \/ 3/)

  await act(async () => { root.unmount() })
})

test('the player plays the active episode, stops it and changes the rate', async () => {
  const played = []
  const stopped = []
  const rates = []
  const { container, root, rerender } = await renderPodcast({
    activeId: 'ep-2',
    onPlay: (id, index) => { played.push([id, index]) },
    onStop: () => { stopped.push(true) },
    onRate: (value) => { rates.push(value) },
  })

  await click(container.querySelector('.er-pod-play'))
  assert.deepEqual(played, [['ep-2', 0]])

  await rerender({ playing: true })
  await click(container.querySelector('.er-pod-stop'))
  assert.equal(stopped.length, 1)

  await changeSelect(container.querySelector('.er-pod-rate-select'), '1.5')
  assert.deepEqual(rates, [1.5])

  await act(async () => { root.unmount() })
})

test('the player steps to the previous and the next line', async () => {
  const played = []
  const { container, root } = await renderPodcast({
    activeId: 'ep-2',
    lineIndex: 1,
    onPlay: (id, index) => { played.push([id, index]) },
  })

  await click(container.querySelector('.er-pod-prev'))
  await click(container.querySelector('.er-pod-next'))
  assert.deepEqual(played, [['ep-2', 0], ['ep-2', 2]])

  await act(async () => { root.unmount() })
})

test('the rate selector offers the reading speeds', async () => {
  const { container, root } = await renderPodcast({ rate: 1 })

  const options = [...container.querySelectorAll('.er-pod-rate-select option')]
  assert.deepEqual(options.map((option) => option.textContent), ['0.75x', '1x', '1.25x', '1.5x', '2x'])
  assert.equal(container.querySelector('.er-pod-rate-select').value, '1')

  await act(async () => { root.unmount() })
})

test('the generate button asks for a new episode', async () => {
  const generated = []
  const { container, root } = await renderPodcast({
    onGenerate: () => { generated.push(true) },
  })

  const button = container.querySelector('.er-pod-generate')
  assert.ok(button, 'the generate button must exist')
  assert.equal(button.disabled, false)
  assert.match(button.textContent, /podcast.generate/)

  await click(button)
  assert.equal(generated.length, 1)

  await act(async () => { root.unmount() })
})

test('while an episode is written the generating state replaces the button label', async () => {
  const { container, root } = await renderPodcast({ loading: true })

  const button = container.querySelector('.er-pod-generate')
  assert.ok(button, 'the generate button must stay in place')
  assert.equal(button.disabled, true)
  assert.ok(container.querySelector('.er-pod-generating'), 'the generating state must show')
  assert.match(container.textContent, /podcast.generating/)
  assert.equal(container.querySelector('.er-pod-generate-label'), null)

  await act(async () => { root.unmount() })
})

test('a failure is shown to the learner', async () => {
  const { container, root } = await renderPodcast({ error: 'The model did not answer.' })

  const notice = container.querySelector('.er-pod-error')
  assert.ok(notice, 'the failure must be shown')
  assert.match(notice.textContent, /The model did not answer\./)

  await act(async () => { root.unmount() })
})

test('an empty shelf shows the empty state', async () => {
  const { container, root } = await renderPodcast({ episodes: [] })

  assert.ok(container.querySelector('.er-pod-empty'), 'the empty state must show')
  assert.match(container.textContent, /podcast.emptyEpisodes/)
  assert.equal(container.querySelectorAll('.er-pod-episode').length, 0)

  await act(async () => { root.unmount() })
})

test('a missing episode list does not break the view', async () => {
  const { container, root } = await renderPodcast({ episodes: null })

  assert.equal(container.querySelectorAll('.er-pod-episode').length, 0)
  assert.match(container.textContent, /podcast.emptyEpisodes/)

  await act(async () => { root.unmount() })
})

test('without an episode the transcript is empty and the player is idle', async () => {
  const { container, root } = await renderPodcast({ activeId: null, lineIndex: -1 })

  assert.match(container.textContent, /podcast.emptyTranscript/)
  assert.equal(container.querySelectorAll('.er-pod-line').length, 0)
  assert.equal(container.querySelector('.er-pod-play').disabled, true)
  assert.equal(container.querySelector('.er-pod-counter').textContent, 'Line 0 / 0')

  await act(async () => { root.unmount() })
})

test('the styles of the module are installed with the view and removed with it', async () => {
  const before = dom.window.document.head.querySelectorAll('style[data-plugin]').length
  const { root } = await renderPodcast({})
  const during = dom.window.document.head.querySelectorAll('style[data-plugin]').length
  assert.equal(during, before + 1)

  await act(async () => { root.unmount() })
  const after = dom.window.document.head.querySelectorAll('style[data-plugin]').length
  assert.equal(after, before)
})

test('the scope selector lists the scopes and reports the one that is picked', async () => {
  const picked = []
  const { container, root } = await renderPodcast({
    scopes: [
      { key: '0', label: 'Chapter 1 · CONTENTS' },
      { key: '1', label: 'Chapter 2 · The Bridge' },
      { key: 'book', label: 'The whole book' },
    ],
    scopeKey: '0',
    onScope: (key) => { picked.push(key) },
  })

  const select = container.querySelector('.er-pod-scope-select')
  assert.ok(select, 'the scope selector must show')
  assert.equal(select.options.length, 3)
  assert.equal(select.value, '0')
  assert.match(select.options[0].textContent, /Chapter 1 · CONTENTS/)

  await changeSelect(select, 'book')
  assert.deepEqual(picked, ['book'])

  await act(async () => { root.unmount() })
})

test('without scopes there is no selector and the plain scope is shown', async () => {
  const { container, root } = await renderPodcast({ scope: 'Chapter 5' })

  assert.equal(container.querySelector('.er-pod-scope-select'), null)
  assert.match(container.querySelector('.er-pod-head-scope').textContent, /Chapter 5/)

  await act(async () => { root.unmount() })
})

test('a scope key that is not among the scopes falls back to the plain scope', async () => {
  const { container, root } = await renderPodcast({
    scopes: [{ key: '0', label: 'Chapter 1' }],
    scopeKey: 'gone',
    scope: 'Chapter 5',
  })

  assert.equal(container.querySelector('.er-pod-scope-select'), null)
  assert.match(container.querySelector('.er-pod-head-scope').textContent, /Chapter 5/)

  await act(async () => { root.unmount() })
})

test('the microphone button talks into the episode and shows the recording state', async () => {
  const interjections = []
  const { container, root, rerender } = await renderPodcast({
    activeId: 'ep-2',
    onInterject: () => { interjections.push(true) },
  })

  const mic = container.querySelector('.er-pod-mic')
  assert.ok(mic, 'the microphone button must show')
  assert.equal(mic.className.includes('is-recording'), false)

  await click(mic)
  assert.equal(interjections.length, 1)

  await rerender({ interjecting: true })
  const recording = container.querySelector('.er-pod-mic')
  assert.equal(recording.className.includes('is-recording'), true)
  assert.match(recording.textContent, /podcast.interacting/)
  assert.equal(recording.getAttribute('title'), 'podcast.interacting')

  await act(async () => { root.unmount() })
})

test('without a handler there is no microphone button', async () => {
  const { container, root } = await renderPodcast({ activeId: 'ep-2' })

  assert.equal(container.querySelector('.er-pod-mic'), null)

  await act(async () => { root.unmount() })
})

test('a line of the learner is labelled as the learner', async () => {
  const { container, root } = await renderPodcast({
    activeId: 'ep-3',
    episodes: [
      {
        id: 'ep-3',
        title: 'The learner speaks',
        scope: 'Chapter 4',
        summary: '',
        createdAt: 1767225600000,
        dialogue: [
          { speaker: 'host', text: 'What do you think of the room?' },
          { speaker: 'you', text: 'I think the room is a metaphor.' },
        ],
      },
    ],
  })

  const lines = container.querySelectorAll('.er-pod-line')
  assert.equal(lines.length, 2)
  assert.match(lines[1].textContent, /podcast.you/)
  assert.match(lines[1].textContent, /I think the room is a metaphor\./)
  assert.equal(lines[1].querySelector('.er-pod-line-speaker').className.includes('is-you'), true)

  await act(async () => { root.unmount() })
})

test('a failure of the recording is shown to the learner', async () => {
  const { container, root } = await renderPodcast({
    interjectError: 'The microphone is not available.',
  })

  const notice = container.querySelector('.er-pod-error')
  assert.ok(notice, 'the failure must be shown')
  assert.match(notice.textContent, /The microphone is not available\./)

  await act(async () => { root.unmount() })
})

test('a window that cannot record explains itself and offers the input box', async () => {
  const { container, root } = await renderPodcast({
    activeId: 'ep-2',
    canRecord: false,
    onInterject: () => {},
    onInterjectText: () => {},
  })

  assert.equal(container.querySelector('.er-pod-mic'), null, 'the microphone must not show')
  assert.ok(container.querySelector('.er-pod-talk-note'), 'the note must show')
  assert.match(container.textContent, /podcast.noRecording/)
  assert.ok(container.querySelector('.er-pod-talk-input'), 'the input box must show')

  await act(async () => { root.unmount() })
})

test('without canRecord the microphone button stays', async () => {
  const { container, root } = await renderPodcast({
    activeId: 'ep-2',
    onInterject: () => {},
  })

  assert.ok(container.querySelector('.er-pod-mic'), 'the microphone must stay')
  assert.equal(container.querySelector('.er-pod-talk-note'), null)

  await act(async () => { root.unmount() })
})

test('a typed line is handed to the parent and the box is emptied', async () => {
  const sent = []
  const { container, root } = await renderPodcast({
    activeId: 'ep-2',
    onInterjectText: (text) => { sent.push(text) },
  })

  const field = container.querySelector('.er-pod-talk-input')
  assert.ok(field, 'the input box must show')
  assert.equal(field.getAttribute('placeholder'), 'podcast.typeToTalk')

  await typeInto(field, 'I think the room is a metaphor.')
  await click(container.querySelector('.er-pod-talk-send'))
  assert.deepEqual(sent, ['I think the room is a metaphor.'])
  assert.equal(field.value, '', 'the box must be empty after sending')

  await act(async () => { root.unmount() })
})

test('the enter key sends the typed line', async () => {
  const sent = []
  const { container, root } = await renderPodcast({
    activeId: 'ep-2',
    onInterjectText: (text) => { sent.push(text) },
  })

  const field = container.querySelector('.er-pod-talk-input')
  await typeInto(field, 'Let me say this.')
  await pressKey(field, 'Enter')
  assert.deepEqual(sent, ['Let me say this.'])
  assert.equal(field.value, '')

  await act(async () => { root.unmount() })
})

test('without a handler there is no input box', async () => {
  const { container, root } = await renderPodcast({ activeId: 'ep-2' })

  assert.equal(container.querySelector('.er-pod-talk-input'), null)

  await act(async () => { root.unmount() })
})

test('the voice pickers list the voices and report the one that is picked', async () => {
  const host = []
  const guest = []
  const { container, root } = await renderPodcast({
    voices: [
      { id: 'v-1', name: 'Amy' },
      { id: 'v-2', name: 'Brian' },
      { id: 'v-3', name: 'Emma' },
    ],
    hostVoice: 'v-1',
    guestVoice: 'v-2',
    onHostVoice: (id) => { host.push(id) },
    onGuestVoice: (id) => { guest.push(id) },
  })

  assert.ok(container.querySelector('.er-pod-voices'), 'the voice block must show')
  assert.match(container.textContent, /podcast.voicesTitle/)
  assert.match(container.textContent, /podcast.hostVoice/)
  assert.match(container.textContent, /podcast.guestVoice/)

  const picks = container.querySelectorAll('.er-pod-voice-select')
  assert.equal(picks.length, 2)
  assert.equal(picks[0].options.length, 3)
  assert.equal(picks[1].options.length, 3)
  assert.equal(picks[0].options[0].textContent, 'Amy')
  assert.equal(picks[0].value, 'v-1')
  assert.equal(picks[1].value, 'v-2')

  await changeSelect(picks[0], 'v-3')
  await changeSelect(picks[1], 'v-1')
  assert.deepEqual(host, ['v-3'])
  assert.deepEqual(guest, ['v-1'])

  await act(async () => { root.unmount() })
})

test('without voices there is no voice block', async () => {
  const { container, root } = await renderPodcast({})

  assert.equal(container.querySelector('.er-pod-voices'), null)
  assert.equal(container.querySelectorAll('.er-pod-voice-select').length, 0)

  await act(async () => { root.unmount() })
})
