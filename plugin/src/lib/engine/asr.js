
/**
 * Attach a machine readable code to an error.
 *
 * The engine does not speak the learner's language: it reports a code and the
 * page turns it into a sentence.
 *
 * @param {Error} error - the error.
 * @param {string} code - the machine readable code.
 * @param {any} [cause] - the underlying reason.
 * @returns {Error} the same error.
 */
function withCode(error, code, cause) {
  error.code = code;
  if (cause !== undefined) error.cause = cause;
  return error;
}

/**
 * 语音识别与录音回放（Web Speech API / MediaRecorder 封装）。
 *
 * 纯 ESM，不依赖 React。浏览器能力全部可注入，因此 Node 测试用假实现即可覆盖。
 *
 * 契约外的可选扩展（向后兼容，不改变契约签名）：
 *   - createRecognizer({ recognitionFactory })
 *   - createRecorder({ mediaRecorderFactory, getUserMedia, createObjectURL })
 */

/** 常见识别错误码对应的中文文案。 */
const ERROR_MESSAGES = {
  'no-speech': '没有检测到语音，请再试一次',
  'audio-capture': '找不到麦克风设备',
  'not-allowed': '麦克风权限被拒绝',
  'service-not-allowed': '当前环境不允许使用语音识别',
  network: '语音识别服务网络异常',
  aborted: '语音识别已被中止',
  'language-not-supported': '当前语音识别服务不支持该语言',
};

/**
 * 读取全局对象上的能力。
 *
 * @param {string} name
 * @returns {any}
 */
function readGlobal(name) {
  return typeof globalThis === 'undefined' ? undefined : globalThis[name];
}

/**
 * 当前环境是否支持语音识别。
 *
 * @returns {boolean}
 */
export function isRecognitionSupported() {
  const g = typeof globalThis === 'undefined' ? {} : globalThis;
  return Boolean(g.SpeechRecognition || g.webkitSpeechRecognition);
}

/**
 * 语音识别控制器（Web Speech API）。
 *
 * onPartial 给当前这一段的实时文本；onFinal 给「本次新定稿的片段」，
 * 多次 final 结果由调用方拼接（需要累计全文可用 getTranscript()）。
 *
 * @param {{ lang?: string, onPartial?: (text: string) => void, onFinal?: (text: string) => void,
 *           onError?: (err: Error) => void, onEnd?: () => void, recognitionFactory?: () => any }} [options]
 * @returns {{ start(): void, stop(): void, abort(): void, isRunning(): boolean, getTranscript(): string }}
 */
export function createRecognizer(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const lang = typeof opts.lang === 'string' && opts.lang ? opts.lang : 'en-US';
  const onPartial = typeof opts.onPartial === 'function' ? opts.onPartial : null;
  const onFinal = typeof opts.onFinal === 'function' ? opts.onFinal : null;
  const onError = typeof opts.onError === 'function' ? opts.onError : null;
  const onEnd = typeof opts.onEnd === 'function' ? opts.onEnd : null;
  const recognitionFactory =
    typeof opts.recognitionFactory === 'function' ? opts.recognitionFactory : null;

  let recognition = null;
  let running = false;
  let finalText = '';
  let generation = 0;

  function defaultFactory() {
    const g = typeof globalThis === 'undefined' ? {} : globalThis;
    const Ctor = g.SpeechRecognition || g.webkitSpeechRecognition;
    return Ctor ? new Ctor() : null;
  }

  function reportError(err) {
    if (onError) onError(err instanceof Error ? err : new Error(String(err)));
  }

  /** 处理一次识别结果。 */
  function handleResult(event) {
    const results = event?.results;
    if (!results) return;
    const from = typeof event.resultIndex === 'number' ? event.resultIndex : 0;
    let interim = '';
    for (let i = from; i < results.length; i += 1) {
      const result = results[i];
      const alternative = result && result[0];
      const transcript = alternative && typeof alternative.transcript === 'string'
        ? alternative.transcript
        : '';
      if (!transcript) continue;
      if (result.isFinal) {
        const piece = transcript.trim();
        if (piece) {
          finalText = finalText ? `${finalText} ${piece}` : piece;
          // onFinal 给「本次新定稿的片段」；多次 final 由调用方拼接（UI 就是追加式消费）。
          // 需要累计全文时用 getTranscript()。
          if (onFinal) onFinal(piece);
        }
      } else {
        interim += transcript;
      }
    }
    if (interim && onPartial) onPartial(interim);
  }

  function handleError(event) {
    const code = (event && event.error) || 'unknown';
    running = false;
    if (code === 'aborted') {
      // 主动中止不算错误
      return;
    }
    const message = ERROR_MESSAGES[code] || `语音识别出错（${code}）`;
    const err = new Error(message);
    err.code = code;
    reportError(err);
  }

  /**
   * 开始识别。不支持时不抛异常，而是回调 onError。
   */
  function start() {
    if (running) return;
    const factory = recognitionFactory || defaultFactory;
    let instance;
    try {
      instance = factory();
    } catch (err) {
      running = false;
      reportError(withCode(new Error('speech recognition could not start'), 'RECOGNITION_START_FAILED', err));
      return;
    }
    if (!instance) {
      running = false;
      reportError(withCode(new Error('speech recognition is unavailable'), 'NO_RECOGNITION'));
      return;
    }
    recognition = instance;
    finalText = '';
    const myGen = ++generation;
    try {
      instance.lang = lang;
      instance.continuous = true;
      instance.interimResults = true;
    } catch {
      // 某些实现不允许改这些字段，忽略
    }
    instance.onresult = (event) => {
      if (myGen !== generation) return;
      handleResult(event);
    };
    instance.onerror = (event) => {
      if (myGen !== generation) return;
      handleError(event);
    };
    instance.onend = () => {
      if (myGen !== generation) return;
      running = false;
      if (onEnd) onEnd();
    };
    try {
      instance.start();
      running = true;
    } catch (err) {
      running = false;
      reportError(withCode(new Error('speech recognition could not start'), 'RECOGNITION_START_FAILED', err));
    }
  }

  /** 停止识别。 */
  function stop() {
    if (recognition && typeof recognition.stop === 'function') {
      try {
        recognition.stop();
      } catch {
        // 忽略
      }
    }
    running = false;
  }

  /** 中止识别。 */
  function abort() {
    generation += 1;
    if (recognition && typeof recognition.abort === 'function') {
      try {
        recognition.abort();
      } catch {
        // 忽略
      }
    }
    running = false;
  }

  /** @returns {boolean} */
  function isRunning() {
    return running;
  }

  /**
   * 累计的最终文本（本次识别会话内所有 final 片段按空格拼接）。
   * 契约外的辅助方法：onFinal 给的是增量片段，需要全文时用这个。
   *
   * @returns {string}
   */
  function getTranscript() {
    return finalText;
  }

  return { start, stop, abort, isRunning, getTranscript };
}

