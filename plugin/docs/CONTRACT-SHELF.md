# reader — 书库持久化契约 (Shelf Persistence Contract)

版本: 1.0 · 状态: 已冻结（宿主半边与客户端半边都必须严格遵守）

## 0. 为什么要有这份契约

书库原来存在**浏览器的 IndexedDB** 里。IndexedDB 按「源（origin）」隔离，于是：

| 使用场景 | 源 | 书库 |
|---|---|---|
| 桌面应用内嵌窗口 | `dsh-app://app` | 有书 |
| 浏览器打开 Web GUI | `http://127.0.0.1:<端口>` | 空 |
| Web GUI 端口每次重启都变 | `http://127.0.0.1:<新端口>` | 又变空 |

同一个「电脑」，两套互不相通的书。这就是「导入了的书籍看不到」的根因，**不是导入失败**。

契约的目标：**书库由宿主（Host）持有并落盘，浏览器只是一块显示屏**。
换应用、换浏览器、换端口、重启、刷新，书库都在。

---

## 1. 传输层

复用已有的路由 `POST /api/reader`（`index.js` 里的 `ROUTE`）。

请求体：

```json
{ "method": "shelf", "payload": { "action": "<动作>", ... } }
```

响应体（与其它方法一致）：

```json
{ "ok": true, "result": <结果> }
```

失败：

```json
{ "ok": false, "error": { "code": "<机器码>", "message": "<中文>", "details": {} } }
```

`method: "shelf"` 不在旧的 `METHODS` 集合里，所以**未重启的旧宿主**会回
`reader/unknown-method`（HTTP 400）。客户端必须把它当成「宿主书库不可用」，
退回本地 IndexedDB，而不是报错——这让灰度期间（先刷新页面、后重启应用）依然可用。

---

## 2. 动作一览

### 2.1 书（books）

| action | payload | result |
|---|---|---|
| `books.list` | `{}` | `BookRecord[]`，按 `addedAt` 倒序 |
| `books.get` | `{ id: string }` | `BookRecord \| null` |
| `books.put` | `{ book: BookRecord }` | `{ id: string }` |
| `books.progress` | `{ id: string, progress: object }` | `{ id: string }` |
| `books.delete` | `{ id: string }` | `{ id: string }` |

**`books.list` 返回完整记录（含 `chapters`）**，与现在 `IndexedDB.getAll()` 的语义完全一致：
书库界面要用 `chapters` 算词数与词频。请求体走 localhost，带一本小说的正文（几 MB）是可接受的，
与今天浏览器里 `getAll()` 的开销同量级。

**`books.progress` 是给「写进度」用的专用动作**：阅读时每翻一句都会写一次进度，如果走
`books.get` + `books.put`，每次都要把整本书（几 MB）在网络上搬两个来回。`books.progress`
只传进度，**由宿主读出那本书、合并进度、写回**：

- 合并语义：新的 `progress` 字段覆盖旧的同名字段，没提到的字段保留。
- `progress.updatedAt` 由宿主填成当前时间。
- 书不存在时**不报错**，返回 `{ id }` 即可（书可能刚被删掉）。

### 2.2 生词本（vocab）

| action | payload | result |
|---|---|---|
| `vocab.list` | `{}` | `VocabEntry[]` |
| `vocab.put` | `{ entry: VocabEntry }` | `{ id: string }` |
| `vocab.delete` | `{ id: string }` | `{ id: string }` |

### 2.3 笔记（notes）

| action | payload | result |
|---|---|---|
| `notes.list` | `{}` | `Note[]` |
| `notes.put` | `{ note: Note }` | `{ id: string }` |
| `notes.delete` | `{ id: string }` | `{ id: string }` |

### 2.4 播客（podcasts）

| action | payload | result |
|---|---|---|
| `podcasts.list` | `{}` | `PodcastEpisode[]` |
| `podcasts.put` | `{ episode: PodcastEpisode }` | `{ id: string }` |
| `podcasts.delete` | `{ id: string }` | `{ id: string }` |

记录形状沿用现有定义，**不要改字段名**：

```js
// src/lib/store.js
BookRecord = {
  id: string, title: string, author: string, format: string,
  chapters: Chapter[], addedAt: number, cover?: string,
  progress?: { unitIndex?: number, chapterIndex?: number, percent?: number,
               updatedAt?: number, activity?: object, playedMs?: number },
}

// src/lib/vocab.js
VocabEntry = { id, word, bookId, bookTitle, sentence, addedAt, state,
               reviewCount, lastReviewedAt, nextReviewAt, phonetic, definition }

// src/lib/notes.js
Note = { id, bookId, unitIndex, quote, text, createdAt, updatedAt }

// src/lib/podcasts.js
PodcastEpisode = { id, bookId, chapterKey, scope, title, summary,
                   dialogue: PodcastLine[], createdAt }
```

