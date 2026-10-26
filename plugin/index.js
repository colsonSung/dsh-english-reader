/**
 * Host half of the English reader bundle.
 *
 * Everything the learner uses runs in the page: file import, parsing, the
 * matching UI and the speech recognition. The Host owns the two things the
 * page cannot do safely: it holds the MiniMax API key and it talks to the
 * provider.
 *
 * The client half posts every request to `/api/english-reader` and switches on
 * the method:
 *   - `word` / `translate` / `breakdown`: the AI assist answers (MiniMax first,
 *     the Host's own model as the fallback)
 *   - `tts`: the reading voice, synthesised by MiniMax
 *   - `voices`: the MiniMax system voices
 *   - `status`: which channels are available
 *
 * The route is registered through the Connection service's Fetch registry, so
 * the caller is authenticated with the same browser session the rest of the app
 * uses.
 */

import { runAiMethod, serviceOf } from './src/host/ai.js';
import * as minimax from './src/host/minimax.js';
import * as gutenberg from './src/host/gutenberg.js';

/** The route the client half posts its requests to. */
export const ROUTE = '/api/english-reader';

/** The methods the client half may ask for. */
const METHODS = new Set(['word', 'translate', 'breakdown', 'tts', 'asr', 'cover', 'voices', 'status', 'source']);

/**
 * Build the error body the client half understands.
 * @param {string} code - the machine readable code.
 * @param {string} message - the Chinese message for the learner.
 * @returns {object} the error body.
 */
function failure(code, message) {
  return { ok: false, error: { code, message, details: {} } };
}

/**
 * Activate the bundle row.
 * @param {object} ctx - the Host plugin context.
 */
export function apply(ctx) {
  ctx.inject(['connection'], (connectionCtx) => {
    connectionCtx.effect(() => {
      try {
        return connectionCtx.connection.fetch.register({
          path: ROUTE,
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: async (request) => {
            let body;
            try {
              body = await request.json();
            } catch {
              return Response.json(failure('english-reader/bad-request', 'body is not JSON'), { status: 400 });
            }
            const method = typeof body?.method === 'string' ? body.method : '';
            if (!METHODS.has(method)) {
              return Response.json(failure('english-reader/unknown-method', `不支持的方法：${method}`), { status: 400 });
            }
            const payload = body?.payload ?? {};
            try {
              if (method === 'status') {
                return Response.json({ ok: true, result: minimax.status() });
              }
              if (method === 'tts') {
                const audio = await minimax.tts({
                  text: payload?.text,
                  voiceId: payload?.voiceId,
                  speed: payload?.rate,
                });
                return Response.json({ ok: true, result: audio });
              }
              if (method === 'asr') {
                const result = await minimax.asr({
                  audio: payload?.audio,
                  mimeType: payload?.mimeType,
                });
                return Response.json({ ok: true, result });
              }
              if (method === 'cover') {
                const cover = await minimax.coverImage({ title: payload?.title });
                return Response.json({ ok: true, result: cover });
              }
              if (method === 'voices') {
                const voices = await minimax.voices();
                return Response.json({ ok: true, result: voices });
              }
              if (method === 'source') {
                const action = payload?.action === 'download' ? 'download' : 'search';
                if (action === 'download') {
                  const file = await gutenberg.download({
                    id: payload?.id,
                    format: payload?.format === 'text' ? 'text' : 'epub',
                  });
                  // The book itself is returned, not a JSON envelope.
                  return new Response(file.bytes, {
                    status: 200,
                    headers: {
                      'content-type': file.contentType,
                      'x-source-url': file.url,
                    },
                  });
                }
                const hits = await gutenberg.search({
                  query: payload?.query,
                  limit: payload?.limit,
                  language: payload?.language,
                });
                return Response.json({
                  ok: true,
                  result: hits.map((hit) => ({ ...hit, cover: gutenberg.coverUrl(hit.id) })),
                });
              }
              const result = await runAiMethod(method, payload, {
                // The model services are read per request: the Host may mount
                // or replace them long after this plugin was applied.
                get llm() {
                  return serviceOf(ctx, 'llm');
                },
                get agentDefaultModel() {
                  return serviceOf(ctx, 'agentDefaultModel');
                },
                minimax,
              });
              return Response.json({ ok: true, result });
            } catch (error) {
              return Response.json(
                failure(
                  'english-reader/failed',
                  error instanceof Error ? error.message : String(error),
                ),
                { status: 200 },
              );
            }
          },
        });
      } catch (error) {
        // A reload can apply this plugin twice; the route already exists then.
        console.warn('[english-reader] route registration failed: ' + String(error));
        return () => {};
      }
    }, 'english-reader: ' + ROUTE);
  });
}
