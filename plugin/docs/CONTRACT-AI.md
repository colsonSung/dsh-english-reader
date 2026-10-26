# english-reader — 第二轮契约（TingYue 对标：词典+AI / 生词本 / 进度 / 计划）

版本: 2.0 · 状态: 已冻结

目标：把 TingYue（听阅）的核心学习闭环补齐——**点词查词（AI 释义）→ 收藏进生词本 → 词汇进度 → 复习队列**，外加 **符号替换** 与 **完形填空** 两个练习增强。

数据流：

```
点词 ──► WordCard（src/ui/wordcard.js）──► askAi('word')  ──► Host /api/english-reader ──► ctx.llm
   │                                                      └─► 本地词典兜底（无 AI 时）
   └──► 生词本（src/lib/vocab.js）──► IndexedDB ──► 进度 / 复习队列
```

---

## 1. Host 半边（负责人: ai）

### 1.1 路由

`index.js` 里按 remote-control 的写法注册（**不要自己发明模式**）：

```js
ctx.inject(['connection'], (connectionCtx) => {
  connectionCtx.effect(() => {
    try {
      return connectionCtx.connection.fetch.register({
        path: '/api/english-reader',
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          let body
          try { body = await request.json() } catch {
            return Response.json({ ok: false, error: { code: 'english-reader/bad-request', message: 'body is not JSON', details: {} } }, { status: 400 })
          }
          const method = typeof body?.method === 'string' ? body.method : ''
          try {
            return Response.json({ ok: true, result: await handle(method, body?.payload ?? {}) })
          } catch (error) {
            return Response.json({ ok: false, error: { code: 'english-reader/failed', message: String(error?.message ?? error), details: {} } }, { status: 200 })
          }
        },
      })
    } catch (error) {
      // 重复 apply（热重载）时路由已存在，记日志后返回，不让插件整体失败
      console.warn('[english-reader] route registration failed: ' + String(error))
      return () => {}
    }
  }, 'english-reader: /api/english-reader')
})
```

### 1.2 模型调用

用宿主现成的 `llm` 服务（不要自己发 HTTP 到模型厂商）：

- `ctx.agentDefaultModel.currentSelection()` → `{ provider, model, ... }`
- `ctx.llm.prepareCall({ provider, model })` → `prepared`
- `prepared.stream({ provider, model, messages, system, temperature, maxTokens, signal })` → 异步可迭代
  流里的 `text-delta` 块的 `text` 拼起来就是完整回复；`finish` 块表示结束。

要点：
- **必须要求模型只输出 JSON**（system 提示里写死 schema），然后 `JSON.parse`；解析失败要重试一次（放宽提示）仍失败则抛错。
- 温度 0.2 左右，maxTokens 800–1200。
- `ctx.get('llm')` 可能不存在（没有模型配置）→ 返回一个可读的中文错误，例如「宿主未配置可用模型，AI 释义不可用」。
- 单次调用整体要有超时（30s），超时抛错。

### 1.3 `src/host/ai.js`

```js
/**
 * 执行一次 AI 辅助请求。
 * @param {string} method - 'word' | 'translate' | 'breakdown' | 'mindmap' | 'podcast'
 * @param {object} payload
 * @returns {Promise<object>}
 */
export async function runAiMethod(method, payload);
```

五个方法的返回结构（**客户端按这些字段渲染，不得再改**）：

```js
// method: 'word'   payload: { word: string, sentence?: string }
// → {
//   word: string,
//   phonetic: string,        // 例：/ˈmɪdɪəl/
//   partOfSpeech: string,    // 例：adjective
//   definition: string,      // 中文释义，一句话
//   examples: [{ en: string, zh: string }],   // 1–3 条
//   contextNote: string,     // 这个词在当前句子里怎么理解；没有句子时给用法说明
// }

// method: 'translate'   payload: { text: string }
// → { text: string }        // 整段中文翻译

// method: 'breakdown'   payload: { sentence: string }
// → {
//   structure: [{ token: string, note: string }],  // 长难句成分拆解
//   translation: string,                            // 中文翻译
//   simplified: string,                            // 改成简单句的说法
// }

// method: 'mindmap'   payload: { title: string, chapterTitle: string, text: string }
// → {
//   title: string,                                 // 中心主题
//   branches: [{
//     label: string,                               // 分支标题
//     quote: string,                               // 原文里代表这个分支的一句英文
//     items: [{ label: string, note: string, quote: string }],
//   }],
// }                        // 一层分支，每支 2–4 个要点；quote 是原文短句，客户端靠它在书里定位

// method: 'podcast'   payload: { title: string, chapterTitle: string, scope: 'chapter' | 'book', text: string }
// → {
//   title: string,                                 // 本期标题
//   summary: string,                               // 一句话导语
//   dialogue: [{ speaker: 'host' | 'guest', text: string }],
// }                                                // 英文双人对话，按顺序念

// method: 'podcastReply'   payload: { title: string, chapterTitle: string, text: string, said: string }
// → {
//   lines: [{ speaker: 'host' | 'guest', text: string }],
// }                        // 学员插话后主持人的回应，节目从这儿继续
```

