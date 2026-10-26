/**
 * Host half of the MiniMax channel.
 *
 * Two services are used: the chat model for word sheets, translations and
 * sentence breakdowns, and the text-to-speech model for the reading voice.
 *
 * The API key never lives in the bundle. It is read from the environment
 * (`MINIMAX_API_KEY`) or from a private file outside the workspace
 * (`~/.dsh/english-reader/minimax.key`), so the source and the client bundle
 * stay free of secrets.
 *
 * Every dependency is injectable, so the behaviour can be tested without the
 * network.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** The MiniMax API root that answers for this kind of key. */
export const BASE_URL = 'https://api.minimaxi.com/v1';

/** The chat model used for the AI assist answers. */
export const CHAT_MODEL = 'MiniMax-Text-01';

/** The speech model used for the reading voice. */
export const TTS_MODEL = 'speech-02-hd';

/** The speech recognition model. */
export const ASR_MODEL = 'asr-1.0';

/** The private file that holds the API key when the environment has none. */
export const KEY_FILE = join(homedir(), '.dsh', 'english-reader', 'minimax.key');

/** Wall-clock budget for one MiniMax request. */
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Read the API key.
 *
 * @param {{ env?: Record<string, string|undefined>, keyFile?: string }} [options]
 * @returns {string|null} the key, or null when none is configured.
 */
export function readApiKey(options = {}) {
  const env = options.env ?? process.env;
  const fromEnv = typeof env.MINIMAX_API_KEY === 'string' ? env.MINIMAX_API_KEY.trim() : '';
  if (fromEnv !== '') return fromEnv;
  // The file can be pointed elsewhere, which is how the tests stay off the
  // network.
  const file = options.keyFile ?? process.env.ENGLISH_READER_MINIMAX_KEY_FILE ?? KEY_FILE;
  try {
    if (existsSync(file)) {
      const content = readFileSync(file, 'utf8').trim();
      if (content !== '') return content;
    }
  } catch {
    // No key file, or it cannot be read: the channel stays off.
  }
  return null;
}

/**
 * Whether the MiniMax channel is configured.
 *
 * @param {object} [options] - the injected dependencies.
 * @returns {boolean} true when a key is available.
 */
export function isAvailable(options = {}) {
  return readApiKey(options) !== null;
}

/**
 * Turn a provider error into a Chinese sentence.
 *
 * @param {any} error - the thrown failure.
 * @returns {string} the Chinese message.
 */
function providerErrorMessage(error) {
  const status = Number(error?.status ?? 0);
  if (status === 401 || status === 403) return 'MiniMax 鉴权失败，请检查 API Key';
  if (status === 429) return 'MiniMax 请求过于频繁，请稍后再试';
  if (status >= 500) return 'MiniMax 服务暂时不可用，请稍后再试';
  return `MiniMax 调用失败：${error instanceof Error ? error.message : String(error)}`;
}

/**
 * Perform one request against the MiniMax API.
 *
 * @param {string} path - the path below the API root.
 * @param {object} body - the request body.
 * @param {object} [deps] - the injected dependencies.
 * @param {string} [deps.key] - the API key.
 * @param {Function} [deps.fetch] - the fetch implementation.
 * @param {number} [deps.timeoutMs] - the wall-clock budget.
 * @returns {Promise<object>} the parsed answer.
 */
async function request(path, body, deps = {}) {
  const key = deps.key ?? readApiKey(deps);
  if (key === null || key === '') {
    const error = new Error('未配置 MiniMax API Key');
    error.code = 'NO_KEY';
    throw error;
  }
  const doFetch = deps.fetch ?? globalThis.fetch;
  if (typeof doFetch !== 'function') {
    const error = new Error('当前环境不支持 fetch');
    error.code = 'NO_FETCH';
    throw error;
  }
  const timeoutMs = Number.isFinite(deps.timeoutMs) && deps.timeoutMs > 0 ? deps.timeoutMs : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, timeoutMs);
  try {
    const response = await doFetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      // The learner sees a Chinese sentence; the provider's own words stay on
      // the cause for diagnosis.
      const error = new Error(providerErrorMessage({ status: response.status }));
      error.cause = new Error(payload?.error?.message ?? `HTTP ${response.status}`);
      error.status = response.status;
      error.code = payload?.error?.type ?? 'HTTP_ERROR';
      throw error;
    }
    if (payload?.base_resp?.status_code !== undefined && Number(payload.base_resp.status_code) !== 0) {
      const error = new Error(payload?.base_resp?.status_msg ?? 'MiniMax 调用失败');
      error.code = 'PROVIDER_ERROR';
      throw error;
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask the MiniMax chat model for one completion.
 *
 * @param {object} options - the call parameters.
 * @param {string} options.system - the system prompt.
 * @param {string} options.user - the user prompt.
 * @param {number} [options.maxTokens] - the token cap.
 * @param {number} [options.temperature] - the sampling temperature.
 * @param {object} [deps] - the injected dependencies.
 * @returns {Promise<string>} the model's answer.
 */
export async function chat({ system, user, maxTokens = 800, temperature = 0.2 }, deps = {}) {
  const payload = await request('/chat/completions', {
    model: deps.model ?? CHAT_MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature,
    max_completion_tokens: maxTokens,
  }, deps);
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.trim() === '') {
    const error = new Error('MiniMax 没有返回内容');
    error.code = 'EMPTY_ANSWER';
    throw error;
  }
  return content;
}

