/**
 * The vocabulary list: the words the learner collected while reading.
 *
 * The layer is deliberately free of React, so the reader, the word card and
 * the vocabulary panel can share one source of truth. Storage is injected:
 * the default instance asks the Host for the list — so the words are the same
 * in the application and in the browser — and falls back to the browser's own
 * IndexedDB while the Host has no shelf yet. The tests inject an in-memory
 * backend, because Node has no IndexedDB.
 *
 * A word is identified by its normalized form (`id`): lower case, without the
 * punctuation that surrounds it. Collecting the same word twice therefore
 * never creates a second row.
 */
import { callShelf, SHELF_UNAVAILABLE } from './remote.js';
import { isHostShelfAvailable, noteHostShelfUnavailable } from './store.js';
import { VOCAB_STORE_NAME, withStore } from './local-store.js';

/** One day in milliseconds. */
const DAY = 24 * 60 * 60 * 1000;

/**
 * The spaced-repetition intervals in days, indexed by the review count:
 * 0 reviews → 1 day, 1 → 2, 2 → 4, 3 → 7, 4 → 15, then 30 days for good.
 */
export const REVIEW_INTERVAL_DAYS = [1, 2, 4, 7, 15, 30];

/**
 * The event the vocabulary panel listens to, so a word collected somewhere
 * else (the reader, the word card) shows up in an open panel right away.
 */
export const VOCAB_CHANGED_EVENT = 'english-reader:vocab-changed';

/**
 * @typedef {object} VocabEntry
 * @property {string} id            // normalized word (lower case), the primary key
 * @property {string} word          // the word as it was written
 * @property {string} bookId
 * @property {string} bookTitle
 * @property {string} sentence      // the sentence the word was collected from
 * @property {number} addedAt
 * @property {'learning'|'known'} state
 * @property {number} reviewCount
 * @property {number} lastReviewedAt
 * @property {number} nextReviewAt
 * @property {string} phonetic
 * @property {string} definition
 */

/**
 * @typedef {object} VocabBackend
 * @property {() => Promise<VocabEntry[]>} list - every entry
 * @property {(id: string) => Promise<VocabEntry|undefined>} get - one entry
 * @property {(entry: VocabEntry) => Promise<void>} put - insert or replace
 * @property {(id: string) => Promise<void>} remove - delete one entry
 */

/**
 * Normalize a word into the primary key of the vocabulary list: lower case,
 * without the characters that surround it.
 *
 * The reader (which offers the word for collection) normalizes the word the
 * same way, so both sides of the plugin agree on the key of a word.
 * @param {string} word
 * @returns {string} the key, or an empty string when there is no word
 */
