/**
 * Local preview harness for the English Reader.
 *
 * It mounts the real page component with a mock client context and a seeded
 * local shelf, so the library and the reader can be inspected without a
 * running Harness. The prose below is written for the demo; it is not taken
 * from any book.
 *
 * IndexedDB needs a real origin, so serve the folder over http:
 *   python3 -m http.server 8080   # then open http://localhost:8080/
 */
import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { apply } from '../../src/client-entry.js';
import { saveBook, withStore, VOCAB_STORE_NAME } from '../../src/lib/store.js';

const NS = 'englishReader';

/** The local calendar day of a timestamp, as the shelf groups it. */
function dayKey(timestamp) {
  const date = new Date(timestamp);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * A reading record for the shelf statistics: total minutes, words, and the
 * per-day buckets the streak is computed from.
 */
function reading({ minutes, words, playedMinutes, percent, days = 1 }) {
  const now = Date.now();
  const buckets = {};
  for (let back = 0; back < days; back += 1) {
    buckets[dayKey(now - back * 24 * 60 * 60 * 1000)] = minutes * 60 * 1000;
  }
  return {
    percent,
    playedMs: playedMinutes * 60 * 1000,
    updatedAt: now - 1000 * 60 * 60 * 2,
    activity: {
      totalMs: minutes * 60 * 1000,
      totalWords: words,
      lastReadAt: now - 1000 * 60 * 60 * 2,
      startedAt: now - 1000 * 60 * 60 * 24,
      days: buckets,
    },
  };
}

/** The demo books: original prose, so nothing here is a copyrighted excerpt. */
const BOOKS = [
  {
    id: 'bk_preview_reading',
    title: 'The Practice of Daily Reading',
    author: 'A. Reader',
    format: 'epub',
    addedAt: Date.now() - 1000 * 60 * 60 * 6,
    progress: { ...reading({ minutes: 24, words: 3200, playedMinutes: 6, percent: 0.42, days: 4 }), unitIndex: 14, chapterIndex: 0 },
    chapters: [
      {
        title: 'Chapter 1 — Why a page a day',
        paragraphs: [
          'Reading a single page every morning is a quiet habit, and quiet habits are the ones that survive a busy year. The point is not to finish a book quickly. The point is to keep a promise to yourself that is small enough to keep.',
          'A reader who never reads two books at once still finishes more than a reader who never starts. Consistency beats intensity, because intensity depends on the mood of the day and consistency depends only on the calendar.',
          'When you return to a book after a week away, the first paragraph feels strange. It takes a few sentences to remember who is speaking and why the question matters. That discomfort is not a sign that you have forgotten the book. It is the shape of the habit reasserting itself.',
          'Choose a book that is slightly too easy. If every sentence asks for your full attention, you will stop in the middle of a chapter and call it a busy week. A book you can read with one hand, in a queue, on a tired evening, will pull you back in.',
          'The words you meet twice a week are the ones you start to recognise. Vocabulary that is only met in a dictionary is a record you have written once. Vocabulary that is met often becomes something you can use without thinking about the definition.',
          'Finally, keep the record honest. A reading log that counts every minute is a measurement, not a diary. A reading log that counts the pages you actually finished is closer to the truth, and the truth is what keeps you reading tomorrow.',
        ],
      },
      {
        title: 'Chapter 2 — Keeping the streak',
        paragraphs: [
          'A streak survives only if it is easy to resume. Leave the book open on the table. Keep a bookmark at the last page you read. Remove one decision from the path between you and the page.',
          'The streak breaks sometimes, and that is information rather than failure. Notice what happened the day before it broke. A late night, a difficult chapter, a crowded week. The pattern is usually obvious once you look for it.',
          'When the streak breaks, restart at the smallest possible size. One paragraph. The temptation after a break is to make up for it by reading twice as much, and that is exactly the demand that produces the next break.',
        ],
      },
    ],
  },
  {
    id: 'bk_preview_vocab',
    title: 'Notes on Vocabulary Building',
    author: 'M. Lexicon',
    format: 'txt',
    addedAt: Date.now() - 1000 * 60 * 60 * 30,
    progress: { ...reading({ minutes: 8, words: 1100, playedMinutes: 2, percent: 0.18, days: 2 }), unitIndex: 5, chapterIndex: 0 },
    chapters: [
      {
        title: 'Chapter 1 — The words you nearly know',
        paragraphs: [
          'There is a band of vocabulary that you can recognise but cannot yet produce. You understand the sentence, you can paraphrase it, but the exact word does not arrive when you reach for it. This band is where most of the useful work happens.',
          'Words in this band need a second meeting, not a second definition. Write them down with the sentence they came from, because a word without a context is a word without a home.',
          'When you look a word up, read the example sentences before you read the definition. The definition tells you what the word is; the example tells you how it behaves, and behaviour is what you are trying to copy.',
        ],
      },
    ],
  },
  {
    id: 'bk_preview_speaking',
    title: 'A Short Guide to Public Speaking',
    author: 'R. Voice',
    format: 'md',
    addedAt: Date.now() - 1000 * 60 * 60 * 80,
    progress: { ...reading({ minutes: 0, words: 0, playedMinutes: 0, percent: 0, days: 0 }), unitIndex: 0, chapterIndex: 0 },
    chapters: [
      {
        title: 'Chapter 1 — Before you stand up',
        paragraphs: [
          'Most of the fear of public speaking is decided before the microphone is switched on. It is decided by how much you have prepared and how little you have rehearsed the opening, which is the part an audience notices most.',
          'Write the first three sentences down. If the opening is familiar, the nerves have less to do, because the body is busy remembering a page it has already seen.',
          'Speak to one person at the start of a talk, not to the whole room. A room is an abstraction; a person is a conversation, and a conversation is something you already know how to do.',
        ],
      },
    ],
  },
];

/** Fill `{name}` placeholders the way the host's locale seat does. */
function interpolate(template, params) {
  if (typeof template !== 'string') return template;
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
}

const dictionaries = {};
const registrations = [];

const ctx = {
  get: () => undefined,
  effect: (callback) => callback(),
  locale: {
    bind: (ns) => (key, params) => interpolate(dictionaries[ns]?.en?.[key] ?? key, params),
    register: (ns, dicts) => { dictionaries[ns] = dicts; },
  },
  slots: {
    inject: (owner, callback) => callback(),
    register: (options, component) => registrations.push({ options, component }),
  },
};

apply(ctx);

const page = registrations.find((row) => row.options?.key === 'english-reader');
if (page === undefined) throw new Error('the reader did not register its main page');

const container = document.getElementById('reader');
const root = createRoot(container);

/** The demo vocabulary: a few collected words in mixed review states. */
const WORDS = [
  { word: 'consistency', state: 'known', reviewCount: 4, phonetic: '/kənˈsɪstənsi/', definition: 'the quality of doing something regularly' },
  { word: 'intensity', state: 'known', reviewCount: 3, phonetic: '/ɪnˈtensəti/', definition: 'great strength or force of feeling' },
  { word: 'paraphrase', state: 'known', reviewCount: 2, phonetic: '/ˈpærəfreɪz/', definition: 'restate a sentence in different words' },
  { word: 'recognise', state: 'learning', reviewCount: 2, phonetic: '/ˈrekəɡnaɪz/', definition: 'know or identify something already seen' },
  { word: 'vocabulary', state: 'learning', reviewCount: 1, phonetic: '/vəˈkæbjələri/', definition: 'the words a person knows' },
  { word: 'streak', state: 'learning', reviewCount: 1, phonetic: '/striːk/', definition: 'a series of successes in a row' },
  { word: 'definition', state: 'to learn', reviewCount: 0, phonetic: '/ˌdefɪˈnɪʃn/', definition: 'the meaning of a word' },
  { word: 'reassuring', state: 'to learn', reviewCount: 0, phonetic: '/ˌriːəˈʃʊərɪŋ/', definition: 'making someone feel calmer' },
];

/** Put the demo books and words on the shelf, then render the page. */
async function seed() {
  for (const book of BOOKS) await saveBook(book);
  const now = Date.now();
  for (const entry of WORDS) {
    await withStore('readwrite', (store) => store.put({
      id: entry.word,
      word: entry.word,
      bookId: BOOKS[0].id,
      bookTitle: BOOKS[0].title,
      sentence: 'A word collected while reading.',
      addedAt: now - 1000 * 60 * 60 * 3,
      state: entry.state === 'known' ? 'known' : 'learning',
      reviewCount: entry.reviewCount,
      lastReviewedAt: now - 1000 * 60 * 60 * 24,
      nextReviewAt: now + 1000 * 60 * 60 * 24,
      phonetic: entry.phonetic,
      definition: entry.definition,
    }), VOCAB_STORE_NAME);
  }
  root.render(h(page.component, { t: ctx.locale.bind(NS), build: 'preview' }));
}

seed().then(() => {
  // `?view=reader` opens a book straight away, so the reading page can be
  // inspected without clicking through the shelf.
  const params = new URLSearchParams(window.location.search);
  if (params.get('view') !== 'reader') return;
  setTimeout(() => {
    const target = [...document.querySelectorAll('button, [role="button"]')]
      .find((element) => (element.getAttribute('title') ?? '').includes(BOOKS[0].title));
    if (target !== undefined) target.click();
  }, 400);
});

