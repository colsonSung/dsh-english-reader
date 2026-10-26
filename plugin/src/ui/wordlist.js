/**
 * The vocabulary panel: a drawer that slides in from the left.
 *
 * The panel owns no vocabulary rules of its own — it reads the list from the
 * data layer (`src/lib/vocab.js`), counts it with the same `summarize` the
 * rest of the plugin uses, and hands the learner back to the word card
 * through `onOpenEntry` and `onReview`.
 *
 * Every label goes through the translator; when the dictionary has no entry
 * yet the Chinese fallback is used, so the panel is readable before the
 * locale files are complete.
 */
import { createElement as h, useCallback, useEffect, useMemo, useState } from 'react';
import { SearchIcon, SoundIcon, TrashIcon } from './icons.js';
import { dueEntries, listEntries, removeEntry, summarize, VOCAB_CHANGED_EVENT } from '../lib/vocab.js';
import { speakWord } from '../lib/speech.js';

/** One day in milliseconds, for the "today" comparison. */
/** The ring progress: a 64 pixel box with a 26 pixel radius. */
const RING_SIZE = 78;
const RING_RADIUS = 33;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * Read a label. The translator returns the key itself when the dictionary
 * has no entry, so the Chinese fallback is used in that case as well.
 * @param {Function} t - the translator
 * @param {string} key
 * @param {string} fallback - the Chinese label
 * @returns {string}
 */
function label(t, key, fallback) {
  try {
    const value = typeof t === 'function' ? t(key) : undefined;
    if (typeof value === 'string' && value.trim() !== '' && value !== key) return value;
  } catch {
    // The dictionary is not registered yet; the fallback carries the meaning.
  }
  return fallback;
}

/**
 * Fill `{name}` placeholders in a locale string.
 * @param {string} template
 * @param {Record<string, number|string>} values
 * @returns {string}
 */
