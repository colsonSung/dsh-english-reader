/**
 * The reader's notes.
 *
 * A note belongs to a book and to a place in it: the sentence it was taken
 * from, its text, and when it was written. Notes live in the local database, so
 * they survive a reload and never leave the machine.
 */

import { NOTES_STORE_NAME, withStore } from './store.js';

/**
 * @typedef {object} Note
 * @property {string} id
 * @property {string} bookId
 * @property {number} unitIndex - the sentence the note was taken from
 * @property {string} quote - the text of that sentence
 * @property {string} text - what the learner wrote
 * @property {number} createdAt
 * @property {number} updatedAt
 */


/**
 * An in-memory store with the same shape as the local database.
 *
 * It lets the notes be tested without IndexedDB, and it is what the tests use.
 *
 * @param {Note[]} [seed] - the notes to start with.
 * @returns {{list: Function, get: Function, put: Function, remove: Function}} the backend.
 */
export function createMemoryBackend(seed = []) {
  const map = new Map();
  (Array.isArray(seed) ? seed : []).forEach((note) => {
    if (note?.id !== undefined && note.id !== '') map.set(note.id, { ...note });
  });
  return {
    list: async () => [...map.values()].map((note) => ({ ...note })),
    get: async (id) => {
      const note = map.get(id);
      return note === undefined ? undefined : { ...note };
    },
    put: async (note) => { map.set(note.id, { ...note }); },
    remove: async (id) => { map.delete(id); },
  };
}

/**
 * The backend the notes are read from and written to.
 *
 * @returns {{list: Function, get: Function, put: Function, remove: Function}} the backend.
 */
function defaultBackend() {
  return {
    list: async () => (await withStore('readonly', (store) => store.getAll(), NOTES_STORE_NAME)) ?? [],
    get: async (id) => withStore('readonly', (store) => store.get(id), NOTES_STORE_NAME),
    put: async (note) => { await withStore('readwrite', (store) => store.put(note), NOTES_STORE_NAME); },
    remove: async (id) => { await withStore('readwrite', (store) => store.delete(id), NOTES_STORE_NAME); },
  };
}

/**
 * Every note of one book, newest first.
 *
 * @param {string} bookId - the book.
 * @returns {Promise<Note[]>}
 */
export async function listNotes(bookId, backend = defaultBackend()) {
  const notes = await backend.list();
  return (notes ?? [])
    .filter((note) => note?.bookId === bookId)
    .sort((a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0));
}

/**
 * How many notes a book has.
 *
 * @param {string} bookId - the book.
 * @returns {Promise<number>}
 */
export async function countNotes(bookId, backend = defaultBackend()) {
  const notes = await listNotes(bookId, backend);
  return notes.length;
}

/**
 * Write a new note.
 *
 * @param {object} note - the note.
 * @param {string} note.bookId
 * @param {number} note.unitIndex
 * @param {string} note.quote
 * @param {string} note.text
 * @returns {Promise<Note>} the stored note.
 */
export async function addNote({ bookId, unitIndex = 0, quote = '', text = '' }, backend = defaultBackend()) {
  const now = Date.now();
  const note = {
    id: `nt_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    bookId,
    unitIndex,
    quote,
    text,
    createdAt: now,
    updatedAt: now,
  };
  await backend.put(note);
  return note;
}

/**
 * Change the text of a note.
 *
 * @param {string} id - the note.
 * @param {string} text - the new text.
 * @returns {Promise<void>}
 */
export async function updateNote(id, text, backend = defaultBackend()) {
  const note = await backend.get(id);
  if (note === undefined) return;
  await backend.put({ ...note, text, updatedAt: Date.now() });
}

/**
 * Remove a note.
 *
 * @param {string} id - the note.
 * @returns {Promise<void>}
 */
export async function removeNote(id, backend = defaultBackend()) {
  await backend.remove(id);
}

/**
 * Remove every note of a book.
 *
 * @param {string} bookId - the book.
 * @returns {Promise<void>}
 */
export async function removeNotesOfBook(bookId, backend = defaultBackend()) {
  const notes = await listNotes(bookId, backend);
  for (const note of notes) {
    await removeNote(note.id, backend);
  }
}