宿主**原样保存**这些 JSON，不做字段裁剪、不做 schema 校验（学习者的数据不能被宿主弄丢）。
`id` 为空或缺字段的记录直接忽略。

---

## 3. 宿主侧存储布局

```
<profileDir>/reader/          profileDir = ctx.profileContext?.dir
├── books/
│   └── <bookId>.json                 一本书一个文件（整条记录）
├── vocabulary.json                   { "<id>": VocabEntry }
├── notes.json                        { "<id>": Note }
└── podcasts.json                     { "<id>": PodcastEpisode }
```

- `profileDir` 未知时退回 `~/.dsh/reader/`（与 MiniMax key、Gutenberg 目录同处）。
- **一本书一个文件**：一本小说改一次进度就重写一个几 MB 的文件；把所有书塞进一个大 JSON
  会让每次读进度都重写整本书。
- 写入**必须原子**：先写 `<file>.tmp`，再 `rename` 覆盖。断电或崩溃不能留下半个 JSON。
- 文件名安全：只允许 `[A-Za-z0-9_-]`，其余字符替换成 `_`；`id` 与文件名不一致时以 id 为准。
- `books/` 目录在第一次写入时才创建。

---

## 4. 宿主侧模块 `src/host/shelf.js`

```js
/**
 * 宿主侧的书库仓库：磁盘上的持久化书架。
 * @param {{ dir?: string }} [options] - dir 是书库根目录，缺省用 <profileDir>/reader
 */
export function createShelf(options = {}) → Shelf
```

`Shelf` 接口（**全部 async**）：

| 方法 | 说明 |
|---|---|
| `listBooks(): Promise<BookRecord[]>` | 全部书，按 `addedAt` 倒序；损坏的文件跳过，不抛错 |
| `getBook(id): Promise<BookRecord \| undefined>` | 一本书 |
| `putBook(book): Promise<void>` | 写入或覆盖一本书 |
| `updateProgress(id, progress): Promise<void>` | 读出那本书、合并进度、写回；书不存在时不报错 |
| `deleteBook(id): Promise<void>` | 删除一本书 |
| `listVocab(): Promise<VocabEntry[]>` / `putVocab(entry)` / `deleteVocab(id)` | 生词本 |
| `listNotes(): Promise<Note[]>` / `putNote(note)` / `deleteNote(id)` | 笔记 |
| `listPodcasts(): Promise<PodcastEpisode[]>` / `putPodcast(ep)` / `deletePodcast(id)` | 播客 |

要求：

1. 读文件失败（不存在 / 解析失败）时返回空或 `undefined`，**不抛异常**——一块坏文件不能
   让整个书库打不开。
2. `put*` 自动建目录。
3. 全部方法可注入 `dir`，这样测试用临时目录，不碰用户数据。

---

## 5. 宿主侧路由接线 `index.js`

- `METHODS` 集合里加上 `'shelf'`。
- 在 fetch 处理函数里，`method === 'shelf'` 时按 `payload.action` 分派到 `Shelf`。
- 未知的 action 返回 `reader/unknown-action`（HTTP 400）。
- `Shelf` 的目录这样取：

```js
const profileDir = ctx?.profileContext?.dir ?? ''
const dir = profileDir !== '' ? join(profileDir, 'reader') : undefined
```

- 插件的 `inject` 需要加上 `'profileContext'`（与 onerway-pmo 一致）。

---

## 6. 客户端侧 `src/lib/**`

### 6.1 `src/lib/remote.js`（新增）

```js
export const ROUTE = '/api/reader';
export const SHELF_UNAVAILABLE = 'shelf-unavailable';

/**
 * 调用宿主的一个动作。
 * @param {string} action
 * @param {object} [payload]
 * @param {{ fetch?: Function }} [options]
 * @returns {Promise<any>} result
 * @throws {Error} code === SHELF_UNAVAILABLE 时表示宿主书库不可用（未重启 / 路由 404 / 400）
 */
export async function callShelf(action, payload = {}, options = {});
```

- 网络错误、HTTP 404 / 405 / 400、`ok: false` 且 `error.code` 为
  `reader/unknown-method` —— 一律抛 `code === SHELF_UNAVAILABLE` 的错误。
- 其余失败抛 `error.code === 'reader/failed'` 的错误，message 用中文。

### 6.2 `src/lib/local-store.js`（新增，现有 `store.js` 的实现搬过来）

保留现有 IndexedDB 实现，作为**迁移来源**与**宿主不可用时的兜底**：

