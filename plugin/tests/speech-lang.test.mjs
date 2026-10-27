/**
 * 语音通道的语言感知：中文书也要能听。
 *
 * 覆盖：
 *   - tts.js：lang 选项、中文音色列表、没有匹配时回落到全集、
 *     setLanguage 换音色、英文行为不变
 *   - minimax.js：云端音色表同时给出中英文音色，并带上语言
 *
 * 运行：node --test tests/speech-lang.test.mjs
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createTts } from '../src/lib/engine/tts.js';
import { detectVoiceLanguage, voices } from '../src/host/minimax.js';

/**
 * 一台会报出这几种语音的机器。
 *
 * @param {{voiceURI: string, name: string, lang: string}[]} list - the voices.
 * @returns {any} the fake speechSynthesis.
 */
function fakeSynth(list) {
  return {
    spoken: [],
    getVoices: () => list,
    speak(utterance) {
      this.spoken.push(utterance);
    },
    cancel() {},
    pause() {},
    resume() {},
  };
}

/** 一台只装了英文语音的机器。 */
const ENGLISH_MACHINE = [
  { voiceURI: 'z', name: 'Zoe', lang: 'en-US' },
  { voiceURI: 'a', name: 'Alice', lang: 'en-GB' },
  { voiceURI: 'f', name: 'Fang', lang: 'zh-CN' },
  { voiceURI: 'b', name: 'Bob', lang: 'EN-au' },
];

/**
 * 一个假的服务端音色表。
 *
 * @param {object[]} list - the voices the provider answers with.
 * @returns {Function} the fake fetch.
 */
function fakeFetch(list) {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({ system_voice: list }),
  });
}

// ------------------------------------------------------------------- tts.js

test('tts: lang zh 的控制器只列出中文语音', () => {
  const tts = createTts({ synth: fakeSynth(ENGLISH_MACHINE), lang: 'zh' });
  assert.deepEqual(tts.listVoices().map((v) => v.name), ['Fang']);
  assert.equal(tts.getLanguage(), 'zh');
});

test('tts: 没有匹配到语音时回落到全集，音色列表不会空', () => {
  const synth = fakeSynth([{ voiceURI: 'z', name: 'Zoe', lang: 'en-US' }]);
  const tts = createTts({ synth, lang: 'zh' });
  const list = tts.listVoices();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'Zoe');
});

test('tts: 一条语音都没有时列表也是空的，不会报错', () => {
  const tts = createTts({ synth: fakeSynth([]), lang: 'zh' });
  assert.deepEqual(tts.listVoices(), []);
});

test('tts: setLanguage 把音色换成会说新语言的那个', () => {
  const tts = createTts({ synth: fakeSynth(ENGLISH_MACHINE) });
  tts.setVoice('z');
  assert.equal(tts.getVoice().id, 'z');
  assert.equal(tts.setLanguage('zh'), 'zh');
  assert.equal(tts.getVoice().id, 'f');
  assert.equal(tts.getVoice().lang, 'zh-CN');
  assert.deepEqual(tts.listVoices().map((v) => v.name), ['Fang']);
});

test('tts: setLanguage 换回英文时音色也跟着换', () => {
  const tts = createTts({ synth: fakeSynth(ENGLISH_MACHINE), lang: 'zh' });
  tts.setVoice('f');
  assert.equal(tts.getVoice().id, 'f');
  tts.setLanguage('en');
  // 换的是第一个会英语的音色：列表按 name 排序，第一个是 Alice
  assert.equal(tts.getVoice().id, 'a');
  assert.equal(tts.getVoice().lang, 'en-GB');
  assert.deepEqual(tts.listVoices().map((v) => v.name), ['Alice', 'Bob', 'Zoe']);
});

test('tts: 新语言没有语音时保留当前音色，朗读器仍然出声', () => {
  const synth = fakeSynth([{ voiceURI: 'z', name: 'Zoe', lang: 'en-US' }]);
  const tts = createTts({ synth });
  tts.setVoice('z');
  tts.setLanguage('zh');
  assert.equal(tts.getVoice().id, 'z');
  assert.equal(tts.getLanguage(), 'zh');
  tts.speak('你好');
  assert.equal(synth.spoken.length, 1);
  assert.equal(synth.spoken[0].voice.voiceURI, 'z');
});

test('tts: 没选音色时告诉浏览器要读哪种语言', () => {
  const synth = fakeSynth([]);
  const tts = createTts({ synth, lang: 'zh' });
  tts.speak('你好，世界');
  assert.equal(synth.spoken[0].lang, 'zh-CN');
});

test('tts: 不传 lang 时行为与从前一致：英文语音、按 name 排序', () => {
  const tts = createTts({ synth: fakeSynth(ENGLISH_MACHINE) });
  assert.equal(tts.getLanguage(), 'en');
  assert.deepEqual(tts.listVoices().map((v) => v.name), ['Alice', 'Bob', 'Zoe']);
  tts.setVoice('z');
  assert.equal(tts.getVoice().id, 'z');
  assert.equal(tts.getVoice().name, 'Zoe');
});

