/**
 * 引擎层单元测试。
 *
 * 覆盖：
 *   - segment.js：缩写切句、引号结尾、tokenize 偏移还原
 *   - match.js：diffTyping（正确 / 部分错 / 多打）、diffWords（缺词 / 多词 / 错词）、wordsPerMinute
 *   - tts.js：注入假 synth，断言 speak 会 cancel、rate clamp、缺 boundary 仍有 onWord 回调
 *   - sync.js：注入假 tts，断言「落后→pause」「领先超容差→cancel 并从目标词重读」
 *   - asr.js：注入假 recognition，断言 partial / final / 错误分支
 *
 * 运行：node --test tests/engine.test.mjs
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildUnits,
  normalizeText,
  splitSentences,
  tokenize,
} from '../src/lib/engine/segment.js';
import { diffTyping, diffWords, wordsPerMinute } from '../src/lib/engine/match.js';
import { createTts } from '../src/lib/engine/tts.js';
import { createSyncDriver } from '../src/lib/engine/sync.js';
import {
  createRecorder,
  createRecognizer,
  isRecognitionSupported,
} from '../src/lib/engine/asr.js';

/** 等待若干毫秒（用于估算型回调）。 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 记录调用的假 speechSynthesis。 */
function createFakeSynth(voices = []) {
  return {
    spoken: [],
    cancelled: 0,
    paused: 0,
    resumed: 0,
    getVoices: () => voices,
    speak(utterance) {
      this.spoken.push(utterance);
    },
    cancel() {
      this.cancelled += 1;
    },
    pause() {
      this.paused += 1;
    },
    resume() {
      this.resumed += 1;
    },
  };
}

/** 记录调用的假 tts 控制器。 */
function createFakeTts() {
  return {
    spoken: [],
    cancelled: 0,
    paused: 0,
    resumed: 0,
    speak(text, handlers) {
      this.spoken.push({ text, handlers: handlers || {} });
    },
    cancel() {
      this.cancelled += 1;
    },
    pause() {
      this.paused += 1;
    },
    resume() {
      this.resumed += 1;
    },
  };
}

// ---------------------------------------------------------------- segment.js

test('segment: normalizeText 归一化弯引号、全角空格、软连字符并压缩空白', () => {
  assert.equal(normalizeText('“Hello”  world'), '"Hello" world');
  assert.equal(normalizeText('a　b'), 'a b');
  assert.equal(normalizeText('soft­hyphen'), 'softhyphen');
  assert.equal(normalizeText('  many   spaces \n\n here  '), 'many spaces here');
  assert.equal(normalizeText(''), '');
  assert.equal(normalizeText(null), '');
});

test('segment: splitSentences 不在常见缩写后误切', () => {
  assert.deepEqual(
    splitSentences('Mr. Smith went home. Dr. Jones stayed.'),
    ['Mr. Smith went home.', 'Dr. Jones stayed.']
  );
  assert.deepEqual(
    splitSentences('He said e.g. this is fine. Then he left.'),
    ['He said e.g. this is fine.', 'Then he left.']
  );
  assert.deepEqual(
    splitSentences('We use apples, i.e. red ones. Then we stop.'),
    ['We use apples, i.e. red ones.', 'Then we stop.']
  );
  // 契约明确要求 etc. 之后不切句（宁可漏切也不误切）
  assert.deepEqual(
    splitSentences('Bring pens, pencils, etc. Then leave.'),
    ['Bring pens, pencils, etc. Then leave.']
  );
  assert.deepEqual(
    splitSentences('The U.S. economy grew. It slowed later.'),
    ['The U.S. economy grew.', 'It slowed later.']
  );
  assert.deepEqual(
    splitSentences('She asked Prof. Lee and Prof. Wu. They agreed.'),
    ['She asked Prof. Lee and Prof. Wu.', 'They agreed.']
  );
});

