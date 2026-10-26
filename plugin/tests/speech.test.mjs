/**
 * Pronouncing a word: the cloud voice first, the built-in voice as the
 * fallback.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blobToBase64, playAudio, speakLocally, speakWord } from '../src/lib/speech.js';

test('playAudio 等待音频播放结束', async () => {
  let ended = null;
  class FakeAudio {
    constructor(url) {
      this.src = url;
      ended = this;
    }
    play() {
      setTimeout(() => { this.onended?.(); }, 1);
      return Promise.resolve();
    }
  }
  await playAudio('data:audio/mp3;base64,AA', { AudioCtor: FakeAudio });
  assert.equal(ended.src, 'data:audio/mp3;base64,AA');
});

test('speakWord 优先用云端音色', async () => {
  const calls = [];
  class FakeAudio {
    constructor(url) { this.src = url; setTimeout(() => { this.onended?.(); }, 1); }
    play() { return Promise.resolve(); }
  }
  const result = await speakWord('universally', {
    voiceId: 'mm:English_Graceful_Lady',
    AudioCtor: FakeAudio,
    askTts: async (payload) => {
      calls.push(payload);
      return { url: 'data:audio/mp3;base64,BB', durationMs: 900 };
    },
  });
  assert.equal(result, 'cloud');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].text, 'universally');
  assert.equal(calls[0].voiceId, 'mm:English_Graceful_Lady');
});

test('speakWord 在云端失败时用自带语音', async () => {
  const spoken = [];
  const result = await speakWord('universally', {
    synth: {
      speak: (utterance) => spoken.push(utterance.text),
      cancel: () => {},
    },
    utteranceFactory: (text) => ({ text, rate: 1 }),
    askTts: async () => { throw new Error('云端不可用'); },
  });
  assert.equal(result, 'local');
  assert.deepEqual(spoken, ['universally']);
});

test('speakWord 空词什么都不做', async () => {
  assert.equal(await speakWord('   ', { askTts: async () => { throw new Error('不该调用'); } }), 'none');
});

test('speakLocally 没有语音能力时返回 false', () => {
  assert.equal(speakLocally('word', { synth: undefined }), false);
});

test('blobToBase64 把录音转成可上传的字符串', async () => {
  const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/webm' });
  const base64 = await blobToBase64(blob);
  assert.equal(Buffer.from(base64, 'base64').length, 4);
  assert.equal(Buffer.from(base64, 'base64')[0], 1);
});
