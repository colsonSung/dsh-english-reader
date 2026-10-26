/**
 * The reader's notes: the shape, the order and the persistence contract.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addNote, countNotes, createMemoryBackend, listNotes, removeNote, removeNotesOfBook, updateNote,
} from '../src/lib/notes.js';

test('addNote 记下书、位置、原文与时间', async () => {
  const backend = createMemoryBackend();
  const note = await addNote({
    bookId: 'b1', unitIndex: 12, quote: 'It is a truth universally acknowledged.', text: '这句是开场白',
  }, backend);
  assert.equal(note.bookId, 'b1');
  assert.equal(note.unitIndex, 12);
  assert.equal(note.quote, 'It is a truth universally acknowledged.');
  assert.equal(note.text, '这句是开场白');
  assert.ok(note.id.startsWith('nt_'));
  assert.ok(note.createdAt > 0);
  assert.equal(note.updatedAt, note.createdAt);
});

test('listNotes 只给这本书的笔记，最新的在前', async () => {
  const backend = createMemoryBackend([
    { id: 'n1', bookId: 'b1', text: '一', unitIndex: 1, quote: 'q1', createdAt: 100, updatedAt: 100 },
    { id: 'n2', bookId: 'b2', text: '二', unitIndex: 2, quote: 'q2', createdAt: 200, updatedAt: 200 },
    { id: 'n3', bookId: 'b1', text: '三', unitIndex: 3, quote: 'q3', createdAt: 300, updatedAt: 300 },
  ]);
  const notes = await listNotes('b1', backend);
  assert.deepEqual(notes.map((note) => note.id), ['n3', 'n1']);
  assert.equal(await countNotes('b1', backend), 2);
  assert.equal(await countNotes('b2', backend), 1);
});

test('updateNote 改文字并留下新的时间', async () => {
  const backend = createMemoryBackend([
    { id: 'n1', bookId: 'b1', text: '旧', unitIndex: 1, quote: 'q', createdAt: 100, updatedAt: 100 },
  ]);
  await updateNote('n1', '新', backend);
  const notes = await listNotes('b1', backend);
  assert.equal(notes[0].text, '新');
  assert.ok(notes[0].updatedAt >= notes[0].createdAt);
});

test('removeNote 删掉一条，removeNotesOfBook 清空整本', async () => {
  const backend = createMemoryBackend([
    { id: 'n1', bookId: 'b1', text: '一', unitIndex: 1, quote: 'q', createdAt: 100, updatedAt: 100 },
    { id: 'n2', bookId: 'b1', text: '二', unitIndex: 2, quote: 'q', createdAt: 200, updatedAt: 200 },
    { id: 'n3', bookId: 'b2', text: '三', unitIndex: 3, quote: 'q', createdAt: 300, updatedAt: 300 },
  ]);
  await removeNote('n1', backend);
  assert.equal((await listNotes('b1', backend)).length, 1);
  await removeNotesOfBook('b1', backend);
  assert.equal((await listNotes('b1', backend)).length, 0);
  assert.equal((await listNotes('b2', backend)).length, 1);
});

test('笔记能存进再读出来（后端往返）', async () => {
  const backend = createMemoryBackend();
  const note = await addNote({ bookId: 'b9', unitIndex: 4, quote: 'q', text: 't' }, backend);
  const notes = await listNotes('b9', backend);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].id, note.id);
  assert.equal(notes[0].text, 't');
});
