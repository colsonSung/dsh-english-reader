/**
 * 语音合成控制器（Web Speech API 封装）。
 *
 * 纯 ESM，不依赖 React，不依赖 DOM API —— 所有浏览器能力都通过 options 注入，
 * 因此可以在 Node 里用假实现完整测试。
 *
 * 契约外的可选扩展（向后兼容，不改变契约签名）：
 *   - options.utteranceFactory: (text) => utterance，替换默认的 SpeechSynthesisUtterance
 *   - options.estimateMsPerWord: number，缺 boundary 事件时的按词估算节奏（默认 400ms）
 *   - options.remote: { speak(text, {rate, voiceId}) => Promise<{url, durationMs}> }，云端语音；
 *     选中云端音色时走这里，失败自动回落到本机合成
 *   - options.getCloudVoices: () => {id, name, lang}[]，云端音色列表
 *   - options.cloudPrefix: string，云端音色的 id 前缀（默认 'mm:'）
 *   - options.lang: 'zh' | 'en'，朗读语言（默认 'en'）；中文书必须传 'zh'，
 *     否则会拿英文音色读中文，听不懂
 */

import { tokenize } from './segment.js';
import { speechLang, voiceMatchesLanguage } from '../language.js';

/**
 * A silent clip. Playing it inside the click that started the reading unlocks
 * the audio element, so the real audio may start after the network round trip.
 */
const SILENT_AUDIO = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

/** 没有 boundary 事件时，按这个语速估算每个词的时长。 */
const DEFAULT_WORDS_PER_MINUTE = 150;

/**
 * 读取全局对象上的能力（不直接引用 window/document，避免 Node 下报错）。
 *
 * @param {string} name
 * @returns {any}
 */
function readGlobal(name) {
  return typeof globalThis === 'undefined' ? undefined : globalThis[name];
}

/**
 * 安全调用 UI 回调：回调抛错不能影响引擎状态。
 *
 * @param {Function|undefined} fn
 * @param {...any} args
 */
function invoke(fn, ...args) {
  if (typeof fn !== 'function') return;
  try {
    fn(...args);
  } catch {
    // 忽略 UI 回调异常
  }
}

/**
 * 找出 charIndex 落在哪个词上。
 *
 * @param {{ start: number, end: number }[]} words
 * @param {number} charIndex
 * @returns {number} 词下标；没有词时返回 -1
 */
function wordIndexAtChar(words, charIndex) {
  if (!words.length) return -1;
  let lo = 0;
  let hi = words.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid].end > charIndex) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * 语音合成控制器。依赖浏览器 Web Speech API，但所有依赖都可注入，便于测试。
 *
 * @param {{ synth?: SpeechSynthesis, getVoices?: () => SpeechSynthesisVoice[],
 *           utteranceFactory?: (text: string) => any, estimateMsPerWord?: number,
 *           lang?: 'zh'|'en' }} [options]
 * @returns {TtsController}
 */
