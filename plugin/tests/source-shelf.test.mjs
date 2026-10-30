/**
 * 宿主侧的源文件：原始导入文件落盘、元数据合并、删除、格式规范化。
 *
 * 契约（docs/CONTRACT-SHELF.md）：一本书的原始文件（导入时那个 EPUB/PDF/TXT）
 * 落在 `<dir>/sources/<bookId>.<format>`，元数据跟着书记录走，学习者随时能看、
 * 能下载，也随时能被取走。
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createShelf } from '../src/host/shelf.js';

/**
 * 建一个临时书库。临时根目录是私有的，所以「写到了书库外面」这种问题能查出来。
 * @returns {{ root: string, dir: string, shelf: object }} 临时根目录、书库目录与书库。
 */
function makeShelf() {
  const root = mkdtempSync(join(tmpdir(), 'reader-shelf-'));
  const dir = join(root, 'reader');
  return { root, dir, shelf: createShelf({ dir }) };
}

/**
 * 一本最小的书。
 * @param {string} id - 书的 id。
 * @param {number} addedAt - 加入时间。
 * @returns {object} 书的记录。
 */
function book(id, addedAt) {
  return { id, title: `Book ${id}`, author: 'Someone', format: 'epub', chapters: [], addedAt };
}

/**
 * 目录里的文件名字。目录还不存在时是空数组：没写过的东西不算错。
 * @param {string} dir - 目录。
 * @returns {string[]} 文件名字。
 */
