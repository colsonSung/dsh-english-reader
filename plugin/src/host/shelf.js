/**
 * 宿主侧的书库仓库：磁盘上的持久化书架。
 *
 * 原来书存在浏览器的 IndexedDB 里，而 IndexedDB 按「源（origin）」隔离：桌面应用
 * （dsh-app://app）和浏览器（http://127.0.0.1:<端口>，端口每次重启都变）各有一份
 * 书库，于是「导入了的书籍看不到」。这里把书库交给宿主，落到磁盘上，换应用、换浏览器、
 * 换端口、刷新、重启，看到的都是同一批书。
 *
 * 磁盘布局（契约 docs/CONTRACT-SHELF.md 第 3 节）：
 *
 *   <dir>/books/<bookId>.json   一本书一个文件（整条记录）
 *   <dir>/vocabulary.json       { "<id>": VocabEntry }
 *   <dir>/notes.json            { "<id>": Note }
 *   <dir>/podcasts.json         { "<id>": PodcastEpisode }
 *
 * 三条硬规矩：
 *
 *   1. 写入是原子的：先写 `<file>.tmp`，再 rename 覆盖目标，断电或崩溃不会留下半个
 *      JSON；
 *   2. 读文件失败（不存在 / 解析失败）返回空或 undefined，不抛异常——一块坏文件不能
 *      让整个书库打不开；
 *   3. 记录原样保存，不裁字段、不校验 schema：学习者的数据不能被宿主弄丢。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** 书库根目录的缺省值：与 MiniMax 的 key、Gutenberg 的目录同处。 */
export const DEFAULT_DIR = join(homedir(), '.dsh', 'english-reader');

/** 一本书一个文件，放在这个子目录里；第一次写入时才创建。 */
const BOOKS_DIR = 'books';

/** 生词本、笔记、播客各一个文件，整张表放在里面。 */
const VOCAB_FILE = 'vocabulary.json';
const NOTES_FILE = 'notes.json';
const PODCASTS_FILE = 'podcasts.json';

/** 每个文件一条链：读改写不能交叉，否则并行的写入会互相覆盖。 */
const writeChains = new Map();

/**
 * 记录在磁盘上的文件名：只允许 [A-Za-z0-9_-]，其余字符一律换成下划线。
 * id 本身不改，它在 JSON 里才是权威。
 *
 * @param {string} id - 记录的 id。
 * @returns {string} 安全的文件名（不含扩展名）。
 */
export function safeFileName(id) {
  const name = String(id ?? '').replace(/[^A-Za-z0-9_-]/g, '_');
  return name === '' ? '_' : name;
}

/**
 * 书库根目录：优先用调用方给的书库目录，其次用宿主配置目录下的 english-reader，
 * 最后退回 ~/.dsh/english-reader。
 *
 * @param {{ dir?: string, profileDir?: string }} [options] - 调用方给的选项。
 * @returns {string} 根目录。
 */
export function resolveDir(options = {}) {
  const dir = typeof options.dir === 'string' ? options.dir.trim() : '';
  if (dir !== '') return dir;
  const profileDir = typeof options.profileDir === 'string' ? options.profileDir.trim() : '';
  if (profileDir !== '') return join(profileDir, 'english-reader');
  return DEFAULT_DIR;
}

/**
 * 一条记录是不是一个能存下来的对象。
 *
 * @param {any} value - 待检查的值。
 * @returns {boolean} true 表示这是一条对象记录。
 */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 读一个 JSON 文件。文件不存在或内容坏了都返回 undefined：书库不能因为一块坏文件
 * 就整个打不开。
 *
 * @param {string} file - 文件路径。
 * @returns {any} 解析出来的内容，或 undefined。
 */
function readJson(file) {
  try {
    if (!existsSync(file)) return undefined;
    const text = readFileSync(file, 'utf8');
    if (text.trim() === '') return undefined;
    return JSON.parse(text);
  } catch {
    // 文件读不了或不是合法 JSON：当它不存在。
    return undefined;
  }
}

/**
 * 原子地写一个 JSON 文件：先写 `<file>.tmp`，再 rename 覆盖目标。
 * 断电或崩溃最多留下一个 .tmp，不会留下半个 JSON。
 *
 * @param {string} file - 目标文件。
 * @param {any} value - 要写进去的内容。
 */
