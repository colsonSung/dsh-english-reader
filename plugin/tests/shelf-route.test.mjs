/**
 * The shelf route, driven through the real fetch handler.
 *
 * `tests/shelf.test.mjs` covers the disk repository on its own. This file
 * covers the other half: the route registration in `index.js`, the action
 * dispatch, and the error bodies the client half depends on.
 *
 * The plugin is mounted on a fake context, so the test exercises exactly the
 * handler the Host registers — no app restart, no network.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { apply, ROUTE } from '../index.js';

/**
 * Mount the plugin on a fake context and hand back the registered route.
 *
 * @param {string} dir - the profile directory the shelf should live in.
 * @returns {{ fetch: Function, path: string, methods: string[] }}
 */
function mountPlugin(dir) {
  let registered = null;
  const connectionCtx = {
    profileContext: { dir },
    connection: {
      fetch: {
        register: (route) => {
          registered = route;
          return () => {};
        },
      },
    },
    effect: (fn) => fn(),
  };
  const ctx = {
    inject: (_deps, callback) => callback(connectionCtx),
  };
  apply(ctx);
  assert.ok(registered, 'the plugin did not register its route');
  return registered;
}

/**
 * Post one request to the route.
 *
 * @param {any} route - the registered route.
 * @param {object} payload - the request body.
 * @returns {Promise<{ status: number, body: any }>}
 */
async function post(route, payload) {
  const request = new Request(`http://localhost${ROUTE}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const response = await route.fetch(request);
  const body = await response.json();
  return { status: response.status, body };
}

/**
 * A book with one chapter.
 * @param {string} id
 * @param {number} addedAt
 * @returns {object}
 */
function book(id, addedAt) {
  return {
    id,
    title: `Book ${id}`,
    author: 'Someone',
    format: 'txt',
    chapters: [{ title: 'Chapter 1', paragraphs: ['Hello there.'] }],
    addedAt,
    progress: { percent: 0.1, unitIndex: 3 },
  };
}

test('the shelf route keeps books across requests', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'er-route-'));
  try {
    const route = mountPlugin(dir);

    const put = await post(route, { method: 'shelf', payload: { action: 'books.put', book: book('bk_a', 100) } });
    assert.equal(put.status, 200);
    assert.equal(put.body.ok, true);
    assert.equal(put.body.result.id, 'bk_a');

    const list = await post(route, { method: 'shelf', payload: { action: 'books.list' } });
    assert.equal(list.body.ok, true);
    assert.equal(list.body.result.length, 1);
    assert.equal(list.body.result[0].id, 'bk_a');
    // The whole record survives the round trip, chapters included.
    assert.equal(list.body.result[0].chapters[0].paragraphs[0], 'Hello there.');

    // The book landed on disk in the profile directory.
    const booksDir = join(dir, 'reader', 'books');
    assert.ok(existsSync(booksDir), 'the books directory was not created');
    assert.deepEqual(readdirSync(booksDir), ['bk_a.json']);

    const get = await post(route, { method: 'shelf', payload: { action: 'books.get', id: 'bk_a' } });
    assert.equal(get.body.result.id, 'bk_a');

    const missing = await post(route, { method: 'shelf', payload: { action: 'books.get', id: 'bk_nope' } });
    assert.equal(missing.body.ok, true);
    assert.equal(missing.body.result, null);

    const del = await post(route, { method: 'shelf', payload: { action: 'books.delete', id: 'bk_a' } });
    assert.equal(del.body.ok, true);
    assert.deepEqual(readdirSync(booksDir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('books.progress merges on the host instead of resending the book', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'er-route-'));
  try {
    const route = mountPlugin(dir);
    await post(route, { method: 'shelf', payload: { action: 'books.put', book: book('bk_p', 100) } });

    const progress = await post(route, {
      method: 'shelf',
      payload: { action: 'books.progress', id: 'bk_p', progress: { unitIndex: 42 } },
    });
    assert.equal(progress.body.ok, true);

    const list = await post(route, { method: 'shelf', payload: { action: 'books.list' } });
    const stored = list.body.result[0];
    // The new field landed...
    assert.equal(stored.progress.unitIndex, 42);
    // ...the fields nobody mentioned survived...
    assert.equal(stored.progress.percent, 0.1);
    // ...the host stamped the time...
    assert.equal(typeof stored.progress.updatedAt, 'number');
    // ...and the body of the book was not touched.
    assert.equal(stored.chapters[0].paragraphs[0], 'Hello there.');

    // Progress for a book that is not there is not an error.
    const ghost = await post(route, {
      method: 'shelf',
      payload: { action: 'books.progress', id: 'bk_ghost', progress: { unitIndex: 1 } },
    });
    assert.equal(ghost.body.ok, true);
    assert.equal(ghost.body.result.id, 'bk_ghost');
    const after = await post(route, { method: 'shelf', payload: { action: 'books.list' } });
    assert.equal(after.body.result.length, 1, 'a progress write invented a book');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('vocabulary, notes and podcasts round trip through the route', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'er-route-'));
  try {
    const route = mountPlugin(dir);

    await post(route, { method: 'shelf', payload: { action: 'vocab.put', entry: { id: 'w1', word: 'quaint' } } });
    await post(route, { method: 'shelf', payload: { action: 'notes.put', note: { id: 'n1', bookId: 'bk_a', text: 'note' } } });
    await post(route, { method: 'shelf', payload: { action: 'podcasts.put', episode: { id: 'p1', bookId: 'bk_a' } } });

    const vocab = await post(route, { method: 'shelf', payload: { action: 'vocab.list' } });
    assert.equal(vocab.body.result.length, 1);
    assert.equal(vocab.body.result[0].word, 'quaint');

    const notes = await post(route, { method: 'shelf', payload: { action: 'notes.list' } });
    assert.equal(notes.body.result.length, 1);
    assert.equal(notes.body.result[0].text, 'note');

    const podcasts = await post(route, { method: 'shelf', payload: { action: 'podcasts.list' } });
    assert.equal(podcasts.body.result.length, 1);
    assert.equal(podcasts.body.result[0].id, 'p1');

    await post(route, { method: 'shelf', payload: { action: 'vocab.delete', id: 'w1' } });
    const after = await post(route, { method: 'shelf', payload: { action: 'vocab.list' } });
    assert.equal(after.body.result.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an unknown shelf action is refused with a 400', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'er-route-'));
  try {
    const route = mountPlugin(dir);
    const answer = await post(route, { method: 'shelf', payload: { action: 'books.nope' } });
    assert.equal(answer.status, 400);
    assert.equal(answer.body.ok, false);
    assert.equal(answer.body.error.code, 'reader/unknown-action');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a method outside the allowlist is refused with a 400', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'er-route-'));
  try {
    const route = mountPlugin(dir);
    const answer = await post(route, { method: 'not-a-method', payload: {} });
    assert.equal(answer.status, 400);
    assert.equal(answer.body.error.code, 'reader/unknown-method');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the other methods of the route still answer', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'er-route-'));
  try {
    const route = mountPlugin(dir);
    const answer = await post(route, { method: 'status', payload: {} });
    assert.equal(answer.status, 200);
    assert.equal(answer.body.ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
