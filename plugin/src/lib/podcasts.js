/**
 * The audio podcasts of a book.
 *
 * An episode is the script of one chapter: the two-host dialogue the model
 * wrote for it. The audio itself is never stored — it is synthesised line by
 * line while the episode plays, so the shelf holds a few kilobytes of text
 * instead of megabytes of sound.
 *
 * The scripts live on the Host, so an episode is the same in the application
 * and in the browser; while the Host has no shelf yet they stay in the
 * browser's own database.
 */

import { callShelf, SHELF_UNAVAILABLE } from './remote.js';
import { isHostShelfAvailable, noteHostShelfUnavailable } from './store.js';
import { PODCAST_STORE_NAME, withStore } from './local-store.js';

/**
 * @typedef {object} PodcastLine
 * @property {'host'|'guest'} speaker - who says the line.
 * @property {string} text - what is said.
 */

/**
 * @typedef {object} PodcastEpisode
 * @property {string} id
 * @property {string} bookId - the book the episode belongs to.
 * @property {string} chapterKey - the chapter the episode covers.
 * @property {string} scope - the chapter's name, shown to the learner.
 * @property {string} title - the episode title.
 * @property {string} summary - one line about the episode.
 * @property {PodcastLine[]} dialogue - the script, in order.
 * @property {number} createdAt
 */

/**
 * An in-memory store with the same shape as the local database.
 *
 * It lets the episodes be tested without IndexedDB, and it is what the tests
 * use.
 *
 * @param {PodcastEpisode[]} [seed] - the episodes to start with.
 * @returns {{list: Function, get: Function, put: Function, remove: Function}} the backend.
 */
export function createMemoryBackend(seed = []) {
  const map = new Map();
  (Array.isArray(seed) ? seed : []).forEach((episode) => {
    if (episode?.id !== undefined && episode.id !== '') map.set(episode.id, { ...episode });
  });
  return {
    list: async () => [...map.values()].map((episode) => ({ ...episode })),
    get: async (id) => {
      const episode = map.get(id);
      return episode === undefined ? undefined : { ...episode };
    },
    put: async (episode) => { map.set(episode.id, { ...episode }); },
    remove: async (id) => { map.delete(id); },
  };
}

/**
 * The backend used when the caller does not pass one.
 *
 * The tests replace it with {@link setPodcastsBackend} so the episodes can be
 * driven without a browser database.
 *
 * @type {{list: Function, get: Function, put: Function, remove: Function}|null}
 */
let backendOverride = null;

/**
 * Replace the backend the episodes are read from and written to.
 *
 * @param {{list: Function, get: Function, put: Function, remove: Function}|null} backend - the backend, or null to restore the default one.
 * @returns {void}
 */
export function setPodcastsBackend(backend) {
  backendOverride = backend ?? null;
}

/**
 * The backend that keeps the episodes in the browser's own database.
 *
 * It is the fallback for the times when the Host has no shelf yet.
 * @returns {{list: Function, get: Function, put: Function, remove: Function}} the backend.
 */
function createLocalBackend() {
  return {
    list: async () => (await withStore('readonly', (store) => store.getAll(), PODCAST_STORE_NAME)) ?? [],
    get: async (id) => withStore('readonly', (store) => store.get(id), PODCAST_STORE_NAME),
    put: async (episode) => { await withStore('readwrite', (store) => store.put(episode), PODCAST_STORE_NAME); },
    remove: async (id) => { await withStore('readwrite', (store) => store.delete(id), PODCAST_STORE_NAME); },
  };
}

/**
 * The backend the episodes are read from and written to.
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
        const episodes = await callShelf('podcasts.list');
        return Array.isArray(episodes) ? episodes : [];
      } catch (error) {
        if (error?.code !== SHELF_UNAVAILABLE) throw error;
        noteHostShelfUnavailable();
        return local.list();
      }
    },
    get: async (id) => {
      if (!isHostShelfAvailable()) return local.get(id);
      try {
        const episodes = await callShelf('podcasts.list');
        const found = (Array.isArray(episodes) ? episodes : []).find((episode) => episode?.id === id);
        return found ?? undefined;
      } catch (error) {
        if (error?.code !== SHELF_UNAVAILABLE) throw error;
        noteHostShelfUnavailable();
        return local.get(id);
      }
    },
    put: async (episode) => {
      if (!isHostShelfAvailable()) {
        await local.put(episode);
        return;
      }
      try {
        await callShelf('podcasts.put', { episode });
      } catch (error) {
        if (error?.code !== SHELF_UNAVAILABLE) throw error;
        noteHostShelfUnavailable();
        await local.put(episode);
      }
    },
    remove: async (id) => {
      if (!isHostShelfAvailable()) {
        await local.remove(id);
        return;
      }
      try {
        await callShelf('podcasts.delete', { id });
      } catch (error) {
        if (error?.code !== SHELF_UNAVAILABLE) throw error;
        noteHostShelfUnavailable();
        await local.remove(id);
      }
    },
  };
}

/**
 * Every episode of one book, newest first.
 *
 * @param {string} bookId - the book.
 * @param {object} [backend] - the backend to read from.
 * @returns {Promise<PodcastEpisode[]>}
 */
export async function listPodcasts(bookId, backend = defaultBackend()) {
  const episodes = await backend.list();
  return (episodes ?? [])
    .filter((episode) => episode?.bookId === bookId)
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

/**
 * The episode of one chapter, when there is one.
 *
 * @param {string} bookId - the book.
 * @param {string} chapterKey - the chapter.
 * @param {object} [backend] - the backend to read from.
 * @returns {Promise<PodcastEpisode|undefined>}
 */
export async function findPodcast(bookId, chapterKey, backend = defaultBackend()) {
  const episodes = await listPodcasts(bookId, backend);
  return episodes.find((episode) => episode.chapterKey === chapterKey);
}

/**
 * Write one episode.
 *
 * @param {object} episode - the episode.
 * @param {object} [backend] - the backend to write to.
 * @returns {Promise<PodcastEpisode>} the stored episode.
 */
export async function savePodcast(episode, backend = defaultBackend()) {
  const now = Date.now();
  const record = {
    id: episode.id ?? `pd_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    bookId: episode.bookId ?? '',
    chapterKey: episode.chapterKey ?? '',
    scope: episode.scope ?? '',
    title: episode.title ?? '',
    summary: episode.summary ?? '',
    dialogue: Array.isArray(episode.dialogue) ? episode.dialogue : [],
    createdAt: episode.createdAt ?? now,
  };
  await backend.put(record);
  return record;
}

/**
 * Remove one episode.
 *
 * @param {string} id - the episode.
 * @param {object} [backend] - the backend to write to.
 * @returns {Promise<void>}
 */
export async function removePodcast(id, backend = defaultBackend()) {
  await backend.remove(id);
}
