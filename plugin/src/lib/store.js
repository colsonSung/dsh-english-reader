/**
 * The local shelf: books and the vocabulary list.
 *
 * Books live in the browser's IndexedDB: a novel's plain text is a few
 * megabytes, which localStorage cannot hold, and nothing leaves the machine.
 */

const DB_NAME = 'english-reader';
const DB_VERSION = 3;
const STORE_NAME = 'books';
/** The vocabulary list shares the database with the shelf. */
export const VOCAB_STORE_NAME = 'vocabulary';
/** The reader's notes share it as well. */
export const NOTES_STORE_NAME = 'notes';

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
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(VOCAB_STORE_NAME)) {
        db.createObjectStore(VOCAB_STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(NOTES_STORE_NAME)) {
        const notes = db.createObjectStore(NOTES_STORE_NAME, { keyPath: 'id' });
        // The notes of one book are read together.
        notes.createIndex('bookId', 'bookId', { unique: false });
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
    setTimeout(() => {
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
    setTimeout(() => {
      if (blocked) {
        const error = new Error('本地书库正被另一个窗口占用，请刷新页面');
        error.code = 'DB_BLOCKED';
        reject(error);
      }
    }, 6000);
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
export async function withStore(mode, action, storeName = STORE_NAME) {
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
 * Store the reading position of a book.
 * @param {string} id
 * @param {{ unitIndex?: number, chapterIndex?: number, percent?: number }} progress
 * @returns {Promise<void>}
 */
export async function updateProgress(id, progress) {
  const book = await getBook(id);
  if (book === undefined) return;
  await saveBook({ ...book, progress: { ...book.progress, ...progress, updatedAt: Date.now() } });
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
 * A stable id for a freshly imported book.
 * @returns {string}
 */
export function newBookId() {
  return `bk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
