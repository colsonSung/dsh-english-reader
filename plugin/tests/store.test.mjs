/**
 * The client half of the shelf: the transport, the host-first store and the
 * one-time migration of the books that already sit in the browser.
 *
 * Node has no IndexedDB, no localStorage and no Host, so all three are faked
 * here. The Host's availability is remembered for the whole page session, so
 * every case loads a fresh copy of the modules.
 *
 * Run: node --test tests/store.test.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';

const REMOTE_URL = new URL('../src/lib/remote.js', import.meta.url).href;
const STORE_URL = new URL('../src/lib/store.js', import.meta.url).href;

/** The counter that gives every fresh copy of a module its own identity. */
let version = 0;

/**
 * Load a fresh copy of a module, so the state it remembers starts empty.
 * @param {string} url - the module URL.
 * @returns {Promise<object>} the module.
 */
function loadModule(url) {
  version += 1;
  return import(`${url}?v=${version}`);
}

/**
 * A fake Host: it answers the shelf actions from an in-memory shelf.
 * @param {object} [seed] - the records it starts with.
 * @returns {object} the fake Host, with `fetch`, `shelf` and `calls`.
 */
function createFakeHost(seed = {}) {
  const shelf = {
    books: [...(seed.books ?? [])],
    vocab: [...(seed.vocab ?? [])],
    notes: [...(seed.notes ?? [])],
    podcasts: [...(seed.podcasts ?? [])],
  };
  const calls = [];

  /**
   * Replace one record of a collection.
   * @param {object[]} collection - the collection.
   * @param {object} record - the record.
   * @returns {void}
   */
  function upsert(collection, record) {
    const index = collection.findIndex((entry) => entry?.id === record?.id);
    if (index >= 0) collection[index] = record;
    else collection.push(record);
  }

  /**
   * Run one shelf action.
   * @param {string} action - the action.
   * @param {object} payload - the payload.
   * @returns {any} the result.
   */
  function run(action, payload) {
    if (action === 'books.list') {
      return [...shelf.books].sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0));
    }
    if (action === 'books.get') {
      return shelf.books.find((book) => book.id === payload.id) ?? null;
    }
    if (action === 'books.put') {
      upsert(shelf.books, payload.book);
      return { id: payload.book.id };
    }
    if (action === 'books.progress') {
      const book = shelf.books.find((entry) => entry.id === payload.id);
      if (book !== undefined) {
        book.progress = { ...book.progress, ...payload.progress, updatedAt: Date.now() };
      }
      return { id: payload.id };
    }
    if (action === 'books.delete') {
      shelf.books = shelf.books.filter((book) => book.id !== payload.id);
      return { id: payload.id };
    }
    if (action === 'vocab.list') return [...shelf.vocab];
    if (action === 'vocab.put') {
      upsert(shelf.vocab, payload.entry);
      return { id: payload.entry.id };
    }
    if (action === 'vocab.delete') {
      shelf.vocab = shelf.vocab.filter((entry) => entry.id !== payload.id);
      return { id: payload.id };
    }
    if (action === 'notes.list') return [...shelf.notes];
    if (action === 'notes.put') {
      upsert(shelf.notes, payload.note);
      return { id: payload.note.id };
    }
    if (action === 'notes.delete') {
      shelf.notes = shelf.notes.filter((entry) => entry.id !== payload.id);
      return { id: payload.id };
    }
    if (action === 'podcasts.list') return [...shelf.podcasts];
    if (action === 'podcasts.put') {
      upsert(shelf.podcasts, payload.episode);
      return { id: payload.episode.id };
    }
    if (action === 'podcasts.delete') {
      shelf.podcasts = shelf.podcasts.filter((entry) => entry.id !== payload.id);
      return { id: payload.id };
    }
    throw new Error(`未知的书架动作：${action}`);
  }

  /**
   * The fetch the client half talks to.
   * @param {string} url - the route.
   * @param {object} init - the request.
   * @returns {Promise<object>} the response.
   */
  async function fetch(url, init) {
    const body = JSON.parse(init.body);
    calls.push(body);
    const payload = body.payload ?? {};
    const result = run(String(payload.action ?? ''), payload);
    return { status: 200, async json() { return { ok: true, result }; } };
  }

  return { fetch, shelf, calls };
}

/**
 * A fake IndexedDB: just enough of it for the browser's own shelf.
 * @returns {object} the fake, with `indexedDB`, `seed`, `records` and `reset`.
 */
