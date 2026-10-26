/**
 * The main panel page.
 *
 * The top bar carries the import button, the section switch and the shelf
 * menu; the body shows the shelf, the reader or the vocabulary list.
 */
import { Component, createElement as h, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseBook } from '../lib/parsers/index.js';
import { coverToDataUrl, generateCover } from '../lib/cover.js';
import { buildUnits } from '../lib/engine/segment.js';
import { askAi } from '../lib/ai.js';
import { deleteBook, listBooks, newBookId, saveBook, updateProgress } from '../lib/store.js';
import { LibraryView } from './library.js';
import { OnlineLibrary } from './online-library.js';
import { ReaderView } from './reader.js';
import { WordList } from './wordlist.js';


/**
 * A render error must not take the whole panel down.
 *
 * The boundary wraps the tab body only, so the top bar stays usable and the
 * learner can switch to another section. It also shows what went wrong, which
 * is the only way to diagnose a crash in the desktop app.
 */
class SectionBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.warn('[english-reader] section failed: ' + (error instanceof Error ? error.message : String(error)));
  }

  render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    const detail = error instanceof Error ? error.message : String(error);
    const frame = typeof error?.stack === 'string'
      ? error.stack.split('\n').find((line) => line.includes('/english-reader/')) ?? ''
      : '';
    return h(
      'div',
      { className: 'er-crash' },
      h('div', { className: 'er-crash-title' }, t('app.crashed')),
      h('div', { className: 'er-crash-hint' }, t('app.crashHint')),
      detail === '' ? null : h('div', { className: 'er-crash-detail' }, detail),
      frame === '' ? null : h('div', { className: 'er-crash-frame' }, frame.trim()),
      h(
        'button',
        {
          type: 'button',
          className: 'er-btn er-btn-primary',
          onClick: () => { globalThis.location?.reload?.(); },
        },
        t('app.reload'),
      ),
    );
  }
}

const VIEW_KEY = 'english-reader:library-view';

/**
 * Read the stored shelf view mode.
 * @returns {'grid'|'list'}
 */