test('segment: splitSentences 处理引号结尾与感叹疑问', () => {
  assert.deepEqual(splitSentences('"Mr. Smith said." He left.'), ['"Mr. Smith said."', 'He left.']);
  assert.deepEqual(splitSentences('He whispered "I am here." Then silence.'), [
    'He whispered "I am here."',
    'Then silence.',
  ]);
  assert.deepEqual(splitSentences('Is it ready? Yes! No.'), ['Is it ready?', 'Yes!', 'No.']);
  assert.deepEqual(splitSentences('Really?! Okay.'), ['Really?!', 'Okay.']);
});

test('segment: splitSentences 不切断小数与列表编号', () => {
  assert.deepEqual(splitSentences('Pi is 3.14 exactly. Nice.'), ['Pi is 3.14 exactly.', 'Nice.']);
  assert.deepEqual(
    splitSentences('1. First item\n2. Second item'),
    ['1. First item\n2. Second item']
  );
});

test('segment: tokenize 的 start/end 偏移能原样还原 text', () => {
  const sentence = "He said, don't go. It's 3 o'clock!";
  const words = tokenize(sentence);
  assert.ok(words.length > 0);
  for (const word of words) {
    assert.equal(sentence.slice(word.start, word.end), word.text);
  }
  assert.deepEqual(
    words.map((w) => w.text),
    ['He', 'said,', "don't", 'go.', "It's", '3', "o'clock!"]
  );
  assert.deepEqual(
    words.map((w) => w.clean),
    ['he', 'said', "don't", 'go', "it's", '3', "o'clock"]
  );
  assert.deepEqual(
    words.map((w) => w.start),
    [0, 3, 9, 15, 19, 24, 26]
  );
});

test('segment: tokenize 偏移在纯文本与首尾标点上同样成立', () => {
  for (const sentence of ['Hello world.', '"Quoted!" said she.', 'A, B; C: D.']) {
    for (const word of tokenize(sentence)) {
      assert.equal(sentence.slice(word.start, word.end), word.text);
    }
  }
});

test('segment: buildUnits 展开成逐句单元', () => {
  const units = buildUnits([
    { title: 'Chapter One', paragraphs: ['Mr. Smith went home. He slept.', ''] },
    { title: 'Chapter Two', paragraphs: ['She left.'] },
  ]);
  assert.equal(units.length, 3);
  assert.deepEqual(
    units.map((u) => u.id),
    ['c0-p0-s0', 'c0-p0-s1', 'c1-p0-s0']
  );
  assert.equal(units[0].chapterIndex, 0);
  assert.equal(units[0].chapterTitle, 'Chapter One');
  assert.equal(units[0].paragraphIndex, 0);
  assert.equal(units[0].sentenceIndex, 0);
  assert.equal(units[1].sentenceIndex, 1);
  assert.equal(units[0].text, 'Mr. Smith went home.');
  assert.ok(units[0].words.length > 0);
  assert.equal(units[0].words[0].text, 'Mr.');
  assert.deepEqual(buildUnits([]), []);
  assert.deepEqual(buildUnits(undefined), []);
});

// ------------------------------------------------------------------ match.js

test('match: diffTyping 完全正确', () => {
  const result = diffTyping('Hello world.', 'Hello world.');
  assert.equal(result.typedChars, 12);
  assert.equal(result.correctChars, 12);
  assert.equal(result.accuracy, 1);
  assert.equal(result.complete, true);
  assert.equal(result.chars.length, 12);
  assert.ok(result.chars.every((c) => c.ok));
});

test('match: diffTyping 部分错误', () => {
  const result = diffTyping('Hello world.', 'Hello wrld.');
  assert.equal(result.typedChars, 11);
  assert.equal(result.chars.length, 12);
  assert.ok(result.chars.slice(0, 6).every((c) => c.ok));
  assert.ok(result.chars.slice(6).some((c) => !c.ok));
  assert.ok(result.correctChars < 12);
  assert.ok(result.accuracy > 0 && result.accuracy < 1);
  assert.equal(result.complete, false);
});

test('match: diffTyping 多打', () => {
  const result = diffTyping('Hello.', 'Hello world!!');
  assert.equal(result.typedChars, 13);
  assert.equal(result.chars.length, 6);
  assert.equal(result.correctChars, 5);
  assert.ok(result.accuracy < 1);
  assert.equal(result.complete, true);
});