function createFakeIndexedDb() {
  const databases = new Map();

  /**
   * A request that answers a tick later, like the real one.
   * @param {Function} compute - what the request does.
   * @returns {object} the request.
   */
  function makeRequest(compute) {
    const request = { onsuccess: null, onerror: null, result: undefined, error: null };
    queueMicrotask(() => {
      try {
        request.result = compute();
        request.onsuccess?.();
      } catch (error) {
        request.error = error;
        request.onerror?.();
      }
    });
    return request;
  }

  /**
   * The object store of one table.
   * @param {object} store - the table.
   * @returns {object} the object store.
   */
  function objectStoreOf(store) {
    return {
      getAll: () => makeRequest(() => [...store.records.values()]),
      get: (key) => makeRequest(() => store.records.get(key)),
      put: (value) => makeRequest(() => {
        store.records.set(value[store.keyPath], value);
        return value[store.keyPath];
      }),
      delete: (key) => makeRequest(() => {
        store.records.delete(key);
        return undefined;
      }),
      clear: () => makeRequest(() => {
        store.records.clear();
        return undefined;
      }),
      createIndex: () => ({}),
    };
  }

  /**
   * The database of one name; it is created the first time it is opened.
   * @param {string} name - the database name.
   * @returns {object} the database.
   */
  function databaseOf(name) {
    let database = databases.get(name);
    if (database === undefined) {
      database = { name, version: 0, stores: new Map() };
      databases.set(name, database);
    }
    return database;
  }

  const indexedDB = {
    open(name, wanted) {
      const request = {
        onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null,
        result: null, error: null,
      };
      queueMicrotask(() => {
        const database = databaseOf(name);
        request.result = {
          objectStoreNames: { contains: (storeName) => database.stores.has(storeName) },
          createObjectStore: (storeName, options = {}) => {
            const store = { keyPath: options.keyPath ?? null, records: new Map() };
            database.stores.set(storeName, store);
            return { createIndex: () => ({}) };
          },
          transaction: () => ({
            objectStore: (storeName) => {
              const store = database.stores.get(storeName);
              if (store === undefined) throw new Error(`没有这个表：${storeName}`);
              return objectStoreOf(store);
            },
          }),
          close: () => {},
        };
        if (wanted > database.version) {
          database.version = wanted;
          request.onupgradeneeded?.();
        }
        request.onsuccess?.();
      });
      return request;
    },
  };

  return {
    indexedDB,
    /**
     * Put a record into a table, as if it had been saved earlier.
     * @param {string} storeName - the table.
     * @param {object} record - the record.
     * @returns {void}
     */
    seed(storeName, record) {
      const database = databaseOf('english-reader');
      let store = database.stores.get(storeName);
      if (store === undefined) {
        store = { keyPath: 'id', records: new Map() };
        database.stores.set(storeName, store);
      }
      store.records.set(record.id, { ...record });
    },
    /**
     * Every record of a table.
     * @param {string} storeName - the table.
     * @returns {object[]} the records.
     */
    records(storeName) {
      const store = databaseOf('english-reader').stores.get(storeName);
      return store === undefined ? [] : [...store.records.values()];
    },
    /**
     * Empty every table, between two cases.
     * @returns {void}
     */
    reset() {
      databases.get('english-reader')?.stores.forEach((store) => store.records.clear());
    },
  };
}

/**
 * A fake localStorage, so the migration marker has a home.
 * @returns {object} the fake.
 */
function createFakeStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    clear: () => { map.clear(); },
    read: (key) => (map.has(key) ? map.get(key) : null),
  };
}

const indexed = createFakeIndexedDb();
const storage = createFakeStorage();
globalThis.indexedDB = indexed.indexedDB;
globalThis.localStorage = storage;

/**
 * A fetch that never reaches the Host.
 * @returns {Function} the failing fetch.
 */
function deadFetch() {
  return async () => { throw new Error('fetch failed'); };
}

test('callShelf 发出正确的请求体并返回 result', async () => {
  const remote = await loadModule(REMOTE_URL);
  const seen = [];
  const result = await remote.callShelf('books.get', { id: 'bk_1' }, {
    fetch: async (url, init) => {
      seen.push({ url, init });
      return { status: 200, async json() { return { ok: true, result: { id: 'bk_1' } }; } };
    },
  });
  assert.deepEqual(result, { id: 'bk_1' });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, remote.ROUTE);
  assert.equal(seen[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(seen[0].init.body), {
    method: 'shelf',
    payload: { action: 'books.get', id: 'bk_1' },
  });
});

test('宿主连不上时报宿主书库不可用', async () => {
  const remote = await loadModule(REMOTE_URL);
  await assert.rejects(
    () => remote.callShelf('books.list', {}, { fetch: deadFetch() }),
    (error) => {
      assert.equal(error.code, remote.SHELF_UNAVAILABLE);
      assert.match(error.message, /[\u4e00-\u9fa5]/);
      assert.ok(error.cause instanceof Error);
      return true;
    },
  );
});