function loadView() {
  try {
    return globalThis.localStorage?.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

/**
 * The plugin's page.
 * @param {object} props
 * @param {Function} props.t - translator
 * @returns {any} the element tree
 */
export function EnglishReaderPage({ t, build }) {
  const [tab, setTab] = useState('library');
  const [books, setBooks] = useState([]);
  const [activeBookId, setActiveBookId] = useState(null);
  const [units, setUnits] = useState([]);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [wordListOpen, setWordListOpen] = useState(false);
  const [cardRequest, setCardRequest] = useState(null);
  const [view, setView] = useState(loadView);
  const [sort, setSort] = useState('recent');
  const [menuOpen, setMenuOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const fileRef = useRef(null);
  const saveTimer = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const stored = await listBooks();
      setBooks(stored);
    } catch (loadError) {
      setError(loadError?.message ?? t('library.loadFailed'));
    }
  }, [t]);

  useEffect(() => {
    refresh().finally(() => { setLoaded(true); });
  }, [refresh]);

  // The reading position is written once the learner stops moving.
  useEffect(() => {
    if (activeBookId === null || units.length === 0) return undefined;
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const unit = units[index];
      void updateProgress(activeBookId, {
        unitIndex: index,
        chapterIndex: unit?.chapterIndex ?? 0,
        percent: units.length > 0 ? index / (units.length - 1 || 1) : 0,
      });
    }, 800);
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    };
  }, [activeBookId, index, units]);

  // Ask the model for a cover; the shelf keeps working while it is drawn.
  const generateCover = useCallback(async (book) => {
    try {
      const result = await askAi('cover', { title: book.title });
      if (typeof result?.url !== 'string' || result.url === '') return false;
      await saveBook({ ...book, cover: result.url });
      await refresh();
      return true;
    } catch {
      return false;
    }
  }, [refresh]);

  const importOne = useCallback(async (file, fallback) => {
    const parsed = await parseBook(file);
    // A book that carries its own picture keeps it; the others get a drawn
    // placeholder first and an AI cover afterwards.
    const hasRealCover = parsed.cover !== null && parsed.cover !== undefined;
    let cover = null;
    try {
      cover = await coverToDataUrl(parsed.cover ?? null) ?? await generateCover(parsed.title, parsed.author);
    } catch {
      cover = null;
    }
    const book = {
      id: newBookId(),
      title: parsed.title || fallback?.title || '',
      author: parsed.author || fallback?.author || '',
      format: parsed.format,
      chapters: parsed.chapters,
      cover,
      addedAt: Date.now(),
      progress: { unitIndex: 0, chapterIndex: 0, percent: 0 },
    };
    await saveBook(book);
    return { book, hasRealCover };
  }, []);

  const onFiles = useCallback(async (files) => {
    setBusy(true);
    setError('');
    try {
      const imported = [];
      for (const file of files) {
        imported.push(await importOne(file, null));
      }
      await refresh();
      setBusy(false);
      // 书里没有自带封面的，让模型画一张；书先入库，封面随后补上
      for (const entry of imported) {
        if (entry === null || entry.hasRealCover) continue;
        void generateCover(entry.book);
      }
    } catch (importError) {
      setError(importError?.message ?? t('library.importFailed'));
    } finally {
      setBusy(false);
    }
  }, [generateCover, importOne, refresh, t]);

  // A book that came from the online source arrives with its catalogue entry.
  const onImported = useCallback(async (file, hit) => {
    setBusy(true);
    setError('');
    try {
      const entry = await importOne(file, hit);
      await refresh();
      setSourceOpen(false);
      if (entry !== null && !entry.hasRealCover) void generateCover(entry.book);
    } catch (importError) {
      setError(importError?.message ?? t('library.importFailed'));
    } finally {
      setBusy(false);
    }
  }, [importOne, refresh, t]);

  // The shelf asks the reader to start reading aloud.
  const [autoPlayToken, setAutoPlayToken] = useState(0);

  const openBook = useCallback(async (id) => {
    const book = books.find((entry) => entry.id === id);
    if (book === undefined) return;
    const nextUnits = buildUnits(book.chapters ?? []);
    setUnits(nextUnits);
    setActiveBookId(id);
    setIndex(Math.min(Math.max(0, book.progress?.unitIndex ?? 0), Math.max(0, nextUnits.length - 1)));
    setTab('reader');
  }, [books]);

  // Open a book and let it read itself out loud.
  const listenBook = useCallback(async (id) => {
    await openBook(id);
    setAutoPlayToken((value) => value + 1);
  }, [openBook]);

  // Leaving the book: the reading time is flushed by the reader on unmount.
  const closeBook = useCallback(() => {
    setActiveBookId(null);
    setUnits([]);
    setIndex(0);
    setCardRequest(null);
    setTab('library');
  }, []);

  const onDelete = useCallback(async (id) => {
    await deleteBook(id);
    if (id === activeBookId) {
      setActiveBookId(null);
      setUnits([]);
      setIndex(0);
      setTab('library');
    }
    await refresh();
  }, [activeBookId, refresh]);

  const onRename = useCallback(async (id, title) => {
    const book = books.find((entry) => entry.id === id);
    if (book === undefined) return;
    await saveBook({ ...book, title });
    await refresh();
  }, [books, refresh]);

  // The reader reports how long and how much was read; it lands on the book.
  const onActivity = useCallback(async (activity, playedMs) => {
    if (activeBookId === null) return;
    await updateProgress(activeBookId, { activity, playedMs });
    // The shelf shows the reading situation, so it has to see the new numbers.
    setBooks(await listBooks());
  }, [activeBookId]);

  const activeBook = useMemo(
    () => books.find((entry) => entry.id === activeBookId) ?? null,
    [books, activeBookId],
  );

  // The shelf can be sorted the way a learner expects.
  const sorted = useMemo(() => {
    const copy = [...books];
    const stamp = (book) => book.progress?.activity?.lastReadAt ?? book.progress?.updatedAt ?? book.addedAt ?? 0;
    if (sort === 'title') copy.sort((a, b) => String(a.title ?? '').localeCompare(String(b.title ?? '')));
    else if (sort === 'added') copy.sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0));
    else if (sort === 'progress') copy.sort((a, b) => (b.progress?.percent ?? 0) - (a.progress?.percent ?? 0));
    else copy.sort((a, b) => stamp(b) - stamp(a));
    return copy;
  }, [books, sort]);

  const changeView = useCallback((next) => {
    setView(next);
    try {
      globalThis.localStorage?.setItem(VIEW_KEY, next);
    } catch {
      // A browser without localStorage simply keeps the current mode.
    }
  }, []);

  const pickFile = useCallback(() => { fileRef.current?.click(); }, []);

  if (!loaded) {
    return h('div', { className: 'er-page' }, h('div', { className: 'er-empty' }, t('library.loading')));
  }

  const sections = [
    { id: 'library', label: t('tab.library') },
    { id: 'reader', label: t('tab.reader') },
    { id: 'vocab', label: t('tab.vocab') },
  ];

  return h(
    'div',
    {
      className: 'er-page',
      onDragOver: (event) => { event.preventDefault(); },
      onDrop: (event) => {
        event.preventDefault();
        const dropped = Array.from(event.dataTransfer?.files ?? []);
        if (dropped.length > 0) void onFiles(dropped);
      },
    },
    h(
      'div',
      { className: 'er-appbar' },
      h(
        'div',
        { className: 'er-appbar-left' },
        h('button', { type: 'button', className: 'er-round-button', title: t('library.import'), onClick: pickFile }, '＋'),
        h(
          'button',
          {
            type: 'button',
            className: 'er-round-button',
            title: t('source.title'),
            onClick: () => { setSourceOpen(true); },
          },
          '🌐',
        ),
      ),
      h(
        'div',
        { className: 'er-segmented', role: 'tablist' },
        sections.map((section) => h(
          'button',
          {
            key: section.id,
            type: 'button',
            role: 'tab',
            className: 'er-segmented-item',
            'aria-selected': tab === section.id,
            onClick: () => { setTab(section.id); },
          },
          section.label,
        )),
      ),
      h(
        'div',
        { className: 'er-appbar-right' },
        h(
          'button',
          {
            type: 'button',
            className: 'er-round-button',
            title: t('library.shelfMenu'),
            onClick: () => { setMenuOpen((value) => !value); },
          },
          '⋯',
        ),
        menuOpen
          ? h(
            'div',
            { className: 'er-book-menu er-book-menu-top', onClick: (event) => { event.stopPropagation(); } },
            h('div', { className: 'er-book-menu-label' }, t('library.sortBy')),
            [
              ['recent', t('library.sortRecent')],
              ['added', t('library.sortAdded')],
              ['title', t('library.sortTitle')],
              ['progress', t('library.sortProgress')],
            ].map(([key, label]) => h(
              'button',
              {
                key,
                type: 'button',
                className: `er-book-menu-item${sort === key ? ' is-active' : ''}`,
                onClick: () => { setSort(key); setMenuOpen(false); },
              },
              label,
            )),
          )
          : null,
      ),
    ),
    h(
      'div',
      { className: 'er-body' },
      h(SectionBoundary, null,
        tab === 'library'
        ? h(LibraryView, {
          t,
          books: sorted,
          build,
          busy,
          error,
          view,
          onViewChange: changeView,
          onFiles,
          onOpen: openBook,
          onDelete,
          onRename,
          onListen: listenBook,
          onGenerateCover: (id) => {
            const book = books.find((entry) => entry.id === id);
            if (book === undefined) return Promise.resolve(false);
            return generateCover(book);
          },
        })
        : tab === 'reader'
          ? h(ReaderView, {
            t,
            book: activeBook,
            units,
            index,
            onIndexChange: setIndex,
            onOpenWordList: () => { setWordListOpen(true); },
            cardRequest,
            onActivity,
            onExit: closeBook,
            autoPlayToken,
          })
          : h(WordList, {
            t,
            variant: 'page',
            open: true,
            onClose: () => { setTab('library'); },
            onOpenEntry: (entry) => {
              setTab('reader');
              setCardRequest({ word: entry.word, sentence: entry.sentence ?? '' });
            },
            onReview: (entry) => {
              setTab('reader');
              setCardRequest({ word: entry.word, sentence: entry.sentence ?? '' });
            },
          })),
    ),
    sourceOpen
      ? h(OnlineLibrary, {
        t,
        onClose: () => { setSourceOpen(false); },
        onImported,
      })
      : null,
    h('input', {
      ref: fileRef,
      type: 'file',
      multiple: true,
      accept: '.epub,.txt,.md,.markdown,.html,.htm,.pdf',
      style: { display: 'none' },
      onChange: (event) => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = '';
        if (files.length > 0) void onFiles(files);
      },
    }),
    wordListOpen
      ? h(WordList, {
        t,
        variant: 'drawer',
        open: true,
        onClose: () => { setWordListOpen(false); },
      onOpenEntry: (entry) => {
        setWordListOpen(false);
        setTab('reader');
        setCardRequest({ word: entry.word, sentence: entry.sentence ?? '' });
      },
        onReview: (entry) => {
          setWordListOpen(false);
          setTab('reader');
          setCardRequest({ word: entry.word, sentence: entry.sentence ?? '' });
        },
      })
      : null,
  );
}
