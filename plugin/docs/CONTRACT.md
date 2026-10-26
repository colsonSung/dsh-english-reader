# english-reader — 接口契约 (Interface Contract)

版本: 1.0 · 状态: 已冻结（实现必须严格遵守，否则集成会失败）

本插件是 DeepSeek Harness 的 Web 客户端插件。侧边栏有一个面板入口，点击后在主面板打开「书库 / 精读」两个页签。

整体数据流：

```
File(epub/txt/md/html/pdf)
  → src/lib/parsers/index.js  parseBook(file, onProgress?) → ParsedBook
  → src/lib/engine/segment.js buildUnits(chapters) → Unit[]
  → src/lib/engine/tts.js     朗读（逐词/整句，带 word boundary 回调）
  → src/lib/engine/asr.js     识别用户朗读 → transcript
  → src/lib/engine/match.js   diffTyping / diffWords → 准确率、错词、漏词
  → UI（src/ui/**）渲染
```

---

## 1. 解析层 `src/lib/parsers/**`（负责人: parsers）

```js
// src/lib/parsers/index.js
export const SUPPORTED_EXTENSIONS = ['epub', 'txt', 'md', 'markdown', 'html', 'htm', 'pdf'];
export const SUPPORTED_ACCEPT = '.epub,.txt,.md,.markdown,.html,.htm,.pdf';

/**
 * 解析一本电子书。
 * @param {File|Blob} file - 浏览器 File/Blob，需有 name 与 type
 * @param {(info: {ratio: number, current: number, total: number, unit: 'page'|'chapter'|null}) => void} [onProgress] - 可选的进度回调
 * @returns {Promise<ParsedBook>}
 * @throws {Error} 不支持格式时抛出，message 为中文可读文案
 */
export async function parseBook(file, onProgress);
```

### 进度回调

`onProgress` 是**可选**的，不传时行为与从前完全一样。它的作用是让界面能报出「现在到哪了」：

- `ratio`：解析完成的份额，`0` 到 `1`，只增不减。
- `current` / `total`：数得出来时的计数（PDF 的页、EPUB 的章）。
- `unit`：`'page'` / `'chapter'` / `null`（数不出来时为 `null`）。

数不出来的格式（TXT / MD / HTML）在解析前后各报一次，`ratio` 为 `0` 和 `1`。

### ParsedBook

```js
/**
 * @typedef {object} ParsedBook
 * @property {string} title
 * @property {string} author
 * @property {'epub'|'txt'|'md'|'html'|'pdf'} format
 * @property {Chapter[]} chapters
 */

/**
 * @typedef {object} Chapter
 * @property {string} title
 * @property {string[]} paragraphs - 每项是一段自然段（不含句号切分），空段不要保留
 */
```

### 各格式要求

- **EPUB**：用 `fflate` 的 `unzipSync` 解包（fflate 已在 devDependencies，esbuild 会打进 bundle）。
  流程：`META-INF/container.xml` → `rootfile/@full-path` → OPF。
  OPF 里取 `metadata/dc:title`、`metadata/dc:creator`、`manifest`、`spine`。
  按 spine 顺序读取每个 XHTML/HTML 文档，用 `DOMParser` 解析（先试 `application/xhtml+xml`，失败退回 `text/html`），
  抽取块级元素（`p, div, h1..h6, li, blockquote, pre, figcaption`）的文本，丢掉 `script/style/nav/head`。
  章标题优先取该文档里的第一个 heading；没有就取 TOC（`nav` 的 `<nav epub:type="toc">` 或 NCX `navPoint/navLabel/text`）里对应的标题；再没有就用 `第 N 章`。
  文本要保留内联空格（用 `textContent` 即可，不要 `innerText`）。
- **TXT**：按空行切成段落；单行超长（> 2000 字符）时按换行兜底再切。
- **Markdown**：先去掉代码块围栏（内容保留为一个段落，标记为代码块不参与朗读则由调用方决定——本次统一当普通段落处理），
  去掉行内标记（`**`/`*`/`_`/`` ` ``/`~~`）、链接 `[text](url)` → `text`、图片 `![alt](url)` → `alt`、
  标题前缀 `#`、列表前缀 `-`/`*`/`+`/`1.`、引用前缀 `>`、水平线 `---`（丢弃）。
  最后按空行切成段落。
- **HTML**：`DOMParser` 解析，按上面的块级规则抽段落；`<title>` 作为书名兜底。
- **PDF**：尽力而为。用 `src/lib/chunks.js` 的 `loadChunk('./client.pdf.js')` 懒加载 pdf.js chunk。
  **不要在解析层直接 import pdfjs**。如果 pdf.js 在当前环境不可用，`parseBook` 对 pdf 必须抛出明确的中文错误
  （例：`「PDF 解析暂不可用，请改用 EPUB 或 TXT」`），不要静默返回空书。
  PDF 文本按页取 `page.getTextContent()` 的 items，按 `hasEOL` 合并成行，再按空行/行间距启发式切段。

