/**
 * The shelf: the books the learner imported.
 *
 * The Host owns the shelf and writes it to disk, so the same books show up in
 * the desktop application and in the browser, whatever port the Web GUI runs
 * on. The page reads and writes through the Host, and falls back to the
 * browser's own IndexedDB while the Host has no shelf yet — the grey release
 * window, where the page is new but the application is old.
 *
 * The local shelf is not thrown away: the first run pushes the books that
 * already sit in the browser up to the Host (see {@link shelfReady}).
 */

import { callShelf, SHELF_UNAVAILABLE } from './remote.js';
import {
  BOOKS_STORE_NAME,
  NOTES_STORE_NAME,
  PODCAST_STORE_NAME,
  VOCAB_STORE_NAME,
  clearStore,
  deleteBook as deleteLocalBook,
  getBook as getLocalBook,
  listBooks as listLocalBooks,
  listNotes as listLocalNotes,
  listPodcasts as listLocalPodcasts,
  listVocab as listLocalVocab,
  saveBook as saveLocalBook,
} from './local-store.js';

/**
 * @typedef {object} BookRecord
 * @property {string} id
 * @property {string} title
 * @property {string} author
 * @property {string} format
 * @property {import('../lib/parsers').Chapter[]} chapters
 * @property {number} addedAt
 * @property {{ unitIndex?: number, chapterIndex?: number, percent?: number,
 *              updatedAt?: number, activity?: object, playedMs?: number }} progress
 */

/**
 * The four collections of the shelf: how the Host lists them, how it stores
 * one record, and which local table holds the browser's copy.
 *
 * @type {{ key: string, list: string, put: string, payloadKey: string,
 *           local: () => Promise<object[]>, storeName: string }[]}
 */
const COLLECTIONS = [
  {
    key: 'books',
    list: 'books.list',
    put: 'books.put',
    payloadKey: 'book',
    local: listLocalBooks,
    storeName: BOOKS_STORE_NAME,
  },
  {
    key: 'vocab',
    list: 'vocab.list',
    put: 'vocab.put',
    payloadKey: 'entry',
    local: listLocalVocab,
    storeName: VOCAB_STORE_NAME,
  },
  {
    key: 'notes',
    list: 'notes.list',
    put: 'notes.put',
    payloadKey: 'note',
    local: listLocalNotes,
    storeName: NOTES_STORE_NAME,
  },
  {
    key: 'podcasts',
    list: 'podcasts.list',
    put: 'podcasts.put',
    payloadKey: 'episode',
    local: listLocalPodcasts,
    storeName: PODCAST_STORE_NAME,
  },
];

/** Where the migration marker lives; it is per origin, like the shelf was. */
const MIGRATION_KEY = 'english-reader:shelf-migrated';

/**
 * Whether the Host's shelf may be used.
 *
 * The Host only gains the shelf when the application is restarted, so once
 * it has proven that it has none, the page keeps to the browser's own shelf
 * until it is reloaded. The lists around the books share this memory: the
 * Host either has a shelf or it does not.
 */
let hostShelfAvailable = true;

/**
 * Whether the Host's shelf may be used.
 *
 * False once the Host has answered that it has no shelf: the page then keeps
 * to the browser's own shelf until it is reloaded.
 *
 * @returns {boolean}
 */
export function isHostShelfAvailable() {
  return hostShelfAvailable;
}

/**
 * Remember that the Host has no shelf.
 *
 * From here on the page asks the browser's own database instead, and does not
 * trouble the Host again in this page session.
 *
 * @returns {void}
 */
export function noteHostShelfUnavailable() {
  hostShelfAvailable = false;
}

/**
 * Whether an error says that the Host has no shelf.
 * @param {unknown} error - the error.
 * @returns {boolean}
 */
function isUnavailable(error) {
  return error?.code === SHELF_UNAVAILABLE;
}

/**
 * Read the migration marker.
 *
 * The marker says which collections this origin has already handed over to
 * the Host. A broken or missing marker is simply "nothing has been migrated
 * yet": the migration is safe to run again.
 *
 * @returns {Record<string, boolean>} the marker.
 */
