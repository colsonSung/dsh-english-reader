/**
 * Host half of the AI assist channel.
 *
 * The client half asks the Host for a model-backed answer — a word sheet, a
 * translation, a sentence breakdown. This module owns that conversation: it
 * picks the Host's default model, asks it for exactly one JSON object, and
 * hands the client back the shape the contract freezes.
 *
 * The Host's `llm` service is the only path into a model. This module never
 * talks to a provider itself, and it never renders anything.
 *
 * Every dependency is injectable so the behaviour can be tested without a
 * model: `llm`, `agentDefaultModel` and `timeoutMs`.
 */

/** The methods the client half may ask for. */
export const AI_METHODS = Object.freeze(['word', 'translate', 'breakdown', 'mindmap', 'podcast', 'podcastReply']);

/** Wall-clock budget for one request, covering the JSON retry as well. */
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * How much of a chapter goes into one model request.
 *
 * The model is asked for an outline, not for a retelling of every sentence, so
 * a long chapter is cut rather than dropped: its head carries the argument the
 * outline is built on.
 */
const MAX_SOURCE_CHARS = 12000;

/** Sampling temperature: the answer is a fact sheet, not prose. */
const TEMPERATURE = 0.2;

/** Raised when the Host has no model to answer with. */
const NO_MODEL_MESSAGE = '宿主未配置可用模型，AI 释义不可用';

/** Raised when the model answered but the answer was not usable JSON. */
const JSON_ERROR_MESSAGE = 'AI 返回的内容不是有效的 JSON，请重试';

/**
 * The system prompt of every method. The model is told to answer with one
 * JSON object and nothing else; the client renders fixed fields, so any prose
 * around the object would break the contract.
 */
const SYSTEM_PROMPTS = {
  word: [
    '你是一名英语学习助手，负责给学习者解释一个英文单词。',
    '只输出一个 JSON 对象：不要使用 Markdown 代码块，不要输出解释、前言或结尾语。',
    'JSON 字段说明：',
    '  word: 原词本身',
    '  phonetic: 国际音标，形如 /ˈmɪdɪəl/；不确定时给空字符串',
    '  partOfSpeech: 词性，如 noun、adjective、verb',
    '  definition: 一句话中文释义',
    '  examples: 例句数组，1 到 3 条，每条形如 { "en": "英文例句", "zh": "中文翻译" }',
    '  contextNote: 这个词在给定句子中怎么理解；没有给定句子时写常见用法说明',
    '所有字段都必须出现。',
  ].join('\n'),
  translate: [
    '你是一名英语学习助手，负责把英文内容翻译成中文。',
    '只输出一个 JSON 对象：不要使用 Markdown 代码块，不要输出解释、前言或结尾语。',
    'JSON 字段说明：',
    '  text: 整段内容的中文翻译，保持原文的段落与顺序',
    '所有字段都必须出现。',
  ].join('\n'),
  breakdown: [
    '你是一名英语学习助手，负责拆解英文长难句。',
    '只输出一个 JSON 对象：不要使用 Markdown 代码块，不要输出解释、前言或结尾语。',
    'JSON 字段说明：',
    '  structure: 成分数组，每条形如 { "token": "句子成分或短语", "note": "中文说明" }，按句子顺序排列',
    '  translation: 整句的中文翻译',
    '  simplified: 用简单句重述同一句话的说法',
    '所有字段都必须出现。',
  ].join('\n'),
  mindmap: [
    '你是一名英语学习助手，负责把一章英文内容整理成一张思维导图。',
    '只输出一个 JSON 对象：不要使用 Markdown 代码块，不要输出解释、前言或结尾语。',
    'JSON 字段说明：',
    '  title: 中心主题，10 个字以内',
    '  branches: 一级分支数组，3 到 6 条，每条形如 { "label": "分支标题", "quote": "原文里代表这个分支的一句英文", "items": [ { "label": "要点", "note": "一句话补充，可为空字符串", "quote": "原文里对应这个要点的一句英文" } ] }',
    '  每个分支的 items 为 2 到 4 条；要点要用章节里真实出现的内容，不要编造。',
    '  label 与 note 都用中文，note 不超过 30 个字。',
    '  quote 必须是从原文里**逐字抄下来**的一句英文（不超过 12 个词），学习者靠它在书里跳回这一段；找不到对应原句时给空字符串。',
    '所有字段都必须出现。',
  ].join('\n'),
  podcast: [
    '你是一名英语播客编剧，负责把一章英文内容改写成一段双人对话播客。',
    '只输出一个 JSON 对象：不要使用 Markdown 代码块，不要输出解释、前言或结尾语。',
    'JSON 字段说明：',
    '  title: 本期播客的标题（英文，不超过 12 个词）',
    '  summary: 一句话导语（英文，不超过 30 个词）',
    '  dialogue: 对话数组，8 到 16 条，每条形如 { "speaker": "host" 或 "guest", "text": "这句台词" }',
    '  host 是主持人，负责提问和串场；guest 是嘉宾，负责讲解。',
    '  所有台词都必须用英文，内容只围绕给定的范围，不要编造没有的情节。',
    '  每句台词 20 到 60 个词，口语化，适合朗读。',
    '所有字段都必须出现。',
  ].join('\n'),
  podcastReply: [
    '你是一档英语播客的主持人。学员正在听节目时插话，你要自然地接住它，再把这期节目继续讲下去。',
    '只输出一个 JSON 对象：不要使用 Markdown 代码块，不要输出解释、前言或结尾语。',
    'JSON 字段说明：',
    '  lines: 台词数组，2 到 4 条，每条形如 { "speaker": "host" 或 "guest", "text": "这句台词" }',
    '  先回应学员刚说的话，再顺着节目原来的话题继续。',
    '  所有台词用英文，语气自然口语化，每句 20 到 60 个词，适合朗读。',
    '所有字段都必须出现。',
  ].join('\n'),
};