test('match: diffTyping 空输入不抛异常', () => {
  const empty = diffTyping('Hello', '');
  assert.equal(empty.typedChars, 0);
  assert.equal(empty.correctChars, 0);
  assert.equal(empty.accuracy, 0);
  assert.equal(empty.complete, false);
  const done = diffTyping('Hello', 'Hello');
  assert.equal(done.complete, true);
});

test('match: diffTyping 的 chars 与 tokenize 的偏移严格对齐（UI 直接按偏移索引）', () => {
  const target = "He said, don't go. It's 3 o'clock!";
  const typed = "He said, don't go. It's 3 o'clo";
  const result = diffTyping(target, typed);
  assert.equal(result.chars.length, target.length, 'chars 长度必须等于 target 长度');
  for (let i = 0; i < target.length; i += 1) {
    assert.equal(result.chars[i].ch, target[i], `chars[${i}] 必须对应 target[${i}]`);
  }
  assert.equal(result.typedChars, typed.length);
  // 每个词的正确性都能通过 word.start / word.end 取到
  for (const word of tokenize(target)) {
    const slice = result.chars.slice(word.start, Math.min(word.end, result.typedChars));
    assert.ok(slice.length > 0);
    assert.ok(slice.every((c) => c.ok), `词 "${word.text}" 应当全部正确`);
  }
});

test('match: diffWords 缺词', () => {
  const result = diffWords('the quick brown fox', 'the quick fox');
  assert.equal(result.missing, 1);
  assert.equal(result.extra, 0);
  assert.equal(result.matched, 3);
  assert.deepEqual(
    result.words.map((w) => w.status),
    ['ok', 'ok', 'missing', 'ok']
  );
  assert.equal(result.words[2].word, 'brown');
  assert.ok(Math.abs(result.accuracy - 0.75) < 1e-9);
});

test('match: diffWords 多词', () => {
  const result = diffWords('the quick fox', 'the quick brown fox');
  assert.equal(result.extra, 1);
  assert.equal(result.missing, 0);
  assert.equal(result.matched, 3);
  assert.equal(result.words[result.words.length - 1].status, 'extra');
  assert.equal(result.words[result.words.length - 1].word, 'brown');
  assert.equal(result.accuracy, 1);
});

test('match: diffWords 错词', () => {
  const result = diffWords('the quick fox', 'the quick box');
  assert.equal(result.matched, 2);
  assert.equal(result.missing, 0);
  assert.equal(result.extra, 0);
  assert.deepEqual(
    result.words.map((w) => w.status),
    ['ok', 'ok', 'wrong']
  );
  assert.equal(result.words[2].word, 'fox');
  assert.ok(Math.abs(result.accuracy - 2 / 3) < 1e-9);
});

test('match: diffWords 忽略大小写与标点', () => {
  const result = diffWords('The Quick, Fox!', 'the quick fox');
  assert.equal(result.matched, 3);
  assert.equal(result.missing, 0);
  assert.equal(result.extra, 0);
});

test('match: wordsPerMinute 数值', () => {
  // 5 字符 ≈ 1 词：300 字符 / 1 分钟 = 60 词
  assert.equal(wordsPerMinute(300, 60000), 60);
  assert.equal(wordsPerMinute(150, 30000), 60);
  assert.equal(wordsPerMinute(600, 120000), 60);
  assert.equal(wordsPerMinute(300, 30000), 120);
  assert.equal(wordsPerMinute(0, 60000), 0);
  assert.equal(wordsPerMinute(300, 0), 0);
});

// -------------------------------------------------------------------- tts.js

test('tts: 缺语音合成环境时不抛异常，走 onError', () => {
  const tts = createTts({ synth: undefined });
  let error = null;
  assert.doesNotThrow(() => {
    tts.speak('hello', { onError: (err) => { error = err; } });
  });
  assert.ok(error instanceof Error);
  assert.equal(error.message, '当前环境不支持语音合成');
  assert.deepEqual(tts.listVoices(), []);
  assert.equal(tts.isSpeaking(), false);
});