```js
export const VOCAB_STORE_NAME = 'vocabulary';
export const NOTES_STORE_NAME = 'notes';
export const PODCAST_STORE_NAME = 'podcasts';
export const BOOKS_STORE_NAME = 'books';
export async function withStore(mode, action, storeName = BOOKS_STORE_NAME);
export async function listBooks(); getBook(id); saveBook(book); deleteBook(id);
export async function listVocab(); listNotes(); listPodcasts();
export async function clearStore(storeName);   // 迁移成功后清空本地表
```

### 6.3 `src/lib/store.js`（重写）

对外 API **保持不变**，内部换成「宿主优先、本地兜底」：

```js
export async function listBooks(): Promise<BookRecord[]>
export async function getBook(id: string): Promise<BookRecord|undefined>
export async function saveBook(book: BookRecord): Promise<void>
export async function updateProgress(id: string, progress: object): Promise<void>
export async function deleteBook(id: string): Promise<void>
export function newBookId(): string
```

新增：

```js
export function isHostShelfAvailable(): boolean
export async function shelfReady(): Promise<void>   // 触发一次迁移，幂等
```

行为：

- 读：先问宿主；宿主不可用或报错 → 读本地 IndexedDB。
- 写：先写宿主；宿主不可用 → 只写本地，并记住「宿主不可用」。
- `updateProgress`：**走 `books.progress` 动作**（只传进度，宿主负责读改写）。
  宿主不可用时退回本地：读本地那本书、合并进度、整体写回（与今天的 `saveBook` 语义一致）。
  不要用 `books.get` + `books.put` 实现它——那会在每次翻句时把整本书在网络上搬两个来回。

### 6.4 生词本 / 笔记 / 播客

`src/lib/vocab.js`、`src/lib/notes.js`、`src/lib/podcasts.js` 里把
`withStore(...)` 拼出来的默认后端换成走 `callShelf` 的后端。

- `vocab.js`：`createIndexedDbBackend()` → `createRemoteBackend()`，仍然接受
  `createVocabStore({ backend })` 注入（测试用内存后端，**不要改测试的注入方式**）。
- `notes.js`：`defaultBackend()` → 远端后端；`setNotesBackend()` 覆盖机制保留。
- `podcasts.js`：`defaultBackend()` → 远端后端；`setPodcastsBackend()` 覆盖机制保留。
- 三个后端的接口形状不变：`{ list, get, put, remove }`。

---

## 7. 迁移：把已经在浏览器里的书搬上宿主

**每个源只迁一次**（IndexedDB 与 localStorage 都是按源隔离的，所以标记也是按源的）。

标记键：`localStorage['english-reader:shelf-migrated']`，值是 JSON：

```json
{ "books": true, "vocab": true, "notes": true, "podcasts": true }
```

`shelfReady()` 的流程：

1. 若宿主书库不可用 → 跳过迁移，直接用本地数据（本节只在宿主可用时生效）。
2. 对 `books` / `vocab` / `notes` / `podcasts` 四个集合，**逐个**判断：
   - 该集合在标记里已经是 `true` → 跳过。
   - 否则：取宿主该集合的条数与本地该集合的条数。
     - 宿主 **0** 条且本地 **>0** 条 → 把本地每一条 `put` 到宿主；
       **全部成功**后再清空本地该集合（失败就不清，保留本地副本）。
     - 宿主 **>0** 条 → 本地数据视为过期副本，**不清空**（保险起见），但标记为已迁移。
3. 四个集合都处理完后，把标记写成全部 `true` 并落盘。

为什么「宿主非空就不迁移」：宿主是唯一真相。如果宿主已经有书，本地那份多半是旧副本，
再迁一次会把用户删掉的书又搬回来。

为什么「宿主为空才迁」：这是救回用户现有书籍的关键路径。桌面应用里已经导入的书就在
`dsh-app://app` 这个源的 IndexedDB 里，第一次打开新版时它们会被搬上宿主，之后
浏览器里打开 Web GUI 就能看到同一批书。

迁移是**幂等**的：中断后重跑，宿主已有的部分会被跳过（宿主非空分支），不会产生重复。

---

## 8. 硬性约束

1. 纯 ESM，`.js` 扩展名，`"type": "module"`。
2. 客户端半边**不得** `import` 任何 `@deepseek-ai/dsh-*` 包，也不得 import `node:fs`。
3. 宿主半边**不得** import `src/ui/**` 与 `src/lib/**`（客户端代码）。
4. 面向用户的报错文案用中文。
5. 所有面向用户的报错文案用中文。
6. 不要破坏现有的测试注入方式（`createVocabStore({ backend })`、`setNotesBackend()`、
   `setPodcastsBackend()`、`createMemoryBackend()`）。
7. 宿主半边的改动需要**重启 Harness 应用**才生效；客户端半边需要 `node build.mjs`
   之后 **⌘R 刷新**。
