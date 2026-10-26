/**
 * The vocabulary list: the spaced-repetition schedule, the summary, and the
 * idempotent collection of a word.
 *
 * Node has no IndexedDB, so the store is built on the in-memory backend the
 * data layer exposes; the IndexedDB backend itself is only exercised by the
 * browser.
 *
 * Run: node --test tests/vocab.test.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REVIEW_INTERVAL_DAYS,
  createMemoryBackend,
  createVocabStore,
  dueEntries,
  listEntries,
  normalizeId,
  scheduleNext,
  summarize,
} from '../src/lib/vocab.js';

/** One day in milliseconds. */
const DAY = 24 * 60 * 60 * 1000;

/** A fixed moment in time, so the tests never depend on the wall clock. */
const NOW = new Date(2026, 0, 15, 12, 0, 0).getTime();

/**
 * A store backed by memory.
 * @param {object[]} [seed]
 * @returns {ReturnType<typeof createVocabStore>}
 */
function memoryStore(seed = []) {
  return createVocabStore({ backend: createMemoryBackend(seed) });
}

test('scheduleNext spaces the reviews 1, 2, 4, 7, 15 and 30 days apart', () => {
  const expected = [1, 2, 4, 7, 15, 30, 30, 30];
  expected.forEach((days, count) => {
    assert.equal(
      scheduleNext({ reviewCount: count }, NOW),
      NOW + days * DAY,
      `review count ${count} must come back after ${days} days`,
    );
  });
  assert.deepEqual(REVIEW_INTERVAL_DAYS, [1, 2, 4, 7, 15, 30]);
});

test('scheduleNext treats a missing review count as the first interval', () => {
  assert.equal(scheduleNext({}, NOW), NOW + DAY);
  assert.equal(scheduleNext({ reviewCount: -3 }, NOW), NOW + DAY);
});

test('summarize splits the list into known, learning and to learn', () => {
  const entries = [
    { id: 'a', state: 'known', reviewCount: 3, addedAt: NOW },
    { id: 'b', state: 'learning', reviewCount: 2, addedAt: NOW - 2 * DAY },
    { id: 'c', state: 'learning', reviewCount: 0, addedAt: NOW - 3 * DAY },
    { id: 'd', state: 'learning', reviewCount: 1, addedAt: NOW - 2 * DAY },
  ];
  assert.deepEqual(summarize(entries, NOW), {
    total: 4,
    known: 1,
    learning: 2,
    toLearn: 1,
    addedToday: 1,
  });
});

test('summarize counts only the words added today as new', () => {
  const dayStart = new Date(2026, 0, 15, 0, 0, 0).getTime();
  const dayEnd = new Date(2026, 0, 16, 0, 0, 0).getTime();
  const entries = [
    { id: 'a', state: 'learning', reviewCount: 0, addedAt: dayStart },
    { id: 'b', state: 'learning', reviewCount: 0, addedAt: dayStart + 60 * 60 * 1000 },
    { id: 'c', state: 'learning', reviewCount: 0, addedAt: dayEnd },
    { id: 'd', state: 'learning', reviewCount: 0, addedAt: dayStart - 60 * 1000 },
  ];
  assert.equal(summarize(entries, NOW).addedToday, 2);
  assert.equal(summarize([], NOW).total, 0);
});

test('the word key is the lower-cased word without its outer punctuation', () => {
  assert.equal(normalizeId('Ledger'), 'ledger');
  assert.equal(normalizeId('  "Hello,"  '), 'hello');
  assert.equal(normalizeId('(well-known)'), 'well-known');
  assert.equal(normalizeId('C++'), 'c');
  assert.equal(normalizeId('   '), '');
});

test('addEntry keeps the key the caller brings along', async () => {
  // The reader normalizes the word itself and passes the key on; the store
  // has to file the word under that very key.
  const store = memoryStore();
  const entry = await store.addEntry({ id: 'ledger', word: 'Ledger' });
  assert.equal(entry.id, 'ledger');
  const again = await store.addEntry({ id: 'ledger', word: 'Ledger' });
  assert.equal(again.id, 'ledger');
  assert.equal((await store.listEntries()).length, 1);
});