/**
 * Read a string field and trim it.
 * @param {any} value - any value.
 * @returns {string} the trimmed string, or '' when the value is not a string.
 */
function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Build an error with a Chinese, user-facing message.
 * @param {string} message - the Chinese message.
 * @param {any} [cause] - the underlying failure, kept for diagnosis only.
 * @returns {Error} the error.
 */
function aiError(message, cause) {
  const error = new Error(message);
  if (cause !== undefined) error.cause = cause;
  return error;
}

/**
 * Translate a model-service failure into a Chinese sentence. The original
 * error never reaches the user; it stays on `cause`.
 * @param {any} error - the thrown failure.
 * @returns {string} the Chinese message.
 */
function modelErrorMessage(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  if (code === 'NO_ADAPTER') return NO_MODEL_MESSAGE;
  if (code === 'MISSING_CREDENTIAL') return '宿主模型缺少可用凭据，AI 释义不可用';
  if (code === 'INVALID_CREDENTIAL') return '宿主模型凭据无效，请检查模型配置';
  if (code === 'AUTH') return '宿主模型鉴权失败，请检查模型配置';
  if (code === 'QUOTA' || code === 'ACCOUNT_QUOTA') return '宿主模型额度不足，请检查账户余额';
  if (code === 'RATE_LIMIT') return '模型服务繁忙，请稍后重试';
  if (code === 'CONTEXT_WINDOW_EXCEEDED') return '内容过长，模型无法一次处理';
  if (code === 'ABORTED') return 'AI 请求已取消';
  return 'AI 调用失败，请稍后重试';
}

/**
 * Strip a markdown code fence, if the model wrapped its answer in one.
 * @param {string} raw - the raw model answer.
 * @returns {string} the answer without a fence.
 */
function stripFence(raw) {
  let value = raw.trim();
  if (value.startsWith('```')) {
    value = value.replace(/^```[a-zA-Z]*[ \t]*\r?\n?/, '').replace(/```[ \t]*$/, '').trim();
  }
  return value;
}

/**
 * Parse the model's answer into one JSON object.
 *
 * The answer is fenced often enough that the fence is stripped first. A model
 * that added a sentence around the object still parses: the outermost braces
 * are tried as a second candidate.
 * @param {string} raw - the raw model answer.
 * @returns {object} the parsed object.
 * @throws {Error} when the answer holds no JSON object.
 */