function listDir(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * 磁盘上那本书的记录：直接读 JSON 文件，不经过书库，免得被书库自己的读法圆过去。
 * @param {string} dir - 书库目录。
 * @param {string} id - 书的 id。
 * @returns {object} 书的记录。
 */
function readBookFile(dir, id) {
  return JSON.parse(readFileSync(join(dir, 'books', `${id}.json`), 'utf8'));
}

/**
 * 源文件元数据该有的样子：文件名、格式、类型、字节数与落盘时间。
 * @param {any} meta - 宿主给出的元数据。
 * @param {object} expected - 期望的字段。
 */
function assertMeta(meta, expected) {
  assert.ok(meta && typeof meta === 'object', '元数据应该是一个对象');
  assert.equal(meta.fileName, expected.fileName);
  assert.equal(meta.format, expected.format);
  assert.equal(meta.contentType, expected.contentType);
  assert.equal(meta.size, expected.size);
  assert.equal(typeof meta.storedAt, 'number');
  assert.ok(meta.storedAt > 0, '落盘时间应该是一个时间戳');
}

test('源文件：putSource 存下字节并返回元数据，getSource 读回同样的字节', async () => {
  const { root, dir, shelf } = makeShelf();
  try {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x7f, 0x80]);
    await shelf.putBook(book('bk_1', 1000));
    const meta = await shelf.putSource('bk_1', {
      fileName: '三体.epub',
      format: 'epub',
      contentType: 'application/epub+zip',
      bytes,
    });
    assertMeta(meta, {
      fileName: '三体.epub',
      format: 'epub',
      contentType: 'application/epub+zip',
      size: bytes.length,
    });

    // 字节落在 <dir>/sources/<safeId>.<format>。
    assert.equal(existsSync(join(dir, 'sources', 'bk_1.epub')), true);

    // getSource 把同样的字节读回来。
    const result = await shelf.getSource('bk_1');
    assert.ok(result, 'getSource 应该拿到源文件');
    assert.equal(result.bytes.length, bytes.length);
    assert.deepEqual(Buffer.from(result.bytes), Buffer.from(bytes));
    assertMeta(result.meta, {
      fileName: '三体.epub',
      format: 'epub',
      contentType: 'application/epub+zip',
      size: bytes.length,
    });

    // getSourceMeta 只给元数据，不带字节。
    const onlyMeta = await shelf.getSourceMeta('bk_1');
    assertMeta(onlyMeta, {
      fileName: '三体.epub',
      format: 'epub',
      contentType: 'application/epub+zip',
      size: bytes.length,
    });
    assert.equal(onlyMeta.bytes, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('源文件：putSource 之后，磁盘上的书记录多出 source 字段', async () => {
  const { root, dir, shelf } = makeShelf();
  try {
    const bytes = Buffer.from('hello source', 'utf8');
    await shelf.putBook(book('bk_1', 1000));
    const meta = await shelf.putSource('bk_1', {
      fileName: 'notes.txt',
      format: 'txt',
      contentType: 'text/plain',
      bytes,
    });

    // 直接读磁盘上的 JSON 文件。
    const record = readBookFile(dir, 'bk_1');
    assert.ok(record.source, '书记录里应该有 source 字段');
    assertMeta(record.source, {
      fileName: 'notes.txt',
      format: 'txt',
      contentType: 'text/plain',
      size: bytes.length,
    });
    assert.deepEqual(record.source, meta);

    // 书的其他字段不能被写坏。
    assert.equal(record.title, 'Book bk_1');
    assert.equal(record.addedAt, 1000);

    // 读出来的书也带着 source。
    const got = await shelf.getBook('bk_1');
    assert.deepEqual(got.source, record.source);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('源文件：再次写入不带 source 的书记录，不会丢掉已有的源文件元数据', async () => {
  const { root, dir, shelf } = makeShelf();
  try {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await shelf.putBook(book('bk_1', 1000));
    const meta = await shelf.putSource('bk_1', {
      fileName: 'a.pdf',
      format: 'pdf',
      contentType: 'application/pdf',
      bytes,
    });

    // 客户端改了书名，把整条记录送回来——那条记录里没有 source。
    await shelf.putBook({ ...book('bk_1', 1000), title: '新名字' });

    const record = readBookFile(dir, 'bk_1');
    assert.equal(record.title, '新名字');
    assert.ok(record.source, '已有的源文件元数据不能被弄丢');
    assert.deepEqual(record.source, meta);

    // 源文件本身也还在，字节没变。
    const result = await shelf.getSource('bk_1');
    assert.ok(result);
    assert.deepEqual(Buffer.from(result.bytes), Buffer.from(bytes));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('源文件：deleteBook 连源文件一起删掉', async () => {
  const { root, dir, shelf } = makeShelf();
  try {
    await shelf.putBook(book('bk_1', 1000));
    await shelf.putSource('bk_1', {
      fileName: 'a.pdf',
      format: 'pdf',
      contentType: 'application/pdf',
      bytes: Buffer.from([9, 8, 7]),
    });
    assert.equal(existsSync(join(dir, 'sources', 'bk_1.pdf')), true);

    await shelf.deleteBook('bk_1');
    assert.equal(existsSync(join(dir, 'books', 'bk_1.json')), false);
    // 书删了，源文件也不该留在磁盘上。
    assert.equal(existsSync(join(dir, 'sources', 'bk_1.pdf')), false);
    assert.deepEqual(listDir(join(dir, 'sources')), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('源文件：没有源文件时返回 undefined，而不是抛异常', async () => {
  const { root, shelf } = makeShelf();
  try {
    // 根本没有这本书。
    assert.equal(await shelf.getSource('bk_missing'), undefined);
    assert.equal(await shelf.getSourceMeta('bk_missing'), undefined);

    // 有书，但没存过源文件。
    await shelf.putBook(book('bk_1', 1000));
    assert.equal(await shelf.getSource('bk_1'), undefined);
    assert.equal(await shelf.getSourceMeta('bk_1'), undefined);

    // 书和源文件都删掉之后，同样不报错。
    await shelf.putSource('bk_1', {
      fileName: 'a.txt',
      format: 'txt',
      contentType: 'text/plain',
      bytes: Buffer.from('x'),
    });
    await shelf.deleteBook('bk_1');
    assert.equal(await shelf.getSource('bk_1'), undefined);
    assert.equal(await shelf.getSourceMeta('bk_1'), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('源文件：格式会被规范化——大写变小写，空格式退回 bin', async () => {
  const { root, dir, shelf } = makeShelf();
  try {
    const bytes = new Uint8Array([0, 1, 2]);

    // 大写变成小写，文件按小写后缀落盘。
    const upper = await shelf.putSource('bk_1', {
      fileName: 'a.epub',
      format: 'EPUB',
      contentType: 'application/epub+zip',
      bytes,
    });
    assert.equal(upper.format, 'epub');
    assert.equal(existsSync(join(dir, 'sources', 'bk_1.epub')), true);
    assert.deepEqual(listDir(join(dir, 'sources')), ['bk_1.epub']);

    // 空格式退回 bin。
    const empty = await shelf.putSource('bk_2', {
      fileName: 'b.unknown',
      format: '',
      contentType: 'application/octet-stream',
      bytes,
    });
    assert.equal(empty.format, 'bin');
    assert.equal(existsSync(join(dir, 'sources', 'bk_2.bin')), true);

    // 常见的格式原样存、原样报。
    for (const format of ['epub', 'pdf', 'txt', 'md', 'html']) {
      const one = await shelf.putSource(`bk_${format}`, {
        fileName: `x.${format}`,
        format,
        contentType: 'application/octet-stream',
        bytes,
      });
      assert.equal(one.format, format);
      assert.equal(existsSync(join(dir, 'sources', `bk_${format}.${format}`)), true);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('源文件：奇怪的格式名也不能跑出源文件目录', async () => {
  const { root, dir, shelf } = makeShelf();
  try {
    const meta = await shelf.putSource('bk_1', {
      fileName: 'x',
      format: '../../evil',
      contentType: 'application/octet-stream',
      bytes: new Uint8Array([1]),
    });
    // 格式名里不能剩下能改路径的字符。
    assert.ok(!meta.format.includes('/'));
    assert.ok(!meta.format.includes('\\'));
    assert.ok(!meta.format.includes('.'));
    // 文件还在 sources/ 里面，书库外面没有多出文件。
    assert.equal(listDir(join(dir, 'sources')).length, 1);
    assert.deepEqual(listDir(root), ['reader']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('源文件：写完不留 .tmp 文件', async () => {
  const { root, dir, shelf } = makeShelf();
  try {
    await shelf.putBook(book('bk_1', 1000));
    await shelf.putSource('bk_1', {
      fileName: 'a.epub',
      format: 'epub',
      contentType: 'application/epub+zip',
      bytes: new Uint8Array([1, 2, 3]),
    });
    assert.equal(existsSync(join(dir, 'sources')), true);
    // 原子写：先写 .tmp 再改名，所以写完目录里没有 .tmp。
    assert.deepEqual(listDir(join(dir, 'sources')).filter((name) => name.endsWith('.tmp')), []);
    // 合并进书记录的那次写也是原子的。
    assert.deepEqual(listDir(join(dir, 'books')).filter((name) => name.endsWith('.tmp')), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('源文件：书还不存在时，字节照样存下并返回元数据', async () => {
  const { root, dir, shelf } = makeShelf();
  try {
    // 客户端先传文件、后存书：这时书还没有，字节也得留住。
    const bytes = Buffer.from('先传文件，后存书', 'utf8');
    const meta = await shelf.putSource('bk_ghost', {
      fileName: 'g.txt',
      format: 'txt',
      contentType: 'text/plain',
      bytes,
    });
    assertMeta(meta, {
      fileName: 'g.txt',
      format: 'txt',
      contentType: 'text/plain',
      size: bytes.length,
    });
    // 字节确实落盘了。
    assert.equal(existsSync(join(dir, 'sources', 'bk_ghost.txt')), true);
    // 但不会凭空造出一本书。
    assert.deepEqual(await shelf.listBooks(), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('源文件：id 里的路径字符不会逃出源文件目录', async () => {
  const { root, dir, shelf } = makeShelf();
  try {
    await shelf.putSource('../evil', {
      fileName: 'e.epub',
      format: 'epub',
      contentType: 'application/epub+zip',
      bytes: new Uint8Array([1]),
    });
    // `.` 和 `/` 都不在允许的字符里，一律换成下划线。
    assert.deepEqual(listDir(join(dir, 'sources')), ['___evil.epub']);
    // 书库目录外面没有多出文件。
    assert.deepEqual(listDir(root), ['reader']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