test('tts: 云端音色按语言过滤，中文云端音色带中文语言', () => {
  const tts = createTts({
    synth: fakeSynth([]),
    getCloudVoices: () => [
      { id: 'English_Graceful_Lady', name: 'Graceful Lady', lang: 'en-US' },
      { id: 'Chinese (Mandarin)_News_Anchor', name: '新闻女声', lang: 'zh-CN' },
    ],
  });
  assert.deepEqual(tts.listVoices().map((v) => v.id), ['mm:English_Graceful_Lady']);
  tts.setLanguage('zh');
  assert.deepEqual(tts.listVoices().map((v) => v.id), ['mm:Chinese (Mandarin)_News_Anchor']);
});

test('tts: 选中云端音色后记下它的语言，不会当成英文', () => {
  const tts = createTts({
    synth: fakeSynth([]),
    getCloudVoices: () => [
      { id: 'English_Graceful_Lady', name: 'Graceful Lady', lang: 'en-US' },
      { id: 'Chinese (Mandarin)_News_Anchor', name: '新闻女声', lang: 'zh-CN' },
    ],
  });
  tts.setVoice('mm:Chinese (Mandarin)_News_Anchor');
  assert.equal(tts.getVoice().name, '新闻女声');
  assert.equal(tts.getVoice().lang, 'zh-CN');
  // 已经是中文音色，换语言时不该被换掉
  tts.setLanguage('zh');
  assert.equal(tts.getVoice().id, 'mm:Chinese (Mandarin)_News_Anchor');
});

// --------------------------------------------------------------- minimax.js

test('minimax: 音色表同时给出中英文音色，并带上语言', async () => {
  const list = await voices({
    key: 'k',
    fetch: fakeFetch([
      { voice_id: 'English_Graceful_Lady', voice_name: 'Graceful Lady' },
      { voice_id: 'Chinese (Mandarin)_News_Anchor', voice_name: '新闻女声' },
      { voice_id: 'female-shaonv', voice_name: '少女音色' },
      { voice_id: 'Cantonese_GentleLady', voice_name: '温柔女声' },
      { voice_id: 'Grinch', voice_name: 'Grinch' },
      { voice_id: 'Korean_SweetGirl', voice_name: 'Sweet Girl' },
    ]),
  });
  const ids = list.map((v) => v.id);
  assert.ok(ids.includes('English_Graceful_Lady'), '英文音色必须留着');
  assert.ok(ids.includes('Chinese (Mandarin)_News_Anchor'), '中文音色必须出现');
  assert.ok(ids.includes('female-shaonv'), '没有前缀的中文音色也要出现');
  assert.ok(ids.includes('Cantonese_GentleLady'), '粤语音色也要出现');
  assert.ok(!ids.includes('Korean_SweetGirl'), '别的语言的音色不给');
  const byId = new Map(list.map((v) => [v.id, v]));
  assert.equal(byId.get('English_Graceful_Lady').lang, 'en-US');
  assert.equal(byId.get('Chinese (Mandarin)_News_Anchor').lang, 'zh-CN');
  assert.equal(byId.get('female-shaonv').lang, 'zh-CN');
  assert.equal(byId.get('Cantonese_GentleLady').lang, 'zh-HK');
  assert.equal(byId.get('Grinch').lang, 'en-US');
});

test('minimax: 客户端取第一个音色时，先拿到本书语言的音色', async () => {
  const fetch = fakeFetch([
    { voice_id: 'Chinese (Mandarin)_News_Anchor', voice_name: '新闻女声' },
    { voice_id: 'English_Graceful_Lady', voice_name: 'Graceful Lady' },
  ]);
  const english = await voices({ key: 'k', fetch });
  assert.equal(english[0].id, 'English_Graceful_Lady');
  const chinese = await voices({ key: 'k', fetch, language: 'zh' });
  assert.equal(chinese[0].id, 'Chinese (Mandarin)_News_Anchor');
});

test('minimax: 认不出语言的音色也留着，不会无声消失', async () => {
  const list = await voices({
    key: 'k',
    fetch: fakeFetch([
      { voice_id: 'English_Graceful_Lady', voice_name: 'Graceful Lady' },
      { voice_id: '某个说不清语言的音色', voice_name: '' },
    ]),
  });
  const unknown = list.find((v) => v.id === '某个说不清语言的音色');
  assert.ok(unknown !== undefined, '认不出语言的音色必须留着');
  assert.equal(unknown.lang, '');
});

test('minimax: detectVoiceLanguage 按 id 前缀与名字判断语言', () => {
  assert.equal(detectVoiceLanguage({ voice_id: 'English_Graceful_Lady' }), 'en-US');
  assert.equal(detectVoiceLanguage({ voice_id: 'Chinese (Mandarin)_News_Anchor' }), 'zh-CN');
  assert.equal(detectVoiceLanguage({ voice_id: 'Cantonese_GentleLady' }), 'zh-HK');
  assert.equal(detectVoiceLanguage({ voice_id: 'female-shaonv', voice_name: '少女音色' }), 'zh-CN');
  assert.equal(detectVoiceLanguage({ voice_id: 'Korean_SweetGirl', voice_name: 'Sweet Girl' }), 'ko-KR');
  assert.equal(detectVoiceLanguage({ voice_id: '' }), '');
});