export function normalizeId(word) {
  const text = String(word ?? '').trim();
  if (text === '') return '';
  return text.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/**
 * Whether a string carries no information.
 * @param {string} value
 * @returns {boolean}
 */
function isBlank(value) {
  return String(value ?? '').trim() === '';
}

/**
 * The start of the local day a timestamp falls into.
 * @param {number} timestamp
 * @returns {number}
 */
function startOfDay(timestamp) {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * Build a complete entry from loose input, filling in the defaults.
 * @param {object} input
 * @param {number} now
 * @returns {VocabEntry}
 */
function toEntry(input, now) {
  const source = input ?? {};
  const word = String(source.word ?? source.id ?? '').trim();
  // A caller that already knows the key may pass it; it is normalized again,
  // so the key is always the normalized form of the word.
  const givenId = String(source.id ?? '').trim();
  const id = givenId === '' ? normalizeId(word) : normalizeId(givenId);
  const addedAt = Number.isFinite(source.addedAt) ? source.addedAt : now;
  return {
    id,
    word: word === '' ? id : word,
    bookId: String(source.bookId ?? ''),
    bookTitle: String(source.bookTitle ?? ''),
    sentence: String(source.sentence ?? ''),
    addedAt,
    state: source.state === 'known' ? 'known' : 'learning',
    reviewCount: Number.isFinite(source.reviewCount) ? Math.max(0, Math.trunc(source.reviewCount)) : 0,
    lastReviewedAt: Number.isFinite(source.lastReviewedAt) ? source.lastReviewedAt : 0,
    // A fresh word is due right away: it joins the review queue at once.
    nextReviewAt: Number.isFinite(source.nextReviewAt) ? source.nextReviewAt : addedAt,
    phonetic: String(source.phonetic ?? ''),
    definition: String(source.definition ?? ''),
  };
}

/** The fields a patch may touch; the key itself never changes. */
const PATCHABLE_FIELDS = [
  'word', 'bookId', 'bookTitle', 'sentence', 'state',
  'reviewCount', 'lastReviewedAt', 'nextReviewAt', 'phonetic', 'definition',
];

/**
 * Apply a patch to an entry, keeping every field in its documented shape.
 * @param {VocabEntry} entry
 * @param {object} patch
 * @returns {VocabEntry}
 */
function applyPatch(entry, patch) {
  const next = { ...entry };
  PATCHABLE_FIELDS.forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(patch, field)) return;
    const value = patch[field];
    if (field === 'state') {
      next.state = value === 'known' ? 'known' : 'learning';
      return;
    }
    if (field === 'reviewCount') {
      next.reviewCount = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : next.reviewCount;
      return;
    }
    if (field === 'lastReviewedAt' || field === 'nextReviewAt') {
      next[field] = Number.isFinite(value) ? value : next[field];
      return;
    }
    next[field] = value === undefined || value === null ? '' : String(value);
  });
  return next;
}

/**
 * The moment the next review of a word is due.
 *
 * The intervals repeat: a word reviewed zero times comes back in a day, then
 * two days, four, seven, fifteen, and every thirty days after that.
 * @param {{ reviewCount?: number }} entry
 * @param {number} [now]
 * @returns {number} the timestamp of the next review
 */
export function scheduleNext(entry, now = Date.now()) {
  const count = Number.isFinite(entry?.reviewCount) ? Math.max(0, Math.trunc(entry.reviewCount)) : 0;
  const index = Math.min(count, REVIEW_INTERVAL_DAYS.length - 1);
  return now + REVIEW_INTERVAL_DAYS[index] * DAY;
}

/**
 * Count the vocabulary list: how many words are known, how many are still
 * being learned, how many are untouched, and how many were added today.
 * @param {VocabEntry[]} entries
 * @param {number} [now]
 * @returns {{ total: number, known: number, learning: number, toLearn: number, addedToday: number }}
 */
export function summarize(entries, now = Date.now()) {
  const list = Array.isArray(entries) ? entries : [];
  const dayStart = startOfDay(now);
  const dayEnd = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), new Date(now).getDate() + 1).getTime();
  let known = 0;
  let learning = 0;
  let addedToday = 0;
  list.forEach((entry) => {
    if (entry?.state === 'known') {
      known += 1;
    } else if (entry?.state === 'learning' && (entry?.reviewCount ?? 0) >= 1) {
      learning += 1;
    }
    const addedAt = entry?.addedAt;
    if (Number.isFinite(addedAt) && addedAt >= dayStart && addedAt < dayEnd) addedToday += 1;
  });
  return {
    total: list.length,
    known,
    learning,
    toLearn: list.length - known - learning,
    addedToday,
  };
}

/**
 * The backend that keeps the vocabulary in the browser's IndexedDB.
 *
 * It is the fallback for the times when the Host has no shelf yet.
 * @returns {VocabBackend}
 */
function createLocalBackend() {
  return {
    list: () => withStore('readonly', (store) => store.getAll(), VOCAB_STORE_NAME),
    get: (id) => withStore('readonly', (store) => store.get(id), VOCAB_STORE_NAME),
    put: (entry) => withStore('readwrite', (store) => store.put(entry), VOCAB_STORE_NAME),
    remove: (id) => withStore('readwrite', (store) => store.delete(id), VOCAB_STORE_NAME),
  };
}

