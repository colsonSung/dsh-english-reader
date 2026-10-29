// The host tests must never reach the network: point the MiniMax key file at
// a path that does not exist, so the channel stays off and the fake Host model
// answers instead.
process.env.READER_MINIMAX_KEY_FILE = '/nonexistent/reader/minimax.key';
/**
 * AI 通道单元测试（对应 CONTRACT-AI.md 1 与 2）。
 *
 * 覆盖：
 *   - src/host/ai.js：正常返回、JSON 解析失败后的重试、模型服务缺失、超时、字段缺失补默认值
 *   - src/lib/ai.js：{ ok: true, result } 解析、{ ok: false, error } 抛中文错误、网络失败抛中文错误
 *   - index.js：路由注册与 { ok, result } / { ok: false, error } 信封
 *
 * 宿主侧用假 llm 服务驱动，不请求任何真实模型。
 *
 * 运行：node --test tests/ai.test.mjs
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { runAiMethod, parseModelJson } from '../src/host/ai.js';
import { askAi, ROUTE } from '../src/lib/ai.js';
import { apply, ROUTE as HOST_ROUTE } from '../index.js';

/** 让流停住，直到请求被中止。 */
const HANG = Symbol('hang');

/**
 * 把一次模型回答变成协议里的流块。
 * @param {string|Symbol} answer - 回答文本，或 HANG。
 * @param {AbortSignal} [signal] - 请求的中止信号。
 * @returns {AsyncGenerator<object>} 流块序列。
 */
async function* chunksOf(answer, signal) {
  if (answer === HANG) {
    await new Promise((resolve) => {
      if (signal?.aborted === true) resolve();
      else signal?.addEventListener('abort', () => resolve(), { once: true });
    });
    yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'aborted', code: 'ABORTED' } } };
    return;
  }
  yield { type: 'block-start', index: 0, blockType: 'text' };
  yield { type: 'text-delta', index: 0, text: answer };
  yield { type: 'block-end', index: 0, block: { type: 'text', text: answer } };
  yield { type: 'finish', reason: { kind: 'stop' } };
}

/**
 * 记录每次调用的假 llm 服务。
 * @param {string|Symbol|Array<string|Symbol>} answers - 依次给出的回答。
 * @returns {object} 假 llm 服务，带 calls 与 streams 记录。
 */
function createFakeLlm(answers) {
  const queue = Array.isArray(answers) ? [...answers] : [answers];
  const calls = [];
  const streams = [];
  return {
    calls,
    streams,
    async prepareCall(config, signal) {
      calls.push({ config: { ...config }, signal });
      const answer = queue.length > 1 ? queue.shift() : queue[0];
      return {
        config: { ...config },
        stream(options) {
          streams.push(options);
          return chunksOf(answer, options?.signal ?? signal);
        },
      };
    },
  };
}

/**
 * 假的默认模型选择服务。
 * @param {string} [provider] - 供应商名。
 * @param {string} [model] - 模型名。
 * @returns {object} 假服务。
 */
function createFakeSelection(provider = 'onerway', model = 'MiniMax-M3.1-Flash') {
  return { currentSelection: () => ({ provider, model }) };
}

/**
 * 一个 json 响应。
 * @param {object} body - 响应体。
 * @param {number} [status] - HTTP 状态码。
 * @returns {object} 假 Response。
 */
function fakeResponse(body, status = 200) {
  return {
    status,
    async json() {
      return body;
    },
  };
}

test('word 方法返回契约写死的字段', async () => {
  const llm = createFakeLlm(JSON.stringify({
    word: 'middle',
    phonetic: '/ˈmɪdɪəl/',
    partOfSpeech: 'adjective',
    definition: '中间的；居中的',
    examples: [{ en: 'the middle of the road', zh: '路的中间' }],
    contextNote: '这里指处于两者之间的位置',
  }));
  const result = await runAiMethod('word', { word: 'middle', sentence: 'He is in the middle.' }, {
    llm,
    agentDefaultModel: createFakeSelection(),
  });

  assert.deepEqual(result, {
    word: 'middle',
    phonetic: '/ˈmɪdɪəl/',
    partOfSpeech: 'adjective',
    definition: '中间的；居中的',
    examples: [{ en: 'the middle of the road', zh: '路的中间' }],
    contextNote: '这里指处于两者之间的位置',
  });
});