export function parseModelJson(raw) {
  const value = stripFence(typeof raw === 'string' ? raw : '');
  const candidates = [value];
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(value.slice(start, end + 1));
  for (const candidate of candidates) {
    let parsed;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  }
  throw new Error('model answer is not a JSON object');
}

/**
 * The three methods, their prompt, their input check and their result shape.
 *
 * `normalize` is the only place that decides what the client receives, so the
 * contract's fields are guaranteed even when the model omits one.
 */
const SPECS = {
  word: {
    maxTokens: 800,
    /**
     * @param {any} payload - the client payload.
     * @returns {{word: string, sentence: string}} the checked input.
     */
    validate(payload) {
      const word = text(payload?.word);
      if (word === '') throw aiError('缺少要查询的单词');
      return { word, sentence: text(payload?.sentence) };
    },
    /**
     * @param {{word: string, sentence: string}} request - the checked input.
     * @returns {string} the user prompt.
     */
    user(request) {
      return request.sentence === ''
        ? `单词：${request.word}`
        : `单词：${request.word}\n例句：${request.sentence}`;
    },
    /**
     * @param {any} raw - the model's JSON object.
     * @param {{word: string}} request - the checked input.
     * @returns {object} the client result.
     */
    normalize(raw, request) {
      const examples = (Array.isArray(raw?.examples) ? raw.examples : [])
        .filter((example) => example !== null && typeof example === 'object')
        .map((example) => ({ en: text(example.en), zh: text(example.zh) }))
        .slice(0, 3);
      return {
        word: text(raw?.word) || request.word,
        phonetic: text(raw?.phonetic),
        partOfSpeech: text(raw?.partOfSpeech),
        definition: text(raw?.definition),
        examples,
        contextNote: text(raw?.contextNote),
      };
    },
  },
  translate: {
    maxTokens: 1200,
    /**
     * @param {any} payload - the client payload.
     * @returns {{text: string}} the checked input.
     */
    validate(payload) {
      const source = text(payload?.text);
      if (source === '') throw aiError('缺少要翻译的内容');
      return { text: source };
    },
    /**
     * @param {{text: string}} request - the checked input.
     * @returns {string} the user prompt.
     */
    user(request) {
      return `请翻译下面这段内容：\n${request.text}`;
    },
    /**
     * @param {any} raw - the model's JSON object.
     * @returns {object} the client result.
     */
    normalize(raw) {
      return { text: text(raw?.text) };
    },
  },
  breakdown: {
    maxTokens: 1200,
    /**
     * @param {any} payload - the client payload.
     * @returns {{sentence: string}} the checked input.
     */
    validate(payload) {
      const sentence = text(payload?.sentence);
      if (sentence === '') throw aiError('缺少要拆解的句子');
      return { sentence };
    },
    /**
     * @param {{sentence: string}} request - the checked input.
     * @returns {string} the user prompt.
     */
    user(request) {
      return `请拆解下面这个句子：\n${request.sentence}`;
    },
    /**
     * @param {any} raw - the model's JSON object.
     * @returns {object} the client result.
     */
    normalize(raw) {
      const structure = (Array.isArray(raw?.structure) ? raw.structure : [])
        .filter((entry) => entry !== null && typeof entry === 'object')
        .map((entry) => ({ token: text(entry.token), note: text(entry.note) }));
      return {
        structure,
        translation: text(raw?.translation),
        simplified: text(raw?.simplified),
      };
    },
  },
  mindmap: {
    maxTokens: 3000,
    /**
     * @param {any} payload - the client payload.
     * @returns {{title: string, chapterTitle: string, text: string}} the checked input.
     */
    validate(payload) {
      const source = text(payload?.text);
      if (source === '') throw aiError('缺少要整理的章节内容');
      return {
        title: text(payload?.title),
        chapterTitle: text(payload?.chapterTitle),
        text: source.slice(0, MAX_SOURCE_CHARS),
      };
    },
    /**
     * @param {{title: string, chapterTitle: string, text: string}} request - the checked input.
     * @returns {string} the user prompt.
     */
    user(request) {
      const header = [
        request.title === '' ? '' : `书名：${request.title}`,
        request.chapterTitle === '' ? '' : `章节：${request.chapterTitle}`,
      ].filter((line) => line !== '').join('\n');
      return `${header}\n\n请把下面这一章整理成一张思维导图：\n${request.text}`;
    },
    /**
     * @param {any} raw - the model's JSON object.
     * @returns {object} the client result.
     */
    normalize(raw) {
      const branches = (Array.isArray(raw?.branches) ? raw.branches : [])
        .filter((branch) => branch !== null && typeof branch === 'object')
        .map((branch) => ({
          label: text(branch.label),
          // The quote is how the learner gets back to the passage: the client
          // looks it up in the chapter and turns it into a jump target.
          quote: text(branch.quote),
          items: (Array.isArray(branch.items) ? branch.items : [])
            .filter((item) => item !== null && typeof item === 'object')
            .map((item) => ({ label: text(item.label), note: text(item.note), quote: text(item.quote) }))
            .slice(0, 6),
        }))
        .filter((branch) => branch.label !== '')
        .slice(0, 8);
      return { title: text(raw?.title), branches };
    },
  },
  podcast: {
    maxTokens: 4000,
    /**
     * @param {any} payload - the client payload.
     * @returns {{title: string, chapterTitle: string, scope: string, text: string}} the checked input.
     */
    validate(payload) {
      const source = text(payload?.text);
      if (source === '') throw aiError('缺少要改写的章节内容');
      return {
        title: text(payload?.title),
        chapterTitle: text(payload?.chapterTitle),
        scope: payload?.scope === 'book' ? 'book' : 'chapter',
        text: source.slice(0, MAX_SOURCE_CHARS),
      };
    },
    /**
     * @param {{title: string, chapterTitle: string, scope: string, text: string}} request - the checked input.
     * @returns {string} the user prompt.
     */
    user(request) {
      const wholeBook = request.scope === 'book';
      const header = [
        request.title === '' ? '' : `书名：${request.title}`,
        wholeBook
          ? '范围：全书'
          : (request.chapterTitle === '' ? '' : `章节：${request.chapterTitle}`),
      ].filter((line) => line !== '').join('\n');
      const ask = wholeBook
        ? '请把下面这本书改写成一段双人对话播客，覆盖全书的主要脉络：'
        : '请把下面这一章改写成一段双人对话播客：';
      return `${header}\n\n${ask}\n${request.text}`;
    },
    /**
     * @param {any} raw - the model's JSON object.
     * @returns {object} the client result.
     */
    normalize(raw) {
      const dialogue = (Array.isArray(raw?.dialogue) ? raw.dialogue : [])
        .filter((line) => line !== null && typeof line === 'object')
        .map((line) => {
          const speaker = text(line.speaker).toLowerCase();
          return {
            speaker: speaker.includes('host') || speaker.includes('主持') ? 'host' : 'guest',
            text: text(line.text).slice(0, 800),
          };
        })
        .filter((line) => line.text !== '')
        .slice(0, 24);
      return { title: text(raw?.title), summary: text(raw?.summary), dialogue };
    },
  },
  podcastReply: {
    maxTokens: 2000,
    /**
     * @param {any} payload - the client payload.
     * @returns {{title: string, chapterTitle: string, text: string, said: string}} the checked input.
     */
    validate(payload) {
      const said = text(payload?.said);
      if (said === '') throw aiError('缺少学员说的话');
      return {
        title: text(payload?.title),
        chapterTitle: text(payload?.chapterTitle),
        text: text(payload?.text).slice(0, 4000),
        said: said.slice(0, 1000),
      };
    },
    /**
     * @param {{title: string, chapterTitle: string, text: string, said: string}} request - the checked input.
     * @returns {string} the user prompt.
     */
    user(request) {
      const header = [
        request.title === '' ? '' : `书名：${request.title}`,
        request.chapterTitle === '' ? '' : `章节：${request.chapterTitle}`,
      ].filter((line) => line !== '').join('\n');
      const soFar = request.text === '' ? '（节目刚开始）' : request.text;
      return [
        header,
        '',
        `节目到目前为止的对话：\n${soFar}`,
        '',
        `学员插话：${request.said}`,
        '',
        '请接住学员的插话，把这期节目继续讲下去。',
      ].join('\n');
    },
    /**
     * @param {any} raw - the model's JSON object.
     * @returns {object} the client result.
     */
    normalize(raw) {
      const lines = (Array.isArray(raw?.lines) ? raw.lines : [])
        .filter((line) => line !== null && typeof line === 'object')
        .map((line) => {
          const speaker = text(line.speaker).toLowerCase();
          return {
            speaker: speaker.includes('guest') || speaker.includes('嘉宾') ? 'guest' : 'host',
            text: text(line.text).slice(0, 800),
          };
        })
        .filter((line) => line.text !== '')
        .slice(0, 6);
      return { lines };
    },
  },
};

