/**
 * The local shelf: the browser's own copy of the books and the lists around
 * them.
 *
 * This is the implementation that lived in `store.js` before the Host took
 * the shelf over. It stays for two reasons:
 *   - it is the source of the one-time migration: the books the learner
 *     imported in an older build are still here, and they are pushed up to the
 *     Host the first time the new page runs;
 *   - it is the fallback while the Host has no shelf yet, so a page that was
 *     refreshed before the application was restarted keeps working.
 *
 * The database is the one the learner already has: same name, same version,
 * same upgrade block, so the existing books open without data loss.
 */

const DB_NAME = 'english-reader';
const DB_VERSION = 4;
/** The book shelf shares the database with the lists below. */
export const BOOKS_STORE_NAME = 'books';
/** The vocabulary list shares the database with the shelf. */
export const VOCAB_STORE_NAME = 'vocabulary';
/** The reader's notes share it as well. */
export const NOTES_STORE_NAME = 'notes';
/** The podcast scripts share it as well. */
export const PODCAST_STORE_NAME = 'podcasts';

/**
 * @typedef {object} BookRecord
 * @property {string} id
 * @property {string} title
 * @property {string} author
 * @property {string} format
 * @property {import('../lib/parsers').Chapter[]} chapters
 * @property {number} addedAt
 * @property {{ unitIndex: number, chapterIndex: number, updatedAt: number }} progress
 */

/** @type {Promise<IDBDatabase>|null} */
let dbPromise = null;

/**
 * Open (and migrate) the database.
 * @returns {Promise<IDBDatabase>}
 */
function openDatabase() {
  if (dbPromise !== null) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前环境不支持本地存储'));
      return;
    }
    let blocked = false;
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(BOOKS_STORE_NAME)) {
        db.createObjectStore(BOOKS_STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(VOCAB_STORE_NAME)) {
        db.createObjectStore(VOCAB_STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(NOTES_STORE_NAME)) {
        const notes = db.createObjectStore(NOTES_STORE_NAME, { keyPath: 'id' });
        // The notes of one book are read together.
        notes.createIndex('bookId', 'bookId', { unique: false });
      }
      if (!db.objectStoreNames.contains(PODCAST_STORE_NAME)) {
        const podcasts = db.createObjectStore(PODCAST_STORE_NAME, { keyPath: 'id' });
        // The episodes of one book are read together.
        podcasts.createIndex('bookId', 'bookId', { unique: false });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab wants a newer version: this connection has to go, or the
      // upgrade stays blocked forever and the reader never opens.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onblocked = () => {
      // A connection from an older build still holds the previous version.
      // Give it a moment to close on its own.
      blocked = true;
    };
    request.onerror = () => { reject(request.error ?? new Error('打开本地书库失败')); };
    // A blocked upgrade must not hang the reader. The other window usually
    // closes on its own within a second, so try once more before giving up.
    const retryTimer = setTimeout(() => {
      if (!blocked) return;
      const retry = indexedDB.open(DB_NAME, DB_VERSION);
      retry.onsuccess = () => {
        const db = retry.result;
        db.onversionchange = () => { db.close(); dbPromise = null; };
        resolve(db);
      };
      retry.onerror = () => {
        const error = new Error('本地书库正被另一个窗口占用，请刷新页面');
        error.code = 'DB_BLOCKED';
        reject(error);
      };
    }, 1500);
    const giveUpTimer = setTimeout(() => {
      if (blocked) {
        const error = new Error('本地书库正被另一个窗口占用，请刷新页面');
        error.code = 'DB_BLOCKED';
        reject(error);
      }
    }, 6000);
    // Node keeps the process alive for a pending timer; the browser does not
    // care, and the tests would otherwise wait for these two.
    if (typeof retryTimer?.unref === 'function') retryTimer.unref();
    if (typeof giveUpTimer?.unref === 'function') giveUpTimer.unref();
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

/**
 * Run a transaction against one object store.
 * @param {'readonly'|'readwrite'} mode
 * @param {(store: IDBObjectStore) => IDBRequest} action
 * @param {string} [storeName] - the store to use, the book shelf by default
 * @returns {Promise<any>}
 */
export async function withStore(mode, action, storeName = BOOKS_STORE_NAME) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = action(transaction.objectStore(storeName));
    request.onsuccess = () => { resolve(request.result); };
    request.onerror = () => { reject(request.error ?? new Error('本地书库操作失败')); };
  });
}

/**
 * Every stored book, newest first.
 * @returns {Promise<BookRecord[]>}
 */
export async function listBooks() {
  const books = await withStore('readonly', (store) => store.getAll());
  return (books ?? []).sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0));
}

/**
 * Read one book.
 * @param {string} id
 * @returns {Promise<BookRecord|undefined>}
 */
export async function getBook(id) {
  return withStore('readonly', (store) => store.get(id));
}

/**
 * Insert or replace a book.
 * @param {BookRecord} book
 * @returns {Promise<void>}
 */
export async function saveBook(book) {
  await withStore('readwrite', (store) => store.put(book));
}

/**
 * Remove a book.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteBook(id) {
  await withStore('readwrite', (store) => store.delete(id));
}

/**
 * Every stored word of the vocabulary list.
 * @returns {Promise<object[]>}
 */
export async function listVocab() {
  return (await withStore('readonly', (store) => store.getAll(), VOCAB_STORE_NAME)) ?? [];
}

/**
 * Every stored note.
 * @returns {Promise<object[]>}
 */
export async function listNotes() {
  return (await withStore('readonly', (store) => store.getAll(), NOTES_STORE_NAME)) ?? [];
}

/**
 * Every stored podcast episode.
 * @returns {Promise<object[]>}
 */
export async function listPodcasts() {
  return (await withStore('readonly', (store) => store.getAll(), PODCAST_STORE_NAME)) ?? [];
}

/**
 * Empty one object store.
 *
 * The migration calls this once the books of that store sit safely on the
 * Host: the browser's copy is then a duplicate of the truth.
 *
 * @param {string} storeName - the store to empty.
 * @returns {Promise<void>}
 */
export async function clearStore(storeName) {
  await withStore('readwrite', (store) => store.clear(), storeName);
}
