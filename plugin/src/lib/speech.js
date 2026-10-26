/**
 * Pronouncing a single word.
 *
 * The cloud voice is used first, because a model voice reads a word the way a
 * dictionary does. The browser's own speech is the fallback, so a word is
 * always pronounceable — even without a key or without a network.
 */

/**
 * Play an audio source and wait until it ends.
 *
 * @param {string} url - the audio URL.
 * @param {object} [options] - the call options.
 * @param {Function} [options.AudioCtor] - the Audio constructor (for tests).
 * @returns {Promise<void>} resolves when the audio ended.
 */
export function playAudio(url, options = {}) {
  const Ctor = options.AudioCtor ?? (typeof globalThis !== 'undefined' ? globalThis.Audio : undefined);
  if (typeof Ctor !== 'function') {
    return Promise.reject(new Error('当前环境不支持音频播放'));
  }
  return new Promise((resolve, reject) => {
    let audio;
    try {
      audio = new Ctor(url);
    } catch (error) {
      reject(error);
      return;
    }
    audio.onended = () => { resolve(); };
    audio.onerror = () => { reject(new Error('音频播放失败')); };
    const promise = audio.play();
    if (promise && typeof promise.catch === 'function') promise.catch(reject);
  });
}

/**
 * Read a word with the browser's own speech.
 *
 * @param {string} text - the word.
 * @param {object} [options] - the call options.
 * @param {number} [options.rate] - the speaking rate.
 * @returns {boolean} true when the word was handed to the browser.
 */
export function speakLocally(text, options = {}) {
  const synth = options.synth ?? (typeof globalThis !== 'undefined' ? globalThis.speechSynthesis : undefined);
  if (!synth || typeof synth.speak !== 'function') return false;
  const Ctor = typeof globalThis !== 'undefined' ? globalThis.SpeechSynthesisUtterance : undefined;
  try {
    const utterance = typeof options.utteranceFactory === 'function'
      ? options.utteranceFactory(text)
      : (typeof Ctor === 'function' ? new Ctor(text) : { text });
    utterance.rate = options.rate ?? 1;
    synth.speak(utterance);
    return true;
  } catch {
    return false;
  }
}

/**
 * Pronounce a word: the cloud voice first, the built-in voice as the fallback.
 *
 * @param {string} text - the word.
 * @param {object} [options] - the call options.
 * @param {string} [options.voiceId] - the cloud voice id.
 * @param {number} [options.rate] - the speaking rate.
 * @param {Function} [options.askTts] - the function that calls the Host.
 * @param {Function} [options.onError] - called when both voices failed.
 * @returns {Promise<'cloud'|'local'|'none'>} which voice spoke.
 */
export async function speakWord(text, options = {}) {
  const word = String(text ?? '').trim();
  if (word === '') return 'none';
  const askTts = options.askTts ?? defaultAskTts;
  if (typeof askTts === 'function') {
    try {
      const result = await askTts({ text: word, voiceId: options.voiceId, rate: options.rate });
      if (result && typeof result.url === 'string' && result.url !== '') {
        await playAudio(result.url, options);
        return 'cloud';
      }
    } catch {
      // The cloud voice is not available: the built-in one takes over.
    }
  }
  const spoken = speakLocally(word, options);
  if (!spoken && typeof options.onError === 'function') {
    options.onError(new Error('当前环境无法朗读'));
  }
  return spoken ? 'local' : 'none';
}

/**
 * The default call to the Host: the same route the reader uses.
 * @param {object} payload - the request.
 * @returns {Promise<object>} the audio.
 */
async function defaultAskTts(payload) {
  const { askAi } = await import('./ai.js');
  return askAi('tts', payload);
}

/**
 * Read a recording as base64, so it can be posted to the Host.
 *
 * @param {Blob} blob - the recording.
 * @returns {Promise<string>} the base64 payload (without the data URL prefix).
 */
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    if (blob === null || blob === undefined || typeof blob.arrayBuffer !== 'function') {
      reject(new Error('没有可识别的音频'));
      return;
    }
    blob.arrayBuffer()
      .then((buffer) => {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        const chunk = 0x8000;
        for (let index = 0; index < bytes.length; index += chunk) {
          binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk));
        }
        resolve(typeof btoa === 'function' ? btoa(binary) : Buffer.from(bytes).toString('base64'));
      })
      .catch(reject);
  });
}
