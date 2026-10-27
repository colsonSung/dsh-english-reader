/**
 * 中日韩切分层的单元测试。
 *
 * 覆盖中文书读不出来的那条链路：
 *   - splitSentences：全角句末标点（。！？）、省略号（……）、中文闭合标记
 *   - tokenize：汉字逐字成词、中英混排、代理对生僻字、偏移还原、标点归属
 *   - buildUnits / frequency：中文章节不再产生空词表，词数不再为 0
 *   - 英文规则回归：缩写、小数、感叹疑问不受中文支持影响
 *
 * 运行：node --test tests/cjk.test.mjs
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildUnits, splitSentences, tokenize } from '../src/lib/engine/segment.js';
import { bookWordCount, wordFrequency } from '../src/lib/frequency.js';

/** 一章中文样本。 */
const CHINESE_CHAPTER = {
  title: '第一章 货币的起源',
  paragraphs: [
    '第一句。第二句！第三句？',
    '他走了……再见。',
  ],
};

/** 统计一段文字里的汉字个数。 */
function hanCount(text) {
  return (text.match(/\p{Script=Han}/gu) ?? []).length;
}

// ------------------------------------------------------------- splitSentences

test('cjk: splitSentences 按全角句末标点断句', () => {
  assert.deepEqual(
    splitSentences('第一句。第二句！第三句？'),
    ['第一句。', '第二句！', '第三句？']
  );
});

test('cjk: splitSentences 把中文闭合标记并入上一句', () => {
  assert.deepEqual(
    splitSentences('他说「你好。」然后走了。'),
    ['他说「你好。」', '然后走了。']
  );
  assert.deepEqual(
    splitSentences('他念『好』。然后走了。'),
    ['他念『好』。', '然后走了。']
  );
  assert.deepEqual(
    splitSentences('书名《账户》。然后走了。'),
    ['书名《账户》。', '然后走了。']
  );
});

test('cjk: splitSentences 把连续的省略号当成一个句尾', () => {
  assert.deepEqual(splitSentences('他走了……再见。'), ['他走了……', '再见。']);
  assert.deepEqual(splitSentences('他说……好吧。'), ['他说……', '好吧。']);
});

test('cjk: splitSentences 不要求中文句末标点后面有空格', () => {
  // 中文没有词间空格：句末标点直接接下一句也要断句
  assert.deepEqual(
    splitSentences('第一句。第二句'),
    ['第一句。', '第二句']
  );
  assert.equal(splitSentences('第一句。第二句。').length, 2);
});

// ------------------------------------------------------------------- tokenize

test('cjk: tokenize 中英混排时汉字逐字成词', () => {
  const words = tokenize('中文English混排123');
  assert.deepEqual(words.map((w) => w.text), ['中', '文', 'English', '混', '排', '123']);
  assert.deepEqual(words.map((w) => w.start), [0, 1, 2, 9, 10, 11]);
  assert.deepEqual(words.map((w) => w.end), [1, 2, 9, 10, 11, 14]);
});

test('cjk: tokenize 的 start/end 偏移能原样还原 text', () => {
  const sentence = '他说，Hello world! 然后走了。';
  const words = tokenize(sentence);
  assert.ok(words.length > 0);
  for (const word of words) {
    assert.equal(sentence.slice(word.start, word.end), word.text);
  }
  // 整段中文也一样
  const chinese = '第一句。第二句；第三句，第四句：第五句！';
  for (const word of tokenize(chinese)) {
    assert.equal(chinese.slice(word.start, word.end), word.text);
  }
});

test('cjk: 代理对里的生僻字是一个词，不会被劈成两半', () => {
  const words = tokenize('𠮷好');
  assert.deepEqual(words.map((w) => w.text), ['𠮷', '好']);
  assert.equal(words[0].start, 0);
  assert.equal(words[0].end, 2, '𠮷 占两个 UTF-16 码元');
  assert.equal(words[0].text.length, 2);
  assert.equal(words[1].start, 2);
});

