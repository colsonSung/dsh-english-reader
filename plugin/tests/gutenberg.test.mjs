/**
 * The online book source: the catalogue parsing and the search.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { downloadUrls, parseCatalog, search } from '../src/host/gutenberg.js';

const CATALOG = [
  "Text#,Type,Issued,Title,Language,Authors,Subjects,LoCC,Bookshelves",
  "1,Text,1971-12-01,The Declaration of Independence,en,\"Jefferson, Thomas\",\"History; Sources\",E201,\"Politics\"",
  "1342,Text,1994-08-01,Pride and Prejudice,en,\"Austen, Jane, 1775-1817\",\"England -- Fiction; Love stories\",PR,\"Best Books Ever\"",
  "11,Text,1991-06-01,\"Alice's Adventures in Wonderland\",en,\"Carroll, Lewis\",\"Fantasy fiction\",PR,\"Children's stories\"",
].join("\n");

test('parseCatalog 读出书号、书名、作者与分类', () => {
  const rows = parseCatalog(CATALOG);
  assert.equal(rows.length, 3);
  const book = rows.find((row) => row.id === 1342);
  assert.equal(book.title, 'Pride and Prejudice');
  assert.equal(book.author, 'Austen, Jane, 1775-1817');
  assert.equal(book.language, 'en');
  assert.deepEqual(book.subjects, ['England -- Fiction', 'Love stories']);
});

test('parseCatalog 处理引号里的逗号', () => {
  const rows = parseCatalog(CATALOG);
  assert.equal(rows[0].author, 'Jefferson, Thomas');
});

test('search 按书名命中并把书名命中的排在前面', async () => {
  const rows = parseCatalog(CATALOG);
  const hits = await search({ query: 'pride' }, { rows, fetch: async () => { throw new Error('no network'); } });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, 1342);
});

test('search 按作者命中', async () => {
  const rows = parseCatalog(CATALOG);
  const hits = await search({ query: 'austen' }, { rows, fetch: async () => { throw new Error('no network'); } });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, 1342);
});

test('downloadUrls 给出官方下载路径', () => {
  const urls = downloadUrls(1342);
  assert.match(urls.epub, /gutenberg\.org\/cache\/epub\/1342\/pg1342\.epub$/);
  assert.match(urls.text, /gutenberg\.org\/files\/1342\/1342-0\.txt$/);
});