function readMigrationMarker() {
  try {
    const raw = globalThis.localStorage?.getItem(MIGRATION_KEY);
    if (typeof raw !== 'string' || raw === '') return {};
    const parsed = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Write the migration marker.
 * @param {Record<string, boolean>} marker - the marker to store.
 * @returns {void}
 */
function writeMigrationMarker(marker) {
  try {
    globalThis.localStorage?.setItem(MIGRATION_KEY, JSON.stringify(marker));
  } catch {
    // The marker is a convenience, not a requirement: without it the
    // migration runs again, and the "the Host already has books" rule keeps
    // that harmless.
  }
}

/**
 * Push the books of the browser up to the Host.
 *
 * The Host is the truth. A collection is only handed over when the Host has
 * none of it: when the Host already has records, the local copy is a stale
 * duplicate, and copying it back would resurrect the books the learner
 * deleted.
 *
 * @returns {Promise<void>}
 */
async function migrateToHost() {
  // The Host has no shelf: there is nothing to migrate to.
  if (!hostShelfAvailable) return;

  const marker = { ...readMigrationMarker() };

  for (const collection of COLLECTIONS) {
    if (marker[collection.key] === true) continue;

    let hostRecords;
    try {
      hostRecords = await callShelf(collection.list);
    } catch (error) {
      // The Host cannot be reached: try again the next time the page runs.
      if (isUnavailable(error)) {
        noteHostShelfUnavailable();
        return;
      }
      continue;
    }

    const hostCount = Array.isArray(hostRecords) ? hostRecords.length : 0;
    let localRecords = [];
    try {
      localRecords = (await collection.local()) ?? [];
    } catch {
      // No local database in this environment: nothing to migrate.
      continue;
    }

    if (hostCount === 0 && localRecords.length > 0) {
      let complete = true;
      for (const record of localRecords) {
        try {
          await callShelf(collection.put, { [collection.payloadKey]: record });
        } catch {
          // One record did not make it: the local copy stays, so the next run
          // can try again.
          complete = false;
          break;
        }
      }
      if (complete) {
        try {
          await clearStore(collection.storeName);
        } catch {
          // The Host has the records; a local table that cannot be emptied is
          // only a duplicate, not a loss.
        }
      }
    }

    marker[collection.key] = true;
    writeMigrationMarker(marker);
  }
}

/** The one migration of this page session. @type {Promise<void>|null} */
let readyPromise = null;

/**
 * Make sure the Host has whatever this browser had.
 *
 * The migration runs once per page session and is idempotent: the marker in
 * `localStorage` says which collections were already handed over, and the
 * Host only takes a collection that is still empty on its side.
 *
 * @returns {Promise<void>} never rejects.
 */
export function shelfReady() {
  if (readyPromise === null) {
    readyPromise = migrateToHost().catch(() => {});
  }
  return readyPromise;
}

/**
 * Every book, newest first.
 * @returns {Promise<BookRecord[]>}
 */
export async function listBooks() {
  await shelfReady();
  if (hostShelfAvailable) {
    try {
      const books = await callShelf('books.list');
      return (Array.isArray(books) ? books : []).sort((a, b) => (b?.addedAt ?? 0) - (a?.addedAt ?? 0));
    } catch (error) {
      // The Host did not answer: the browser's own shelf is the fallback.
      if (isUnavailable(error)) noteHostShelfUnavailable();
    }
  }
  return listLocalBooks();
}

/**
 * Read one book.
 * @param {string} id
 * @returns {Promise<BookRecord|undefined>}
 */
export async function getBook(id) {
  if (hostShelfAvailable) {
    try {
      const book = await callShelf('books.get', { id });
      return book ?? undefined;
    } catch (error) {
      // The Host did not answer: the browser's own shelf is the fallback.
      if (isUnavailable(error)) noteHostShelfUnavailable();
    }
  }
  return getLocalBook(id);
}

/**
 * Insert or replace a book.
 * @param {BookRecord} book
 * @returns {Promise<void>}
 */
export async function saveBook(book) {
  if (hostShelfAvailable) {
    try {
      await callShelf('books.put', { book });
      return;
    } catch (error) {
      // Only the missing Host falls back to the browser; a Host that refused
      // the book has to tell the learner why.
      if (!isUnavailable(error)) throw error;
      noteHostShelfUnavailable();
    }
  }
  await saveLocalBook(book);
}

/**
 * Store the reading position of a book.
 *
 * The Host has a dedicated action for this: the progress is a few bytes,
 * while the book itself is megabytes, and the progress is written on every
 * sentence the learner turns.
 *
 * @param {string} id
 * @param {{ unitIndex?: number, chapterIndex?: number, percent?: number,
 *           activity?: object, playedMs?: number }} progress
 * @returns {Promise<void>}
 */
export async function updateProgress(id, progress) {
  if (hostShelfAvailable) {
    try {
      await callShelf('books.progress', { id, progress });
      return;
    } catch (error) {
      if (!isUnavailable(error)) throw error;
      noteHostShelfUnavailable();
    }
  }
  const book = await getLocalBook(id);
  if (book === undefined) return;
  await saveLocalBook({ ...book, progress: { ...book.progress, ...progress, updatedAt: Date.now() } });
}

/**
 * Remove a book.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteBook(id) {
  if (hostShelfAvailable) {
    try {
      await callShelf('books.delete', { id });
      return;
    } catch (error) {
      if (!isUnavailable(error)) throw error;
      noteHostShelfUnavailable();
    }
  }
  await deleteLocalBook(id);
}

/**
 * A stable id for a freshly imported book.
 * @returns {string}
 */
export function newBookId() {
  return `bk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