export function createTts(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const synth = opts.synth !== undefined ? opts.synth : readGlobal('speechSynthesis');
  const injectedGetVoices = typeof opts.getVoices === 'function' ? opts.getVoices : null;
  const estimateMsPerWord =
    Number.isFinite(opts.estimateMsPerWord) && opts.estimateMsPerWord > 0
      ? opts.estimateMsPerWord
      : 60000 / DEFAULT_WORDS_PER_MINUTE;
  const remote = opts.remote !== undefined && typeof opts.remote === 'object' ? opts.remote : null;
  const cloudPrefix = typeof opts.cloudPrefix === 'string' && opts.cloudPrefix !== '' ? opts.cloudPrefix : 'mm:';
  const getCloudVoices = typeof opts.getCloudVoices === 'function' ? opts.getCloudVoices : null;

  let voice = null; // 原始 SpeechSynthesisVoice
  let voiceInfo = null; // { id, name, lang }
  let cloudVoiceId = null; // 选中的云端音色（不含前缀）
  let language = opts.lang === 'zh' ? 'zh' : 'en'; // 朗读语言：中文书必须用 'zh'
  let rate = 1;
  let generation = 0; // 会话令牌：cancel 后旧回调自动失效
  let session = null; // 当前朗读会话
  let disposed = false;

  /** 取原始语音列表。 */
  function rawVoices() {
    if (!synth) return [];
    try {
      const list = injectedGetVoices
        ? injectedGetVoices()
        : typeof synth.getVoices === 'function'
          ? synth.getVoices()
          : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  /**
   * 本机与云端的全部语音，按 name 排序。
   *
   * 这里不按语言过滤：语言过滤是 listVoices 的事，全集要留着，
   * 否则回落到全集时就没有东西可回落了。
   *
   * @returns {{ id: string, name: string, lang: string, cloud?: boolean }[]}
   */
  function allVoices() {
    const local = rawVoices()
      .filter((v) => v !== null && v !== undefined)
      .map((v) => ({
        id: v.voiceURI || v.name || '',
        name: v.name || '',
        lang: typeof v.lang === 'string' ? v.lang : '',
      }))
      .filter((v) => v.id !== '' || v.name !== '')
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    const cloud = getCloudVoices === null
      ? []
      : (() => {
        try {
          const list = getCloudVoices();
          return Array.isArray(list) ? list : [];
        } catch {
          return [];
        }
      })()
        .filter((v) => v && typeof v.id === 'string' && v.id !== '')
        .map((v) => ({
          id: cloudPrefix + v.id,
          name: String(v.name ?? v.id),
          lang: typeof v.lang === 'string' && v.lang !== '' ? v.lang : 'en-US',
          cloud: true,
        }))
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return [...local, ...cloud];
  }

  /**
   * 返回当前语言的语音，按 name 排序。
   *
   * 没有匹配到时退回全集：少一个中文音色不能让学习者看到一个空的音色列表。
   *
   * @returns {{ id: string, name: string, lang: string, cloud?: boolean }[]}
   */
  function listVoices() {
    const all = allVoices();
    const matched = all.filter((v) => voiceMatchesLanguage(v, language));
    return matched.length > 0 ? matched : all;
  }

  /**
   * 切换朗读语言。
   *
   * 当前选中的音色不会说新语言时，改用第一个会说新语言的音色；一个也没有时
   * 保留当前音色，朗读器仍然出声，只是音色不对。
   *
   * @param {'zh'|'en'} next 语言
   * @returns {'zh'|'en'} 生效的语言
   */
  function setLanguage(next) {
    language = next === 'zh' ? 'zh' : next === 'en' ? 'en' : language;
    if (voiceInfo !== null && !voiceMatchesLanguage(voiceInfo, language)) {
      const candidate = allVoices().find((v) => voiceMatchesLanguage(v, language));
      if (candidate !== undefined) setVoice(candidate.id);
    }
    return language;
  }

  /** @returns {'zh'|'en'} 当前朗读语言 */
  function getLanguage() {
    return language;
  }

  /**
   * 选择语音。
   *
   * @param {string} id 语音 id（也接受语音 name）
   * @returns {string|null} 选中的 id
   */
  function setVoice(id) {
    if (id === undefined || id === null || id === '') {
      voice = null;
      voiceInfo = null;
      cloudVoiceId = null;
      return null;
    }
    // 云端音色用前缀标记，选中它就不再用本机合成
    if (typeof id === 'string' && id.startsWith(cloudPrefix)) {
      cloudVoiceId = id.slice(cloudPrefix.length);
      voice = null;
      // 音色表里有它就照抄名字与语言：中文云端音色不能被写成英文
      const known = allVoices().find((v) => v.id === id);
      voiceInfo = known ? { ...known } : { id, name: id, lang: 'en-US', cloud: true };
      return id;
    }
    cloudVoiceId = null;
    // 在全集里找：音色列表按语言过滤过，但选中的音色可能来自回落到的那一份
    const list = allVoices();
    const found = list.find((v) => v.id === id) || list.find((v) => v.name === id);
    if (!found) return voiceInfo ? voiceInfo.id : null;
    voiceInfo = found;
    const raw = rawVoices();
    voice =
      raw.find((v) => (v.voiceURI || v.name) === found.id) ||
      raw.find((v) => v.name === found.name) ||
      null;
    return found.id;
  }

  /**
   * 当前语音。
   *
   * @returns {{ id: string, name: string, lang: string }|null}
   */
  function getVoice() {
    return voiceInfo ? { ...voiceInfo } : null;
  }

  /**
   * 设置语速，clamp 到 [0.5, 2]。
   *
   * @param {number} value
   * @returns {number} 实际生效的语速
   */
  function setRate(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return rate;
    rate = Math.min(2, Math.max(0.5, num));
    return rate;
  }

  /** @returns {number} */
  function getRate() {
    return rate;
  }

  /** 创建 utterance：优先注入工厂，其次全局构造函数，最后退化成普通对象。 */
  function createUtterance(text) {
    if (typeof opts.utteranceFactory === 'function') {
      try {
        return opts.utteranceFactory(text);
      } catch {
        // 落到下面的兜底
      }
    }
    const ctor =
      readGlobal('SpeechSynthesisUtterance') ||
      (synth && typeof synth.Utterance === 'function' ? synth.Utterance : null);
    if (typeof ctor === 'function') {
      try {
        return new ctor(text);
      } catch {
        // 落到下面的兜底
      }
    }
    return { text, rate: 1, voice: null, onboundary: null, onend: null, onerror: null };
  }

  /** 停止按词估算定时器。 */
  function stopEstimate(s) {
    if (s.timer !== null && s.timer !== undefined) {
      clearTimeout(s.timer);
      s.timer = null;
    }
  }

  /** 发出一次词回调（同一词不重复回调）。 */
  function emitWord(s, index, charIndex) {
    if (s.gen !== generation) return;
    if (index < 0 || index <= s.emitted) return;
    s.emitted = index;
    invoke(s.handlers.onWord, index, charIndex);
  }

  /**
   * 按词估算回调：浏览器不触发 boundary 时使用。
   * 每 estimateMsPerWord 毫秒推进一个词（按语速等比缩放），至少每 3 个词就有一次回调。
   *
   * 注意：估算链必须在词表耗尽后停止续期，否则浏览器不派发 onend 时定时器会一直挂着。
   */
  function startEstimate(s) {
    stopEstimate(s);
    if (s.gen !== generation) return;
    if (s.boundarySeen || s.paused) return;
    if (s.estimateIndex >= s.words.length) return; // 没有词可估算了，停止续期
    s.timer = setTimeout(() => {
      s.timer = null;
      if (s.gen !== generation || s.boundarySeen || s.paused) return;
      const index = s.estimateIndex;
      if (index < s.words.length) {
        s.estimateIndex = index + 1;
        emitWord(s, index, s.words[index].start);
      }
      startEstimate(s);
    }, Math.max(1, (s.msPerWord ?? estimateMsPerWord) / rate));
  }

  /**
   * 朗读一段文本。
   *
   * @param {string} text
   * @param {{ onWord?: (index: number, charIndex: number) => void,
   *           onEnd?: () => void, onError?: (err: Error) => void }} [handlers]
   */
  function speak(text, handlers) {
    const h = handlers && typeof handlers === 'object' ? handlers : {};
    if (disposed) {
      invoke(h.onError, new Error('语音合成控制器已释放'));
      return;
    }
    // 先取消上一次，避免语音堆积
    cancel();
    const content =
      typeof text === 'string' ? text : text === undefined || text === null ? '' : String(text);
    if (!content.trim()) {
      invoke(h.onEnd);
      return;
    }
    const words = tokenize(content);
    // 选中了云端音色就走云端合成，失败时回落到本机
    if (cloudVoiceId !== null && remote !== null && typeof remote.speak === 'function') {
      speakRemote(content, words, h);
      return;
    }
    speakLocal(content, words, h);
  }

  /**
   * 用本机的语音合成朗读一段文本。
   *
   * @param {string} content - the text to read.
   * @param {object[]} words - the tokenised words.
   * @param {object} h - the handlers.
   */
  function speakLocal(content, words, h) {
    if (!synth || typeof synth.speak !== 'function') {
      invoke(h.onError, new Error('当前环境不支持语音合成'));
      return;
    }
    const utterance = createUtterance(content);
    utterance.rate = rate;
    if (voice) {
      utterance.voice = voice;
    } else {
      // 没选音色时告诉浏览器要读哪种语言：中文书否则会用默认的英文音色念中文
      try {
        utterance.lang = speechLang(language);
      } catch {
        // 有些实现不允许改这个字段，忽略
      }
    }

    const s = {
      gen: ++generation,
      handlers: h,
      words,
      utterance,
      emitted: -1,
      estimateIndex: 0,
      timer: null,
      boundarySeen: false,
      paused: false,
      active: true,
    };
    session = s;

    utterance.onboundary = (event) => {
      if (s.gen !== generation) return;
      // 收到 boundary 就切换到精确模式，停掉估算
      s.boundarySeen = true;
      stopEstimate(s);
      const charIndex = typeof event?.charIndex === 'number' ? event.charIndex : 0;
      const index = wordIndexAtChar(s.words, charIndex);
      if (index >= 0) emitWord(s, index, charIndex);
    };

    utterance.onend = () => {
      if (s.gen !== generation) return;
      stopEstimate(s);
      s.active = false;
      if (session === s) session = null;
      // 结束时补上最后一个词
      if (s.words.length && s.emitted < s.words.length - 1) {
        emitWord(s, s.words.length - 1, s.words[s.words.length - 1].start);
      }
      invoke(h.onEnd);
    };

    utterance.onerror = (event) => {
      if (s.gen !== generation) return;
      stopEstimate(s);
      s.active = false;
      if (session === s) session = null;
      const message =
        (event && typeof event.message === 'string' && event.message) || '语音合成失败';
      const err = new Error(message);
      if (event && event.error) err.code = event.error;
      invoke(h.onError, err);
    };

    try {
      synth.speak(utterance);
    } catch (err) {
      stopEstimate(s);
      s.active = false;
      if (session === s) session = null;
      invoke(h.onError, err instanceof Error ? err : new Error('语音合成失败'));
      return;
    }
    startEstimate(s);
  }

  /**
   * 用云端语音合成朗读一段文本。
   *
   * 云端音频没有 boundary 事件，词的进度按音频总时长平均估算，比本机的固定
   * 节奏更准。合成失败时回落到本机合成，学习者不会听到任何声音。
   *
   * @param {string} content - the text to read.
   * @param {object[]} words - the tokenised words.
   * @param {object} h - the handlers.
   */
  async function speakRemote(content, words, h) {
    const s = {
      gen: ++generation,
      handlers: h,
      words,
      utterance: null,
      emitted: -1,
      estimateIndex: 0,
      timer: null,
      boundarySeen: false,
      paused: false,
      active: true,
      audio: null,
      msPerWord: null,
    };
    session = s;
    // The click that started the reading is the only chance to unlock the
    // audio, so it is used right here, before the network round trip.
    const Ctor = readGlobal('Audio');
    if (typeof Ctor === 'function') {
      try {
        const unlock = new Ctor(SILENT_AUDIO);
        unlock.muted = true;
        const promise = unlock.play();
        if (promise && typeof promise.catch === 'function') promise.catch(() => {});
      } catch {
        // The browser may refuse; the real audio still tries.
      }
    }
    let result;
    try {
      result = await remote.speak(content, { rate, voiceId: cloudVoiceId });
    } catch (error) {
      if (s.gen !== generation) return;
      // 云端不可用：本机合成顶上
      speakLocal(content, words, h);
      return;
    }
    if (s.gen !== generation) return;
    if (typeof Ctor !== 'function') {
      speakLocal(content, words, h);
      return;
    }
    let audio;
    try {
      audio = new Ctor(result?.url ?? '');
    } catch {
      speakLocal(content, words, h);
      return;
    }
    s.audio = audio;
    audio.onended = () => {
      if (s.gen !== generation) return;
      stopEstimate(s);
      s.active = false;
      if (session === s) session = null;
      if (s.words.length && s.emitted < s.words.length - 1) {
        emitWord(s, s.words.length - 1, s.words[s.words.length - 1].start);
      }
      invoke(h.onEnd);
    };
    audio.onerror = () => {
      if (s.gen !== generation) return;
      stopEstimate(s);
      s.active = false;
      if (session === s) session = null;
      // 云端音频放不出来时，用本机合成顶上，学习者不会听到任何声音
      speakLocal(content, words, h);
    };
    try {
      await audio.play();
    } catch (error) {
      if (s.gen !== generation) return;
      stopEstimate(s);
      s.active = false;
      if (session === s) session = null;
      // 浏览器拒绝了自动播放：本机合成顶上
      speakLocal(content, words, h);
      return;
    }
    const durationMs = Number(result?.durationMs ?? 0);
    if (durationMs > 0 && s.words.length > 0) {
      s.msPerWord = durationMs / s.words.length;
      startEstimate(s);
    }
  }

  /**
   * 朗读单个词（用于点击单词发音）。
   *
   * @param {string} text
   */
  function speakWord(text) {
    speak(text, {});
  }

  /** 停止朗读。 */
  function cancel() {
    generation += 1; // 让旧回调失效
    if (session) {
      stopEstimate(session);
      session.active = false;
      session = null;
    }
    if (synth && typeof synth.cancel === 'function') {
      try {
        synth.cancel();
      } catch {
        // 忽略
      }
    }
    if (session && session.audio) {
      try {
        session.audio.pause();
      } catch {
        // 忽略
      }
      try {
        session.audio.currentTime = 0;
      } catch {
        // 忽略
      }
    }
  }

  /** 暂停朗读。 */
  function pause() {
    const s = session;
    if (!s) return;
    if (synth && typeof synth.pause === 'function') {
      try {
        synth.pause();
      } catch {
        // 忽略
      }
    }
    s.paused = true;
    stopEstimate(s);
  }

  /** 继续朗读。 */
  function resume() {
    const s = session;
    if (!s) return;
    if (synth && typeof synth.resume === 'function') {
      try {
        synth.resume();
      } catch {
        // 忽略
      }
    }
    s.paused = false;
    startEstimate(s);
  }

  /** @returns {boolean} 是否正在朗读（暂停中仍算在朗读） */
  function isSpeaking() {
    return Boolean(session);
  }

  /** @returns {boolean} 是否处于暂停状态（契约外的辅助信息） */
  function isPaused() {
    return Boolean(session && session.paused);
  }

  /** 释放资源。 */
  function dispose() {
    cancel();
    disposed = true;
    voice = null;
    voiceInfo = null;
  }

  return {
    listVoices,
    setVoice,
    getVoice,
    setLanguage,
    getLanguage,
    setRate,
    getRate,
    speak,
    speakWord,
    cancel,
    pause,
    resume,
    isSpeaking,
    isPaused,
    dispose,
  };
}