test('请求带上了默认模型、温度与 token 上限，消息是 content block 形状', async () => {
  const llm = createFakeLlm('{"word":"x"}');
  await runAiMethod('word', { word: 'x' }, { llm, agentDefaultModel: createFakeSelection() });

  assert.equal(llm.calls.length, 1);
  assert.deepEqual(llm.calls[0].config, {
    provider: 'onerway',
    model: 'MiniMax-M3.1-Flash',
    temperature: 0.2,
    maxTokens: 800,
  });

  const options = llm.streams[0];
  assert.equal(options.provider, 'onerway');
  assert.equal(options.model, 'MiniMax-M3.1-Flash');
  assert.equal(options.temperature, 0.2);
  assert.equal(options.maxTokens, 800);
  assert.equal(options.messages.length, 1);
  assert.equal(options.messages[0].role, 'user');
  assert.equal(options.messages[0].content[0].type, 'text');
  assert.match(options.messages[0].content[0].text, /middle|x/);
  assert.match(options.system, /JSON/);
});

test('translate 与 breakdown 返回各自的结构', async () => {
  const translateLlm = createFakeLlm('{"text":"你好，世界"}');
  const translated = await runAiMethod('translate', { text: 'Hello, world' }, {
    llm: translateLlm,
    agentDefaultModel: createFakeSelection(),
  });
  assert.deepEqual(translated, { text: '你好，世界' });
  assert.equal(translateLlm.calls[0].config.maxTokens, 1200);

  const breakdownLlm = createFakeLlm(JSON.stringify({
    structure: [{ token: 'the man', note: '主语' }],
    translation: '那个男人',
    simplified: 'That man.',
  }));
  const broken = await runAiMethod('breakdown', { sentence: 'The man left.' }, {
    llm: breakdownLlm,
    agentDefaultModel: createFakeSelection(),
  });
  assert.deepEqual(broken, {
    structure: [{ token: 'the man', note: '主语' }],
    translation: '那个男人',
    simplified: 'That man.',
  });
  assert.equal(breakdownLlm.calls[0].config.maxTokens, 1200);
});

test('mindmap 返回一棵分支树，坏数据被丢掉', async () => {
  const llm = createFakeLlm(JSON.stringify({
    title: '人物关系',
    branches: [
      { label: '主线', quote: 'It was a bright cold day.', items: [{ label: '相遇', note: '第一章', quote: 'a bright cold day' }, { label: '离开' }] },
      { label: '', items: [{ label: '没有分支名' }] },
      { label: '支线', items: [{ label: '一' }, { label: '二' }] },
    ],
  }));
  const result = await runAiMethod('mindmap', { title: 'A Novel', chapterTitle: 'Chapter One', text: 'It was a bright cold day.' }, {
    llm,
    agentDefaultModel: createFakeSelection(),
  });

  assert.equal(result.title, '人物关系');
  assert.deepEqual(result.branches.map((branch) => branch.label), ['主线', '支线']);
  // The quote travels with the node: it is how the learner gets back to the
  // passage the node came from.
  assert.deepEqual(result.branches[0].items, [
    { label: '相遇', note: '第一章', quote: 'a bright cold day' },
    { label: '离开', note: '', quote: '' },
  ]);
  assert.equal(result.branches[0].quote, 'It was a bright cold day.');
  // The prompt carries the book, the chapter and the text.
  const prompt = llm.streams[0].messages[0].content[0].text;
  assert.match(prompt, /A Novel/);
  assert.match(prompt, /Chapter One/);
  assert.match(prompt, /bright cold day/);
});