test('tts: speak 会先 cancel 上一次，避免语音堆积', () => {
  const synth = createFakeSynth();
  const tts = createTts({ synth });
  tts.speak('one');
  tts.speak('two');
  assert.equal(synth.cancelled, 2); // 每次 speak 前的 cancel + 无其它来源
  assert.equal(synth.spoken.length, 2);
  assert.equal(synth.spoken[0].text, 'one');
  assert.equal(synth.spoken[1].text, 'two');
});

test('tts: setRate clamp 到 [0.5, 2]', () => {
  const tts = createTts({ synth: createFakeSynth() });
  assert.equal(tts.getRate(), 1);
  assert.equal(tts.setRate(3), 2);
  assert.equal(tts.getRate(), 2);
  assert.equal(tts.setRate(0.1), 0.5);
  assert.equal(tts.getRate(), 0.5);
  assert.equal(tts.setRate(1.5), 1.5);
  assert.equal(tts.getRate(), 1.5);
  const synth = createFakeSynth();
  const tts2 = createTts({ synth });
  tts2.setRate(1.75);
  tts2.speak('hello');
  assert.equal(synth.spoken[0].rate, 1.75);
});

test('tts: listVoices 只保留英文语音并按 name 排序', () => {
  const synth = createFakeSynth([
    { voiceURI: 'z', name: 'Zoe', lang: 'en-US' },
    { voiceURI: 'a', name: 'Alice', lang: 'en-GB' },
    { voiceURI: 'f', name: 'Fang', lang: 'zh-CN' },
    { voiceURI: 'b', name: 'Bob', lang: 'EN-au' },
  ]);
  const tts = createTts({ synth });
  assert.deepEqual(tts.listVoices().map((v) => v.name), ['Alice', 'Bob', 'Zoe']);
  tts.setVoice('z');
  assert.equal(tts.getVoice().id, 'z');
  assert.equal(tts.getVoice().name, 'Zoe');
  tts.speak('hello');
  assert.equal(synth.spoken[0].voice.voiceURI, 'z');
});

test('tts: 缺 boundary 事件时仍有 onWord 回调，且结束时回调最后一个词', async () => {
  const synth = createFakeSynth();
  const tts = createTts({ synth, estimateMsPerWord: 1 });
  const spoken = [];
  let ended = false;
  tts.speak('Hello brave world', {
    onWord: (index) => spoken.push(index),
    onEnd: () => { ended = true; },
  });
  // 触发结束：此时还没有任何 boundary 事件
  synth.spoken[0].onend();
  assert.equal(ended, true);
  assert.ok(spoken.length > 0, '缺 boundary 时必须仍有 onWord 回调');
  assert.equal(spoken[spoken.length - 1], 2, '结束时必须回调最后一个词');
});

test('tts: 缺 boundary 事件时按词估算持续回调', async () => {
  const synth = createFakeSynth();
  const tts = createTts({ synth, estimateMsPerWord: 1 });
  const spoken = [];
  tts.speak('one two three four', { onWord: (index) => spoken.push(index) });
  await sleep(40);
  assert.ok(spoken.length >= 3, `估算回调次数不足：${spoken.length}`);
  assert.deepEqual(spoken.slice(0, 3), [0, 1, 2]);
  tts.cancel();
});

test('tts: 有 boundary 事件时按 boundary 的 charIndex 定位词', () => {
  const synth = createFakeSynth();
  const tts = createTts({ synth, estimateMsPerWord: 10000 });
  const spoken = [];
  tts.speak('Hello brave world', { onWord: (index, charIndex) => spoken.push([index, charIndex]) });
  synth.spoken[0].onboundary({ charIndex: 6 });
  synth.spoken[0].onboundary({ charIndex: 12 });
  assert.deepEqual(spoken, [[1, 6], [2, 12]]);
  tts.cancel();
});

test('tts: pause / resume / cancel / isSpeaking 行为', () => {
  const synth = createFakeSynth();
  const tts = createTts({ synth });
  tts.speak('hello world');
  assert.equal(tts.isSpeaking(), true);
  tts.pause();
  assert.equal(synth.paused, 1);
  assert.equal(tts.isPaused(), true);
  tts.resume();
  assert.equal(synth.resumed, 1);
  assert.equal(tts.isPaused(), false);
  tts.cancel();
  assert.equal(synth.cancelled, 2); // speak 前的 cancel + 显式 cancel
  assert.equal(tts.isSpeaking(), false);
});