function writeJsonAtomic(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  try {
    writeFileSync(tmp, JSON.stringify(value), 'utf8');
    renameSync(tmp, file);
  } catch (error) {
    // 写失败时把半截的临时文件清掉，免得它留在目录里混淆下一次读。
    try {
      unlinkSync(tmp);
    } catch {
      // 临时文件本来就不在了。
    }
    throw error;
  }
}

/**
 * 让同一个文件上的写操作排队执行。
 *
 * @param {string} key - 文件路径。
 * @param {() => any} task - 要做的事。
 * @returns {Promise<any>} 任务的结果。
 */
function withFileLock(key, task) {
  const previous = writeChains.get(key) ?? Promise.resolve();
  const run = previous.then(() => task(), () => task());
  // 这条链本身不能 reject，否则后面的任务会被一起跳过。
  writeChains.set(key, run.then(() => undefined, () => undefined));
  return run;
}

/**
 * 读一整张表（生词本 / 笔记 / 播客）。文件坏了就当空表。
 *
 * @param {string} file - 文件路径。
 * @returns {Record<string, any>} id → 记录。
 */
function readTable(file) {
  const parsed = readJson(file);
  return isRecord(parsed) ? parsed : {};
}

/**
 * 表里的所有记录。
 *
 * @param {string} file - 文件路径。
 * @returns {any[]} 记录列表。
 */
function listTable(file) {
  const table = readTable(file);
  const records = [];
  for (const [key, value] of Object.entries(table)) {
    if (!isRecord(value)) continue;
    const id = typeof value.id === 'string' ? value.id : key;
    if (id === '') continue;
    records.push(value);
  }
  return records;
}

/**
 * 往表里放一条记录。
 *
 * @param {string} file - 文件路径。
 * @param {any} record - 记录。
 */
function writeTableEntry(file, record) {
  const table = readTable(file);
  table[String(record.id)] = record;
  writeJsonAtomic(file, table);
}

/**
 * 从表里删掉一条记录。
 *
 * @param {string} file - 文件路径。
 * @param {string} id - 记录的 id。
 */
function removeTableEntry(file, id) {
  const table = readTable(file);
  if (!(id in table)) return;
  delete table[id];
  writeJsonAtomic(file, table);
}

/**
 * 建一个书库。
 *
 * @param {{ dir?: string, profileDir?: string }} [options] - dir 是书库根目录；
 *   profileDir 是宿主的配置目录；两个都没有时用 ~/.dsh/english-reader。
 * @returns {object} 书库仓库（方法全部异步）。
 */