/**
 * Synthesise speech with the MiniMax text-to-speech model.
 *
 * @param {object} options - the call parameters.
 * @param {string} options.text - the text to read.
 * @param {string} [options.voiceId] - the MiniMax voice id.
 * @param {number} [options.speed] - the speaking rate, 0.5 to 2.
 * @param {object} [deps] - the injected dependencies.
 * @returns {Promise<{url: string, durationMs: number, format: string}>} the audio.
 */
export async function tts({ text, voiceId, speed = 1 }, deps = {}) {
  const content = typeof text === 'string' ? text.trim() : '';
  if (content === '') {
    const error = new Error('没有要朗读的内容');
    error.code = 'EMPTY_TEXT';
    throw error;
  }
  const rate = Math.min(2, Math.max(0.5, Number(speed) || 1));
  const payload = await request('/t2a_v2', {
    model: deps.model ?? TTS_MODEL,
    text: content,
    stream: false,
    voice_setting: {
      voice_id: voiceId ?? 'English_Graceful_Lady',
      speed: rate,
      vol: 1,
      pitch: 0,
    },
    audio_setting: {
      sample_rate: 32000,
      bitrate: 128000,
      format: 'mp3',
      channel: 1,
    },
  }, deps);
  const hex = payload?.data?.audio;
  if (typeof hex !== 'string' || hex === '') {
    const error = new Error('MiniMax 没有返回音频');
    error.code = 'EMPTY_AUDIO';
    throw error;
  }
  const format = payload?.extra_info?.audio_format ?? 'mp3';
  const durationMs = Number(payload?.extra_info?.audio_length ?? 0);
  return {
    url: `data:audio/${format};base64,${Buffer.from(hex, 'hex').toString('base64')}`,
    durationMs: Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0,
    format,
  };
}



/** The image model used for the book covers. */
export const IMAGE_MODEL = 'image-01';

/**
 * Build the prompt for a book cover.
 *
 * The image models render short titles well but garble long ones, so only the
 * title is given to them and the author is kept out of the picture.
 *
 * @param {string} title - the book title.
 * @returns {string} the prompt.
 */
export function coverPrompt(title) {
  const name = String(title ?? '').trim();
  return [
    `A modern book cover for the title "${name}".`,
    'Editorial design, strong typographic hierarchy, generous margins,',
    'a restrained palette of two or three colours on textured paper,',
    'one clear geometric or photographic focal point.',
    `The only text on the cover is the title "${name}", set cleanly and spelled exactly as written.`,
    'No author name, no publisher, no other text, no barcode.',
  ].join(' ');
}

/**
 * Generate a cover image with the MiniMax image model.
 *
 * @param {object} options - the call parameters.
 * @param {string} options.title - the book title.
 * @param {object} [deps] - the injected dependencies.
 * @returns {Promise<{url: string, width: number, height: number}>} the cover.
 */
