/**
 * The MiniMax host channel: the key, the chat, the speech and the voices.
 *
 * Every request is served by a fake fetch, so the tests never reach the
 * network.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  asr, chat, coverImage, coverPrompt, isAvailable, readApiKey, status, tts, voices,
} from '../src/host/minimax.js';

/**
 * A fetch that answers with one JSON body.
 * @param {object} payload - the body to answer with.
 * @param {object} [options] - the options.
 * @param {number} [options.status] - the HTTP status.
 * @param {Array} [options.calls] - the calls to record.
 * @returns {Function} the fake fetch.
 */
function fakeFetch(payload, options = {}) {
  const calls = options.calls ?? [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: (options.status ?? 200) < 400,
      status: options.status ?? 200,
      json: async () => payload,
    };
  };
  return fn;
}

test('readApiKey 优先用环境变量，其次用私有文件', () => {
  assert.equal(readApiKey({ env: { MINIMAX_API_KEY: ' sk-from-env ' } }), 'sk-from-env');
  assert.equal(readApiKey({ env: {}, keyFile: '/nonexistent/key' }), null);
  assert.equal(isAvailable({ env: { MINIMAX_API_KEY: 'k' } }), true);
  assert.equal(isAvailable({ env: {}, keyFile: '/nonexistent/key' }), false);
});

test('status 说明通道是否可用', () => {
  const value = status({ env: { MINIMAX_API_KEY: 'k' } });
  assert.equal(value.minimax, true);
  assert.equal(value.chatModel, 'MiniMax-Text-01');
  assert.equal(value.ttsModel, 'speech-02-hd');
});

test('chat 用 system 与 user 两条消息换来一段回答', async () => {
  const calls = [];
  const doFetch = fakeFetch({ choices: [{ message: { content: 'Pong!' } }] }, { calls });
  const answer = await chat(
    { system: '你是助手', user: '说 pong', maxTokens: 20 },
    { key: 'k', fetch: doFetch },
  );
  assert.equal(answer, 'Pong!');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /chat\/completions$/);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.messages[0].role, 'system');
  assert.equal(body.messages[1].content, '说 pong');
  assert.equal(body.max_completion_tokens, 20);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer k');
});

test('chat 没有可用 key 时报错', async () => {
  await assert.rejects(
    () => chat({ system: 's', user: 'u' }, { key: '', fetch: fakeFetch({}) }),
    (error) => error.code === 'NO_KEY',
  );
});

test('chat 把鉴权失败翻译成中文', async () => {
  const doFetch = fakeFetch({ error: { message: 'invalid api key' } }, { status: 401 });
  await assert.rejects(
    () => chat({ system: 's', user: 'u' }, { key: 'k', fetch: doFetch }),
    /鉴权失败/,
  );
});

test('tts 把十六进制音频变成可播放的 data URL', async () => {
  const calls = [];
  const hex = Buffer.from('ID3-audio-bytes').toString('hex');
  const doFetch = fakeFetch(
    { data: { audio: hex, status: 2 }, extra_info: { audio_length: 3996, audio_format: 'mp3' } },
    { calls },
  );
  const audio = await tts({ text: 'Hello', voiceId: 'English_Graceful_Lady', speed: 1.25 }, { key: 'k', fetch: doFetch });
  assert.match(audio.url, /^data:audio\/mp3;base64,/);
  assert.equal(audio.durationMs, 3996);
  assert.equal(audio.format, 'mp3');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.voice_setting.voice_id, 'English_Graceful_Lady');
  assert.equal(body.voice_setting.speed, 1.25);
  assert.equal(body.audio_setting.format, 'mp3');
});

test('tts 语速被夹在 0.5 到 2 之间', async () => {
  const calls = [];
  const doFetch = fakeFetch({ data: { audio: '00' } }, { calls });
  await tts({ text: 'Hello', speed: 9 }, { key: 'k', fetch: doFetch });
  assert.equal(JSON.parse(calls[0].init.body).voice_setting.speed, 2);
});

test('tts 没有内容时不发请求', async () => {
  await assert.rejects(
    () => tts({ text: '  ' }, { key: 'k', fetch: fakeFetch({}) }),
    (error) => error.code === 'EMPTY_TEXT',
  );
});

test('voices 给出中英文音色并带上语言', async () => {
  const doFetch = fakeFetch({
    system_voice: [
      { voice_id: 'English_Graceful_Lady', voice_name: 'Graceful Lady' },
      { voice_id: 'female-shaonv', voice_name: '少女音色' },
      { voice_id: 'male-qn-jingying', voice_name: '精英青年音色' },
    ],
  });
  const list = await voices({ key: 'k', fetch: doFetch });
  assert.deepEqual(list, [
    { id: 'English_Graceful_Lady', name: 'Graceful Lady', lang: 'en-US' },
    { id: 'female-shaonv', name: '少女音色', lang: 'zh-CN' },
    { id: 'male-qn-jingying', name: '精英青年音色', lang: 'zh-CN' },
  ]);
});

test('asr 把录音交给模型并拿回转写文本', async () => {
  const calls = [];
  const doFetch = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ text: 'Hello world, this is a reading test.', duration: 3.38 }),
    };
  };
  const result = await asr({ audio: Buffer.from('fake-audio').toString('base64'), mimeType: 'audio/webm' }, { key: 'k', fetch: doFetch });
  assert.equal(result.text, 'Hello world, this is a reading test.');
  assert.equal(result.duration, 3.38);
  assert.match(calls[0].url, /speech_to_text$/);
  // the model name is the one MiniMax accepts
  assert.equal(calls[0].init.body.get('model'), 'asr-1.0');
});

test('asr 没有音频时不发请求', async () => {
  await assert.rejects(
    () => asr({ audio: '' }, { key: 'k', fetch: async () => { throw new Error('不该调用'); } }),
    (error) => error.code === 'EMPTY_AUDIO',
  );
});

test('coverPrompt 只把书名交给模型，不让它写作者名', () => {
  const prompt = coverPrompt('MOVE: the 4-question Go-To-Market Framework');
  assert.match(prompt, /MOVE: the 4-question Go-To-Market Framework/);
  assert.match(prompt, /No author name/);
});

test('coverImage 生成封面并交回 data URL', async () => {
  const calls = [];
  const doFetch = async (url, init) => {
    calls.push({ url, init });
    if (url.includes('image_generation')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { image_urls: ['https://example.test/cover.jpg'] } }),
      };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    };
  };
  const cover = await coverImage({ title: 'A Book' }, { key: 'k', fetch: doFetch });
  assert.match(cover.url, /^data:image\/jpeg;base64,/);
  assert.equal(calls.length, 2);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, 'image-01');
  assert.equal(body.aspect_ratio, '2:3');
});
