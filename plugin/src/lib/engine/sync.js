/**
 * 打字同步驱动器：让朗读进度跟随打字进度。
 *
 * 纯 ESM，不依赖 React，不依赖 DOM。tts 由外部注入（可以是假实现），因此本层
 * 只负责「策略」，不碰任何浏览器 API。
 *
 * 同步策略（契约 2.4）：
 *   1. 目标词落后于已读词（用户打字慢）→ 暂停朗读，等用户追上再 resume。
 *   2. 目标词领先于已读词超过 gapTolerance 个词 → 取消当前朗读，从目标词重读。
 *   3. 目标词领先但未超过容差 → 不做任何事，让朗读自然跟上。
 *   4. setWords 一律先 stop 内部状态。
 */

/**
 * @typedef {{ speak: Function, cancel?: Function, pause?: Function, resume?: Function }} TtsController
 */

/**
 * 打字同步驱动器：让朗读进度跟随打字进度。
 *
 * @param {{ tts: TtsController, gapTolerance?: number, onWordSpoken?: (index: number) => void }} options
 * @returns {SyncDriver}
 */
export function createSyncDriver(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const tts = opts.tts || null;
  const gapTolerance = Number.isFinite(opts.gapTolerance) ? Math.max(0, opts.gapTolerance) : 2;
  const onWordSpoken = typeof opts.onWordSpoken === 'function' ? opts.onWordSpoken : null;

  /** @type {string[]} */
  let words = [];
  let spokenIndex = -1; // 已读到的词下标（相对整句）
  let baseIndex = 0; // 当前朗读片段的起始词下标
  let playing = false;
  let paused = false;
  let generation = 0; // 会话令牌：cancel 之后旧回调失效

  /**
   * 停止并复位（保留当前词表）。
   */
  function stop() {
    generation += 1;
    if (tts && typeof tts.cancel === 'function') {
      try {
        tts.cancel();
      } catch {
        // 忽略
      }
    }
    playing = false;
    paused = false;
    spokenIndex = -1;
    baseIndex = 0;
  }

  /**
   * 从第 index 个词开始朗读。
   *
   * @param {number} index
   */
  function startFrom(index) {
    if (!tts || typeof tts.speak !== 'function') return;
    const slice = words.slice(index);
    if (!slice.length) return;
    const text = slice.join(' ');
    baseIndex = index;
    // 朗读起点即当前进度：这样下一次 syncTo 的相对位置才正确
    spokenIndex = index;
    playing = true;
    paused = false;
    const myGen = ++generation;

    tts.speak(text, {
      onWord: (wordIndex) => {
        if (myGen !== generation) return;
        const abs = Math.min(baseIndex + Math.max(0, wordIndex | 0), words.length - 1);
        spokenIndex = abs;
        if (onWordSpoken) onWordSpoken(abs);
      },
      onEnd: () => {
        if (myGen !== generation) return;
        playing = false;
        paused = false;
      },
      onError: () => {
        if (myGen !== generation) return;
        playing = false;
        paused = false;
      },
    });
  }

  /**
   * 取消当前朗读并从目标词重新开始读。
   *
   * @param {number} index
   */
  function restartFrom(index) {
    generation += 1; // 让旧会话的回调失效
    playing = false;
    paused = false;
    if (tts && typeof tts.cancel === 'function') {
      try {
        tts.cancel();
      } catch {
        // 忽略
      }
    }
    startFrom(index);
  }

  /**
   * 设置当前句子的词数组（纯文本）。调用时先复位内部状态。
   *
   * @param {string[]} nextWords
   */
  function setWords(nextWords) {
    stop();
    words = Array.isArray(nextWords) ? nextWords.slice() : [];
  }

  /**
   * 打字进度变化时调用，把播放对齐到第 index 个词（0 基）。
   *
   * @param {number} index
   */
  function syncTo(index) {
    if (!words.length) return;
    const total = words.length;
    const raw = Number(index);
    const target = Math.min(total - 1, Math.max(0, Number.isFinite(raw) ? Math.trunc(raw) : 0));

    if (!playing) {
      // 还没开始读：把播放对齐到目标词；已经读完且目标在已读范围内则不动
      if (spokenIndex === -1 || target > spokenIndex) startFrom(target);
      return;
    }

    const delta = target - spokenIndex;
    if (delta < 0) {
      // 用户打字慢：暂停朗读，等追上
      if (!paused) {
        if (tts && typeof tts.pause === 'function') {
          try {
            tts.pause();
          } catch {
            // 忽略
          }
        }
        paused = true;
      }
      return;
    }
    if (delta > gapTolerance) {
      // 用户超前太多：取消当前朗读，从目标词重读
      restartFrom(target);
      return;
    }
    if (paused && delta >= 0) {
      // 用户追上了：继续朗读
      if (tts && typeof tts.resume === 'function') {
        try {
          tts.resume();
        } catch {
          // 忽略
        }
      }
      paused = false;
    }
  }

  /**
   * @returns {{ spokenIndex: number, playing: boolean, paused: boolean }}
   */
  function getState() {
    return { spokenIndex, playing, paused };
  }

  return { setWords, syncTo, stop, getState };
}