test('podcast 返回逐句对话，主持人与嘉宾被认出来', async () => {
  const llm = createFakeLlm(JSON.stringify({
    title: 'The Opening',
    summary: 'Why the novel begins here.',
    dialogue: [
      { speaker: 'Host', text: 'What happened before page one?' },
      { speaker: 'Guest', text: 'Plenty, and the novel wants us to feel it.' },
      { speaker: 'host', text: '' },
    ],
  }));
  const result = await runAiMethod('podcast', { title: 'A Novel', chapterTitle: 'Chapter One', text: 'It was a bright cold day.' }, {
    llm,
    agentDefaultModel: createFakeSelection(),
  });

  assert.equal(result.title, 'The Opening');
  assert.equal(result.summary, 'Why the novel begins here.');
  assert.deepEqual(result.dialogue, [
    { speaker: 'host', text: 'What happened before page one?' },
    { speaker: 'guest', text: 'Plenty, and the novel wants us to feel it.' },
  ]);
});

test('podcast 分章节与全书两种范围', async () => {
  const llm = createFakeLlm('{"title":"x","summary":"y","dialogue":[]}');
  await runAiMethod('podcast', { title: 'A Novel', chapterTitle: 'Chapter One', scope: 'chapter', text: 'It was a bright cold day.' }, {
    llm,
    agentDefaultModel: createFakeSelection(),
  });
  assert.match(llm.streams[0].messages[0].content[0].text, /章节：Chapter One/);

  const bookLlm = createFakeLlm('{"title":"x","summary":"y","dialogue":[]}');
  await runAiMethod('podcast', { title: 'A Novel', chapterTitle: 'The whole book', scope: 'book', text: '[Chapter One] It was a bright cold day.' }, {
    llm: bookLlm,
    agentDefaultModel: createFakeSelection(),
  });
  const prompt = bookLlm.streams[0].messages[0].content[0].text;
  assert.match(prompt, /范围：全书/);
  assert.match(prompt, /覆盖全书的主要脉络/);
});

test('podcastReply 接过学员的插话', async () => {
  const llm = createFakeLlm(JSON.stringify({
    lines: [
      { speaker: 'host', text: 'Good question. Let us go back to it.' },
      { speaker: 'guest', text: 'The clue is in the first paragraph.' },
    ],
  }));
  const result = await runAiMethod('podcastReply', {
    title: 'A Novel',
    chapterTitle: 'Chapter One',
    text: 'host: Welcome to the episode.',
    said: 'But why does he say that?',
  }, {
    llm,
    agentDefaultModel: createFakeSelection(),
  });

  assert.deepEqual(result.lines, [
    { speaker: 'host', text: 'Good question. Let us go back to it.' },
    { speaker: 'guest', text: 'The clue is in the first paragraph.' },
  ]);
  const prompt = llm.streams[0].messages[0].content[0].text;
  assert.match(prompt, /But why does he say that\?/);
  assert.match(prompt, /Welcome to the episode/);
});

test('podcastReply 没有学员的话就不该发生', async () => {
  const llm = createFakeLlm('{"lines":[]}');
  await assert.rejects(
    () => runAiMethod('podcastReply', { said: '' }, { llm, agentDefaultModel: createFakeSelection() }),
    /缺少学员说的话/,
  );
});

test('mindmap 与 podcast 都要有正文，正文太长会被截断', async () => {
  const llm = createFakeLlm('{"title":"x","branches":[],"dialogue":[]}');
  await assert.rejects(
    () => runAiMethod('mindmap', { text: '' }, { llm, agentDefaultModel: createFakeSelection() }),
    /缺少要整理的章节内容/,
  );
  await assert.rejects(
    () => runAiMethod('podcast', { text: '' }, { llm, agentDefaultModel: createFakeSelection() }),
    /缺少要改写的章节内容/,
  );

  const longLlm = createFakeLlm('{"title":"x","branches":[],"dialogue":[]}');
  await runAiMethod('mindmap', { text: 'a'.repeat(30000) }, { llm: longLlm, agentDefaultModel: createFakeSelection() });
  const prompt = longLlm.streams[0].messages[0].content[0].text;
  assert.ok(prompt.length < 30000, 'the prompt must not carry the whole chapter');
});