test('tts: 旧会话的回调在 cancel 之后不再触发', () => {
  const synth = createFakeSynth();
  const tts = createTts({ synth });
  const spoken = [];
  tts.speak('one', { onWord: (i) => spoken.push(i) });
  const first = synth.spoken[0];
  tts.speak('two');
  first.onend();
  first.onboundary({ charIndex: 0 });
  assert.deepEqual(spoken, []);
});

test('tts: speakWord 朗读单个词', () => {
  const synth = createFakeSynth();
  const tts = createTts({ synth });
  tts.speakWord('hello');
  assert.equal(synth.spoken.length, 1);
  assert.equal(synth.spoken[0].text, 'hello');
});

// ------------------------------------------------------------------- sync.js

test('sync: 用户落后于已读词 → 暂停朗读', () => {
  const tts = createFakeTts();
  const driver = createSyncDriver({ tts, gapTolerance: 2 });
  driver.setWords(['one', 'two', 'three', 'four', 'five', 'six']);
  driver.syncTo(0);
  assert.equal(tts.spoken.length, 1);
  assert.equal(tts.spoken[0].text, 'one two three four five six');
  // 朗读推进到第 3 个词
  tts.spoken[0].handlers.onWord(2);
  assert.equal(driver.getState().spokenIndex, 2);
  // 用户只打到第 1 个词 → 落后 → 暂停
  driver.syncTo(1);
  assert.equal(tts.paused, 1);
  assert.equal(driver.getState().paused, true);
  // 用户追上后恢复
  driver.syncTo(3);
  assert.equal(tts.resumed, 1);
  assert.equal(driver.getState().paused, false);
});

test('sync: 用户领先超容差 → cancel 并从目标词重读', () => {
  const tts = createFakeTts();
  const driver = createSyncDriver({ tts, gapTolerance: 2 });
  driver.setWords(['one', 'two', 'three', 'four', 'five', 'six']);
  driver.syncTo(0);
  tts.spoken[0].handlers.onWord(0);
  assert.equal(driver.getState().spokenIndex, 0);
  const cancelBefore = tts.cancelled;
  driver.syncTo(5); // 领先 5 > 容差 2
  assert.equal(tts.cancelled, cancelBefore + 1, '必须 cancel 当前朗读');
  assert.equal(tts.spoken.length, 2);
  assert.equal(tts.spoken[1].text, 'six', '必须从目标词重新开始读');
  assert.equal(driver.getState().spokenIndex, 5);
});

test('sync: 用户领先但未超容差 → 不做任何事', () => {
  const tts = createFakeTts();
  const driver = createSyncDriver({ tts, gapTolerance: 2 });
  driver.setWords(['one', 'two', 'three', 'four', 'five']);
  driver.syncTo(0);
  tts.spoken[0].handlers.onWord(0);
  const cancelBefore = tts.cancelled;
  driver.syncTo(2); // 领先 2，未超过容差
  assert.equal(tts.cancelled, cancelBefore, '未超容差时不能 cancel');
  assert.equal(tts.spoken.length, 1);
  assert.equal(tts.paused, 0);
  assert.equal(driver.getState().spokenIndex, 0);
});

test('sync: setWords 会复位内部状态，stop 会停止并复位', () => {
  const tts = createFakeTts();
  const driver = createSyncDriver({ tts });
  driver.setWords(['one', 'two']);
  driver.syncTo(0);
  tts.spoken[0].handlers.onWord(1);
  assert.equal(driver.getState().spokenIndex, 1);
  assert.equal(driver.getState().playing, true);
  driver.setWords(['three', 'four']);
  assert.equal(driver.getState().spokenIndex, -1);
  assert.equal(driver.getState().playing, false);
  driver.syncTo(0);
  assert.equal(tts.spoken.length, 2);
  assert.equal(tts.spoken[1].text, 'three four');
  driver.stop();
  assert.equal(driver.getState().playing, false);
  assert.equal(driver.getState().spokenIndex, -1);
});