### 单元测试（`tests/parsers.test.mjs`）

- 用 `fflate.zipSync` 在内存里构造一个最小 epub（含 `mimetype`、`META-INF/container.xml`、OPF、两个 XHTML），断言标题/作者/章节/段落。
- txt / md / html 各断言段落切分与标记清理结果。
- 不支持的扩展名断言抛出错误。
- 用 `node --test tests/parsers.test.mjs` 运行（本机 Node 22 上 `node --test tests/` 的目录形式会失败）；DOMParser 用 jsdom 提供（参考 `sidebar-appearance/tests/appearance.client.test.mjs` 的全局注入方式）。

---

## 2. 引擎层 `src/lib/engine/**`（负责人: engine）

### 2.1 `src/lib/engine/segment.js`

```js
/**
 * 规范化文本：弯引号→直引号、全角空格→半角、去掉软连字符、压缩空白。
 * @param {string} text
 * @returns {string}
 */
export function normalizeText(text);

/**
 * 切句。需处理句末标点 . ! ? 以及闭引号；需避免在常见缩写（Mr. Dr. e.g. i.e. etc. U.S.）后误切。
 * @param {string} text
 * @returns {string[]} 每个元素是一个句子（含原标点），空白已 trim
 */
export function splitSentences(text);

/**
 * 切词：保留原文片段与规范化形式。
 * @param {string} sentence
 * @returns {Word[]} Word = { text, clean, start, end }
 *   text  = 原文里的片段（可能是 "don't,"）
 *   clean = 去掉首尾标点并小写后的可比形式（"don't"）
 *   start/end = 在传入句子中的字符偏移
 */
export function tokenize(sentence);

/**
 * 把章节展开成逐句单元。
 * @param {Chapter[]} chapters
 * @returns {Unit[]} Unit = {
 *   id: string,            // 稳定唯一 id
 *   chapterIndex: number,
 *   chapterTitle: string,
 *   paragraphIndex: number,
 *   sentenceIndex: number, // 该段内第几句，从 0 开始
 *   text: string,
 *   words: Word[],
 * }
 */
export function buildUnits(chapters);
```

### 2.2 `src/lib/engine/match.js`

```js
/**
 * 打字比对：逐字符判定。
 * @param {string} target - 原句
 * @param {string} typed - 用户已输入
 * @returns {{ chars: { ch: string, ok: boolean }[], typedChars: number, correctChars: number,
 *            accuracy: number, complete: boolean }}
 *   complete = typed 的规范化形式已覆盖 target 的规范化形式
 *   accuracy = correctChars / max(typedChars, 1)，取值 0..1
 */
export function diffTyping(target, typed);

/**
 * 朗读比对：词级对齐。
 * @param {string} target - 原句
 * @param {string} spoken - 识别到（或用户自述）的文本
 * @returns {{ words: { word: string, status: 'ok'|'wrong'|'missing'|'extra' }[],
 *            accuracy: number, missing: number, extra: number, matched: number }}
 *   以 target 的词为基准做编辑距离对齐；target 有而 spoken 缺 → 'missing'；
 *   spoken 多出来的词 → 'extra'（放在末尾）；词形不一致 → 'wrong'。
 *   accuracy = matched / target 词数（0..1）
 */
export function diffWords(target, spoken);

/**
 * 语速。
 * @param {number} chars - 输入字符数
 * @param {number} ms - 耗时毫秒
 * @returns {number} 每分钟词数（按 5 字符≈1 词折算）
 */
export function wordsPerMinute(chars, ms);
```

### 2.3 `src/lib/engine/tts.js`

```js
/**
 * 语音合成控制器。依赖浏览器 Web Speech API，但所有依赖都可注入，便于测试。
 * @param {{ synth?: SpeechSynthesis, getVoices?: () => SpeechSynthesisVoice[] }} [options]
 * @returns {TtsController}
 */
export function createTts(options);
```

`TtsController` 接口：

| 方法 | 说明 |
|---|---|
| `listVoices()` | 返回 `[{ id, name, lang }]`，只保留 `lang` 以 `en` 开头的语音，按 name 排序 |
| `setVoice(id)` / `getVoice()` | 选择语音 |
| `setRate(rate)` / `getRate()` | 语速，0.5–2，默认 1 |
| `speak(text, handlers)` | 朗读一段文本。`handlers = { onWord?(index, charIndex), onEnd?(), onError?(err) }`。`onWord` 依赖 `boundary` 事件；浏览器不触发 boundary 时，必须退化为「按词估算」：至少每 3 个词回调一次，且结束时回调最后一个词。 |
| `speakWord(text)` | 朗读单个词（用于点击单词发音） |
| `cancel()` | 停止朗读 |
| `pause()` / `resume()` | 暂停/继续 |
| `isSpeaking()` | 是否在朗读 |
| `dispose()` | 释放资源 |

