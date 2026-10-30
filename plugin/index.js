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

/**
 * The route the source files travel on.
 *
 * The body of a request is the file itself and the answer is the file itself:
 * a book can be tens of megabytes, and base64 in a JSON envelope would make it
 * a third bigger for nothing. What is known about the file (its name, its type,
 * its format) travels in the query string, because a header cannot carry a
 * file name with Chinese characters in it.
 */
export const SOURCE_ROUTE = '/api/reader/source';

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
 * The name a download is offered under.
 *
 * The `Content-Disposition` header may only carry a plain name; the real name
 * travels in `filename*` (RFC 5987) and in `x-reader-file-name`, which the
 * client decodes itself.
 *
 * @param {string} fileName - the name the file had when it was imported.
 * @param {string} id - the book the file belongs to.
 * @param {string} format - the format of the file.
 * @returns {string} a name that only uses ASCII characters.
 */
function asciiFileName(fileName, id, format) {
  const base = String(fileName ?? '').trim();
  const ascii = base.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
  if (ascii !== '') return ascii;
  return `${String(id ?? 'book').replace(/[^\x20-\x7e]/g, '_')}.${String(format ?? 'bin')}`;
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

    // The source file of a book: the EPUB or PDF the learner imported. It is
    // kept next to the shelf so the learner can look at the original file and
    // take it away again.
    connectionCtx.effect(() => {
      try {
        return connectionCtx.connection.fetch.register({
          path: SOURCE_ROUTE,
          methods: ['GET', 'POST'],
          requestBody: 'buffered',
          fetch: async (request) => {
            try {
              const url = new URL(request.url, 'http://localhost');
              const id = url.searchParams.get('id') ?? '';
              if (id === '') {
                return Response.json(failure('reader/source-bad-request', '缺少书籍 id'), { status: 400 });
              }
              if (request.method === 'POST') {
                const bytes = new Uint8Array(await request.arrayBuffer());
                if (bytes.length === 0) {
                  return Response.json(failure('reader/source-empty', '源文件是空的'), { status: 400 });
                }
                const meta = await shelf.putSource(id, {
                  fileName: url.searchParams.get('name') ?? '',
                  format: url.searchParams.get('format') ?? '',
                  contentType: url.searchParams.get('type') ?? '',
                  bytes,
                });
                if (meta === undefined) {
                  return Response.json(failure('reader/source-failed', '源文件保存失败'), { status: 400 });
                }
                return Response.json({ ok: true, result: meta });
              }
              const source = await shelf.getSource(id);
              if (source === undefined) {
                return Response.json(failure('reader/source-missing', '这本书没有保留源文件'), { status: 404 });
              }
              const meta = source.meta;
              const name = asciiFileName(meta.fileName, id, meta.format);
              const download = url.searchParams.get('download') === '1';
              return new Response(source.bytes, {
                status: 200,
                headers: {
                  'content-type': meta.contentType || 'application/octet-stream',
                  'content-length': String(source.bytes.length),
                  'content-disposition': `${download ? 'attachment' : 'inline'}; filename="${name}"`,
                  'x-reader-file-name': encodeURIComponent(meta.fileName || name),
                },
              });
            } catch (error) {
              return Response.json(
                failure('reader/source-failed', error instanceof Error ? error.message : String(error)),
                { status: 500 },
              );
            }
          },
        });
      } catch (error) {
        console.warn('[reader] source route registration failed: ' + String(error));
        return () => {};
      }
    }, 'reader: ' + SOURCE_ROUTE);

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