test('模型带 markdown 包裹时也能解析', async () => {
  const llm = createFakeLlm('```json\n{"text":"你好"}\n```');
  const result = await runAiMethod('translate', { text: 'Hello' }, {
    llm,
    agentDefaultModel: createFakeSelection(),
  });
  assert.deepEqual(result, { text: '你好' });
});

test('JSON 解析失败时重试一次，第二次成功即返回', async () => {
  const llm = createFakeLlm(['这不是 JSON', '{"text":"重试后成功"}']);
  const result = await runAiMethod('translate', { text: 'Hello' }, {
    llm,
    agentDefaultModel: createFakeSelection(),
  });

  assert.deepEqual(result, { text: '重试后成功' });
  assert.equal(llm.calls.length, 2);
  assert.match(llm.streams[1].system, /只输出一个 JSON 对象/);
});

test('两次都不是 JSON 时抛出中文错误', async () => {
  const llm = createFakeLlm(['仍然不是 JSON', '依然不是 JSON']);
  await assert.rejects(
    () => runAiMethod('translate', { text: 'Hello' }, { llm, agentDefaultModel: createFakeSelection() }),
    (error) => {
      assert.match(error.message, /JSON/);
      assert.doesNotMatch(error.message, /[A-Za-z]{4,}\s*at\s/);
      return true;
    },
  );
  assert.equal(llm.calls.length, 2);
});

test('模型服务缺失时返回宿主未配置模型的文案', async () => {
  await assert.rejects(
    () => runAiMethod('word', { word: 'x' }, { agentDefaultModel: createFakeSelection() }),
    (error) => {
      assert.equal(error.message, '宿主未配置可用模型，AI 释义不可用');
      return true;
    },
  );

  await assert.rejects(
    () => runAiMethod('word', { word: 'x' }, { llm: createFakeLlm('{}') }),
    (error) => {
      assert.equal(error.message, '宿主未配置可用模型，AI 释义不可用');
      return true;
    },
  );
});

test('请求超时抛出中文错误', async () => {
  const llm = createFakeLlm(HANG);
  await assert.rejects(
    () => runAiMethod('word', { word: 'x' }, {
      llm,
      agentDefaultModel: createFakeSelection(),
      timeoutMs: 40,
    }),
    (error) => {
      assert.match(error.message, /超时/);
      return true;
    },
  );
});

test('字段缺失时补默认值', async () => {
  const llm = createFakeLlm('{}');
  const result = await runAiMethod('word', { word: 'middle' }, {
    llm,
    agentDefaultModel: createFakeSelection(),
  });
  assert.deepEqual(result, {
    word: 'middle',
    phonetic: '',
    partOfSpeech: '',
    definition: '',
    examples: [],
    contextNote: '',
  });

  const breakdownLlm = createFakeLlm('{}');
  const broken = await runAiMethod('breakdown', { sentence: 'The man left.' }, {
    llm: breakdownLlm,
    agentDefaultModel: createFakeSelection(),
  });
  assert.deepEqual(broken, { structure: [], translation: '', simplified: '' });
});

test('不支持的方法与缺少参数都抛出中文错误', async () => {
  await assert.rejects(
    () => runAiMethod('summarise', {}, { llm: createFakeLlm('{}'), agentDefaultModel: createFakeSelection() }),
    (error) => {
      assert.match(error.message, /不支持的 AI 方法/);
      return true;
    },
  );
  await assert.rejects(
    () => runAiMethod('word', {}, { llm: createFakeLlm('{}'), agentDefaultModel: createFakeSelection() }),
    (error) => {
      assert.match(error.message, /缺少要查询的单词/);
      return true;
    },
  );
});

test('模型服务报错时给出中文提示而不是英文堆栈', async () => {
  const llm = {
    async prepareCall() {
      const error = new Error('no adapter registered for provider "onerway"');
      error.code = 'NO_ADAPTER';
      throw error;
    },
  };
  await assert.rejects(
    () => runAiMethod('word', { word: 'x' }, { llm, agentDefaultModel: createFakeSelection() }),
    (error) => {
      assert.equal(error.message, '宿主未配置可用模型，AI 释义不可用');
      return true;
    },
  );
});

