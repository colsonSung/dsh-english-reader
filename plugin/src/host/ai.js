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
export const AI_METHODS = Object.freeze(['word', 'translate', 'breakdown']);

/** Wall-clock budget for one request, covering the JSON retry as well. */
const DEFAULT_TIMEOUT_MS = 30000;

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
