/**
 * 客户端半边：源文件的上传、取回与下载。
 *
 * 这些测试不打真实的宿主：`fetch` 被换成一个假的，它记录请求并给出回答。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { downloadSourceFile, fetchSourceFile, formatBytes, uploadSourceFile } from '../src/lib/source-file.js';

/**
 * 一个假的上传文件：浏览器里的 File 只有名字、类型和字节。
 * @param {string} name - 文件名。
 * @param {string} type - MIME 类型。
 * @param {number} size - 字节数。
 * @returns {object} 假文件。
 */
function fakeFile(name, type, size = 4) {
  const bytes = new Uint8Array(size).fill(65);
  return {
    name,
    type,
    async arrayBuffer() {
      return bytes.buffer;
    },
  };
}

/**
 * 一个假的回答。
 * @param {object} options - 回答的内容。
 * @returns {object} 一个够用的 Response。
 */
function fakeResponse({ status = 200, json = null, bytes = null, headers = {} } = {}) {
  const map = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (key) => map.get(String(key).toLowerCase()) ?? null },
    async json() {
      if (json === null) throw new Error('not json');
      return json;
    },
    async arrayBuffer() {
      const buffer = new Uint8Array(bytes ?? [1, 2, 3]).buffer;
      return buffer;
    },
  };
}

test('上传：请求体是文件的字节，元数据在查询串里', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return fakeResponse({
      json: { ok: true, result: { fileName: '一本书.epub', format: 'epub', contentType: 'application/epub+zip', size: 4, storedAt: 1 } },
    });
  };

  const meta = await uploadSourceFile('bk_1', fakeFile('一本书.epub', 'application/epub+zip'), {
    fetch: fetchImpl,
    format: 'epub',
  });

  assert.equal(calls.length, 1);
  const { url, options } = calls[0];
  assert.ok(url.startsWith('/api/reader/source?'), url);
  assert.ok(url.includes('id=bk_1'), url);
  assert.ok(url.includes(`name=${encodeURIComponent('一本书.epub')}`), url);
  assert.ok(url.includes('format=epub'), url);
  assert.equal(options.method, 'POST');
  // 请求体就是字节本身，不是 base64，也不是 JSON。
  assert.deepEqual(Array.from(new Uint8Array(options.body)), [65, 65, 65, 65]);
  assert.equal(meta.fileName, '一本书.epub');
  assert.equal(meta.format, 'epub');
  assert.equal(meta.size, 4);
});

test('上传：空文件不发出请求', async () => {
  let called = 0;
  const fetchImpl = async () => { called += 1; return fakeResponse(); };
  const meta = await uploadSourceFile('bk_1', fakeFile('空.epub', '', 0), { fetch: fetchImpl });
  assert.equal(called, 0);
  assert.equal(meta, null);
});

test('取回：字节、文件名与类型都回来了', async () => {
  const fetchImpl = async () => fakeResponse({
    bytes: [7, 8, 9],
    headers: {
      'content-type': 'application/epub+zip',
      'x-reader-file-name': encodeURIComponent('我的书.epub'),
    },
  });

  const source = await fetchSourceFile('bk_1', { fetch: fetchImpl });
  assert.deepEqual(Array.from(source.bytes), [7, 8, 9]);
  assert.equal(source.fileName, '我的书.epub');
  assert.equal(source.contentType, 'application/epub+zip');
});

test('取回：宿主说没有源文件时，报的是中文', async () => {
  const fetchImpl = async () => fakeResponse({
    status: 404,
    json: { ok: false, error: { code: 'reader/source-missing', message: '这本书没有保留源文件' } },
  });

  await assert.rejects(
    () => fetchSourceFile('bk_1', { fetch: fetchImpl }),
    (error) => {
      assert.equal(error.message, '这本书没有保留源文件');
      return true;
    },
  );
});

test('下载：点一个带文件名的链接，文件名就是导入时的那个', async () => {
  const fetchImpl = async () => fakeResponse({
    bytes: [1, 2, 3],
    headers: { 'content-type': 'application/epub+zip', 'x-reader-file-name': encodeURIComponent('我的书.epub') },
  });

  const clicked = [];
  const link = {
    href: '',
    download: '',
    rel: '',
    style: {},
    click() { clicked.push({ href: this.href, download: this.download }); },
    remove() {},
  };
  const fakeDocument = {
    createElement: () => link,
    body: { appendChild() {} },
  };

  const name = await downloadSourceFile('bk_1', { fetch: fetchImpl, document: fakeDocument });
  assert.equal(name, '我的书.epub');
  assert.equal(clicked.length, 1);
  assert.equal(clicked[0].download, '我的书.epub');
  assert.ok(clicked[0].href.startsWith('blob:'), clicked[0].href);
});

test('字节数：说人话', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2.0 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
  assert.equal(formatBytes(undefined), '0 B');
});