/**
 * 录音回放兜底（浏览器不支持识别时使用）。
 *
 * @param {{ onStop?: (blob: Blob, url: string) => void, onError?: (err: Error) => void,
 *           mediaRecorderFactory?: (stream: any) => any, getUserMedia?: (constraints: any) => Promise<any>,
 *           createObjectURL?: (blob: Blob) => string }} [options]
 * @returns {{ start(): Promise<void>, stop(): void, isRecording(): boolean }}
 */
export function createRecorder(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const onStop = typeof opts.onStop === 'function' ? opts.onStop : null;
  const onError = typeof opts.onError === 'function' ? opts.onError : null;
  const mediaRecorderFactory =
    typeof opts.mediaRecorderFactory === 'function' ? opts.mediaRecorderFactory : null;
  const injectedGetUserMedia = typeof opts.getUserMedia === 'function' ? opts.getUserMedia : null;
  const injectedCreateObjectURL =
    typeof opts.createObjectURL === 'function' ? opts.createObjectURL : null;

  let recorder = null;
  let stream = null;
  let chunks = [];
  let recording = false;

  function defaultGetUserMedia() {
    const mediaDevices = readGlobal('navigator')?.mediaDevices;
    if (!mediaDevices || typeof mediaDevices.getUserMedia !== 'function') return null;
    return mediaDevices.getUserMedia({ audio: true });
  }

  function defaultCreateObjectURL(blob) {
    const url = readGlobal('URL');
    if (!url || typeof url.createObjectURL !== 'function') return '';
    return url.createObjectURL(blob);
  }

  function releaseStream() {
    if (stream && typeof stream.getTracks === 'function') {
      for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch {
          // 忽略
        }
      }
    }
    stream = null;
  }

  /**
   * 开始录音。不支持时 reject 一个中文错误。
   *
   * @returns {Promise<void>}
   */
  async function start() {
    if (recording) return;
    const MediaRecorderCtor = readGlobal('MediaRecorder');
    if (!mediaRecorderFactory && typeof MediaRecorderCtor !== 'function') {
      throw new Error('当前环境不支持录音');
    }
    const gUM = injectedGetUserMedia || defaultGetUserMedia();
    if (typeof gUM !== 'function') {
      throw new Error('当前环境不支持录音');
    }
    let acquired;
    try {
      acquired = await gUM({ audio: true });
    } catch (err) {
      const reason = err && err.message ? err.message : err;
      throw new Error(`无法访问麦克风：${reason}`);
    }
    if (!acquired) {
      throw new Error('无法访问麦克风：未获得媒体流');
    }
    stream = acquired;
    chunks = [];
    let instance;
    try {
      instance = mediaRecorderFactory
        ? mediaRecorderFactory(stream)
        : new MediaRecorderCtor(stream);
    } catch (err) {
      releaseStream();
      const reason = err && err.message ? err.message : err;
      throw new Error(`录音初始化失败：${reason}`);
    }
    recorder = instance;

    recorder.ondataavailable = (event) => {
      const data = event?.data;
      if (data && (typeof data.size !== 'number' || data.size > 0)) chunks.push(data);
    };
    recorder.onstop = () => {
      const mimeType = (recorder && recorder.mimeType) || 'audio/webm';
      const BlobCtor = readGlobal('Blob');
      let blob;
      try {
        blob = BlobCtor ? new BlobCtor(chunks, { type: mimeType }) : { type: mimeType, size: 0 };
      } catch {
        blob = { type: mimeType, size: 0 };
      }
      const url = (injectedCreateObjectURL || defaultCreateObjectURL)(blob);
      recording = false;
      releaseStream();
      if (onStop) onStop(blob, url);
    };
    recorder.onerror = (event) => {
      recording = false;
      const reason = event?.error?.message || event?.message || 'recording failed';
      if (onError) onError(withCode(new Error('recording failed'), 'RECORD_FAILED', reason));
    };

    try {
      recorder.start();
    } catch (err) {
      recording = false;
      releaseStream();
      const reason = err && err.message ? err.message : err;
      throw new Error(`录音启动失败：${reason}`);
    }
    recording = true;
  }

  /** 停止录音，触发 onStop。 */
  function stop() {
    if (!recorder || !recording) return;
    try {
      recorder.stop();
    } catch {
      recording = false;
    }
  }

  /** @returns {boolean} */
  function isRecording() {
    return recording;
  }

  return { start, stop, isRecording };
}