test('宿主答 404 / 405 / 400 时都当宿主书库不可用', async () => {
  for (const status of [404, 405, 400]) {
    const remote = await loadModule(REMOTE_URL);
    await assert.rejects(
      () => remote.callShelf('books.list', {}, {
        fetch: async () => ({
          status,
          async json() {
            return { ok: false, error: { code: 'english-reader/unknown-method', message: '不支持的方法：shelf' } };
          },
        }),
      }),
      (error) => {
        assert.equal(error.code, remote.SHELF_UNAVAILABLE, `HTTP ${status} 必须被当成宿主书库不可用`);
        return true;
      },
    );
  }
});

test('未重启的宿主回 unknown-method 时当宿主书库不可用', async () => {
  const remote = await loadModule(REMOTE_URL);
  await assert.rejects(
    () => remote.callShelf('books.list', {}, {
      fetch: async () => ({
        status: 200,
        async json() {
          return { ok: false, error: { code: 'english-reader/unknown-method', message: '不支持的方法：shelf' } };
        },
      }),
    }),
    (error) => {
      assert.equal(error.code, remote.SHELF_UNAVAILABLE);
      return true;
    },
  );
});

test('宿主答失败时给出宿主的中文原因', async () => {
  const remote = await loadModule(REMOTE_URL);
  await assert.rejects(
    () => remote.callShelf('books.put', { book: { id: 'bk_1' } }, {
      fetch: async () => ({
        status: 200,
        async json() {
          return { ok: false, error: { code: 'english-reader/failed', message: '书库写入失败' } };
        },
      }),
    }),
    (error) => {
      assert.equal(error.code, 'english-reader/failed');
      assert.equal(error.message, '书库写入失败');
      return true;
    },
  );

  await assert.rejects(
    () => remote.callShelf('books.put', { book: { id: 'bk_1' } }, {
      fetch: async () => ({
        status: 200,
        async json() {
          return { ok: false, error: { code: 'english-reader/failed', message: '' } };
        },
      }),
    }),
    (error) => {
      assert.equal(error.code, 'english-reader/failed');
      assert.match(error.message, /[\u4e00-\u9fa5]/);
      return true;
    },
  );
});

test('宿主可用时书库从宿主读', async () => {
  indexed.reset();
  storage.clear();
  const host = createFakeHost({
    books: [{ id: 'bk_host', title: '宿主上的书', addedAt: 2, chapters: [] }],
  });
  globalThis.fetch = host.fetch;
  const store = await loadModule(STORE_URL);

  const books = await store.listBooks();
  assert.equal(books.length, 1);
  assert.equal(books[0].id, 'bk_host');
  assert.equal(store.isHostShelfAvailable(), true);
});

test('宿主可用时新书写进宿主，取书与删书也走宿主', async () => {
  indexed.reset();
  storage.clear();
  const host = createFakeHost();
  globalThis.fetch = host.fetch;
  const store = await loadModule(STORE_URL);

  await store.saveBook({ id: 'bk_1', title: '新书', addedAt: 1, chapters: [] });
  assert.equal(host.shelf.books.length, 1);
  assert.equal(indexed.records('books').length, 0);

  assert.equal((await store.getBook('bk_1'))?.title, '新书');
  await store.deleteBook('bk_1');
  assert.equal(host.shelf.books.length, 0);
});

test('宿主不可用时退回浏览器自己的书库，并且不再问宿主', async () => {
  indexed.reset();
  storage.clear();
  indexed.seed('books', { id: 'bk_local', title: '浏览器里的书', addedAt: 1, chapters: [] });
  let asked = 0;
  globalThis.fetch = async () => {
    asked += 1;
    throw new Error('fetch failed');
  };
  const store = await loadModule(STORE_URL);

  const books = await store.listBooks();
  assert.equal(books.length, 1);
  assert.equal(books[0].id, 'bk_local');
  assert.equal(store.isHostShelfAvailable(), false);
  // 宿主一旦证明自己没有书库，这一页就不再问它。
  assert.equal(asked, 1);
});

test('宿主不可用时新书写进浏览器自己的书库', async () => {
  indexed.reset();
  storage.clear();
  globalThis.fetch = deadFetch();
  const store = await loadModule(STORE_URL);

  await store.saveBook({ id: 'bk_new', title: '新书', addedAt: 3, chapters: [] });
  assert.deepEqual(indexed.records('books').map((book) => book.id), ['bk_new']);
});

