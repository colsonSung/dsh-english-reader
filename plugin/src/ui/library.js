/**
 * The library tab.
 *
 * The shelf looks like a bookshelf: a centred title, three figures for the
 * learner's own reading, and a grid of covers. Every cover carries a listen
 * button, a progress bar and a menu (word frequency, details, rename, delete).
 */
import { createElement as h, useCallback, useEffect, useMemo, useState } from 'react';
import { ImportIcon, TrashIcon, BookIcon } from './icons.js';
import { bookWordCount, wordFrequency } from '../lib/frequency.js';

/**
 * A human duration, split into minutes and seconds.
 * @param {number} ms
 * @returns {{ minutes: string, seconds: string }}
 */
function splitDuration(ms) {
  const total = Math.max(0, Math.round((ms ?? 0) / 1000));
  return { minutes: String(Math.floor(total / 60)), seconds: String(total % 60) };
}

/**
 * A human duration.
 * @param {number} ms
 * @returns {string}
 */
function formatDuration(ms) {
  const { minutes, seconds } = splitDuration(ms);
  return `${minutes} 分钟 ${seconds} 秒`;
}

/**
 * A compact word count.
 * @param {number} words
 * @returns {string}
 */
function formatWords(words) {
  const value = Math.max(0, Math.round(words ?? 0));
  if (value < 1000) return `${value} 词`;
  return `${(value / 1000).toFixed(1)}k 词`;
}

/**
 * The first letters of a title, for the placeholder cover.
 * @param {string} title
 * @returns {string}
 */
function initialsOf(title) {
  const trimmed = String(title ?? '').trim();
  if (trimmed.length === 0) return '?';
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

/**
 * A small modal used by the per-book menu.
 *
 * The wide variant carries the mind map and the podcast player, which need
 * more room than a form.
 *
 * @param {object} props
 * @param {string} props.title
 * @param {Function} props.onClose
 * @param {Function} props.children
 * @param {'default'|'wide'} [props.size] - the width of the modal.
 * @returns {any} the element tree
 */
export function Modal({ title, onClose, children, size = 'default' }) {
  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); };
  }, [onClose]);
  return h(
    'div',
    { className: 'er-modal-mask', onClick: onClose },
    h(
      'div',
      { className: `er-modal${size === 'wide' ? ' is-wide' : ''}`, onClick: (event) => { event.stopPropagation(); } },
      h(
        'div',
        { className: 'er-modal-head' },
        h('div', { className: 'er-modal-title' }, title),
        h('button', { type: 'button', className: 'er-round-button', onClick: onClose }, '✕'),
      ),
      children,
    ),
  );
}

/**
 * The library tab.
 * @param {object} props
 * @param {Function} props.t - translator
 * @param {object[]} props.books - the stored books
 * @param {string} props.error
 * @param {Function} props.onFiles
 * @param {Function} props.onOpen
 * @param {Function} props.onDelete
 * @param {Function} props.onRename
 * @param {'grid'|'list'} props.view
 * @param {Function} props.onViewChange
 * @param {Function} props.onListen
 * @returns {any} the element tree
 */
