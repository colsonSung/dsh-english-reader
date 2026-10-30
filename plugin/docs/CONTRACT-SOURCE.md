# reader — 数据源文件契约 (Source File Contract)

版本: 1.0 · 状态: 已冻结（宿主半边与客户端半边都必须严格遵守）

## 0. 为什么要有这份契约

书库里存的是**解析后的正文**（章节、段落、句子）。那是给精读用的。

但学习者导入的那本电子书本身——那个 EPUB、那个 PDF——也是他的东西：

- 他要能**看**到原文件长什么样（PDF 的排版、EPUB 的插图、原始的段落）；
- 他要能**下载**它，带走一份属于自己的副本。

原文只在导入那一刻在浏览器手里，解析完就丢了。所以宿主把**原始字节**也存下来，
和书库放在一起，书就永远带着它的源文件。

契约的目标：**源文件由宿主持有并落盘，浏览器只是一块显示屏**。
换应用、换浏览器、换端口、重启、刷新，源文件都在。

---

## 1. 术语

| 词 | 含义 |
|---|---|
| 源文件 | 导入时那个文件本身（EPUB / PDF / TXT / MD / HTML 的字节） |
| 书记录 | `books/<bookId>.json` 里那条记录，字段形状见 `CONTRACT-SHELF.md` 第 2.4 节 |

---

## 2. 传输层

源文件走**独立的路由**，不走 `/api/reader` 的 JSON 信封：

```
GET  /api/reader/source?id=<bookId>[&download=1]
POST /api/reader/source?id=<bookId>&name=<>&type=<>&format=<>
```

**为什么单独一条路由**：一本书可能几十兆。base64 塞进 JSON 会白白胀大三分之一，
而且 JSON 解析要先把这个字符串读进内存。请求体是文件、响应体也是文件，两头都不绕路。

**元数据走查询串，不走请求头**：请求头只能放 ASCII，文件名里却常有中文。

### 2.1 上传（POST）

| 位置 | 含义 |
|---|---|
| 查询 `id` | 这份文件属于哪本书（必需） |
| 查询 `name` | 原始文件名（URL 编码） |
| 查询 `type` | MIME 类型 |
| 查询 `format` | `epub` / `pdf` / `txt` / `md` / `html` |
| 请求体 | 文件的原始字节 |

成功：

```json
{ "ok": true, "result": { "fileName": "…", "format": "epub",
                          "contentType": "application/epub+zip",
                          "size": 123456, "storedAt": 1750000000000 } }
```

失败沿用统一信封（`{ "ok": false, "error": { code, message, details } }`）：

| 情况 | HTTP | code |
|---|---|---|
| 没有 `id` | 400 | `reader/source-bad-request` |
| 请求体是空的 | 400 | `reader/source-empty` |
| 写盘失败 | 500 | `reader/source-failed` |

### 2.2 取回（GET）

成功时**直接返回文件字节**，响应头：

| 头 | 内容 |
|---|---|
| `content-type` | 源文件的 MIME 类型（没有就 `application/octet-stream`） |
| `content-length` | 字节数 |
| `content-disposition` | `inline` 或 `attachment`（`download=1` 时），带一个纯 ASCII 文件名 |
| `x-reader-file-name` | URL 编码的**原始文件名**（客户端自己解码并用它命名下载） |

没有源文件时：HTTP 404，`reader/source-missing`。

---

## 3. 宿主侧存储布局

```
<profileDir>/reader/
├── books/
│   └── <bookId>.json              一本书一条记录
├── sources/
│   └── <bookId>.<format>          一本书的原始文件（字节）
├── vocabulary.json
├── notes.json
└── podcasts.json
```

- 源文件按**格式**命名（`<bookId>.epub`），原始文件名记在书记录的 `source` 字段里。
- 写入**必须原子**：先写 `<file>.tmp`，再 `rename` 覆盖。
- 一本书只保留一个源文件：换了格式写入时，旧的源文件被删掉。
- **删书会连源文件一起删**：书没了，文件也不该留在磁盘上。

---

## 4. 书记录的 `source` 字段

书记录多一个**可选**字段：

```js
source: {
  fileName: string,     // 导入时的原始文件名
  format: string,       // epub | pdf | txt | md | html
  contentType: string,  // MIME 类型
  size: number,         // 字节数
  storedAt: number,     // 宿主写入的时间
}
```

