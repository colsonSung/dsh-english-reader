# 引擎层（src/lib/engine）

逐句精读引擎的纯逻辑层：切句切词、逐字/词级比对、语音合成、朗读同步、语音识别。
不依赖 React、不依赖 DOM（除 `setTimeout`），所有浏览器能力均可注入，因此能在 Node 里完整单测。

## 模块与 API

### segment.js

```js
normalizeText(text) → string
splitSentences(text) → string[]      // 含原标点，已 trim
tokenize(sentence) → Word[]          // { text, clean, start, end }
buildUnits(chapters) → Unit[]         // { id, chapterIndex, chapterTitle, paragraphIndex, sentenceIndex, text, words }
```

- `tokenize` 偏移保证 `sentence.slice(w.start, w.end) === w.text`。
- `clean` = 去掉首尾标点 + 小写 + 弯撇号转直撇号（`don't` / `don't`）。
- `buildUnits` 先对每个段落做 `normalizeText` 再切句，因此 unit.text 是干净的单行句子。
- 缩写不误切：`Mr. Dr. e.g. i.e. etc. U.S. Prof. Lt. Jan.` 等；点分缩写（`U.S.` `Ph.D.`）与序数词（`3rd.`）也覆盖。
- 列表编号（行首的 `1.` `2.`）不切句；句中的 `1990.` 会正常切句。
- 句尾闭引号/括号并入本句：`"Mr. Smith said."` 是完整一句。

### match.js

```js
diffTyping(target, typed) → { chars, typedChars, correctChars, accuracy, complete }
diffWords(target, spoken) → { words, accuracy, missing, extra, matched }
wordsPerMinute(chars, ms) → number    // 5 字符 ≈ 1 词
```

**`diffTyping` 的 chars 是「逐 target 字符」的对齐**（长度 = target 长度），`ok` 表示该字符是否已被正确键入。
用户多打的字符不在 `chars` 里，但计入 `typedChars`，因此会拉低 `accuracy`。
比较大小写不敏感，标点敏感（打字模式要求逐字对上）。
`chars` 的索引基准是 **UTF-16 码元**，与 `tokenize()` 的 `word.start` / `word.end` 偏移严格一致，
所以 UI 可以直接写 `diff.chars[word.start]` 判断某个词打对了没有。
`complete` 用词粒度判定：typed 的词序列必须逐词覆盖 target 的词序列（标点、末尾标点差异不影响）。

**`diffWords`** 以 target 的词为基准做 Levenshtein 对齐，输出 `ok / wrong / missing / extra`；
`extra` 的词统一放在数组末尾；`accuracy = matched / target 词数`（`wrong` 不计入 matched）。

### tts.js

```js
createTts({ synth?, getVoices?, utteranceFactory?, estimateMsPerWord? }) → TtsController
```

- `speak(text, { onWord(index, charIndex), onEnd(), onError(err) })`：先 `cancel()` 再排队。
- `onWord` 优先用 `boundary` 事件的 `charIndex` 定位词；浏览器不派发 boundary 时退化为按词估算
  （默认 400ms/词，按 `rate` 等比缩放），估算链在词表耗尽后自动停止，不会挂住事件循环。
- 朗读结束时若最后一个词还没回调过，会补一次 `onWord`。
- 无 `speechSynthesis` 时所有方法不抛异常：`listVoices()` 返回 `[]`，`speak()` 走 `onError(new Error('当前环境不支持语音合成'))`。
- `setRate` clamp 到 [0.5, 2]；`getVoice()` 返回 `{ id, name, lang }`。
- 每次 `speak()` 分配新的会话令牌，`cancel()` 后旧 utterance 的 `onend/onboundary` 不再影响状态。

### sync.js

```js
createSyncDriver({ tts, gapTolerance = 2, onWordSpoken }) → { setWords, syncTo, stop, getState }
```

同步策略见下方「同步策略落地」。

### asr.js

```js
isRecognitionSupported() → boolean
createRecognizer({ lang?, onPartial?, onFinal?, onError?, onEnd?, recognitionFactory? })
  → { start, stop, abort, isRunning }
createRecorder({ onStop?, onError?, mediaRecorderFactory?, getUserMedia?, createObjectURL? })
  → { start(): Promise<void>, stop, isRecording }
```

- `onPartial` 给当前这一段的实时文本；`onFinal` 给**本次新定稿的片段**（多次 final 由调用方拼接，
  与 UI 的追加式消费一致）；需要累计全文用 `recognizer.getTranscript()`。
- 不支持识别时 `start()` 不抛异常，走 `onError(new Error('当前环境不支持语音识别'))`。
- `createRecorder` 不支持时 `start()` reject 中文错误；`getUserMedia` 失败也 reject 中文错误。

## 三种模式怎么接

**听（listen）**：`createTts()` → `speak(unit.text, { onWord: (i) => highlight(unit.words[i]) })`。

**打字（typing）**：`createSyncDriver({ tts, onWordSpoken: (i) => highlight(unit.words[i]) })`。
UI 在句子进入时 `setWords(unit.words.map(w => w.text))`，用户每敲完一个词调用 `syncTo(当前词下标)`。
打分用 `diffTyping(unit.text, 用户输入)`。

**朗读（read aloud）**：`createRecognizer({ onPartial, onFinal })` 收集识别文本，
结束后用 `diffWords(unit.text, 识别文本)` 标注漏读/误读；浏览器不支持识别时用 `createRecorder()` 兜底录音。

## 同步策略落地（sync.js）

状态：`spokenIndex`（已读到的词下标）、`playing`、`paused`、`baseIndex`（当前朗读片段在整句中的起点）。

`syncTo(target)`：

| 情况 | 行为 |
|---|---|
| 还没在朗读（`spokenIndex === -1` 或 target 超过已读位置） | 从 target 词开始朗读 |
| target < spokenIndex（用户打字慢） | `tts.pause()`，进入 paused |
| target - spokenIndex > gapTolerance | `tts.cancel()` 后从 target 词重读 |
| target - spokenIndex 在 (0, gapTolerance] 内 | 什么都不做 |
| paused 且 target >= spokenIndex（用户追上了） | `tts.resume()` |

边界处理：

- **用户中途删字回退**：target 变小 → delta < 0 → 暂停，等用户重新打上来再 resume。
- **句末换句**：`setWords()` 会先 `stop()`（cancel + 复位 `spokenIndex = -1`），旧会话令牌失效，
  旧 utterance 的 `onEnd` 回调不会再污染新句状态。
- **语音被取消**：`cancel()` 让旧回调全部失效（会话令牌比对），因此「cancel 后浏览器迟到的 onend」
  不会把 `playing` 误置回 true。
- **暂停后用户不再打字**：朗读会一直停在暂停态，等下一次 `syncTo` 追上才恢复（契约行为，未加自动超时恢复）。
- **重读片段的词下标**：重读时把 `baseIndex` 设为目标词，`onWord` 的相对下标加上 `baseIndex` 得到整句绝对下标。

## 与契约的差异（均为向后兼容的扩展，不改变契约签名）

1. `createTts` 多接受 `utteranceFactory` / `estimateMsPerWord` 两个可选项；多暴露 `isPaused()`。
2. `createRecorder` 多接受 `mediaRecorderFactory` / `getUserMedia` / `createObjectURL` 三个注入项
   （否则 Node 里无法测 MediaRecorder）。
3. `sync.getState()` 在契约要求的 `{ spokenIndex, playing }` 之外多返回一个 `paused` 字段。
4. `buildUnits` 会对段落先做 `normalizeText`（契约未明说），这样 unit.text 一定是干净的单行句子。
