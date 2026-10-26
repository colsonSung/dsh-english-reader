/**
 * The podcast episodes: the shape, the order and the persistence contract.
 *
 * The audio itself is never stored, so an episode is a script: the store has
 * to keep the script of one chapter together and let the book read it back.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createMemoryBackend, findPodcast, listPodcasts, removePodcast, savePodcast,
} from '../src/lib/podcasts.js';

test('savePodcast 记下书、章节、标题与台词', async () => {
  const backend = createMemoryBackend();
  const episode = await savePodcast({
    bookId: 'b1',
    chapterKey: '2',
    scope: 'Chapter 3',
    title: 'The Opening Argument',
    summary: 'Why the novel starts in the middle.',
    dialogue: [{ speaker: 'host', text: 'What happened before page one?' }],
  }, backend);
  assert.equal(episode.bookId, 'b1');
  assert.equal(episode.chapterKey, '2');
  assert.equal(episode.scope, 'Chapter 3');
  assert.equal(episode.title, 'The Opening Argument');
  assert.equal(episode.dialogue.length, 1);
  assert.ok(episode.id.startsWith('pd_'));
  assert.ok(episode.createdAt > 0);
});

test('listPodcasts 只给这本书的节目，最新的在前', async () => {
  const backend = createMemoryBackend([
    { id: 'p1', bookId: 'b1', chapterKey: '0', title: '一', createdAt: 100 },
    { id: 'p2', bookId: 'b2', chapterKey: '0', title: '二', createdAt: 200 },
    { id: 'p3', bookId: 'b1', chapterKey: '1', title: '三', createdAt: 300 },
  ]);
  const episodes = await listPodcasts('b1', backend);
  assert.deepEqual(episodes.map((episode) => episode.id), ['p3', 'p1']);
});

test('findPodcast 按章节找到那一期', async () => {
  const backend = createMemoryBackend([
    { id: 'p1', bookId: 'b1', chapterKey: '0', title: '第一章', createdAt: 100 },
    { id: 'p2', bookId: 'b1', chapterKey: '1', title: '第二章', createdAt: 200 },
  ]);
  const found = await findPodcast('b1', '1', backend);
  assert.equal(found?.id, 'p2');
  assert.equal(await findPodcast('b1', '9', backend), undefined);
});

test('removePodcast 把那一期删掉，其余不动', async () => {
  const backend = createMemoryBackend([
    { id: 'p1', bookId: 'b1', chapterKey: '0', title: '一', createdAt: 100 },
    { id: 'p2', bookId: 'b1', chapterKey: '1', title: '二', createdAt: 200 },
  ]);
  await removePodcast('p1', backend);
  const episodes = await listPodcasts('b1', backend);
  assert.deepEqual(episodes.map((episode) => episode.id), ['p2']);
});

test('缺字段也不会写坏一条节目', async () => {
  const backend = createMemoryBackend();
  const episode = await savePodcast({ bookId: 'b1' }, backend);
  assert.equal(episode.chapterKey, '');
  assert.deepEqual(episode.dialogue, []);
  assert.equal(episode.title, '');
});