---

## 2. 客户端 AI 通道（负责人: ai）

`src/lib/ai.js`：

```js
/**
 * 调用宿主的 AI 辅助接口。
 * @param {'word'|'translate'|'breakdown'|'mindmap'|'podcast'} method
 * @param {object} payload
 * @returns {Promise<object>} 与 1.3 的返回结构一致
 */
export async function askAi(method, payload);
```

- `fetch('/api/english-reader', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, payload }) })`
- 解析 `{ ok, result }`；`ok === false` 时抛出带中文文案的 Error。
- 网络失败同样抛中文 Error（例如「无法连接宿主服务」）。

---

## 3. 生词本数据层（负责人: vocab）

存储：与现有书籍同一个 IndexedDB（库名 `english-reader`），新增 object store `vocabulary`。
**数据库版本由 lead 统一升到 2 并在 `src/lib/store.js` 里建表**；vocab.js 直接复用 lead 提供的存储入口（见下）。

`src/lib/vocab.js`：

```js
/**
 * @typedef {object} VocabEntry
 * @property {string} id            // 规范化后的词（小写），主键
 * @property {string} word          // 原文形态
 * @property {string} bookId
 * @property {string} bookTitle
 * @property {string} sentence      // 收藏时的原句
 * @property {number} addedAt
 * @property {'learning'|'known'} state
 * @property {number} reviewCount
 * @property {number} lastReviewedAt
 * @property {number} nextReviewAt
 * @property {string} phonetic
 * @property {string} definition
 */

export async function listEntries();          // VocabEntry[]
export async function addEntry(entry);        // 幂等 upsert，返回最终条目
export async function removeEntry(id);         // void
export async function updateEntry(id, patch);  // 返回更新后的条目
export async function dueEntries(now = Date.now());  // nextReviewAt <= now
export function summarize(entries, now = Date.now());
// → { total, known, learning, toLearn, addedToday }
export function scheduleNext(entry, now = Date.now());  // 下次复习时间戳
```

规则：
- `id` = 词的小写形式（去掉首尾标点）。
- `addEntry` 幂等：已存在时只补 `phonetic`/`definition`（若原来为空），不重置 `addedAt`/`state`/`reviewCount`。
- `scheduleNext`：间隔重复 —— 复习次数 0→1 天，1→2 天，2→4 天，3→7 天，4→15 天，之后 30 天。
- `summarize`：`known` = state==='known'；`learning` = state==='learning' 且复习次数 ≥ 1；`toLearn` = 其余；`addedToday` = addedAt 在今天内。

---

## 4. UI（负责人: lead）

- `src/ui/wordcard.js`：点词弹出的词卡。
- `src/ui/wordlist.js`：生词本面板（负责人: vocab）。
- reader.js 里点词 = 打开词卡（现在只是朗读发音）。

---

## 5. 硬性约束

1. 纯 ESM、`.js`、无 JSX（用 `React.createElement`）。
2. 不加载任何 `@deepseek-ai/dsh-*` 客户端包。
3. 引擎层/解析层不依赖 React；生词本数据层不依赖 React。
4. 面向用户的文案用中文；AI 相关失败必须给出可读中文提示，不能抛原始英文堆栈。
5. 不得修改不属于自己写作用域的文件。
6. 测试用 `node --test tests/xxx.test.mjs`（本机 `node --test tests/` 目录形式会失败）。