硬性要求：
- 合成器对象缺失（没有 `speechSynthesis`）时，所有方法不得抛异常：`listVoices()` 返回 `[]`，`speak()` 立刻调用 `onError(new Error('当前环境不支持语音合成'))`。
- `speak()` 前先 `cancel()`，避免排队堆积。
- `setRate` 要 clamp 到 [0.5, 2]。

### 2.4 `src/lib/engine/sync.js`

```js
/**
 * 打字同步驱动器：让朗读进度跟随打字进度。
 * @param {{ tts: TtsController, gapTolerance?: number, onWordSpoken?: (index: number) => void }} options
 * @returns {SyncDriver}
 */
export function createSyncDriver(options);
```

`SyncDriver` 接口：

| 方法 | 说明 |
|---|---|
| `setWords(words: string[])` | 设置当前句子的词数组（纯文本） |
| `syncTo(index: number)` | 打字进度变化时调用，把播放对齐到第 index 个词（0 基） |
| `stop()` | 停止并复位 |
| `getState()` | 返回 `{ spokenIndex, playing }` |

同步策略（必须按此实现，UI 依赖它）：
- 目标词索引 **落后**于已读词索引（用户打字慢）：**暂停**朗读，等用户追上再 `resume()`。
- 目标词索引 **领先**于已读词索引超过 `gapTolerance`（默认 2）个词：取消当前朗读，从目标词重新开始读。
- 目标词索引领先但未超过容差：不做任何事，让朗读自然跟上。
- 任何时候 `setWords` 被调用都要先 `stop()` 内部状态。

### 2.5 `src/lib/engine/asr.js`

```js
/**
 * 当前环境是否支持语音识别。
 * @returns {boolean}
 */
export function isRecognitionSupported();

/**
 * 语音识别控制器（Web Speech API）。
 * @param {{ lang?: string, onPartial?: (text: string) => void, onFinal?: (text: string) => void,
 *           onError?: (err: Error) => void, onEnd?: () => void, recognitionFactory?: () => any }} [options]
 * @returns {{ start(): void, stop(): void, abort(): void, isRunning(): boolean }}
 */
export function createRecognizer(options);

/**
 * 录音回放兜底（浏览器不支持识别时使用）。
 * @param {{ onStop?: (blob: Blob, url: string) => void, onError?: (err: Error) => void }} [options]
 * @returns {{ start(): Promise<void>, stop(): void, isRecording(): boolean }}
 */
export function createRecorder(options);
```

要求：
- `createRecognizer` 在不支持时 `start()` 不抛异常，而是调用 `onError(new Error('当前环境不支持语音识别'))`。
- 识别结果要 `onPartial` 实时反馈，`onFinal` 给最终文本（多次 final 结果要拼接）。
- `createRecorder` 用 `MediaRecorder`；不支持时 `start()` reject 一个中文错误。

### 2.6 引擎层单元测试（`tests/engine.test.mjs`）

- `segment.js`：`splitSentences` 对缩写、`"Mr. Smith said."`、引号结尾；`tokenize` 的 start/end 偏移必须能在原句里还原出 `text`。
- `match.js`：`diffTyping` 完全正确 / 部分错误 / 多打；`diffWords` 缺词、多词、错词三种情况；`wordsPerMinute` 的数值。
- `tts.js`：注入一个假的 `synth`（记录 speak/cancel/pause/resume 调用），断言 `speak` 会 cancel 上一次、rate clamp、缺 boundary 事件时仍有 `onWord` 回调。
- `sync.js`：注入假 tts，断言「用户落后→pause」「用户领先超容差→cancel 并从目标词重读」。
- `asr.js`：注入假的 recognition 对象，断言 partial/final 回调与错误分支。

---

## 3. 共享层（负责人: lead，不属于上面两组的写作用域）

- `src/client-entry.js` — 插件入口：注册 `sidebar.panellist` 与 `main` 两个 slot。
- `src/ui/**` — 页面与组件。
- `src/lib/store.js` — IndexedDB 书籍仓库。
- `src/lib/chunks.js` — `loadChunk(path)` 懒加载 chunk。

`src/lib/chunks.js` 已提供：

```js
/**
 * 懒加载一个 chunk；加载失败要 reject，不能永久挂起。
 * @param {string} path - 相对模块的 chunk 路径，如 './client.pdf.js'
 * @param {number} [timeoutMs]
 * @returns {Promise<any>}
 */
export async function loadChunk(path, timeoutMs = 20000);
```

---

## 4. 硬性工程约束

1. 纯 ESM，`.js` 扩展名，`"type": "module"`。不要引入 TypeScript、JSX 语法（用 `React.createElement`）。
2. 引擎层不得依赖 React；解析层不得依赖 React。两者都不得依赖 `src/ui/**`。
3. 不得 `import` 任何 `@deepseek-ai/dsh-*` 包（插件不得加载 Harness Client 包）。
4. 浏览器 API 在 Node 测试里不存在，必须允许注入或做能力检测，测试用假实现。
5. 所有面向用户的报错文案用中文。
6. 不要修改不属于自己写作用域的文件；需要新增文件时只在自己目录下新增。