/**
 * The backend that keeps the vocabulary on the Host.
 *
 * The Host holds the truth; the browser's own table is only used while the
 * Host has no shelf, which is the window between refreshing the page and
 * restarting the application.
 * @returns {VocabBackend}
 */
export function createRemoteBackend() {
  const local = createLocalBackend();
  return {
    list: async () => {
      if (!isHostShelfAvailable()) return local.list();
      try {
        const entries = await callShelf('vocab.list');
        return Array.isArray(entries) ? entries : [];
      } catch (error) {
        if (error?.code !== SHELF_UNAVAILABLE) throw error;
        noteHostShelfUnavailable();
        return local.list();
      }
    },
    get: async (id) => {
      if (!isHostShelfAvailable()) return local.get(id);
      try {
        const entries = await callShelf('vocab.list');
        const found = (Array.isArray(entries) ? entries : []).find((entry) => entry?.id === id);
        return found ?? undefined;
      } catch (error) {
        if (error?.code !== SHELF_UNAVAILABLE) throw error;
        noteHostShelfUnavailable();
        return local.get(id);
      }
    },
    put: async (entry) => {
      if (!isHostShelfAvailable()) {
        await local.put(entry);
        return;
      }
      try {
        await callShelf('vocab.put', { entry });
      } catch (error) {
        if (error?.code !== SHELF_UNAVAILABLE) throw error;
        noteHostShelfUnavailable();
        await local.put(entry);
      }
    },
    remove: async (id) => {
      if (!isHostShelfAvailable()) {
        await local.remove(id);
        return;
      }
      try {
        await callShelf('vocab.delete', { id });
      } catch (error) {
        if (error?.code !== SHELF_UNAVAILABLE) throw error;
        noteHostShelfUnavailable();
        await local.remove(id);
      }
    },
  };
}

/**
 * An in-memory backend, for tests and for browsers without IndexedDB.
 * @param {VocabEntry[]} [seed] - the entries the store starts with
 * @returns {VocabBackend}
 */
export function createMemoryBackend(seed = []) {
  const map = new Map();
  (Array.isArray(seed) ? seed : []).forEach((entry) => {
    if (entry?.id !== undefined && entry?.id !== '') map.set(entry.id, { ...entry });
  });
  return {
    list: async () => [...map.values()].map((entry) => ({ ...entry })),
    get: async (id) => {
      const entry = map.get(id);
      return entry === undefined ? undefined : { ...entry };
    },
    put: async (entry) => { map.set(entry.id, { ...entry }); },
    remove: async (id) => { map.delete(id); },
  };
}

/**
 * Tell the open panels that the list changed.
 */
function notifyChanged() {
  const view = globalThis.window;
  if (view === undefined || typeof view.dispatchEvent !== 'function') return;
  if (typeof view.CustomEvent !== 'function') return;
  view.dispatchEvent(new view.CustomEvent(VOCAB_CHANGED_EVENT));
}

/**
 * Build a vocabulary store on top of a storage backend.
 *
 * The default backend is the Host's shelf; the tests inject the in-memory
 * one, so nothing here needs a browser.
 * @param {{ backend?: VocabBackend }} [options]
 * @returns {{
 *   listEntries: () => Promise<VocabEntry[]>,
 *   addEntry: (entry: object) => Promise<VocabEntry>,
 *   removeEntry: (id: string) => Promise<void>,
 *   updateEntry: (id: string, patch: object) => Promise<VocabEntry>,
 *   dueEntries: (now?: number) => Promise<VocabEntry[]>,
 *   summarize: (entries: VocabEntry[], now?: number) => object,
 *   scheduleNext: (entry: object, now?: number) => number,
 * }}
 */