test('sync: onWordSpoken 回传绝对词下标', () => {
  const tts = createFakeTts();
  const seen = [];
  const driver = createSyncDriver({ tts, onWordSpoken: (index) => seen.push(index) });
  driver.setWords(['one', 'two', 'three', 'four', 'five']);
  driver.syncTo(0);
  tts.spoken[0].handlers.onWord(0);
  driver.syncTo(4); // 超容差 → 从第 4 个词重读
  tts.spoken[1].handlers.onWord(0);
  assert.deepEqual(seen, [0, 4]);
});

test('sync: 句子换句时旧回调不再影响状态', () => {
  const tts = createFakeTts();
  const driver = createSyncDriver({ tts });
  driver.setWords(['one', 'two']);
  driver.syncTo(0);
  const stale = tts.spoken[0];
  driver.setWords(['three', 'four']);
  stale.handlers.onWord(1);
  assert.equal(driver.getState().spokenIndex, -1);
});

// -------------------------------------------------------------------- asr.js

test('asr: isRecognitionSupported 在无浏览器环境下返回 false', () => {
  assert.equal(typeof isRecognitionSupported(), 'boolean');
  assert.equal(isRecognitionSupported(), false);
});

test('asr: 不支持识别时 start 不抛异常，走 onError', () => {
  let error = null;
  const recognizer = createRecognizer({ onError: (err) => { error = err; } });
  assert.doesNotThrow(() => recognizer.start());
  assert.ok(error instanceof Error);
  // The engine reports a code; the page turns it into the learner's language.
  assert.equal(error.code, 'NO_RECOGNITION');
  assert.equal(recognizer.isRunning(), false);
});

test('asr: 注入假 recognition，partial / final 回调正常', () => {
  const fake = {
    lang: '',
    continuous: false,
    interimResults: false,
    started: false,
    start() { this.started = true; },
    stop() { this.stopped = true; },
    abort() { this.aborted = true; },
  };
  const partials = [];
  const finals = [];
  const recognizer = createRecognizer({
    recognitionFactory: () => fake,
    onPartial: (text) => partials.push(text),
    onFinal: (text) => finals.push(text),
  });
  recognizer.start();
  assert.equal(fake.started, true);
  assert.equal(fake.lang, 'en-US');
  assert.equal(fake.continuous, true);
  assert.equal(fake.interimResults, true);
  assert.equal(recognizer.isRunning(), true);

  fake.onresult({
    resultIndex: 0,
    results: [{ isFinal: false, 0: { transcript: 'hello' } }],
  });
  assert.deepEqual(partials, ['hello']);

  fake.onresult({
    resultIndex: 0,
    results: [
      { isFinal: false, 0: { transcript: 'hello' } },
      { isFinal: true, 0: { transcript: 'world' } },
    ],
  });
  assert.deepEqual(finals, ['world']);

  fake.onresult({
    resultIndex: 2,
    results: [
      { isFinal: false, 0: { transcript: 'hello' } },
      { isFinal: true, 0: { transcript: 'world' } },
      { isFinal: true, 0: { transcript: 'again' } },
    ],
  });
  assert.equal(finals[finals.length - 1], 'again', 'onFinal 给本次新定稿的片段');
  assert.deepEqual(finals, ['world', 'again']);
  assert.equal(recognizer.getTranscript(), 'world again', '累计全文由 getTranscript() 提供');
  // UI 是追加式消费：片段拼起来才是完整 transcript
  assert.equal(finals.join(' '), 'world again');

  recognizer.stop();
  assert.equal(recognizer.isRunning(), false);
  recognizer.abort();
  assert.equal(fake.aborted, true);
});

test('asr: 识别错误走 onError，且 aborted 不算错误', () => {
  const fake = {
    start() {},
    stop() {},
    abort() {},
  };
  const errors = [];
  const recognizer = createRecognizer({
    recognitionFactory: () => fake,
    onError: (err) => errors.push(err),
  });
  recognizer.start();
  fake.onerror({ error: 'not-allowed' });
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /麦克风权限/);
  fake.onerror({ error: 'aborted' });
  assert.equal(errors.length, 1, 'aborted 不应上报为错误');
});

