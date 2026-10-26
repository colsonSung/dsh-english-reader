/**
 * The main panel page.
 *
 * The top bar carries the import button, the section switch and the shelf
 * menu; the body shows the shelf, the reader or the vocabulary list.
 */
import { Component, createElement as h, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseBook } from '../lib/parsers/index.js';
import { coverToDataUrl, generateCover as drawPlaceholderCover } from '../lib/cover.js';
import { buildUnits } from '../lib/engine/segment.js';
import { askAi } from '../lib/ai.js';
import { deleteBook, getBook, listBooks, newBookId, saveBook, updateProgress } from '../lib/store.js';
import { LibraryView } from './library.js';
import { ImportCard } from './import-card.js';
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
    // The translator comes in as a prop: this class has no `t` of its own, and
    // reaching for one would throw a second error that hides the first.
    const { t } = this.props;
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
 * How long the import card stays on screen at least.
 *
 * A fast TXT import finishes in a few dozen milliseconds; without a floor the
 * card would flash and vanish, which reads as a glitch rather than as progress.
 */
const MIN_IMPORT_VISIBLE_MS = 700;

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
  const [importProgress, setImportProgress] = useState(null);
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
  const importStartedAt = useRef(0);
  const importHideTimer = useRef(null);

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
  const generateAiCover = useCallback(async (book) => {
    try {
      const result = await askAi('cover', { title: book.title });
      if (typeof result?.url !== 'string' || result.url === '') return false;
      // The book may have been renamed or deleted while the cover was drawn,
      // so the stored copy is read again instead of the one we started with.
      const stored = await getBook(book.id);
      if (stored === undefined) return false;
      await saveBook({ ...stored, cover: result.url });
      await refresh();
      return true;
    } catch {
      return false;
    }
  }, [refresh]);

  // The import card is cleared at the end of an import, but not before it has
  // been on screen long enough to be read.
  const clearImportProgress = useCallback(() => {
    if (importHideTimer.current !== null) {
      window.clearTimeout(importHideTimer.current);
      importHideTimer.current = null;
    }
    const elapsed = Date.now() - importStartedAt.current;
    const wait = Math.max(0, MIN_IMPORT_VISIBLE_MS - elapsed);
    if (wait === 0) {
      setImportProgress(null);
      return;
    }
    importHideTimer.current = window.setTimeout(() => {
      importHideTimer.current = null;
      setImportProgress(null);
    }, wait);
  }, []);

  useEffect(() => () => {
    if (importHideTimer.current !== null) window.clearTimeout(importHideTimer.current);
  }, []);

  // The progress of one file. The stages are reported as they happen, and the
  // ratio inside a stage moves the bar. Reports that say the same thing twice
  // are dropped: a 300 page PDF would otherwise re-render the page 300 times.
  const makeReporter = useCallback((file, index, total) => {
    let lastKey = '';
    return (patch) => {
      const key = `${patch.stage}:${Math.round((patch.ratio ?? 0) * 100)}`;
      if (key === lastKey) return;
      lastKey = key;
      setImportProgress((previous) => {
        if (previous === null) return previous;
        return {
          ...previous,
          ...patch,
          name: file?.name ?? '',
          index,
          total,
          detail: patch.detail ?? null,
        };
      });
    };
  }, []);

  const importOne = useCallback(async (file, fallback, report) => {
    report({ stage: 'read', ratio: 0 });
    const parsed = await parseBook(file, (info) => {
      report({ stage: 'parse', ratio: info.ratio, detail: info });
    });
    // A book that carries its own picture keeps it; the others get a drawn
    // placeholder first and an AI cover afterwards.
    const hasRealCover = parsed.cover !== null && parsed.cover !== undefined;
    report({ stage: 'cover', ratio: 0 });
    let cover = null;
    try {
      cover = await coverToDataUrl(parsed.cover ?? null) ?? await drawPlaceholderCover(parsed.title, parsed.author);
    } catch {
      cover = null;
    }
    report({ stage: 'cover', ratio: 1 });
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
    report({ stage: 'save', ratio: 0 });
    await saveBook(book);
    report({ stage: 'save', ratio: 1 });
    return { book, hasRealCover };
  }, []);

  const onFiles = useCallback(async (files) => {
    const list = Array.from(files ?? []);
    if (list.length === 0) return;
    setError('');
    importStartedAt.current = Date.now();
    setImportProgress({ name: list[0]?.name ?? '', index: 0, total: list.length, stage: 'read', ratio: 0, detail: null });
    try {
      const imported = [];
      for (let index = 0; index < list.length; index += 1) {
        const file = list[index];
        const report = makeReporter(file, index, list.length);
        imported.push(await importOne(file, null, report));
      }
      await refresh();
      // 书里没有自带封面的，让模型画一张；书先入库，封面随后补上
      for (const entry of imported) {
        if (entry === null || entry.hasRealCover) continue;
        void generateAiCover(entry.book);
      }
    } catch (importError) {
      setError(importError?.message ?? t('library.importFailed'));
    } finally {
      clearImportProgress();
    }
  }, [clearImportProgress, generateAiCover, importOne, makeReporter, refresh, t]);

  // A book that came from the online source arrives with its catalogue entry.
  const onImported = useCallback(async (file, hit) => {
    setError('');
    importStartedAt.current = Date.now();
    setImportProgress({ name: file?.name ?? hit?.title ?? '', index: 0, total: 1, stage: 'read', ratio: 0, detail: null });
    try {
      const report = makeReporter(file, 0, 1);
      const entry = await importOne(file, hit, report);
      await refresh();
      setSourceOpen(false);
      if (entry !== null && !entry.hasRealCover) void generateAiCover(entry.book);
    } catch (importError) {
      setError(importError?.message ?? t('library.importFailed'));
    } finally {
      clearImportProgress();
    }
  }, [clearImportProgress, generateAiCover, importOne, makeReporter, refresh, t]);

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
      // The import card floats over the body, so the body gets room for it.
      className: importProgress === null ? 'er-page' : 'er-page is-importing',
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
      h(SectionBoundary, { t },
        tab === 'library'
        ? h(LibraryView, {
          t,
          books: sorted,
          build,
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
            return generateAiCover(book);
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
    // The import card: what is being imported, and how far it has come.
    h(ImportCard, { t, progress: importProgress }),
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