test('addEntry stores a new word and makes it due right away', async () => {
  const store = memoryStore();
  const entry = await store.addEntry({
    word: 'Ledger',
    bookId: 'bk_1',
    bookTitle: 'Book',
    sentence: 'The ledger is full.',
    phonetic: '/ˈledʒər/',
    definition: '账本',
  });
  assert.equal(entry.id, 'ledger');
  assert.equal(entry.word, 'Ledger');
  assert.equal(entry.state, 'learning');
  assert.equal(entry.reviewCount, 0);
  assert.equal(entry.nextReviewAt, entry.addedAt);
  assert.equal((await store.listEntries()).length, 1);
});

test('addEntry is idempotent: it only fills in what was missing', async () => {
  const store = memoryStore();
  const first = await store.addEntry({ word: 'ledger', definition: '账本' });
  const second = await store.addEntry({ word: 'Ledger', phonetic: '/ˈledʒər/', definition: '另一个释义' });
  assert.equal(second.phonetic, '/ˈledʒər/');
  assert.equal(second.definition, '账本');
  assert.equal(second.addedAt, first.addedAt);
  assert.equal(second.state, first.state);
  assert.equal(second.reviewCount, first.reviewCount);
  assert.equal((await store.listEntries()).length, 1);
});

test('addEntry never resets what the learner already did with a word', async () => {
  const store = memoryStore();
  await store.addEntry({ word: 'ledger', definition: '账本' });
  await store.updateEntry('ledger', { state: 'known', reviewCount: 3 });
  const again = await store.addEntry({ word: 'ledger', definition: '新的释义', phonetic: '/ˈledʒər/' });
  assert.equal(again.state, 'known');
  assert.equal(again.reviewCount, 3);
  assert.equal(again.definition, '账本');
  assert.equal(again.phonetic, '/ˈledʒər/');
});

test('addEntry refuses a word that is only punctuation', async () => {
  const store = memoryStore();
  await assert.rejects(() => store.addEntry({ word: '...' }), /没有可收藏的单词/);
});

test('updateEntry merges the patch and reschedules the review', async () => {
  const store = memoryStore();
  await store.addEntry({ word: 'ledger' });
  const before = Date.now();
  const updated = await store.updateEntry('ledger', { state: 'known', reviewCount: 1, definition: '账本' });
  const after = Date.now();
  assert.equal(updated.state, 'known');
  assert.equal(updated.reviewCount, 1);
  assert.equal(updated.definition, '账本');
  assert.equal(updated.id, 'ledger');
  assert.ok(updated.nextReviewAt >= before + 2 * DAY - 1000);
  assert.ok(updated.nextReviewAt <= after + 2 * DAY + 1000);
});

test('updateEntry keeps an explicit nextReviewAt', async () => {
  const store = memoryStore();
  await store.addEntry({ word: 'ledger' });
  const updated = await store.updateEntry('ledger', { state: 'known', nextReviewAt: NOW });
  assert.equal(updated.nextReviewAt, NOW);
});

test('updateEntry reports a word that is not in the list', async () => {
  const store = memoryStore();
  await assert.rejects(() => store.updateEntry('nope', { state: 'known' }), /生词本里没有这个词/);
});

test('removeEntry forgets a word and ignores an unknown one', async () => {
  const store = memoryStore();
  await store.addEntry({ word: 'ledger' });
  await store.addEntry({ word: 'margin' });
  await store.removeEntry('ledger');
  assert.deepEqual((await store.listEntries()).map((entry) => entry.id), ['margin']);
  await store.removeEntry('ledger');
  assert.equal((await store.listEntries()).length, 1);
});

test('dueEntries returns the words whose review is due', async () => {
  const store = memoryStore();
  await store.addEntry({ word: 'due' });
  await store.addEntry({ word: 'later', nextReviewAt: Date.now() + 10 * DAY });
  const due = await store.dueEntries();
  assert.deepEqual(due.map((entry) => entry.id), ['due']);
});

test('listEntries returns the newest word first', async () => {
  const store = memoryStore([
    { id: 'old', word: 'old', addedAt: NOW - 5 * DAY, nextReviewAt: NOW },
    { id: 'new', word: 'new', addedAt: NOW, nextReviewAt: NOW },
  ]);
  assert.deepEqual((await store.listEntries()).map((entry) => entry.id), ['new', 'old']);
});

test('the default store asks for a browser instead of failing silently', async () => {
  // Node has no IndexedDB, so the default instance reports it in Chinese.
  await assert.rejects(() => listEntries(), /本地存储/);
  await assert.rejects(() => dueEntries(), /本地存储/);
});