两条规矩：

1. **宿主写入 `source`**：源文件保存成功后，宿主把元数据合并进那本书的记录。
2. **宿主不丢 `source`**：客户端把整条记录写回来时（改名、换封面），那条记录里
   往往没有 `source` 字段——它是在源文件保存之前读到的。此时**磁盘上已有的
   `source` 保留下来**，不被这次写入抹掉。

没有 `source` 字段的书 = 这本书没有源文件（导入时没存住，或者是很久以前导入的）。
界面上要把这两件事说清楚，不要假装每本书都能下载。

---

## 5. 宿主侧模块 `src/host/shelf.js`

在 `CONTRACT-SHELF.md` 第 4 节的 `Shelf` 接口上增加三个方法（全部 async）：

| 方法 | 说明 |
|---|---|
| `putSource(id, { fileName, format, contentType, bytes })` | 写入源文件（原子写），把元数据合并进书记录，返回元数据；没有字节时返回 `undefined` |
| `getSourceMeta(id)` | 只读元数据；没有源文件时返回 `undefined`，**不抛异常** |
| `getSource(id)` | 返回 `{ meta, bytes }`；没有时返回 `undefined`，**不抛异常** |

`deleteBook(id)` 的语义变了：**连源文件一起删**。

`format` 会被规范化：小写，只保留 `[a-z0-9]`，其余换成 `_`；空格式退回 `bin`。

**没有源文件时返回 `undefined`，不是 `null`**：这跟书库里 `getBook` 找不到书时
返回 `undefined` 是同一个规矩，全库一个口径。宿主路由判断时用 `=== undefined`。

---

## 6. 宿主侧路由接线 `index.js`

- 新增常量 `SOURCE_ROUTE = '/api/reader/source'`。
- 在 `connection.fetch` 上注册一条路由，`methods: ['GET', 'POST']`，
  `requestBody: 'buffered'`（要读整个请求体）。
- 路由注册失败只打一行警告，不影响其它路由（和现有路由一个脾气）。

---

## 7. 客户端侧 `src/lib/source-file.js`

```js
export const SOURCE_ROUTE = '/api/reader/source';

export async function fetchSourceFile(bookId, options = {}):
  Promise<{ bytes: Uint8Array, fileName: string, contentType: string }>

export async function uploadSourceFile(bookId, file, options = {}):
  Promise<SourceMeta | null>

export async function downloadSourceFile(bookId, options = {}): Promise<string>

export function formatBytes(size): string
```

- `options.fetch` 可以注入，测试用它代替真实的 `fetch`。
- 面向用户的报错文案用中文：
  - 连不上宿主 → 「无法连接宿主服务，源文件暂时不可用」
  - 宿主说没有源文件 → 「这本书没有保留源文件」
- `downloadSourceFile` 走「取回字节 → `Blob` → `object URL` → 点一个带 `download`
  属性的链接」这条路：链接的 `download` 属性会盖掉响应头里的文件名，所以文件名
  必须跟着这一次点击走。

---

## 8. 界面

书库（Library）里每本书的「⋯」菜单多两项：

| 菜单项 | 行为 |
|---|---|
| 查看源文件 | 打开预览浮层：PDF 用 pdf.js 渲染页面，EPUB 按 spine 顺序渲染原始章节，纯文本显示原文，HTML 在沙箱 iframe 里显示 |
| 下载源文件 | 把原始字节下载下来，文件名就是导入时的那个名字 |

**没有源文件的书**（书记录里没有 `source` 字段）：这两项不可用，并且说清楚原因，
而不是点下去才报错。

---

## 9. 硬性约束

1. 纯 ESM，`.js` 扩展名，`"type": "module"`。
2. 客户端半边**不得** import `node:fs` 或任何 `@deepseek-ai/dsh-*` 包。
3. 宿主半边**不得** import `src/ui/**` 与 `src/lib/**`。
4. 面向用户的报错文案用中文。
5. 上传源文件**不能影响导入本身**：源文件存不住时，书照样入库，只是这本书没有源文件。
6. 宿主半边的改动需要**重启 Harness 应用**才生效；客户端半边需要 `node build.mjs`
   之后 **⌘R 刷新**。