export function createShelf(options = {}) {
  const dir = resolveDir(options);
  const booksDir = join(dir, BOOKS_DIR);
  const vocabFile = join(dir, VOCAB_FILE);
  const notesFile = join(dir, NOTES_FILE);
  const podcastsFile = join(dir, PODCASTS_FILE);

  /**
   * 一本书在磁盘上的路径。
   *
   * @param {string} id - 书的 id。
   * @returns {string} 路径。
   */
  const bookFile = (id) => join(booksDir, `${safeFileName(id)}.json`);

  return {
    /** 书库根目录。 */
    dir,

    /**
     * 全部书，按加入时间倒序。坏掉的文件跳过，不抛错。
     *
     * @returns {Promise<object[]>} 书的列表。
     */
    async listBooks() {
      let names = [];
      try {
        names = readdirSync(booksDir);
      } catch {
        // 还没写过：books/ 目录不存在。
        return [];
      }
      const books = [];
      for (const name of names) {
        // 写了一半的 .tmp 不是一本书。
        if (!name.endsWith('.json')) continue;
        const record = readJson(join(booksDir, name));
        if (!isRecord(record)) continue;
        if (typeof record.id !== 'string' || record.id === '') continue;
        books.push(record);
      }
      books.sort((a, b) => {
        const diff = (Number(b.addedAt) || 0) - (Number(a.addedAt) || 0);
        if (diff !== 0) return diff;
        // 同一时间进来的书按 id 排，顺序才是稳定的。
        return String(a.id) < String(b.id) ? -1 : (String(a.id) > String(b.id) ? 1 : 0);
      });
      return books;
    },

    /**
     * 读一本书。
     *
     * @param {string} id - 书的 id。
     * @returns {Promise<object|undefined>} 那本书，或者 undefined。
     */
    async getBook(id) {
      const key = typeof id === 'string' ? id : '';
      if (key === '') return undefined;
      const record = readJson(bookFile(key));
      if (!isRecord(record)) return undefined;
      // 文件名只是索引，id 以 JSON 里的为准。
      if (record.id !== key) return undefined;
      return record;
    },

    /**
     * 写入或覆盖一本书。
     *
     * @param {object} book - 整条记录。
     * @returns {Promise<void>}
     */
    async putBook(book) {
      if (!isRecord(book)) return;
      const id = typeof book.id === 'string' ? book.id : '';
      // 没有 id 的记录直接忽略。
      if (id === '') return;
      const file = bookFile(id);
      await withFileLock(file, () => {
        writeJsonAtomic(file, book);
      });
    },

    /**
     * 合并并写回一本书的阅读进度。读改写都在磁盘上完成，客户端只传进度。
     *
     * @param {string} id - 书的 id。
     * @param {object} progress - 新的进度字段。
     * @returns {Promise<void>}
     */
    async updateProgress(id, progress) {
      const key = typeof id === 'string' ? id : '';
      if (key === '') return;
      const file = bookFile(key);
      await withFileLock(file, () => {
        const record = readJson(file);
        // 书可能刚被删掉：这时不报错，也不凭空造一本书出来。
        if (!isRecord(record)) return;
        const old = isRecord(record.progress) ? record.progress : {};
        const patch = isRecord(progress) ? progress : {};
        writeJsonAtomic(file, {
          ...record,
          // 新字段覆盖旧字段，没提到的保留；updatedAt 由宿主填。
          progress: { ...old, ...patch, updatedAt: Date.now() },
        });
      });
    },

    /**
     * 删除一本书。
     *
     * @param {string} id - 书的 id。
     * @returns {Promise<void>}
     */
    async deleteBook(id) {
      const key = typeof id === 'string' ? id : '';
      if (key === '') return;
      const file = bookFile(key);
      await withFileLock(file, () => {
        try {
          unlinkSync(file);
        } catch {
          // 已经不在了。
        }
      });
    },

    /**
     * 生词本。
     *
     * @returns {Promise<object[]>} 全部生词。
     */
    async listVocab() {
      return listTable(vocabFile);
    },

    /**
     * 写入或覆盖一条生词。
     *
     * @param {object} entry - 生词记录。
     * @returns {Promise<void>}
     */
    async putVocab(entry) {
      if (!isRecord(entry)) return;
      const id = typeof entry.id === 'string' ? entry.id : '';
      if (id === '') return;
      await withFileLock(vocabFile, () => {
        writeTableEntry(vocabFile, entry);
      });
    },

    /**
     * 删除一条生词。
     *
     * @param {string} id - 生词的 id。
     * @returns {Promise<void>}
     */
    async deleteVocab(id) {
      const key = typeof id === 'string' ? id : '';
      if (key === '') return;
      await withFileLock(vocabFile, () => {
        removeTableEntry(vocabFile, key);
      });
    },

    /**
     * 笔记。
     *
     * @returns {Promise<object[]>} 全部笔记。
     */
    async listNotes() {
      return listTable(notesFile);
    },

    /**
     * 写入或覆盖一条笔记。
     *
     * @param {object} note - 笔记记录。
     * @returns {Promise<void>}
     */
    async putNote(note) {
      if (!isRecord(note)) return;
      const id = typeof note.id === 'string' ? note.id : '';
      if (id === '') return;
      await withFileLock(notesFile, () => {
        writeTableEntry(notesFile, note);
      });
    },

    /**
     * 删除一条笔记。
     *
     * @param {string} id - 笔记的 id。
     * @returns {Promise<void>}
     */
    async deleteNote(id) {
      const key = typeof id === 'string' ? id : '';
      if (key === '') return;
      await withFileLock(notesFile, () => {
        removeTableEntry(notesFile, key);
      });
    },

    /**
     * 播客。
     *
     * @returns {Promise<object[]>} 全部剧集。
     */
    async listPodcasts() {
      return listTable(podcastsFile);
    },

    /**
     * 写入或覆盖一集播客。
     *
     * @param {object} episode - 剧集记录。
     * @returns {Promise<void>}
     */
    async putPodcast(episode) {
      if (!isRecord(episode)) return;
      const id = typeof episode.id === 'string' ? episode.id : '';
      if (id === '') return;
      await withFileLock(podcastsFile, () => {
        writeTableEntry(podcastsFile, episode);
      });
    },

    /**
     * 删除一集播客。
     *
     * @param {string} id - 剧集的 id。
     * @returns {Promise<void>}
     */
    async deletePodcast(id) {
      const key = typeof id === 'string' ? id : '';
      if (key === '') return;
      await withFileLock(podcastsFile, () => {
        removeTableEntry(podcastsFile, key);
      });
    },
  };
}