test('asr: 识别结束回调 onEnd', () => {
  const fake = { start() {}, stop() {}, abort() {} };
  let ended = false;
  const recognizer = createRecognizer({
    recognitionFactory: () => fake,
    onEnd: () => { ended = true; },
  });
  recognizer.start();
  fake.onend();
  assert.equal(ended, true);
  assert.equal(recognizer.isRunning(), false);
});

test('asr: createRecorder 注入假 MediaRecorder，录音结束后回传 blob 与 url', async () => {
  const fakeRecorder = {
    mimeType: 'audio/webm',
    ondataavailable: null,
    onstop: null,
    onerror: null,
    started: false,
    start() { this.started = true; },
    stop() {
      this.stopped = true;
      if (this.ondataavailable) this.ondataavailable({ data: { size: 4, type: 'audio/webm' } });
      if (this.onstop) this.onstop();
    },
  };
  let stopped = null;
  const recorder = createRecorder({
    mediaRecorderFactory: () => fakeRecorder,
    getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }),
    createObjectURL: () => 'blob:fake-url',
    onStop: (blob, url) => { stopped = { blob, url }; },
  });
  await recorder.start();
  assert.equal(recorder.isRecording(), true);
  assert.equal(fakeRecorder.started, true);
  recorder.stop();
  assert.equal(recorder.isRecording(), false);
  assert.ok(stopped, '必须回调 onStop');
  assert.equal(stopped.url, 'blob:fake-url');
  assert.ok(stopped.blob);
});

test('asr: createRecorder 在不支持时 reject 中文错误', async () => {
  const recorder = createRecorder({});
  await assert.rejects(
    () => recorder.start(),
    (err) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /不支持录音/);
      return true;
    }
  );
});

test('tts: 选中云端音色时走云端合成', async () => {
  const instances = [];
  class FakeAudio {
    constructor(src) {
      this.src = src;
      instances.push(this);
    }
    play() {
      return Promise.resolve();
    }
    pause() {}
  }
  globalThis.Audio = FakeAudio;
  const remoteCalls = [];
  const tts = createTts({
    synth: { speak: () => {}, cancel: () => {} },
    getVoices: () => [],
    getCloudVoices: () => [{ id: 'English_Graceful_Lady', name: 'Graceful Lady' }],
    remote: {
      speak: async (text, options) => {
        remoteCalls.push({ text, options });
        return { url: 'data:audio/mp3;base64,AA', durationMs: 2000 };
      },
    },
  });

  // 云端音色出现在音色列表里
  const voices = tts.listVoices();
  assert.equal(voices.length, 1);
  assert.equal(voices[0].id, 'mm:English_Graceful_Lady');

  tts.setVoice('mm:English_Graceful_Lady');
  const words = [];
  tts.speak('Hello there', { onWord: (index) => words.push(index) });
  await new Promise((resolve) => setTimeout(resolve, 10));

  // 请求发给了云端，本机合成没有被调用
  assert.equal(remoteCalls.length, 1);
  assert.equal(remoteCalls[0].text, 'Hello there');
  assert.equal(remoteCalls[0].options.voiceId, 'English_Graceful_Lady');
  // The first element is the silent clip that unlocks playback inside the
  // click; the second one carries the audio the server sent.
  assert.equal(instances.length, 2);
  assert.equal(instances[instances.length - 1].src, 'data:audio/mp3;base64,AA');

  // 音频结束后回调结束
  instances[instances.length - 1].onended();
  delete globalThis.Audio;
});

test('tts: 云端合成失败时回落到本机合成', async () => {
  const local = [];
  const tts = createTts({
    synth: {
      speak: (utterance) => local.push(utterance.text),
      cancel: () => {},
    },
    getVoices: () => [{ voiceURI: 'local', name: 'Local', lang: 'en-US' }],
    remote: {
      speak: async () => {
        throw new Error('云端不可用');
      },
    },
  });
  tts.setVoice('mm:English_Graceful_Lady');
  tts.speak('Fallback please');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(local, ['Fallback please']);
});