function format(template, values) {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

/**
 * When the word was collected: today, yesterday, or the day itself.
 * @param {number} timestamp
 * @param {number} [now]
 * @returns {string}
 */
function formatAddedAt(timestamp, now = Date.now()) {
  if (!Number.isFinite(timestamp)) return '';
  const date = new Date(timestamp);
  const today = new Date(now);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startOfYesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1).getTime();
  if (timestamp >= startOfToday) return '今天';
  if (timestamp >= startOfYesterday) return '昨天';
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

/**
 * Whether an entry belongs to one of the three buckets of the summary.
 * @param {object} entry
 * @param {string} bucket - 'all' | 'tolearn' | 'learning' | 'known'
 * @returns {boolean}
 */
function matchesBucket(entry, bucket) {
  const count = entry?.reviewCount ?? 0;
  if (bucket === 'known') return entry?.state === 'known';
  if (bucket === 'learning') return entry?.state === 'learning' && count >= 1;
  if (bucket === 'tolearn') return entry?.state === 'learning' && count < 1;
  return true;
}

/**
 * The vocabulary drawer.
 * @param {object} props
 * @param {Function} props.t - the translator
 * @param {boolean} props.open - whether the drawer is expanded
 * @param {Function} props.onClose - close the drawer
 * @param {Function} props.onOpenEntry - open the word card of an entry
 * @param {Function} props.onReview - open the word card for a review
 * @returns {any} the element tree
 */
export function WordList({ t, open, onClose, onOpenEntry, onReview, variant = 'drawer' }) {
  const [entries, setEntries] = useState([]);
  const [pending, setPending] = useState([]);
  const [bucket, setBucket] = useState('all');
  const [query, setQuery] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  /**
   * Read the list and the review queue.
   * @returns {Promise<void>}
   */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const stored = await listEntries();
      setEntries(stored);
      setPending(await dueEntries());
      setNote('');
    } catch (error) {
      setNote(error?.message ?? label(t, 'vocab.loadFailed', '无法读取生词本。'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  // The drawer reads the list when it opens, and again whenever the list
  // changes — a word collected in the reader shows up right away.
  useEffect(() => {
    if (!open) return undefined;
    void load();
    const view = globalThis.window;
    if (view === undefined || typeof view.addEventListener !== 'function') return undefined;
    const onChanged = () => { void load(); };
    view.addEventListener(VOCAB_CHANGED_EVENT, onChanged);
    return () => { view.removeEventListener(VOCAB_CHANGED_EVENT, onChanged); };
  }, [open, load]);

  /**
   * Speak a word with the browser's own voice.
   * @param {string} word
   */
  // The cloud voice reads the word; the browser's own speech is the fallback.
  const speak = useCallback((word) => {
    setNote('');
    void speakWord(word, {
      onError: () => { setNote(label(t, 'vocab.speechFailed', '当前环境不支持语音合成。')); },
    });
  }, [t]);

  /**
   * Forget a word.
   * @param {object} entry
   */
  const onDelete = useCallback(async (entry) => {
    try {
      await removeEntry(entry.id);
      await load();
    } catch (error) {
      setNote(error?.message ?? label(t, 'vocab.loadFailed', '无法读取生词本。'));
    }
  }, [load, t]);

  /**
   * Hand one word of the review queue to the word card.
   */
  const onReviewClick = useCallback(async () => {
    const queue = await dueEntries();
    setPending(queue);
    if (queue.length === 0) {
      setNote(label(t, 'vocab.noDue', '暂时没有需要复习的单词。'));
      return;
    }
    const picked = queue[Math.floor(Math.random() * queue.length)];
    onReview?.(picked);
  }, [onReview, t]);

  const summary = useMemo(() => summarize(entries), [entries]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (!matchesBucket(entry, bucket)) return false;
      if (needle === '') return true;
      return String(entry?.word ?? '').toLowerCase().includes(needle);
    });
  }, [entries, bucket, query]);

  const percent = summary.total === 0 ? 0 : Math.round((summary.known / summary.total) * 100);
  const dash = (percent / 100) * RING_CIRCUMFERENCE;

  const buckets = [
    { key: 'all', text: label(t, 'vocab.all', '全部') },
    { key: 'tolearn', text: label(t, 'vocab.toLearn', '待学') },
    { key: 'learning', text: label(t, 'vocab.learning', '学习中') },
    { key: 'known', text: label(t, 'vocab.known', '已掌握') },
  ];

  /**
   * One line of the summary next to the ring.
   * @param {string} kind - 'known' | 'learning' | 'tolearn'
   * @param {number} value
   * @param {string} text
   * @returns {any} the element tree
   */
  const stat = (kind, value, text) => h(
    'div',
    { className: 'er-wordlist-stat' },
    h('span', { className: 'er-wordlist-stat-value' }, String(value)),
    h('span', { className: 'er-wordlist-stat-label' },
      h('span', { className: `er-wordlist-dot is-${kind}` }),
      text),
  );

  /**
   * One collected word.
   * @param {object} entry
   * @returns {any} the element tree
   */
  const row = (entry) => h(
    'li',
    { key: entry.id, className: `er-wordlist-row${entry.state === 'known' ? ' is-known' : ''}` },
    h(
      'div',
      { className: 'er-wordlist-row-main' },
      h(
        'div',
        { className: 'er-wordlist-row-head' },
        h(
          'button',
          {
            type: 'button',
            className: 'er-wordlist-word',
            onClick: () => { onOpenEntry?.(entry); },
          },
          entry.word,
        ),
        entry.phonetic ? h('span', { className: 'er-wordlist-phonetic' }, entry.phonetic) : null,
      ),
      h('div', { className: 'er-wordlist-definition' }, entry.definition ?? ''),
      h(
        'div',
        { className: 'er-wordlist-meta' },
        h('span', { className: 'er-wordlist-time' }, formatAddedAt(entry.addedAt)),
        entry.bookTitle ? h('span', { className: 'er-wordlist-book' }, entry.bookTitle) : null,
      ),
    ),
    h(
      'div',
      { className: 'er-wordlist-actions' },
      h(
        'button',
        {
          type: 'button',
          className: 'er-wordlist-speak',
          title: label(t, 'vocab.speak', '朗读'),
          onClick: () => { speak(entry.word); },
        },
        h(SoundIcon, { size: 14 }),
        h('span', { className: 'er-wordlist-speak-text' }, label(t, 'vocab.speak', '朗读')),
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'er-wordlist-delete',
          title: label(t, 'vocab.delete', '删除'),
          onClick: () => { void onDelete(entry); },
        },
        h(TrashIcon, { size: 14 }),
      ),
    ),
  );

  const emptyText = entries.length === 0
    ? label(t, 'vocab.empty', '生词本还是空的。在阅读时点击任意单词即可收藏。')
    : label(t, 'vocab.emptyFiltered', '没有符合当前筛选的单词。');

  return h(
    'div',
    {
      className: `er-wordlist${open ? ' is-open' : ' is-closed'}${variant === 'page' ? ' is-page' : ''}`,
      'aria-hidden': open ? undefined : 'true',
    },
    h('div', {
      className: 'er-wordlist-mask',
      onClick: () => { onClose?.(); },
    }),
    h(
      'aside',
      { className: 'er-wordlist-panel', role: 'dialog', 'aria-label': label(t, 'vocab.title', '生词本') },
      h(
        'div',
        { className: 'er-wordlist-head' },
        h('div', { className: 'er-wordlist-title' }, label(t, 'vocab.title', '生词本')),
        h(
          'button',
          {
            type: 'button',
            className: 'er-wordlist-close',
            title: label(t, 'vocab.close', '关闭'),
            'aria-label': label(t, 'vocab.close', '关闭'),
            onClick: () => { onClose?.(); },
          },
          '×',
        ),
      ),
      h(
        'div',
        { className: 'er-wordlist-body' },
        h(
          'div',
          { className: 'er-wordlist-progress' },
          h(
            'svg',
            {
              className: 'er-wordlist-ring',
              viewBox: `0 0 ${RING_SIZE} ${RING_SIZE}`,
              width: RING_SIZE,
              height: RING_SIZE,
              role: 'img',
              'aria-label': `${percent}%`,
            },
            h('circle', { className: 'er-wordlist-ring-track', cx: RING_SIZE / 2, cy: RING_SIZE / 2, r: RING_RADIUS }),
            // At zero percent the round cap would draw a stray dot.
            percent > 0
              ? h('circle', {
                className: 'er-wordlist-ring-value',
                cx: RING_SIZE / 2,
                cy: RING_SIZE / 2,
                r: RING_RADIUS,
                strokeDasharray: `${dash} ${RING_CIRCUMFERENCE - dash}`,
                strokeLinecap: 'round',
                transform: `rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`,
              })
              : null,
            h(
              'text',
              { className: 'er-wordlist-ring-text', x: RING_SIZE / 2, y: RING_SIZE / 2 + 6, textAnchor: 'middle' },
              `${percent}%`,
            ),
          ),
          h(
            'div',
            { className: 'er-wordlist-stats' },
            stat('known', summary.known, label(t, 'vocab.known', '已掌握')),
            stat('learning', summary.learning, label(t, 'vocab.learning', '学习中')),
            stat('tolearn', summary.toLearn, label(t, 'vocab.toLearn', '待学')),
            h(
              'div',
              { className: 'er-wordlist-added' },
              format(label(t, 'vocab.addedToday', '今日新增 {n}'), { n: summary.addedToday }),
            ),
          ),
        ),
        h(
          'div',
          { className: 'er-wordlist-review' },
          h(
            'button',
            {
              type: 'button',
              className: 'er-wordlist-review-button',
              disabled: pending.length === 0,
              onClick: () => { void onReviewClick(); },
            },
            format(label(t, 'vocab.reviewDue', '待复习 {n}'), { n: pending.length }),
          ),
        ),
        h(
          'div',
          { className: 'er-wordlist-filters' },
          h(
            'div',
            { className: 'er-wordlist-chips', role: 'group', 'aria-label': label(t, 'vocab.filter', '筛选') },
            buckets.map((item) => h(
              'button',
              {
                key: item.key,
                type: 'button',
                className: `er-wordlist-chip${bucket === item.key ? ' is-active' : ''}`,
                'aria-pressed': bucket === item.key,
                onClick: () => { setBucket(item.key); },
              },
              item.text,
            )),
          ),
          h(
            'div',
            { className: 'er-wordlist-searchwrap' },
            h(SearchIcon, { size: 14, className: 'er-wordlist-search-icon' }),
            h('input', {
              className: 'er-wordlist-search',
              type: 'search',
              value: query,
              placeholder: label(t, 'vocab.search', '搜索单词'),
              onChange: (event) => { setQuery(event.target.value); },
            }),
          ),
        ),
        note ? h('div', { className: 'er-wordlist-note' }, note) : null,
        loading && entries.length === 0
          ? h('div', { className: 'er-wordlist-empty' }, label(t, 'vocab.loading', '正在读取生词本…'))
          : null,
        !loading && visible.length === 0
          ? h('div', { className: 'er-wordlist-empty' }, emptyText)
          : null,
        visible.length > 0
          ? h('ul', { className: 'er-wordlist-list' }, visible.map((entry) => row(entry)))
          : null,
      ),
    ),
  );
}