/**
 * Read one Host service without assuming it is mounted.
 * @param {any} ctx - the Host plugin context.
 * @param {string} name - the service name.
 * @returns {any} the service, or undefined.
 */
export function serviceOf(ctx, name) {
  try {
    if (ctx !== null && ctx !== undefined && typeof ctx.get === 'function') {
      const found = ctx.get(name);
      if (found !== undefined && found !== null) return found;
    }
  } catch {
    // The context does not expose services this way; try the property below.
  }
  try {
    if (ctx !== null && ctx !== undefined) {
      const found = ctx[name];
      if (found !== undefined && found !== null) return found;
    }
  } catch {
    // The service is not reachable from this context.
  }
  return undefined;
}

/**
 * Ask the model for one completion and return its text.
 *
 * The call is prepared first, because a prepared call binds one adapter
 * generation to one dispatch: `stream` refuses options whose provider, model,
 * reasoning effort, temperature or token cap differ from the prepared config.
 * The stream options are therefore built from `prepared.config`.
 * @param {object} options - the call parameters.
 * @returns {Promise<string>} the model's answer.
 */
async function complete({ llm, provider, model, system, user, maxTokens, signal }) {
  const prepared = await llm.prepareCall({ provider, model, temperature: TEMPERATURE, maxTokens }, signal);
  const config = prepared?.config ?? { provider, model, temperature: TEMPERATURE, maxTokens };
  const request = {
    ...config,
    messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
    system,
    signal,
  };
  const stream = prepared.stream(request);
  let answer = '';
  let failure;
  for await (const chunk of stream) {
    if (chunk === null || typeof chunk !== 'object') continue;
    if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
      answer += chunk.text;
      continue;
    }
    if (chunk.type === 'finish') {
      const reason = chunk.reason;
      if (reason !== null && typeof reason === 'object' && (reason.kind === 'error' || reason.kind === 'aborted')) {
        failure = reason;
      }
    }
  }
  if (failure !== undefined) {
    const error = new Error(modelErrorMessage(failure.failure));
    error.code = typeof failure.failure?.code === 'string' ? failure.failure.code : '';
    throw error;
  }
  return answer;
}