export function createVocabStore(options = {}) {
  const backend = options?.backend ?? createRemoteBackend();

  /**
   * Every entry, the newest first.
   * @returns {Promise<VocabEntry[]>}
   */
  const listEntries = async () => {
    const entries = await backend.list();
    return [...(entries ?? [])].sort((a, b) => (b?.addedAt ?? 0) - (a?.addedAt ?? 0));
  };

  /**
   * Collect a word. Collecting the same word again only fills in what was
   * missing; the collection time, the state and the review count stay.
   * @param {object} input
   * @returns {Promise<VocabEntry>} the stored entry
   */
  const addEntry = async (input) => {
    const candidate = toEntry(input, Date.now());
    if (candidate.id === '') throw new Error('没有可收藏的单词');
    const existing = await backend.get(candidate.id);
    if (existing === undefined) {
      await backend.put(candidate);
      notifyChanged();
      return { ...candidate };
    }
    const merged = { ...existing };
    if (isBlank(merged.phonetic) && !isBlank(candidate.phonetic)) merged.phonetic = candidate.phonetic;
    if (isBlank(merged.definition) && !isBlank(candidate.definition)) merged.definition = candidate.definition;
    await backend.put(merged);
    notifyChanged();
    return { ...merged };
  };

  /**
   * Forget a word.
   * @param {string} id
   * @returns {Promise<void>}
   */
  const removeEntry = async (id) => {
    await backend.remove(String(id ?? ''));
    notifyChanged();
  };

  /**
   * Change a word: its state, its review count, its definition…
   *
   * A patch that touches the review state reschedules the word: the next
   * review follows the spaced-repetition intervals. Pass `nextReviewAt`
   * explicitly to decide the date yourself.
   * @param {string} id
   * @param {object} patch
   * @returns {Promise<VocabEntry>} the updated entry
   */
  const updateEntry = async (id, patch = {}) => {
    const existing = await backend.get(String(id ?? ''));
    if (existing === undefined) throw new Error('生词本里没有这个词');
    const changes = patch ?? {};
    const next = applyPatch(existing, changes);
    next.id = existing.id;
    const reviewed = ['state', 'reviewCount', 'lastReviewedAt']
      .some((field) => Object.prototype.hasOwnProperty.call(changes, field));
    if (reviewed && !Object.prototype.hasOwnProperty.call(changes, 'nextReviewAt')) {
      next.nextReviewAt = scheduleNext(next, Date.now());
    }
    await backend.put(next);
    notifyChanged();
    return { ...next };
  };

  /**
   * The words whose review is due, the longest overdue one first.
   * @param {number} [now]
   * @returns {Promise<VocabEntry[]>}
   */
  const dueEntries = async (now = Date.now()) => {
    const entries = await listEntries();
    return entries
      .filter((entry) => (Number.isFinite(entry?.nextReviewAt) ? entry.nextReviewAt : 0) <= now)
      .sort((a, b) => (a?.nextReviewAt ?? 0) - (b?.nextReviewAt ?? 0));
  };

  return { listEntries, addEntry, removeEntry, updateEntry, dueEntries, summarize, scheduleNext };
}

/** The store the plugin itself uses: the Host's shelf. */
const defaultStore = createVocabStore();

/**
 * Every entry, the newest first.
 * @returns {Promise<VocabEntry[]>}
 */
export async function listEntries() {
  return defaultStore.listEntries();
}

/**
 * Collect a word; collecting it again only fills in what was missing.
 * @param {object} entry
 * @returns {Promise<VocabEntry>} the stored entry
 */
export async function addEntry(entry) {
  return defaultStore.addEntry(entry);
}

/**
 * Forget a word.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function removeEntry(id) {
  return defaultStore.removeEntry(id);
}

/**
 * Change a word; a review reschedules it.
 * @param {string} id
 * @param {object} patch
 * @returns {Promise<VocabEntry>} the updated entry
 */
export async function updateEntry(id, patch) {
  return defaultStore.updateEntry(id, patch);
}

/**
 * The words whose review is due.
 * @param {number} [now]
 * @returns {Promise<VocabEntry[]>}
 */
export async function dueEntries(now = Date.now()) {
  return defaultStore.dueEntries(now);
}