test('parseModelJson 能从夹带说明文字的答案里取出对象', () => {
  assert.deepEqual(parseModelJson('好的：{"a":1}'), { a: 1 });
  assert.throws(() => parseModelJson('完全不是 JSON'));
});

test('客户端在 ok 为 true 时返回 result', async () => {
  const seen = [];
  const result = await askAi('word', { word: 'middle' }, {
    fetch: async (url, init) => {
      seen.push({ url, init });
      return fakeResponse({ ok: true, result: { word: 'middle', definition: '中间的' } });
    },
  });
  assert.deepEqual(result, { word: 'middle', definition: '中间的' });
  assert.equal(seen[0].url, ROUTE);
  assert.equal(seen[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(seen[0].init.body), { method: 'word', payload: { word: 'middle' } });
});

test('客户端在 ok 为 false 时抛出中文错误', async () => {
  await assert.rejects(
    () => askAi('word', { word: 'middle' }, {
      fetch: async () => fakeResponse({ ok: false, error: { code: 'reader/failed', message: '宿主未配置可用模型，AI 释义不可用' } }),
    }),
    (error) => {
      assert.equal(error.message, '宿主未配置可用模型，AI 释义不可用');
      return true;
    },
  );

  await assert.rejects(
    () => askAi('word', { word: 'middle' }, {
      fetch: async () => fakeResponse({ ok: false, error: { code: 'reader/failed', message: '' } }),
    }),
    (error) => {
      assert.match(error.message, /AI 辅助请求失败/);
      return true;
    },
  );
});

test('客户端在网络失败时抛出中文错误', async () => {
  await assert.rejects(
    () => askAi('word', { word: 'middle' }, {
      fetch: async () => {
        throw new Error('fetch failed');
      },
    }),
    (error) => {
      assert.equal(error.message, '无法连接宿主服务，AI 功能暂不可用');
      return true;
    },
  );
});

test('客户端在宿主没有装载插件时抛出中文错误', async () => {
  await assert.rejects(
    () => askAi('word', { word: 'middle' }, {
      fetch: async () => fakeResponse({}, 404),
    }),
    (error) => {
      assert.match(error.message, /重启应用/);
      return true;
    },
  );
});

test('宿主路由注册在 connection 上，并返回 { ok, result } 信封', async () => {
  let route;
  const ctx = {
    services: {
      llm: createFakeLlm('{"text":"你好"}'),
      agentDefaultModel: createFakeSelection(),
    },
    get(name) {
      return this.services[name];
    },
    inject(names, callback) {
      callback({
        effect(fn) {
          return fn();
        },
        connection: {
          fetch: {
            register(definition) {
              route = definition;
              return () => {};
            },
          },
        },
      });
    },
  };
  apply(ctx);

  assert.equal(route.path, HOST_ROUTE);
  assert.deepEqual(route.methods, ['POST']);
  assert.equal(route.requestBody, 'buffered');

  const request = new Request('http://127.0.0.1/api/reader', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'translate', payload: { text: 'Hello' } }),
  });
  const response = await route.fetch(request);
  assert.deepEqual(await response.json(), { ok: true, result: { text: '你好' } });
});

test('宿主路由在失败时返回 { ok: false, error } 信封', async () => {
  let route;
  const ctx = {
    services: { llm: undefined, agentDefaultModel: createFakeSelection() },
    get(name) {
      return this.services[name];
    },
    inject(names, callback) {
      callback({
        effect(fn) {
          return fn();
        },
        connection: {
          fetch: {
            register(definition) {
              route = definition;
              return () => {};
            },
          },
        },
      });
    },
  };
  apply(ctx);

  const request = new Request('http://127.0.0.1/api/reader', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'word', payload: { word: 'middle' } }),
  });
  const response = await route.fetch(request);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.error.message, '宿主未配置可用模型，AI 释义不可用');
});
