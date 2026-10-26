/**
 * The reader's notes.
 *
 * A note belongs to a book and to a place in it: the sentence it was taken
 * from, its text, and when it was written. The notes live on the Host, so
 * they are the same in the application and in the browser; while the Host has
 * no shelf yet they stay in the browser's own database.
 */

import { callShelf, SHELF_UNAVAILABLE } from './remote.js';
import { isHostShelfAvailable, noteHostShelfUnavailable } from './store.js';
import { NOTES_STORE_NAME, withStore } from './local-store.js';

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
 * The backend used when the caller does not pass one.
 *
 * The tests replace it with {@link setNotesBackend} so the reader can be
 * driven without a browser database.
 *
 * @type {{list: Function, get: Function, put: Function, remove: Function}|null}
 */
let backendOverride = null;

/**
 * Replace the backend the notes are read from and written to.
 *
 * @param {{list: Function, get: Function, put: Function, remove: Function}|null} backend - the backend, or null to restore the default one.
 * @returns {void}
 */
export function setNotesBackend(backend) {
  backendOverride = backend ?? null;
}

/**
 * The backend that keeps the notes in the browser's own database.
 *
 * It is the fallback for the times when the Host has no shelf yet.
 * @returns {{list: Function, get: Function, put: Function, remove: Function}} the backend.
 */
function createLocalBackend() {
  return {
    list: async () => (await withStore('readonly', (store) => store.getAll(), NOTES_STORE_NAME)) ?? [],
    get: async (id) => withStore('readonly', (store) => store.get(id), NOTES_STORE_NAME),
    put: async (note) => { await withStore('readwrite', (store) => store.put(note), NOTES_STORE_NAME); },
    remove: async (id) => { await withStore('readwrite', (store) => store.delete(id), NOTES_STORE_NAME); },
  };
}

/**
 * The backend the notes are read from and written to.
 *
 * The Host holds the truth; the browser's own table is only used while the
 * Host has no shelf, which is the window between refreshing the page and
 * restarting the application.
 *
 * @returns {{list: Function, get: Function, put: Function, remove: Function}} the backend.
 */
function defaultBackend() {
  if (backendOverride !== null) return backendOverride;
  const local = createLocalBackend();
  return {
    list: async () => {
      if (!isHostShelfAvailable()) return local.list();
      try {
        const notes = await callShelf('notes.list');
        return Array.isArray(notes) ? notes : [];
      } catch (error) {
        if (error?.code !== SHELF_UNAVAILABLE) throw error;
        noteHostShelfUnavailable();
        return local.list();
      }
    },
    get: async (id) => {
      if (!isHostShelfAvailable()) return local.get(id);
      try {
        const notes = await callShelf('notes.list');
        const found = (Array.isArray(notes) ? notes : []).find((note) => note?.id === id);
        return found ?? undefined;
      } catch (error) {
        if (error?.code !== SHELF_UNAVAILABLE) throw error;
        noteHostShelfUnavailable();
        return local.get(id);
      }
    },
    put: async (note) => {
      if (!isHostShelfAvailable()) {
        await local.put(note);
        return;
      }
      try {
        await callShelf('notes.put', { note });
      } catch (error) {
        if (error?.code !== SHELF_UNAVAILABLE) throw error;
        noteHostShelfUnavailable();
        await local.put(note);
      }
    },
    remove: async (id) => {
      if (!isHostShelfAvailable()) {
        await local.remove(id);
        return;
      }
      try {
        await callShelf('notes.delete', { id });
      } catch (error) {
        if (error?.code !== SHELF_UNAVAILABLE) throw error;
        noteHostShelfUnavailable();
        await local.remove(id);
      }
    },
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