/**
 * Whether the MiniMax channel can answer right now.
 *
 * @param {any} minimax - the MiniMax channel, if the caller injected one.
 * @returns {boolean} true when the channel is usable.
 */
function minimaxReady(minimax) {
  if (minimax === undefined || minimax === null) return false;
  if (typeof minimax.chat !== 'function') return false;
  if (typeof minimax.isAvailable === 'function' && minimax.isAvailable() === false) return false;
  return true;
}

/**
 * Ask the MiniMax chat model for one completion.
 *
 * @param {object} options - the call parameters.
 * @param {object} options.minimax - the MiniMax channel.
 * @param {string} options.system - the system prompt.
 * @param {string} options.user - the user prompt.
 * @param {number} options.maxTokens - the token cap.
 * @returns {Promise<string>} the model's answer.
 */
async function completeWithMinimax({ minimax, system, user, maxTokens }) {
  try {
    return await minimax.chat({ system, user, maxTokens });
  } catch (error) {
    if (error?.name === 'AbortError') throw aiError('AI 请求已取消', error);
    throw aiError(
      error instanceof Error ? error.message : 'MiniMax 调用失败，请稍后重试',
      error,
    );
  }
}

/**
 * Run one AI assist request.
 *
 * The MiniMax channel answers first when it is configured; the Host's own
 * model is the fallback, so the feature keeps working without a key.
 *
 * @param {'word'|'translate'|'breakdown'} method - the method to run.
 * @param {object} payload - the method payload.
 * @param {object} [deps] - the injected dependencies.
 * @param {object} [deps.llm] - the Host's `llm` service.
 * @param {object} [deps.agentDefaultModel] - the Host's `agentDefaultModel` service.
 * @param {object} [deps.minimax] - the MiniMax channel.
 * @param {number} [deps.timeoutMs] - the wall-clock budget of the request.
 * @returns {Promise<object>} the result, in the shape the contract freezes.
 * @throws {Error} with a Chinese message when the request cannot be served.
 */