export function LibraryView({
  t, books, error, onFiles, onOpen, onDelete, onRename, onGenerateCover,
  view, onViewChange, onListen, build,
}) {
  const [query, setQuery] = useState('');
  const [menuFor, setMenuFor] = useState(null);
  const [modal, setModal] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  // Drawing a cover takes a while, so the learner gets told what is going on.
  const [pendingCover, setPendingCover] = useState(null);
  const [notice, setNotice] = useState(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return books;
    return books.filter((book) => {
      const haystack = `${book.title ?? ''} ${book.author ?? ''} ${book.format ?? ''}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [books, query]);

  // The learner's own reading situation, summed over every book.
  const overall = useMemo(() => {
    let words = 0;
    let readMs = 0;
    let playedMs = 0;
    let started = 0;
    for (const book of books) {
      const activity = book.progress?.activity;
      words += activity?.totalWords ?? 0;
      readMs += activity?.totalMs ?? 0;
      playedMs += book.progress?.playedMs ?? 0;
      const percent = book.progress?.percent ?? 0;
      if (percent > 0) started += 1;
    }
    const minutes = readMs / 60000;
    // A reading speed above the fastest reader alive is a data glitch, not a
    // result; it is shown as "no speed" instead of a silly number.
    const raw = minutes < 0.2 ? 0 : words / minutes;
    return {
      words,
      readMs,
      playedMs,
      started,
      wpm: raw > 600 ? 0 : Math.round(raw),
    };
  }, [books]);

  const openMenu = (book, event) => {
    event?.stopPropagation?.();
    setMenuFor(menuFor === book.id ? null : book.id);
  };

  const drawCover = useCallback(async (book) => {
    setMenuFor(null);
    setPendingCover(book.id);
    setNotice({ kind: 'busy', text: t('library.coverGenerating') });
    try {
      const done = await onGenerateCover(book.id);
      setNotice(done === true
        ? { kind: 'ok', text: t('library.coverDone') }
        : { kind: 'error', text: t('library.coverFailed') });
    } catch (error) {
      setNotice({ kind: 'error', text: t('library.coverFailed') });
    } finally {
      setPendingCover(null);
    }
  }, [onGenerateCover, t]);

  const showFrequency = (book) => {
    setMenuFor(null);
    setModal({ kind: 'frequency', book });
  };

  const showDetails = (book) => {
    setMenuFor(null);
    setModal({ kind: 'details', book });
  };

  const startRename = (book) => {
    setMenuFor(null);
    setRenameValue(book.title ?? '');
    setModal({ kind: 'rename', book });
  };

  const renderStatCards = () => {
    const read = splitDuration(overall.readMs);
    const played = splitDuration(overall.playedMs);
    return h(
      'div',
      { className: 'er-library-cards' },
      h(
        'div',
        { className: 'er-library-card' },
        h('div', { className: 'er-library-card-label' }, t('library.statRead')),
        h(
          'div',
          { className: 'er-library-card-value' },
          h('span', { className: 'er-library-card-number is-read' }, read.minutes),
          h('span', { className: 'er-library-card-unit' }, 'min'),
          h('span', { className: 'er-library-card-number is-read' }, read.seconds),
          h('span', { className: 'er-library-card-unit' }, 'sec'),
        ),
      ),
      h(
        'div',
        { className: 'er-library-card' },
        h('div', { className: 'er-library-card-label' }, t('library.statPlayed')),
        h(
          'div',
          { className: 'er-library-card-value' },
          h('span', { className: 'er-library-card-number is-played' }, played.minutes),
          h('span', { className: 'er-library-card-unit' }, 'min'),
          h('span', { className: 'er-library-card-number is-played' }, played.seconds),
          h('span', { className: 'er-library-card-unit' }, 'sec'),
        ),
      ),
      h(
        'div',
        { className: 'er-library-card' },
        h('div', { className: 'er-library-card-label' }, t('library.statSpeed')),
        h(
          'div',
          { className: 'er-library-card-value' },
          h('span', { className: 'er-library-card-number is-speed' }, String(overall.wpm)),
          h('span', { className: 'er-library-card-unit' }, 'WPM'),
        ),
      ),
    );
  };

  const renderCover = (book) => {
    const percent = Math.max(0, Math.min(1, book.progress?.percent ?? 0));
    return h(
      'div',
      { className: 'er-shelf-cover' },
      book.cover
        ? h('img', { className: 'er-cover-image', src: book.cover, alt: '' })
        : h('div', { className: 'er-cover-fallback' }, initialsOf(book.title)),
      h(
        'button',
        {
          type: 'button',
          className: 'er-cover-open',
          title: book.title,
          onClick: () => { onOpen(book.id); },
        },
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'er-cover-action er-cover-listen',
          title: t('library.listen'),
          onClick: (event) => { event.stopPropagation(); onListen?.(book.id); },
        },
        '🎧',
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'er-cover-action er-cover-menu',
          title: t('library.more'),
          onClick: (event) => { openMenu(book, event); },
        },
        '⋯',
      ),
      percent > 0
        ? h('div', { className: 'er-cover-progress' }, h('span', { style: { width: `${Math.round(percent * 100)}%` } }))
        : null,
      pendingCover === book.id
        ? h('div', { className: 'er-cover-busy' }, h('span', { className: 'er-cover-spinner' }), t('library.coverGenerating'))
        : null,
    );
  };

  const renderMenu = (book) => h(
    'div',
    { className: 'er-book-menu', onClick: (event) => { event.stopPropagation(); } },
    h('button', { type: 'button', className: 'er-book-menu-item', onClick: () => { showFrequency(book); } }, t('library.menuFrequency')),
    h('button', { type: 'button', className: 'er-book-menu-item', onClick: () => { showDetails(book); } }, t('library.menuDetails')),
    h(
      'button',
      {
        type: 'button',
        className: 'er-book-menu-item',
        disabled: pendingCover !== null,
        onClick: () => { void drawCover(book); },
      },
      pendingCover === book.id ? t('library.coverGenerating') : t('library.menuCover'),
    ),
    h('button', { type: 'button', className: 'er-book-menu-item', onClick: () => { startRename(book); } }, t('library.menuRename')),
    h('button', { type: 'button', className: 'er-book-menu-item is-danger', onClick: () => { setMenuFor(null); onDelete(book.id); } }, t('library.menuDelete')),
  );

  const renderGridCard = (book) => {
    const percent = Math.max(0, Math.min(1, book.progress?.percent ?? 0));
    return h(
      'div',
      { key: book.id, className: 'er-shelf-card' },
      renderCover(book),
      h('div', { className: 'er-shelf-title', title: book.title }, book.title || t('library.untitled')),
      h('div', { className: 'er-shelf-percent' }, `${Math.round(percent * 100)}%`),
      menuFor === book.id ? renderMenu(book) : null,
    );
  };

  const renderListRow = (book) => {
    const percent = Math.max(0, Math.min(1, book.progress?.percent ?? 0));
    const activity = book.progress?.activity;
    return h(
      'div',
      { key: book.id, className: 'er-book' },
      h(
        'div',
        { className: 'er-book-cover-small' },
        renderCover(book),
        menuFor === book.id ? renderMenu(book) : null,
      ),
      h(
        'div',
        { className: 'er-book-main' },
        h('div', { className: 'er-book-title' }, book.title || t('library.untitled')),
        h(
          'div',
          { className: 'er-book-meta' },
          `${book.author || t('library.unknownAuthor')} · ${String(book.format ?? '').toUpperCase()} · ${formatWords(bookWordCount(book.chapters))}`,
        ),
        h(
          'div',
          { className: 'er-book-stats' },
          `${Math.round(percent * 100)}% · ${formatWords(activity?.totalWords ?? 0)}`,
          activity?.totalMs ? ` · ${formatDuration(activity.totalMs)}` : '',
        ),
        h('div', { className: 'er-book-progress' }, h('span', { style: { width: `${Math.round(percent * 100)}%` } })),
      ),
      h(
        'div',
        { className: 'er-book-actions' },
        h('button', { type: 'button', className: 'er-btn', onClick: () => { onListen?.(book.id); } }, t('library.listen')),
        h('button', { type: 'button', className: 'er-btn er-btn-primary', onClick: () => { onOpen(book.id); } }, percent > 0 ? t('library.continue') : t('library.open')),
        h('button', { type: 'button', className: 'er-btn er-btn-danger er-btn-icon', title: t('library.delete'), onClick: () => { onDelete(book.id); } }, h(TrashIcon, { size: 14 })),
      ),
    );
  };

  const renderModal = () => {
    if (modal === null) return null;
    const { kind, book } = modal;
    if (kind === 'frequency') {
      const words = wordFrequency(book.chapters, 40);
      const max = words[0]?.count ?? 1;
      return h(
        Modal,
        { title: `${t('library.frequencyTitle')} · ${book.title}`, onClose: () => { setModal(null); } },
        h(
          'div',
          { className: 'er-frequency' },
          words.length === 0
            ? h('div', { className: 'er-empty-hint' }, t('library.frequencyEmpty'))
            : words.map((entry) => h(
              'div',
              { key: entry.word, className: 'er-frequency-row' },
              h('span', { className: 'er-frequency-word' }, entry.word),
              h('span', { className: 'er-frequency-bar' }, h('span', { style: { width: `${Math.round((entry.count / max) * 100)}%` } })),
              h('span', { className: 'er-frequency-count' }, String(entry.count)),
            )),
        ),
      );
    }
    if (kind === 'details') {
      const activity = book.progress?.activity;
      const rows = [
        [t('library.detailAuthor'), book.author || t('library.unknownAuthor')],
        [t('library.detailFormat'), String(book.format ?? '').toUpperCase()],
        [t('library.detailChapters'), String(book.chapters?.length ?? 0)],
        [t('library.detailParagraphs'), String((book.chapters ?? []).reduce((sum, chapter) => sum + (chapter.paragraphs?.length ?? 0), 0))],
        [t('library.detailWords'), formatWords(bookWordCount(book.chapters))],
        [t('library.detailProgress'), `${Math.round((book.progress?.percent ?? 0) * 100)}%`],
        [t('library.detailReadWords'), formatWords(activity?.totalWords ?? 0)],
        [t('library.detailReadTime'), formatDuration(activity?.totalMs ?? 0)],
        [t('library.detailAdded'), new Date(book.addedAt ?? Date.now()).toLocaleDateString()],
      ];
      return h(
        Modal,
        { title: book.title, onClose: () => { setModal(null); } },
        h(
          'div',
          { className: 'er-details' },
          rows.map(([label, value]) => h(
            'div',
            { key: label, className: 'er-details-row' },
            h('span', { className: 'er-details-label' }, label),
            h('span', { className: 'er-details-value' }, value),
          )),
        ),
      );
    }
    return h(
      Modal,
      { title: t('library.menuRename'), onClose: () => { setModal(null); } },
      h('input', {
        className: 'er-rename-input',
        value: renameValue,
        onChange: (event) => { setRenameValue(event.target.value); },
      }),
      h(
        'div',
        { className: 'er-modal-foot' },
        h('button', { type: 'button', className: 'er-btn', onClick: () => { setModal(null); } }, t('library.cancel')),
        h(
          'button',
          {
            type: 'button',
            className: 'er-btn er-btn-primary',
            onClick: () => { onRename(book.id, renameValue.trim() || book.title); setModal(null); },
          },
          t('library.save'),
        ),
      ),
    );
  };

  return h(
    'div',
    { className: 'er-library' },
    h(
      'div',
      { className: 'er-library-head' },
      h('div', { className: 'er-library-title' }, t('tab.library')),
      build === undefined ? null : h('span', { className: 'er-library-build', title: 'Build' }, build),
    ),
    notice === null
      ? null
      : h(
        'div',
        { className: `er-notice is-${notice.kind}` },
        notice.kind === 'busy' ? h('span', { className: 'er-cover-spinner' }) : null,
        h('span', {}, notice.text),
      ),
    renderStatCards(),
    h(
      'div',
      { className: 'er-library-toolbar' },
      h(
        'div',
        { className: 'er-library-search' },
        h('input', {
          type: 'search',
          value: query,
          placeholder: t('library.searchPlaceholder'),
          onChange: (event) => { setQuery(event.target.value); },
        }),
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'er-view-switch-item',
          title: view === 'grid' ? t('library.viewList') : t('library.viewGrid'),
          onClick: () => { onViewChange?.(view === 'grid' ? 'list' : 'grid'); },
        },
        view === 'grid' ? '▦' : '☰',
      ),
    ),
    error ? h('div', { className: 'er-error' }, error) : null,
    books.length === 0
      ? h(
        'div',
        { className: 'er-empty' },
        h(BookIcon, { size: 28 }),
        h('div', { className: 'er-empty-title' }, t('library.emptyTitle')),
        h('div', { className: 'er-empty-hint' }, t('library.emptyHint')),
      )
      : filtered.length === 0
        ? h('div', { className: 'er-empty' }, h('div', { className: 'er-empty-title' }, t('library.noMatch')))
        : h(
          'div',
          { className: view === 'grid' ? 'er-book-grid' : 'er-book-list' },
          filtered.map((book) => (view === 'grid' ? renderGridCard(book) : renderListRow(book))),
        ),
    renderModal(),
  );
}
