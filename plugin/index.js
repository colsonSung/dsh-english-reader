/**
 * Host half of the English reader bundle.
 *
 * Everything the learner uses runs in the page: file import, parsing, the
 * matching UI and the speech recognition. The Host owns the two things the
 * page cannot do safely: it holds the MiniMax API key and it talks to the
 * provider. It also owns the shelf: the books, the vocabulary list, the notes
 * and the podcasts live on disk, so that the desktop app and any browser see
 * the same library.
 *
 * The client half posts every request to `/api/reader` and switches on
 * the method:
 *   - `word` / `translate` / `breakdown`: the AI assist answers (MiniMax first,
 *     the Host's own model as the fallback)
 *   - `mindmap` / `podcast`: the chapter outline and the podcast script
 *   - `podcastReply`: the answer to a learner who talks back mid-episode
 *   - `tts`: the reading voice, synthesised by MiniMax
 *   - `voices`: the MiniMax system voices
 *   - `status`: which channels are available
 *   - `shelf`: the persistent shelf on disk (books, vocabulary, notes,
 *     podcasts)
 *
 * The route is registered through the Connection service's Fetch registry, so
 * the caller is authenticated with the same browser session the rest of the app
 * uses.
 */

import { join } from 'node:path';

import { runAiMethod, serviceOf } from './src/host/ai.js';
import * as minimax from './src/host/minimax.js';
import * as gutenberg from './src/host/gutenberg.js';
import { createShelf } from './src/host/shelf.js';

/** The route the client half posts its requests to. */
export const ROUTE = '/api/reader';

/** The methods the client half may ask for. */
const METHODS = new Set(['word', 'translate', 'breakdown', 'mindmap', 'podcast', 'podcastReply', 'tts', 'asr', 'cover', 'voices', 'status', 'source', 'shelf']);

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
 * The id of a record the client sent.
 * @param {any} record - the record.
 * @returns {string} the id, or an empty string when there is none.
 */
function idOf(record) {
  return typeof record?.id === 'string' ? record.id : '';
}

/**
 * Where the shelf lives: the current profile's `reader` folder. When the
 * profile directory is not known, the shelf falls back to `~/.dsh/reader`.
 * @param {object} ctx - the Host plugin context.
 * @returns {{ dir?: string }} the options for createShelf.
 */
function shelfOptions(ctx) {
  const profileContext = serviceOf(ctx, 'profileContext');
  const profileDir = typeof profileContext?.dir === 'string' ? profileContext.dir : '';
  const dir = profileDir !== '' ? join(profileDir, 'reader') : undefined;
  return { dir };
}

/**
 * Handle one shelf action (contract section 2).
 *
 * The shelf is the Host's own: the client asks for books, vocabulary, notes and
 * podcasts by name, and the Host reads and writes them on disk.
 *
 * @param {object} shelf - the shelf.
 * @param {object} payload - the payload of the request.
 * @returns {Promise<Response>} the response.
 */
async function handleShelf(shelf, payload) {
  const action = typeof payload?.action === 'string' ? payload.action : '';
  if (action === 'books.list') {
    return Response.json({ ok: true, result: await shelf.listBooks() });
  }
  if (action === 'books.get') {
    const book = await shelf.getBook(payload?.id);
    return Response.json({ ok: true, result: book ?? null });
  }
  if (action === 'books.put') {
    const book = payload?.book;
    await shelf.putBook(book);
    return Response.json({ ok: true, result: { id: idOf(book) } });
  }
  if (action === 'books.progress') {
    // The Host merges the progress into the book on disk, so the whole book
    // does not travel over the wire on every sentence.
    const id = typeof payload?.id === 'string' ? payload.id : '';
    await shelf.updateProgress(id, payload?.progress);
    return Response.json({ ok: true, result: { id } });
  }
  if (action === 'books.delete') {
    const id = typeof payload?.id === 'string' ? payload.id : '';
    await shelf.deleteBook(id);
    return Response.json({ ok: true, result: { id } });
  }
  if (action === 'vocab.list') {
    return Response.json({ ok: true, result: await shelf.listVocab() });
  }
  if (action === 'vocab.put') {
    const entry = payload?.entry;
    await shelf.putVocab(entry);
    return Response.json({ ok: true, result: { id: idOf(entry) } });
  }
  if (action === 'vocab.delete') {
    const id = typeof payload?.id === 'string' ? payload.id : '';
    await shelf.deleteVocab(id);
    return Response.json({ ok: true, result: { id } });
  }
  if (action === 'notes.list') {
    return Response.json({ ok: true, result: await shelf.listNotes() });
  }
  if (action === 'notes.put') {
    const note = payload?.note;
    await shelf.putNote(note);
    return Response.json({ ok: true, result: { id: idOf(note) } });
  }
  if (action === 'notes.delete') {
    const id = typeof payload?.id === 'string' ? payload.id : '';
    await shelf.deleteNote(id);
    return Response.json({ ok: true, result: { id } });
  }
  if (action === 'podcasts.list') {
    return Response.json({ ok: true, result: await shelf.listPodcasts() });
  }
  if (action === 'podcasts.put') {
    const episode = payload?.episode;
    await shelf.putPodcast(episode);
    return Response.json({ ok: true, result: { id: idOf(episode) } });
  }
  if (action === 'podcasts.delete') {
    const id = typeof payload?.id === 'string' ? payload.id : '';
    await shelf.deletePodcast(id);
    return Response.json({ ok: true, result: { id } });
  }
  return Response.json(failure('reader/unknown-action', `不支持的书库操作：${action}`), { status: 400 });
}

/**
 * Activate the bundle row.
 * @param {object} ctx - the Host plugin context.
 */
export function apply(ctx) {
  ctx.inject(['connection', 'profileContext'], (connectionCtx) => {
    // The shelf belongs to the Host and lives on disk, so the desktop app and
    // every browser see the same library.
    const shelf = createShelf(shelfOptions(connectionCtx));
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
              return Response.json(failure('reader/bad-request', 'body is not JSON'), { status: 400 });
            }
            const method = typeof body?.method === 'string' ? body.method : '';
            if (!METHODS.has(method)) {
              return Response.json(failure('reader/unknown-method', `不支持的方法：${method}`), { status: 400 });
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
                // 客户端告诉宿主这本书的语种，音色表按它排序：中文书的第一个
                // 音色必须会读中文，而不是英文。
                const voices = await minimax.voices({ language: payload?.language });
                return Response.json({ ok: true, result: voices });
              }
              if (method === 'shelf') {
                return await handleShelf(shelf, payload);
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
                  'reader/failed',
                  error instanceof Error ? error.message : String(error),
                ),
                { status: 200 },
              );
            }
          },
        });
      } catch (error) {
        // A reload can apply this plugin twice; the route already exists then.
        console.warn('[reader] route registration failed: ' + String(error));
        return () => {};
      }
    }, 'reader: ' + ROUTE);
  });
}