export async function coverImage({ title }, deps = {}) {
  const key = deps.key ?? readApiKey(deps);
  if (key === null || key === '') {
    const error = new Error('未配置 MiniMax API Key');
    error.code = 'NO_KEY';
    throw error;
  }
  const doFetch = deps.fetch ?? globalThis.fetch;
  const prompt = deps.prompt ?? coverPrompt(title);
  const timeoutMs = Number.isFinite(deps.timeoutMs) && deps.timeoutMs > 0 ? deps.timeoutMs : 120000;
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, timeoutMs);
  try {
    const response = await doFetch(`${BASE_URL}/image_generation`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: deps.model ?? IMAGE_MODEL,
        prompt,
        aspect_ratio: '2:3',
        n: 1,
        response_format: 'url',
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(providerErrorMessage({ status: response.status }));
      error.cause = new Error(payload?.error?.message ?? `HTTP ${response.status}`);
      error.code = payload?.error?.type ?? 'HTTP_ERROR';
      throw error;
    }
    const urls = payload?.data?.image_urls ?? payload?.data?.images ?? [];
    const imageUrl = Array.isArray(urls) ? urls[0] : null;
    if (typeof imageUrl !== 'string' || imageUrl === '') {
      const error = new Error('MiniMax 没有返回图片');
      error.code = 'EMPTY_IMAGE';
      throw error;
    }
    // The picture is fetched here and handed over as a data URL, so the shelf
    // never depends on the network.
    const picture = await doFetch(imageUrl);
    if (!picture.ok) {
      const error = new Error('封面图片下载失败');
      error.code = 'IMAGE_DOWNLOAD_FAILED';
      throw error;
    }
    const bytes = Buffer.from(await picture.arrayBuffer());
    const type = picture.headers?.get?.('content-type') ?? 'image/jpeg';
    return {
      url: `data:${type};base64,${bytes.toString('base64')}`,
      width: Number(payload?.data?.width ?? 0),
      height: Number(payload?.data?.height ?? 0),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Transcribe a recording with the MiniMax speech recognition model.
 *
 * The browser's own recognition needs a Google speech service, which the
 * desktop app does not have; this is the replacement.
 *
 * @param {object} options - the call parameters.
 * @param {string} options.audio - the recording, base64 encoded.
 * @param {string} [options.mimeType] - the audio mime type.
 * @param {object} [deps] - the injected dependencies.
 * @returns {Promise<{text: string, duration: number}>} the transcript.
 */
export async function asr({ audio, mimeType = 'audio/webm' }, deps = {}) {
  const key = deps.key ?? readApiKey(deps);
  if (key === null || key === '') {
    const error = new Error('未配置 MiniMax API Key');
    error.code = 'NO_KEY';
    throw error;
  }
  const doFetch = deps.fetch ?? globalThis.fetch;
  if (typeof doFetch !== 'function') {
    const error = new Error('当前环境不支持 fetch');
    error.code = 'NO_FETCH';
    throw error;
  }
  const bytes = Buffer.from(String(audio ?? ''), 'base64');
  if (bytes.length === 0) {
    const error = new Error('没有可识别的音频');
    error.code = 'EMPTY_AUDIO';
    throw error;
  }
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mimeType }), 'recording.webm');
  form.append('model', deps.model ?? ASR_MODEL);
  const timeoutMs = Number.isFinite(deps.timeoutMs) && deps.timeoutMs > 0 ? deps.timeoutMs : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, timeoutMs);
  try {
    const response = await doFetch(`${BASE_URL}/speech_to_text`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(providerErrorMessage({ status: response.status }));
      error.cause = new Error(payload?.error?.message ?? `HTTP ${response.status}`);
      error.code = payload?.error?.type ?? 'HTTP_ERROR';
      throw error;
    }
    return {
      text: typeof payload?.text === 'string' ? payload.text : '',
      duration: Number(payload?.duration ?? 0),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * List the system voices of the MiniMax account.
 *
 * @param {object} [deps] - the injected dependencies.
 * @returns {Promise<{id: string, name: string}[]>} the English voices.
 */
export async function voices(deps = {}) {
  const payload = await request('/get_voice', { voice_type: 'all' }, deps);
  const list = Array.isArray(payload?.system_voice) ? payload.system_voice : [];
  return list
    .filter((voice) => voice && typeof voice.voice_id === 'string')
    .filter((voice) => {
      const id = voice.voice_id.toLowerCase();
      const name = String(voice.voice_name ?? '');
      return id.startsWith('english') || /英文|英语/i.test(name);
    })
    .map((voice) => ({ id: voice.voice_id, name: String(voice.voice_name ?? voice.voice_id) }));
}

/**
 * The capabilities of the channel, for the client's status call.
 *
 * @param {object} [deps] - the injected dependencies.
 * @returns {{minimax: boolean, chatModel: string, ttsModel: string}} the status.
 */
export function status(deps = {}) {
  return {
    minimax: isAvailable(deps),
    chatModel: CHAT_MODEL,
    ttsModel: TTS_MODEL,
  };
}