test('写进度只走 books.progress，不搬整本书', async () => {
  indexed.reset();
  storage.clear();
  const host = createFakeHost({
    books: [{ id: 'bk_1', title: '书', addedAt: 1, chapters: [{ title: '第一章', paragraphs: ['正文'] }] }],
  });
  globalThis.fetch = host.fetch;
  const store = await loadModule(STORE_URL);

  await store.updateProgress('bk_1', { unitIndex: 7, chapterIndex: 2 });

  const progressCalls = host.calls.filter((call) => call.payload.action === 'books.progress');
  assert.equal(progressCalls.length, 1);
  assert.deepEqual(progressCalls[0].payload, {
    action: 'books.progress',
    id: 'bk_1',
    progress: { unitIndex: 7, chapterIndex: 2 },
  });
  assert.equal(host.calls.some((call) => call.payload.action === 'books.get'), false);
  assert.equal(host.calls.some((call) => call.payload.action === 'books.put'), false);
  assert.equal(host.shelf.books[0].progress.unitIndex, 7);
});

test('宿主不可用时进度合并进浏览器里的那本书', async () => {
  indexed.reset();
  storage.clear();
  indexed.seed('books', {
    id: 'bk_1', title: '书', addedAt: 1, chapters: [], progress: { unitIndex: 2, percent: 0.5 },
  });
  globalThis.fetch = deadFetch();
  const store = await loadModule(STORE_URL);

  await store.updateProgress('bk_1', { unitIndex: 9 });

  const book = indexed.records('books')[0];
  assert.equal(book.progress.unitIndex, 9);
  assert.equal(book.progress.percent, 0.5);
  assert.ok(book.progress.updatedAt > 0);
});

test('迁移把浏览器里的书推上空宿主，只推一次', async () => {
  indexed.reset();
  storage.clear();
  indexed.seed('books', { id: 'bk_1', title: '书一', addedAt: 1, chapters: [] });
  indexed.seed('books', { id: 'bk_2', title: '书二', addedAt: 2, chapters: [] });
  const host = createFakeHost();
  globalThis.fetch = host.fetch;
  const store = await loadModule(STORE_URL);

  await store.shelfReady();

  assert.equal(host.shelf.books.length, 2);
  assert.equal(host.calls.filter((call) => call.payload.action === 'books.put').length, 2);
  // 全部推上去之后，本地那份清空。
  assert.equal(indexed.records('books').length, 0);
  // 标记落盘，四个集合都算迁过。
  assert.deepEqual(JSON.parse(storage.read('english-reader:shelf-migrated')), {
    books: true, vocab: true, notes: true, podcasts: true,
  });

  // 再跑一次不会重复推。
  await store.shelfReady();
  assert.equal(host.calls.filter((call) => call.payload.action === 'books.put').length, 2);
});

test('宿主已经有书时不再搬浏览器的副本', async () => {
  indexed.reset();
  storage.clear();
  indexed.seed('books', { id: 'bk_local', title: '浏览器里的旧书', addedAt: 1, chapters: [] });
  const host = createFakeHost({
    books: [{ id: 'bk_host', title: '宿主上的书', addedAt: 2, chapters: [] }],
  });
  globalThis.fetch = host.fetch;
  const store = await loadModule(STORE_URL);

  await store.shelfReady();

  assert.equal(host.calls.filter((call) => call.payload.action === 'books.put').length, 0);
  assert.equal(host.shelf.books.length, 1);
  assert.equal(host.shelf.books[0].id, 'bk_host');
  // 本地那份按契约不清空，但标记为已迁移。
  assert.equal(indexed.records('books').length, 1);
  assert.equal(JSON.parse(storage.read('english-reader:shelf-migrated')).books, true);
});

test('宿主不可用时迁移跳过，也不报错', async () => {
  indexed.reset();
  storage.clear();
  indexed.seed('books', { id: 'bk_1', title: '书', addedAt: 1, chapters: [] });
  globalThis.fetch = deadFetch();
  const store = await loadModule(STORE_URL);

  await store.shelfReady();

  assert.equal(indexed.records('books').length, 1);
  assert.equal(storage.read('english-reader:shelf-migrated'), null);
});

test('shelfReady 并发调用只迁移一次', async () => {
  indexed.reset();
  storage.clear();
  indexed.seed('books', { id: 'bk_1', title: '书', addedAt: 1, chapters: [] });
  const host = createFakeHost();
  globalThis.fetch = host.fetch;
  const store = await loadModule(STORE_URL);

  await Promise.all([store.shelfReady(), store.shelfReady(), store.shelfReady()]);

  assert.equal(host.calls.filter((call) => call.payload.action === 'books.put').length, 1);
});
