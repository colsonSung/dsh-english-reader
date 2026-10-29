/**
 * 宿主侧的书库仓库：落盘、原子写、坏文件跳过、文件名安全。
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

test('书：写入、读出、列出、删除', async () => {
  const { root, dir, shelf } = makeShelf();
  try {
    const one = book('bk_1', 1000);
    await shelf.putBook(one);
    const got = await shelf.getBook('bk_1');
    assert.deepEqual(got, one);
    assert.deepEqual(await shelf.listBooks(), [one]);

    await shelf.deleteBook('bk_1');
    assert.equal(await shelf.getBook('bk_1'), undefined);
    assert.deepEqual(await shelf.listBooks(), []);
    assert.equal(existsSync(join(dir, 'books', 'bk_1.json')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('listBooks 按 addedAt 倒序', async () => {
  const { root, shelf } = makeShelf();
  try {
    await shelf.putBook(book('bk_old', 1000));
    await shelf.putBook(book('bk_new', 3000));
    await shelf.putBook(book('bk_mid', 2000));
    const books = await shelf.listBooks();
    assert.deepEqual(books.map((item) => item.id), ['bk_new', 'bk_mid', 'bk_old']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('生词本、笔记、播客：写入、读出、删除', async () => {
  const { root, shelf } = makeShelf();
  try {
    const entry = { id: 'apple', word: 'apple', bookId: 'bk_1', addedAt: 1, state: 'learning' };
    await shelf.putVocab(entry);
    assert.deepEqual(await shelf.listVocab(), [entry]);
    await shelf.deleteVocab('apple');
    assert.deepEqual(await shelf.listVocab(), []);

    const note = { id: 'nt_1', bookId: 'bk_1', unitIndex: 3, quote: 'q', text: 't', createdAt: 1, updatedAt: 1 };
    await shelf.putNote(note);
    assert.deepEqual(await shelf.listNotes(), [note]);
    await shelf.deleteNote('nt_1');
    assert.deepEqual(await shelf.listNotes(), []);

    const episode = { id: 'pd_1', bookId: 'bk_1', chapterKey: 'c1', title: 't', dialogue: [], createdAt: 1 };
    await shelf.putPodcast(episode);
    assert.deepEqual(await shelf.listPodcasts(), [episode]);
    await shelf.deletePodcast('pd_1');
    assert.deepEqual(await shelf.listPodcasts(), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('写完不留 .tmp 文件', async () => {
  const { root, dir, shelf } = makeShelf();
  try {
    await shelf.putBook(book('bk_1', 1000));
    await shelf.putVocab({ id: 'apple', word: 'apple' });
    await shelf.putNote({ id: 'nt_1', text: 't' });
    await shelf.putPodcast({ id: 'pd_1', title: 't' });
    assert.deepEqual(readdirSync(join(dir, 'books')), ['bk_1.json']);
    assert.equal(existsSync(join(dir, 'books', 'bk_1.json.tmp')), false);
    assert.equal(existsSync(join(dir, 'vocabulary.json.tmp')), false);
    assert.equal(existsSync(join(dir, 'notes.json.tmp')), false);
    assert.equal(existsSync(join(dir, 'podcasts.json.tmp')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('坏掉的书文件被跳过，其余书照常列出', async () => {
  const { root, dir, shelf } = makeShelf();
  try {
    await shelf.putBook(book('bk_ok', 1000));
    writeFileSync(join(dir, 'books', 'bk_broken.json'), '{ this is not json', 'utf8');
    const books = await shelf.listBooks();
    assert.deepEqual(books.map((item) => item.id), ['bk_ok']);
    assert.equal(await shelf.getBook('bk_broken'), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('id 里的路径字符不会逃出书库目录', async () => {
  const { root, dir, shelf } = makeShelf();
  try {
    await shelf.putBook({ ...book('../evil', 1000), title: 'evil' });
    // `.` 和 `/` 都不在允许的字符里，一律换成下划线。
    assert.deepEqual(readdirSync(join(dir, 'books')), ['___evil.json']);
    // 书库目录外面没有多出文件。
    assert.deepEqual(readdirSync(root), ['reader']);
    const got = await shelf.getBook('../evil');
    assert.equal(got.id, '../evil');
    assert.equal(got.title, 'evil');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('没有 id 的记录被忽略', async () => {
  const { root, dir, shelf } = makeShelf();
  try {
    await shelf.putBook({ title: 'no id' });
    await shelf.putVocab({ word: 'no id' });
    await shelf.putNote({ text: 'no id' });
    await shelf.putPodcast({ title: 'no id' });
    assert.deepEqual(await shelf.listBooks(), []);
    assert.deepEqual(await shelf.listVocab(), []);
    assert.deepEqual(await shelf.listNotes(), []);
    assert.deepEqual(await shelf.listPodcasts(), []);
    assert.equal(existsSync(join(dir, 'books')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('updateProgress 合并进度：新的覆盖旧的，没提到的保留', async () => {
  const { root, shelf } = makeShelf();
  try {
    await shelf.putBook({ ...book('bk_1', 1000), progress: { unitIndex: 3, percent: 10, playedMs: 500 } });
    await shelf.updateProgress('bk_1', { unitIndex: 5 });
    const got = await shelf.getBook('bk_1');
    assert.equal(got.progress.unitIndex, 5);
    assert.equal(got.progress.percent, 10);
    assert.equal(got.progress.playedMs, 500);
    assert.ok(got.progress.updatedAt > 0);
    // 书的其它字段不能被进度写坏。
    assert.equal(got.title, 'Book bk_1');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('updateProgress 对不存在的书不报错，也不造书', async () => {
  const { root, shelf } = makeShelf();
  try {
    await shelf.updateProgress('bk_missing', { unitIndex: 1 });
    assert.deepEqual(await shelf.listBooks(), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