test('cjk: 中文标点并入前一个词，clean 只留汉字', () => {
  const words = tokenize('真的吗？');
  assert.deepEqual(words.map((w) => w.text), ['真', '的', '吗？']);
  assert.deepEqual(words.map((w) => w.clean), ['真', '的', '吗']);
  // 汉字属于 \p{L}，clean 不会把中文洗成空串
  const single = tokenize('好。');
  assert.deepEqual(single.map((w) => w.text), ['好。']);
  assert.deepEqual(single.map((w) => w.clean), ['好']);
  assert.ok(single[0].clean.length > 0);
});

test('cjk: 中文标点不会从词表里丢失', () => {
  const sentence = '第一句。第二句；第三句，第四句：第五句！';
  const rebuilt = tokenize(sentence).map((w) => w.text).join('');
  assert.equal(rebuilt, sentence);
});

// ------------------------------------------------------------------ buildUnits

test('cjk: buildUnits 展开的中文单元都有词', () => {
  const units = buildUnits([CHINESE_CHAPTER]);
  assert.ok(units.length >= 5);
  for (const unit of units) {
    assert.ok(unit.words.length > 0, `单元 ${unit.id} 没有词`);
    assert.ok(unit.text.length > 0, `单元 ${unit.id} 没有正文`);
  }
  const firstParagraph = units.filter((u) => u.paragraphIndex === 0);
  assert.equal(firstParagraph.length, 3);
  assert.deepEqual(
    firstParagraph.map((u) => u.text),
    ['第一句。', '第二句！', '第三句？']
  );
  assert.deepEqual(
    firstParagraph.map((u) => u.sentenceIndex),
    [0, 1, 2]
  );
  assert.deepEqual(
    firstParagraph[0].words.map((w) => w.text),
    ['第', '一', '句。']
  );
});

// ------------------------------------------------------------------- frequency

test('cjk: bookWordCount 数的是汉字个数，不是 0', () => {
  const count = bookWordCount([CHINESE_CHAPTER]);
  assert.ok(count > 0, '中文章节的词数不能是 0');
  assert.equal(count, hanCount(CHINESE_CHAPTER.paragraphs.join('')));
});

test('cjk: wordFrequency 返回非空的词频表', () => {
  const result = wordFrequency([CHINESE_CHAPTER], 10);
  assert.ok(result.length > 0, '中文章节的词频表不能是空的');
  const total = result.reduce((sum, item) => sum + item.count, 0);
  assert.ok(total > 0);
  for (const item of result) {
    // 没有中文分词器时，单字就是诚实的单位
    assert.match(item.word, /^\p{Script=Han}$/u);
    assert.ok(item.count > 0);
    assert.ok(item.share > 0 && item.share <= 1);
  }
});

// ---------------------------------------------------------------- 英文规则回归

test('cjk: 英文切句规则没有因为支持中文而改变', () => {
  assert.deepEqual(splitSentences('Mr. Smith went home.'), ['Mr. Smith went home.']);
  assert.deepEqual(splitSentences('U.S. economy grew.'), ['U.S. economy grew.']);
  assert.deepEqual(splitSentences('Really?! Okay.'), ['Really?!', 'Okay.']);
  assert.deepEqual(splitSentences('Pi is 3.14 exactly. Nice.'), ['Pi is 3.14 exactly.', 'Nice.']);
  assert.deepEqual(
    splitSentences('He said e.g. this is fine. Then he left.'),
    ['He said e.g. this is fine.', 'Then he left.']
  );
});

test('cjk: 英文切词规则没有因为支持中文而改变', () => {
  assert.deepEqual(
    tokenize("He said, don't go. It's 3 o'clock!").map((w) => w.text),
    ['He', 'said,', "don't", 'go.', "It's", '3', "o'clock!"]
  );
  assert.deepEqual(
    tokenize('Hello world.').map((w) => w.clean),
    ['hello', 'world']
  );
});