export async function runAiMethod(method, payload, deps = {}) {
  const spec = Object.prototype.hasOwnProperty.call(SPECS, method) ? SPECS[method] : undefined;
  if (spec === undefined) throw aiError(`不支持的 AI 方法：${String(method)}`);

  const request = spec.validate(payload);

  const useMinimax = minimaxReady(deps.minimax);
  const llm = deps.llm;
  const agentDefaultModel = deps.agentDefaultModel;
  if (!useMinimax && (llm === undefined || llm === null || typeof llm.prepareCall !== 'function')) {
    throw aiError(NO_MODEL_MESSAGE);
  }
  if (!useMinimax && (agentDefaultModel === undefined || agentDefaultModel === null || typeof agentDefaultModel.currentSelection !== 'function')) {
    throw aiError(NO_MODEL_MESSAGE);
  }

  let provider = '';
  let model = '';
  if (!useMinimax) {
    const selection = agentDefaultModel.currentSelection();
    provider = text(selection?.provider);
    model = text(selection?.model);
    if (provider === '' || model === '') throw aiError(NO_MODEL_MESSAGE);
  }

  const timeoutMs = Number.isFinite(deps.timeoutMs) && deps.timeoutMs > 0 ? deps.timeoutMs : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const system = SYSTEM_PROMPTS[method];
  const user = spec.user(request);
  const call = { llm, provider, model, maxTokens: spec.maxTokens, user, signal: controller.signal };
  const answerWith = (finalSystem) => (useMinimax
    ? completeWithMinimax({ minimax: deps.minimax, system: finalSystem, user, maxTokens: spec.maxTokens })
    : complete({ ...call, system: finalSystem }));

  try {
    let answer;
    try {
      answer = await answerWith(system);
    } catch (error) {
      if (timedOut) throw aiError(`AI 请求超时（${Math.round(timeoutMs / 1000)} 秒），请稍后再试`, error);
      if (error?.name === 'AbortError') throw aiError('AI 请求已取消', error);
      throw aiError(modelErrorMessage(error), error);
    }

    try {
      return spec.normalize(parseModelJson(answer), request);
    } catch (firstError) {
      // The answer was not JSON: ask once more, with a stricter prompt.
      let retryAnswer;
      try {
        retryAnswer = await answerWith(`${system}\n只输出一个 JSON 对象。`);
      } catch (error) {
        if (timedOut) throw aiError(`AI 请求超时（${Math.round(timeoutMs / 1000)} 秒），请稍后再试`, error);
        if (error?.name === 'AbortError') throw aiError('AI 请求已取消', error);
        throw aiError(modelErrorMessage(error), error);
      }
      try {
        return spec.normalize(parseModelJson(retryAnswer), request);
      } catch (secondError) {
        throw aiError(JSON_ERROR_MESSAGE, secondError ?? firstError);
      }
    }
  } finally {
    clearTimeout(timer);
  }
}
