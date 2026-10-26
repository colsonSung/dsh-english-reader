/**
 * The reading tab.
 *
 * The page always shows a whole paragraph, so the learner keeps the context of
 * the text instead of reading isolated sentences. Inside that paragraph one
 * unit is active: either a single sentence or the whole paragraph. That unit
 * is what the learner types, reads aloud, or listens to:
 *
 *  - listen: the unit is read aloud and the spoken word is highlighted;
 *  - type:   the learner types the unit in place, word by word, and the
 *            speech follows the typing;
 *  - speak:  the learner reads the unit aloud and the transcript is matched.
 *
 * The typing mode follows the interaction model of the "Type to Learn" app:
 * the paragraph itself is the typing surface, the current word is highlighted
 * in the text, wrong characters are painted red where they were typed, a
 * mono input box at the bottom shows the word being typed, and a compact bar
 * on top carries accuracy and speed.
 */
import { createElement as h, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createTts } from '../lib/engine/tts.js';
import { createSyncDriver } from '../lib/engine/sync.js';
import { createRecognizer, createRecorder, isRecognitionSupported } from '../lib/engine/asr.js';
import { diffTyping, diffWords, wordsPerMinute } from '../lib/engine/match.js';
import { addEntry, listEntries, removeEntry } from '../lib/vocab.js';
import { recordReading } from '../lib/activity.js';
import { askAi } from '../lib/ai.js';
import { blobToBase64, speakWord } from '../lib/speech.js';
import { addNote, listNotes, removeNote } from '../lib/notes.js';
import { listPodcasts, removePodcast, savePodcast } from '../lib/podcasts.js';
import { NotesPanel } from './notes.js';
import { MindMapView } from './mindmap.js';
import { PodcastView } from './podcast.js';
import {
  ClozeIcon, ExitIcon, GlobeIcon, HighlighterIcon, KeyboardIcon, ListIcon, MicIcon, MindMapIcon,
  NextIcon, NoteIcon, PauseIcon, PencilIcon, PlayIcon, PodcastIcon, PrevIcon, RepeatIcon,
  SettingsIcon, SoundIcon, TrashIcon, TranslateIcon,
} from './icons.js';
import { WordCard } from './wordcard.js';
import { Modal } from './library.js';

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
/** How many paragraphs one reading page holds. */
const PAGE_PARAGRAPHS = 6;
/** The fewest paragraphs a page may hold on a small window. */
const MIN_PAGE_PARAGRAPHS = 3;
/** The most paragraphs a page may hold, however tall the window is. */
const MAX_PAGE_PARAGRAPHS = 40;

/**
 * Put a floating panel at the end of the document body.
 *
 * The panels live in the body so that no ancestor of the reader can clip them
 * or paint over them: the sticky mode row and the tool rail both live inside
 * the reader, and a panel anchored to them has to escape their stacking
 * contexts.
 *
 * @param {any} element - the element tree, or null when there is nothing to show.
 * @returns {any} the portal, or the element itself when there is no document.
 */
function floating(element) {
  if (element === null || element === undefined) return null;
  if (typeof document === 'undefined') return element;
  return createPortal(element, document.body);
}

const TYPING_SETTINGS_KEY = 'english-reader:typing';

const DEFAULT_TYPING_SETTINGS = {
  fontStyle: 'mono',
  fontSize: 20,
  lineHeight: 0.5,
  columnWidth: 'normal',
  speedUnit: 'words',
  forgive: false,
  hideInput: false,
  replacements: [
    { from: '\u2014', to: '-' },
    { from: '\u2013', to: '-' },
    { from: '\u2026', to: '...' },
    { from: '\u201c', to: '"' },
    { from: '\u201d', to: '"' },
    { from: '\u2018', to: "'" },
    { from: '\u2019', to: "'" },
  ],
};

/** How wide the reading column may grow, in characters per line. */
const COLUMN_WIDTHS = {
  narrow: '62ch',
  normal: '74ch',
  wide: '92ch',
  // Fill the reading area. The lines get long, which is a trade the learner
  // makes on purpose.
  full: 'none',
};

const FONT_FAMILIES = {
  sans: 'var(--dsw-font, system-ui, -apple-system, "Segoe UI", sans-serif)',
  serif: 'Georgia, "Times New Roman", "Songti SC", serif',
  mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
};

/**
 * Drop the punctuation a learner is not expected to type.
 * @param {string} text
 * @returns {string}
 */
function stripTrailingPunctuation(text) {
  return text.replace(/[.,!?;:"“”'’)\]}]+$/u, '');
}

/**
 * Normalize a word for comparison.
 * @param {string} text
 * @returns {string}
 */
function comparableWord(text) {
  return text.replace(/[.,!?;:"“”'’()[\]{}-]+/gu, '').toLowerCase();
}

/**
 * Normalize text for an equality check.
 * @param {string} text
 * @returns {string}
 */
function comparable(text) {
  return text.trim().replace(/\s+/gu, ' ').toLowerCase();
}

/**
 * Apply the learner's symbol replacements to a word.
 * @param {string} text
 * @param {{ from: string, to: string }[]} replacements
 * @returns {string}
 */
function applyReplacements(text, replacements) {
  let result = text;
  for (const rule of replacements ?? []) {
    if (typeof rule?.from !== 'string' || rule.from.length === 0) continue;
    result = result.split(rule.from).join(typeof rule.to === 'string' ? rule.to : '');
  }
  return result;
}

/**
 * Serialize the replacement rules for the settings field.
 * @param {{ from: string, to: string }[]} replacements
 * @returns {string}
 */
function formatReplacements(replacements) {
  return (replacements ?? []).map((rule) => `${rule.from} => ${rule.to}`).join('\n');
}

/**
 * Parse the replacement rules from the settings field.
 * @param {string} text
 * @returns {{ from: string, to: string }[]}
 */
function parseReplacements(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const at = line.indexOf('=>');
      if (at < 0) return { from: line, to: '' };
      return { from: line.slice(0, at).trim(), to: line.slice(at + 2).trim() };
    })
    .filter((rule) => rule.from.length > 0);
}

/**
 * The words of one paragraph group, in reading order.
 * @param {{ unitIndexes: number[] }} group
 * @param {object[]} units
 * @returns {object[]}
 */
function wordsOfGroup(group, units) {
  const list = [];
  for (const unitIndex of group?.unitIndexes ?? []) {
    const unit = units[unitIndex];
    for (const word of unit?.words ?? []) {
      list.push({ ...word, sentencePosition: unit?.sentenceIndex ?? 0 });
    }
  }
  return list;
}

/**
 * Normalize a word into its vocabulary id.
 * @param {string} word
 * @returns {string}
 */
function normalizeWordId(word) {
  return word.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/**
 * Index vocabulary entries by their id.
 * @param {object[]} entries
 * @returns {Record<string, object>}
 */
function toVocabMap(entries) {
  const map = {};
  for (const entry of entries ?? []) map[entry.id] = entry;
  return map;
}

/**
 * Fill `{name}` placeholders in a locale string. The locale service has no
 * interpolation of its own, so the plugin does it here.
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
 * Read the typing preferences.
 * @returns {object}
 */
function loadTypingSettings() {
  try {
    const raw = globalThis.localStorage?.getItem(TYPING_SETTINGS_KEY);
    if (raw === undefined || raw === null) return { ...DEFAULT_TYPING_SETTINGS };
    return { ...DEFAULT_TYPING_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_TYPING_SETTINGS };
  }
}

/**
 * Store the typing preferences.
 * @param {object} settings
 */

/**
 * Turn an engine error into a sentence in the learner's language.
 *
 * The engine reports a machine readable code; the page owns the wording.
 *
 * @param {any} error - the error from the engine.
 * @param {string} fallback - the sentence to use when the code is unknown.
 * @returns {string} the message for the learner.
 */
function engineMessage(error, fallback) {
  const code = typeof error?.code === 'string' ? error.code : '';
  if (code === 'NO_RECOGNITION') return fallback;
  if (code === 'RECORD_FAILED' || code === 'RECOGNITION_START_FAILED') return fallback;
  if (typeof error?.message === 'string' && error.message.trim() !== '') {
    // A message the engine wrote in the learner's language is kept.
    return error.message;
  }
  return fallback;
}

function saveTypingSettings(settings) {
  try {
    globalThis.localStorage?.setItem(TYPING_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // A browser without localStorage simply keeps the defaults.
  }
}

/**
 * Group the sentence units into paragraphs. The engine keeps the original
 * paragraph index on every unit, so the grouping needs no extra parsing.
 * @param {object[]} units
 * @returns {{ key: string, chapterIndex: number, chapterTitle: string, unitIndexes: number[] }[]}
 */
function groupParagraphs(units) {
  const paragraphs = [];
  let current = null;
  units.forEach((unit, unitIndex) => {
    const key = `${unit.chapterIndex}:${unit.paragraphIndex}`;
    if (current === null || current.key !== key) {
      current = {
        key,
        chapterIndex: unit.chapterIndex,
        chapterTitle: unit.chapterTitle,
        unitIndexes: [],
      };
      paragraphs.push(current);
    }
    current.unitIndexes.push(unitIndex);
  });
  return paragraphs;
}

/**
 * Flatten a paragraph's sentences into one word list, with offsets in the
 * paragraph text.
 * @param {{ unit: object, unitIndex: number }[]} entries
 * @returns {{ words: object[], sentenceStart: number[], text: string }}
 */
function flattenParagraph(entries) {
  const words = [];
  const sentenceStart = [];
  let base = 0;
  entries.forEach((entry, sentencePosition) => {
    sentenceStart.push(words.length);
    (entry.unit.words ?? []).forEach((word) => {
      words.push({
        text: word.text,
        sentencePosition,
        start: base + word.start,
        end: base + word.end,
      });
    });
    base += entry.unit.text.length + 1;
  });
  return { words, sentenceStart, text: entries.map((entry) => entry.unit.text).join(' ') };
}

/**
 * The words the learner has to type, each carrying the display word it
 * belongs to.
 * @param {object[]} entries - paragraph entries with `displayOffset`
 * @returns {{ text: string, words: object[] }}
 */
function buildPractice(entries, replacements = []) {
  const words = [];
  let offset = 0;
  entries.forEach((entry) => {
    (entry.unit.words ?? []).forEach((word, wordIndex) => {
      const text = stripTrailingPunctuation(applyReplacements(word.text, replacements));
      if (text.length === 0) return;
      words.push({
        text,
        start: offset,
        end: offset + text.length,
        displayIndex: entry.displayOffset + wordIndex,
      });
      offset += text.length + 1;
    });
  });
  return { text: words.map((word) => word.text).join(' '), words };
}

/**
 * Align a spoken-text result onto the practice words, so the paragraph can
 * show which words were read, missed or misread.
 * @param {object[]} resultWords
 * @param {object[]} practiceWords
 * @returns {(string|null)[]} one state per practice word
 */
function alignSpokenWords(resultWords, practiceWords) {
  const states = new Array(practiceWords.length).fill(null);
  let cursor = 0;
  for (const entry of resultWords ?? []) {
    if (entry.status === 'extra') continue;
    const clean = comparableWord(entry.word ?? '');
    let found = -1;
    for (let i = cursor; i < practiceWords.length; i += 1) {
      if (comparableWord(practiceWords[i].text) === clean) {
        found = i;
        break;
      }
    }
    if (found < 0) continue;
    states[found] = entry.status === 'ok' ? 'ok' : 'bad';
    cursor = found + 1;
  }
  return states;
}

/**
 * The reading tab.
 * @param {object} props
 * @param {Function} props.t - translator
 * @param {object} props.book - the open book
 * @param {object[]} props.units - every sentence of the book
 * @param {number} props.index - the current sentence index
 * @param {Function} props.onIndexChange
 * @param {Function} [props.onOpenWordList] - open the vocabulary drawer
 * @param {Function} [props.onActivity] - report the reading activity of this session
 * @param {{ word: string, sentence: string }|null} [props.cardRequest] - open the word card for this word
 * @returns {any} the element tree
 */
export function ReaderView({
  t, book, units, index, onIndexChange, onOpenWordList, cardRequest, onActivity, onExit, autoPlayToken,
}) {
  const unit = units[index];
  const [scope, setScope] = useState('sentence');
  const [mode, setMode] = useState('listen');
  const [speaking, setSpeaking] = useState(false);
  const [interim, setInterim] = useState('');
  const [transcript, setTranscript] = useState('');
  const [spokenResult, setSpokenResult] = useState(null);
  const [audioUrl, setAudioUrl] = useState('');
  const [ttsNote, setTtsNote] = useState('');
  const [card, setCard] = useState(null);
  const activeRef = useRef(null);
  const [vocabEntries, setVocabEntries] = useState({});

  // Typing state, in the "Type to Learn" model: one word at a time.
  const [wordIndex, setWordIndex] = useState(0);
  const [wordInput, setWordInput] = useState('');
  const [wordResults, setWordResults] = useState([]);
  const [startedAt, setStartedAt] = useState(0);
  const [muted, setMuted] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Reading-surface switches, the "Learning Modes" panel of the reference app.
  const [modes, setModes] = useState({
    highlight: true,   // colour the saved words by their state
    gloss: false,      // show the definition under a saved word
    translate: false,  // show a Chinese translation under every paragraph
    blur: false,       // blur the text until the sentence is tapped
    bionic: false,     // bold the beginning of every word
    limitLookups: false, // ration the word card so the context does the work
  });
  const [modePanelOpen, setModePanelOpen] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const [translations, setTranslations] = useState({});
  const [revealed, setRevealed] = useState({});
  const [lookupsUsed, setLookupsUsed] = useState(0);
  const LOOKUP_BUDGET = 5;
  const [settings, setSettings] = useState(loadTypingSettings);
  const [replacementText, setReplacementText] = useState(() => formatReplacements(loadTypingSettings().replacements));

  const cloudVoicesRef = useRef([]);
  const ttsRef = useRef(null);
  if (ttsRef.current === null) {
    ttsRef.current = createTts({
      // 云端音色走宿主的 MiniMax 语音合成；失败时引擎自动回落到本机合成
      remote: {
        speak: (text, options) => askAi('tts', {
          text,
          voiceId: options?.voiceId,
          rate: options?.rate,
        }),
      },
      getCloudVoices: () => cloudVoicesRef.current,
    });
  }
  const tts = ttsRef.current;

  const syncRef = useRef(null);
  if (syncRef.current === null) syncRef.current = createSyncDriver({ tts });
  const sync = syncRef.current;

  const [voices, setVoices] = useState(() => tts.listVoices());
  const [voiceId, setVoiceId] = useState('');
  const [rate, setRate] = useState(1);
  const [spokenWord, setSpokenWord] = useState(-1);
  const [playing, setPlaying] = useState(false);
  // The reader's notes: they live in the local database.
  const [notesOpen, setNotesOpen] = useState(false);
  // How many paragraphs the page holds: it fills the window instead of
  // leaving a large empty area below the text.
  const [pageSize, setPageSize] = useState(PAGE_PARAGRAPHS);
  // Bumped when the window changes size, so the page is measured again.
  const [measureToken, setMeasureToken] = useState(0);
  const readBodyRef = useRef(null);
  const readingRef = useRef(null);
  const [noteCount, setNoteCount] = useState(0);
  // Bumped whenever a note is written, so the badge follows at once.
  const [notesVersion, setNotesVersion] = useState(0);
  // Every note of the book: the paragraphs show which ones already have one.
  const [bookNotes, setBookNotes] = useState([]);
  // The note editor, when it is open: which paragraph it belongs to and where
  // it was opened.
  const [noteEditor, setNoteEditor] = useState(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteError, setNoteError] = useState('');
  // The paragraph being read on its own, and the one being translated.
  const [speakingParagraph, setSpeakingParagraph] = useState(-1);
  const [translatingParagraph, setTranslatingParagraph] = useState(-1);
  // Where the learning-modes panel is anchored.
  const [modesAnchor, setModesAnchor] = useState(null);
  const modesButtonRef = useRef(null);
  const modesRowRef = useRef(null);
  const modesPanelRef = useRef(null);
  const noteEditorRef = useRef(null);
  // The mind map of the chapter being read.
  const [mindMapOpen, setMindMapOpen] = useState(false);
  const [mindMapData, setMindMapData] = useState(null);
  const [mindMapChapter, setMindMapChapter] = useState('');
  const [mindMapLoading, setMindMapLoading] = useState(false);
  const [mindMapError, setMindMapError] = useState('');
  // The audio podcast of the chapter being read.
  const [podcastOpen, setPodcastOpen] = useState(false);
  const [podcastEpisodes, setPodcastEpisodes] = useState([]);
  const [podcastActiveId, setPodcastActiveId] = useState(null);
  const [podcastLine, setPodcastLine] = useState(-1);
  const [podcastPlaying, setPodcastPlaying] = useState(false);
  const [podcastLoading, setPodcastLoading] = useState(false);
  const [podcastError, setPodcastError] = useState('');
  // What an episode covers: a chapter, or the whole book.
  const [podcastScope, setPodcastScope] = useState('');
  // The two voices of the show: the host keeps the voice the learner already
  // listens to, the guest gets a different one so the two are tellable apart.
  const [podcastVoices, setPodcastVoices] = useState({ host: '', guest: '' });
  // The learner talking back while the episode plays.
  const [interjecting, setInterjecting] = useState(false);
  const [interjectError, setInterjectError] = useState('');
  const interjectRecorderRef = useRef(null);
  const podcastBookRef = useRef(book?.id ?? '');
  const [repeat, setRepeat] = useState(false);

  const recognizerRef = useRef(null);
  const recorderRef = useRef(null);
  const transcriptRef = useRef('');
  const wordInputRef = useRef(null);

  // 云端音色：宿主报告 MiniMax 可用时拉一次音色表，并默认选一个
  const [cloudReady, setCloudReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const status = await askAi('status');
        if (cancelled || status?.minimax !== true) return;
        const list = await askAi('voices');
        if (cancelled || !Array.isArray(list) || list.length === 0) return;
        cloudVoicesRef.current = list;
        setCloudReady(true);
        setVoices(tts.listVoices());
        const first = `mm:${list[0].id}`;
        tts.setVoice(first);
        setVoiceId(first);
      } catch {
        // 没有配置 MiniMax：继续用本机语音
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [tts]);

  // How many notes does this book have, and which paragraphs already carry
  // one? The list is the source of truth for both.
  useEffect(() => {
    let cancelled = false;
    if (book === null || book === undefined) {
      setNoteCount(0);
      setBookNotes([]);
      return undefined;
    }
    void listNotes(book.id)
      .then((list) => {
        if (cancelled) return;
        setBookNotes(list);
        setNoteCount(list.length);
      })
      .catch(() => {
        if (cancelled) return;
        setNoteCount(0);
        setBookNotes([]);
      });
    return () => { cancelled = true; };
  }, [book?.id, notesOpen, notesVersion]);

  // The floating panels close on Escape and on a click outside them. The tool
  // rail keeps them open by itself: it opens and closes them on its own.
  useEffect(() => {
    if (!modePanelOpen && noteEditor === null) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      setModePanelOpen(false);
      setNoteEditor(null);
    };
    const onPointerDown = (event) => {
      const target = event.target;
      if (modesPanelRef.current?.contains?.(target) === true) return;
      if (noteEditorRef.current?.contains?.(target) === true) return;
      if (typeof target?.closest === 'function' && target.closest('.er-read-tool') !== null) return;
      setModePanelOpen(false);
      setNoteEditor(null);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [modePanelOpen, noteEditor]);

  // Is the transcription channel ready?
  useEffect(() => {
    let cancelled = false;
    askAi('status')
      .then((status) => { if (!cancelled) setAsrAvailable(status?.minimax === true); })
      .catch(() => { if (!cancelled) setAsrAvailable(false); });
    return () => { cancelled = true; };
  }, []);

  // The voice list arrives asynchronously in most browsers.
  useEffect(() => {
    const refresh = () => { setVoices(tts.listVoices()); };
    refresh();
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (synth === undefined) return undefined;
    synth.addEventListener?.('voiceschanged', refresh);
    return () => { synth.removeEventListener?.('voiceschanged', refresh); };
  }, [tts]);

  // Leaving the reader stops every sound it started.
  useEffect(() => () => {
    tts.cancel();
    sync.stop();
    recognizerRef.current?.abort?.();
  }, [tts, sync]);

  // Reading activity: minutes read and words read, flushed to the shelf.
  const activityRef = useRef({ ms: 0, wordsUpTo: 0 });
  // The time the learner spends listening is tracked separately: the shelf
  // shows it as PLAYED next to the reading time.
  const playedRef = useRef({ ms: 0, since: 0 });

  const wordsUpTo = useMemo(() => {
    let count = 0;
    for (let i = 0; i <= index && i < units.length; i += 1) count += units[i].words?.length ?? 0;
    return count;
  }, [units, index]);

  // The words before the position the book was opened at were not read in
  // this session, so they must not count towards the reading speed.
  const baselineBookRef = useRef(null);
  useEffect(() => {
    const id = book?.id ?? null;
    if (id === baselineBookRef.current) return;
    baselineBookRef.current = id;
    activityRef.current.wordsUpTo = wordsUpTo;
  }, [book?.id, wordsUpTo]);

  const flushActivity = useCallback(() => {
    if (book === null || book === undefined) return;
    const delta = activityRef.current;
    const words = Math.max(0, wordsUpTo - delta.wordsUpTo);
    const played = playedRef.current;
    const playedMs = played.ms + (played.since === 0 ? 0 : Date.now() - played.since);
    if (delta.ms === 0 && words === 0 && playedMs === 0) return;
    activityRef.current = { ms: 0, wordsUpTo };
    playedRef.current = { ms: playedMs, since: 0 };
    onActivity?.(recordReading(book?.progress?.activity, { ms: delta.ms, words }), playedMs);
  }, [book, wordsUpTo, onActivity]);

  useEffect(() => {
    if (book === null || book === undefined) return undefined;
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      activityRef.current.ms += 1000;
    }, 1000);
    // The activity is written back while reading, not only when leaving.
    const flusher = setInterval(() => { flushActivity(); }, 15000);
    return () => {
      clearInterval(timer);
      clearInterval(flusher);
      flushActivity();
    };
  }, [book, flushActivity]);

  // Moving to another sentence counts the words just read.
  useEffect(() => { flushActivity(); }, [index, flushActivity]);

  // The vocabulary list can ask the reader to open a word card.
  useEffect(() => {
    if (cardRequest === null || cardRequest === undefined) return;
    setCard({ word: cardRequest.word, sentence: cardRequest.sentence ?? '', x: 220, y: 120 });
  }, [cardRequest]);

  // The vocabulary list is shared across books, so it is read once.
  useEffect(() => {
    let cancelled = false;
    listEntries()
      .then((entries) => { if (!cancelled) setVocabEntries(toVocabMap(entries)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const paragraphs = useMemo(() => groupParagraphs(units), [units]);
  const paragraphIndexByUnit = useMemo(() => {
    const map = new Map();
    paragraphs.forEach((paragraph, paragraphIndex) => {
      paragraph.unitIndexes.forEach((unitIndex) => { map.set(unitIndex, paragraphIndex); });
    });
    return map;
  }, [paragraphs]);
  const currentParagraphIndex = paragraphIndexByUnit.get(index) ?? 0;
  const currentParagraph = paragraphs[currentParagraphIndex];
  const currentParagraphFirstUnit = currentParagraph?.unitIndexes?.[0] ?? -1;

  // Keep the active paragraph in view when the reader moves on.
  useEffect(() => {
    // jsdom and some embedded views have no scrollIntoView.
    if (typeof activeRef.current?.scrollIntoView === 'function') {
      activeRef.current.scrollIntoView({ block: 'nearest' });
    }
  }, [currentParagraphIndex]);

  // The whole paragraph, flattened into one word list plus per-sentence
  // offsets so the active sentence can be located inside it.
  const paragraph = useMemo(() => {
    if (currentParagraph === undefined) return { words: [], sentenceStart: [], text: '', entries: [] };
    const base = currentParagraph.unitIndexes.map((unitIndex) => ({ unit: units[unitIndex], unitIndex }));
    const flat = flattenParagraph(base);
    const entries = base.map((entry, sentencePosition) => ({
      ...entry,
      sentencePosition,
      displayOffset: flat.sentenceStart[sentencePosition],
    }));
    return { ...flat, entries };
  }, [currentParagraph, units]);

  const practiceKey = scope === 'paragraph'
    ? `p${currentParagraphIndex}`
    : scope === 'cloze'
      ? `c${currentParagraphIndex}`
      : `u${unit?.id ?? 'none'}`;

  // The cloze mode blanks out the words the learner saved; those are the words
  // to be recalled from memory.
  const clozeWords = useMemo(() => {
    const list = [];
    paragraph.words.forEach((word, position) => {
      if (vocabEntries[normalizeWordId(word.text)] === undefined) return;
      list.push({ text: stripTrailingPunctuation(word.text), displayIndex: position });
    });
    return list;
  }, [paragraph.words, vocabEntries]);

  const clozeIndexes = useMemo(
    () => new Set(scope === 'cloze' ? clozeWords.map((word) => word.displayIndex) : []),
    [scope, clozeWords],
  );

  const practice = useMemo(() => {
    if (scope === 'cloze') {
      const words = [];
      let offset = 0;
      for (const item of clozeWords) {
        words.push({ text: item.text, start: offset, end: offset + item.text.length, displayIndex: item.displayIndex });
        offset += item.text.length + 1;
      }
      return { text: words.map((word) => word.text).join(' '), words };
    }
    const source = scope === 'paragraph'
      ? paragraph.entries
      : paragraph.entries.filter((entry) => entry.unitIndex === index);
    return buildPractice(source, settings.replacements);
    // `index` only matters in sentence scope, where `practiceKey` changes with
    // the sentence anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, practiceKey, paragraph, settings.replacements, clozeWords]);

  // The reading surface shows a page of text, not a single paragraph: the
  // paragraph before the active one gives the context, the ones after it carry
  // the story forward.
  const pageRange = useMemo(() => {
    const total = paragraphs.length;
    const start = Math.max(0, Math.min(currentParagraphIndex - 1, Math.max(0, total - pageSize)));
    const end = Math.min(total, start + pageSize);
    return { start, end, groups: paragraphs.slice(start, end) };
  }, [paragraphs, currentParagraphIndex, pageSize]);

  // Fill the window: add paragraphs while there is room, drop back when the
  // text no longer fits.
  //
  // The size must settle: growing and shrinking again and again makes the
  // text jump under the reader's eyes. So the largest size that fitted is
  // remembered, and once a size does not fit the search stops.
  const bestSizeRef = useRef(PAGE_PARAGRAPHS);
  const overflowRef = useRef(false);
  const layoutKeyRef = useRef('');
  useEffect(() => {
    const body = readBodyRef.current;
    const reading = readingRef.current;
    if (body === null || reading === null) return;
    const key = `${settings.fontSize}|${settings.lineHeight}|${scope}|${mode}|${measureToken}`;
    if (layoutKeyRef.current !== key) {
      layoutKeyRef.current = key;
      bestSizeRef.current = PAGE_PARAGRAPHS;
      overflowRef.current = false;
    }
    const available = body.clientHeight;
    const used = reading.scrollHeight;
    if (available < 120) return;
    if (used > available) {
      // This size does not fit: go back to the last one that did.
      if (pageSize > bestSizeRef.current) {
        setPageSize(bestSizeRef.current);
      }
      overflowRef.current = true;
      return;
    }
    if (overflowRef.current) return;
    if (used + 60 < available && pageSize < MAX_PAGE_PARAGRAPHS) {
      bestSizeRef.current = pageSize;
      setPageSize((value) => Math.min(MAX_PAGE_PARAGRAPHS, value + 1));
      return;
    }
    // It fits: the page is full, stop adjusting.
    bestSizeRef.current = pageSize;
    overflowRef.current = true;
  }, [pageSize, pageRange.end, measureToken, settings.fontSize, settings.lineHeight, scope, mode]);

  // A window that changes size asks for a new measurement. It must not reset
  // the page size: that update would cancel the one that fills the window.
  useEffect(() => {
    const body = readBodyRef.current;
    if (body === null || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => { setMeasureToken((value) => value + 1); });
    observer.observe(body, { box: 'border-box' });
    return () => { observer.disconnect(); };
  }, []);

  // The Chinese translation of every paragraph on the page, fetched on demand.
  const translationsRef = useRef({});
  useEffect(() => {
    if (!modes.translate) return undefined;
    let cancelled = false;
    // Every paragraph of the page is translated in parallel, so the page
    // costs one model latency instead of one per paragraph.
    const load = async () => {
      const pending = [];
      for (const group of pageRange.groups) {
        const index = paragraphs.indexOf(group);
        if (index < 0) continue;
        if (translationsRef.current[index] !== undefined) continue;
        const text = group.unitIndexes.map((unitIndex) => units[unitIndex]?.text ?? '').join(' ');
        if (text.trim().length === 0) continue;
        pending.push({ index, text });
      }
      if (pending.length === 0) return;
      const results = await Promise.all(pending.map(async (item) => {
        try {
          const result = await askAi('translate', { text: item.text });
          return [item.index, result?.text ?? ''];
        } catch {
          return [item.index, ''];
        }
      }));
      if (cancelled) return;
      const next = { ...translationsRef.current };
      for (const [index, value] of results) next[index] = value;
      translationsRef.current = next;
      setTranslations(next);
    };
    void load();
    return () => { cancelled = true; };
  }, [modes.translate, pageRange, units, paragraphs]);

  // Translate one paragraph on its own. The translation lands under it, in the
  // same place the full-text switch puts it.
  const translateParagraph = useCallback(async (group, paragraphIndex) => {
    if (translatingParagraph === paragraphIndex) return;
    setTranslatingParagraph(paragraphIndex);
    try {
      const text = group.unitIndexes.map((unitIndex) => units[unitIndex]?.text ?? '').join(' ');
      if (text.trim() === '') return;
      const result = await askAi('translate', { text });
      const value = result?.text ?? '';
      // A failed translation leaves the paragraph alone rather than showing
      // an empty line.
      if (value === '') return;
      const next = { ...translationsRef.current, [paragraphIndex]: value };
      translationsRef.current = next;
      setTranslations(next);
    } catch {
      // The model is unreachable: the paragraph stays as it was.
    } finally {
      setTranslatingParagraph(-1);
    }
  }, [translatingParagraph, units]);

  // Read one paragraph aloud, on its own. A second click stops it.
  const speakParagraph = useCallback((group, paragraphIndex) => {
    if (speakingParagraph === paragraphIndex) {
      tts.cancel();
      setSpeakingParagraph(-1);
      return;
    }
    const text = group.unitIndexes.map((unitIndex) => units[unitIndex]?.text ?? '').join(' ');
    if (text.trim() === '') return;
    tts.cancel();
    setSpeakingParagraph(paragraphIndex);
    tts.speak(text, {
      onEnd: () => { setSpeakingParagraph(-1); },
      onError: () => { setSpeakingParagraph(-1); },
    });
  }, [speakingParagraph, tts, units]);

  const practiceIndexByDisplay = useMemo(() => {
    const map = new Map();
    practice.words.forEach((word, position) => { map.set(word.displayIndex, position); });
    return map;
  }, [practice.words]);

  const activeEntry = paragraph.entries.find((entry) => entry.unitIndex === index);
  const sentencePosition = activeEntry === undefined ? 0 : activeEntry.sentencePosition;
  const sentenceTotal = paragraph.entries.length;

  // A new unit resets the practice state.
  useEffect(() => {
    setWordIndex(0);
    setWordInput('');
    setWordResults([]);
    setStartedAt(0);
    setSpokenWord(-1);
    setTranscript('');
    setInterim('');
    setSpokenResult(null);
    setAudioUrl('');
  }, [practiceKey]);

  useEffect(() => {
    tts.cancel();
    sync.setWords(practice.words.map((word) => word.text));
  }, [practiceKey, practice, tts, sync]);

  // The typing surface keeps the focus while the learner types.
  useEffect(() => {
    if (mode !== 'type') return undefined;
    const field = wordInputRef.current;
    if (field === null) return undefined;
    field.focus({ preventScroll: true });
    return undefined;
  }, [mode, practiceKey]);

  const chapters = useMemo(() => {
    const map = new Map();
    units.forEach((entry, entryIndex) => {
      if (!map.has(entry.chapterIndex)) {
        map.set(entry.chapterIndex, { index: entry.chapterIndex, title: entry.chapterTitle, unitIndex: entryIndex });
      }
    });
    return [...map.values()];
  }, [units]);

  // The chapter the learner is in: both the mind map and the podcast are built
  // from it, so they follow the reading position.
  const chapterIndex = unit?.chapterIndex ?? 0;
  const chapterTitle = chapters.find((entry) => entry.index === chapterIndex)?.title ?? '';
  const chapterKey = String(chapterIndex);
  // The chapter's text. It is cut long before the model sees it: an outline
  // needs the argument, not every sentence.
  const chapterText = useMemo(() => {
    const parts = [];
    for (const entry of units) {
      if (entry.chapterIndex !== chapterIndex) continue;
      parts.push(entry.text ?? '');
    }
    return parts.join(' ').slice(0, 12000);
  }, [chapterIndex, units]);

  // Ask the model for the mind map of this chapter.
  const generateMindMap = useCallback(async () => {
    setMindMapLoading(true);
    setMindMapError('');
    try {
      const result = await askAi('mindmap', {
        title: book?.title ?? '',
        chapterTitle,
        text: chapterText,
      });
      setMindMapData(result);
      setMindMapChapter(chapterKey);
    } catch (error) {
      setMindMapError(error?.message ?? t('mindmap.failed'));
    } finally {
      setMindMapLoading(false);
    }
  }, [book?.title, chapterKey, chapterText, chapterTitle, t]);

  // Open the mind map. A map of another chapter is not shown here: the panel
  // always talks about the chapter being read.
  const openMindMap = useCallback(() => {
    setMindMapOpen(true);
    if (mindMapChapter !== chapterKey || mindMapData === null) void generateMindMap();
  }, [chapterKey, generateMindMap, mindMapChapter, mindMapData]);

  // Where a node of the mind map comes from. The model quotes the chapter, so
  // the quote is looked up in the text and the node is given the unit it comes
  // from: the learner can jump straight back to that passage.
  const locateQuote = useCallback((quote) => {
    const needle = String(quote ?? '').trim().toLowerCase();
    if (needle === '') return -1;
    for (let unitIndex = 0; unitIndex < units.length; unitIndex += 1) {
      const body = String(units[unitIndex]?.text ?? '').toLowerCase();
      if (!body.includes(needle)) continue;
      const paragraphIndex = paragraphIndexByUnit.get(unitIndex);
      const group = paragraphs[paragraphIndex];
      return group?.unitIndexes?.[0] ?? unitIndex;
    }
    return -1;
  }, [paragraphIndexByUnit, paragraphs, units]);

  // The mind map with every node annotated with where it comes from.
  const mindMapView = useMemo(() => {
    if (mindMapData === null) return null;
    const branches = (Array.isArray(mindMapData.branches) ? mindMapData.branches : []).map((branch) => ({
      ...branch,
      target: locateQuote(branch?.quote),
      items: (Array.isArray(branch?.items) ? branch.items : []).map((item) => ({
        ...item,
        target: locateQuote(item?.quote),
      })),
    }));
    return { title: mindMapData.title ?? '', branches };
  }, [locateQuote, mindMapData]);

  // Jump from a node of the mind map to the passage it came from.
  const jumpFromMindMap = useCallback((node) => {
    const target = node?.target;
    if (typeof target !== 'number' || target < 0) return;
    setMindMapOpen(false);
    onIndexChange(target);
  }, [onIndexChange]);

  // The episodes of this book, newest first.
  const refreshPodcasts = useCallback(async () => {
    if (book === null || book === undefined) {
      setPodcastEpisodes([]);
      return;
    }
    try {
      const list = await listPodcasts(book.id);
      setPodcastEpisodes(list);
    } catch {
      setPodcastEpisodes([]);
    }
  }, [book?.id]);

  // What an episode can cover: every chapter of the book, plus the whole book.
  const podcastScopes = useMemo(() => {
    const list = chapters.map((chapter) => ({
      key: String(chapter.index),
      label: `${format(t('podcast.scopeChapter'), { n: chapter.index + 1 })} · ${chapter.title}`,
    }));
    list.push({ key: 'book', label: t('podcast.scopeBook') });
    return list;
  }, [chapters, t]);

  // Can this window record at all? A browser only exposes the microphone in a
  // secure context (https or localhost). The desktop app serves its window
  // from a custom scheme, so there the learner types instead of talking.
  const canRecord = useMemo(() => {
    const g = typeof globalThis === 'undefined' ? {} : globalThis;
    return typeof g.MediaRecorder === 'function'
      && typeof g.navigator?.mediaDevices?.getUserMedia === 'function';
  }, []);

  // The English voices the show can use.
  const englishVoices = useMemo(
    () => voices.filter((voice) => String(voice.lang ?? '').toLowerCase().startsWith('en')),
    [voices],
  );

  // Give the show its two voices as soon as the voice list is there: the host
  // keeps the reading voice, the guest gets the first one that is not it.
  useEffect(() => {
    if (englishVoices.length === 0) return;
    setPodcastVoices((current) => {
      const host = englishVoices.some((voice) => voice.id === current.host)
        ? current.host
        : (englishVoices.some((voice) => voice.id === voiceId) ? voiceId : englishVoices[0].id);
      const guest = englishVoices.some((voice) => voice.id === current.guest) && current.guest !== host
        ? current.guest
        : (englishVoices.find((voice) => voice.id !== host)?.id ?? host);
      if (host === current.host && guest === current.guest) return current;
      return { host, guest };
    });
  }, [englishVoices, voiceId]);

  // The whole book cannot be read in one go, so the model gets the structure
  // and the opening of every chapter: enough to write an episode about the
  // book's line of argument.
  const bookDigest = useMemo(() => {
    const parts = [];
    for (const chapter of chapters) {
      const body = units
        .filter((unit) => unit.chapterIndex === chapter.index)
        .map((unit) => unit.text ?? '')
        .join(' ');
      if (body.trim() === '') continue;
      parts.push(`[${chapter.title}] ${body.slice(0, 900)}`);
    }
    return parts.join('\n').slice(0, 12000);
  }, [chapters, units]);

  // The text an episode is written from.
  const textOfScope = useCallback((scopeKey) => {
    if (scopeKey === 'book') return bookDigest;
    const index = Number(scopeKey);
    if (!Number.isFinite(index)) return '';
    return units
      .filter((unit) => unit.chapterIndex === index)
      .map((unit) => unit.text ?? '')
      .join(' ');
  }, [bookDigest, units]);

  // A new book starts at the chapter being read; the learner's own choice
  // sticks while the reading position moves.
  useEffect(() => {
    const bookId = book?.id ?? '';
    if (podcastBookRef.current === bookId) return;
    podcastBookRef.current = bookId;
    setPodcastScope(String(chapterIndex));
  }, [book?.id, chapterIndex]);

  // Ask the model for a podcast episode of the chosen scope and keep it.
  const generatePodcast = useCallback(async () => {
    const scopeKey = podcastScope === '' ? String(chapterIndex) : podcastScope;
    const scopeLabel = podcastScopes.find((entry) => entry.key === scopeKey)?.label ?? chapterTitle;
    const wholeBook = scopeKey === 'book';
    setPodcastLoading(true);
    setPodcastError('');
    try {
      const result = await askAi('podcast', {
        title: book?.title ?? '',
        chapterTitle: wholeBook ? t('podcast.scopeBook') : chapterTitle,
        scope: wholeBook ? 'book' : 'chapter',
        text: textOfScope(scopeKey),
      });
      const episode = await savePodcast({
        bookId: book?.id ?? '',
        chapterKey: scopeKey,
        scope: scopeLabel,
        title: result?.title ?? '',
        summary: result?.summary ?? '',
        dialogue: result?.dialogue ?? [],
      });
      setPodcastEpisodes((current) => [episode, ...current.filter((entry) => entry.id !== episode.id)]);
      setPodcastActiveId(episode.id);
      setPodcastLine(-1);
    } catch (error) {
      setPodcastError(error?.message ?? t('podcast.failed'));
    } finally {
      setPodcastLoading(false);
    }
  }, [book?.id, chapterIndex, chapterTitle, podcastScope, podcastScopes, t, textOfScope]);

  // Open the podcast panel and load the episodes of this book.
  const openPodcast = useCallback(() => {
    setPodcastOpen(true);
    void refreshPodcasts();
  }, [refreshPodcasts]);

  // The playback walks the script line by line. The position lives in a ref,
  // so the speech callback never reads a stale render.
  const podcastStateRef = useRef({ episodeId: null, lineIndex: -1 });
  const podcastEpisodesRef = useRef([]);
  useEffect(() => { podcastEpisodesRef.current = podcastEpisodes; }, [podcastEpisodes]);

  const speakPodcastLine = useCallback((episodeId, lineIndex) => {
    const episode = podcastEpisodesRef.current.find((entry) => entry.id === episodeId);
    if (episode === undefined) return;
    // The learner's own line stays in the transcript but is not spoken: they
    // just said it (or typed it), the show answers.
    let index = lineIndex;
    let line = episode.dialogue?.[index];
    while (line !== undefined && line.speaker === 'you') {
      index += 1;
      line = episode.dialogue[index];
    }
    if (line === undefined || typeof line.text !== 'string' || line.text.trim() === '') {
      podcastStateRef.current = { episodeId, lineIndex: -1 };
      setPodcastLine(-1);
      setPodcastPlaying(false);
      tts.cancel();
      // The reading voice comes back when the show is over.
      tts.setVoice(voiceId);
      return;
    }
    podcastStateRef.current = { episodeId, lineIndex: index };
    setPodcastActiveId(episodeId);
    setPodcastLine(index);
    setPodcastPlaying(true);
    // Each speaker has its own voice: the show sounds like two people.
    tts.setVoice(line.speaker === 'guest' ? podcastVoices.guest : podcastVoices.host);
    tts.speak(line.text, {
      onEnd: () => {
        const state = podcastStateRef.current;
        if (state.episodeId !== episodeId) return;
        speakPodcastLine(episodeId, state.lineIndex + 1);
      },
    });
  }, [podcastVoices, tts, voiceId]);

  // Stop the podcast when the panel closes: the speech must not keep running
  // behind a closed panel.
  const stopPodcast = useCallback(() => {
    podcastStateRef.current = { episodeId: null, lineIndex: -1 };
    setPodcastLine(-1);
    setPodcastPlaying(false);
    tts.cancel();
    // The reading voice comes back.
    tts.setVoice(voiceId);
  }, [tts, voiceId]);

  // The host answers the learner, and the episode goes on from there. The
  // learner's own words and the answer stay in the episode, so the transcript
  // reads like a conversation that really happened.
  const continuePodcast = useCallback(async (episode, said) => {
    setPodcastLoading(true);
    try {
      const context = episode.dialogue
        .slice(-6)
        .map((line) => `${line.speaker}: ${line.text}`)
        .join('\n');
      const result = await askAi('podcastReply', {
        title: book?.title ?? '',
        chapterTitle: episode.scope ?? '',
        text: context,
        said,
      });
      const lines = [{ speaker: 'you', text: said }, ...(result?.lines ?? [])];
      const updated = await savePodcast({ ...episode, dialogue: [...episode.dialogue, ...lines] });
      // The ref goes first: the playback reads the episode from it, and the
      // new lines have to be in place before the next line is spoken.
      const next = podcastEpisodesRef.current.map((entry) => (entry.id === updated.id ? updated : entry));
      podcastEpisodesRef.current = next;
      setPodcastEpisodes(next);
      // The episode continues with the host's answer.
      speakPodcastLine(updated.id, episode.dialogue.length + 1);
    } catch (error) {
      setInterjectError(error?.message ?? t('podcast.interjectFailed'));
    } finally {
      setPodcastLoading(false);
    }
  }, [book?.title, speakPodcastLine, t]);

  // The learner types instead of talking: the same flow, without a microphone.
  const interjectText = useCallback(async (text) => {
    const said = String(text ?? '').trim();
    if (said === '') return;
    const episode = podcastEpisodesRef.current.find((entry) => entry.id === podcastActiveId);
    if (episode === undefined) return;
    setInterjectError('');
    // The episode waits for the learner.
    tts.cancel();
    setPodcastPlaying(false);
    await continuePodcast(episode, said);
  }, [continuePodcast, podcastActiveId, tts]);

  // The learner talks back mid-episode: the podcast waits, the words are
  // transcribed, and the host answers before the episode goes on.
  const interject = useCallback(async () => {
    if (interjecting) {
      interjectRecorderRef.current?.stop?.();
      return;
    }
    const episode = podcastEpisodesRef.current.find((entry) => entry.id === podcastActiveId);
    if (episode === undefined) return;
    setInterjectError('');
    // The episode waits for the learner.
    tts.cancel();
    setPodcastPlaying(false);
    const recorder = createRecorder({
      onStop: async (blob) => {
        setInterjecting(false);
        interjectRecorderRef.current = null;
        try {
          const audio = await blobToBase64(blob);
          const result = await askAi('asr', { audio, mimeType: blob.type || 'audio/webm' });
          const said = String(result?.text ?? '').trim();
          if (said === '') {
            setInterjectError(t('podcast.interjectEmpty'));
            return;
          }
          await continuePodcast(episode, said);
        } catch (error) {
          setInterjectError(error?.message ?? t('podcast.interjectFailed'));
        }
      },
      onError: (error) => {
        setInterjecting(false);
        interjectRecorderRef.current = null;
        setInterjectError(error?.message ?? t('podcast.interjectFailed'));
      },
    });
    interjectRecorderRef.current = recorder;
    setInterjecting(true);
    try {
      await recorder.start();
    } catch (error) {
      setInterjecting(false);
      interjectRecorderRef.current = null;
      setInterjectError(error?.message ?? t('podcast.interjectFailed'));
    }
  }, [continuePodcast, interjecting, podcastActiveId, t, tts]);

  // Leaving the reader stops the speech: the podcast must not follow the
  // learner out of the book.
  useEffect(() => () => { tts.cancel(); }, [tts]);

  const spokenStates = useMemo(() => {
    if (mode !== 'speak' || spokenResult === null) return null;
    return alignSpokenWords(spokenResult.words, practice.words);
  }, [mode, spokenResult, practice.words]);

  // Typing statistics: characters, words, and where the mistakes are.
  const typingStats = useMemo(() => {
    let typedChars = 0;
    let correctChars = 0;
    let committedWords = 0;
    let correctWords = 0;
    for (let i = 0; i < wordIndex; i += 1) {
      const typed = wordResults[i];
      if (typed === undefined) continue;
      const target = practice.words[i]?.text ?? '';
      committedWords += 1;
      let clean = true;
      for (let c = 0; c < typed.length; c += 1) {
        typedChars += 1;
        if (typed[c] === target[c]) correctChars += 1;
        else clean = false;
      }
      if (clean && typed.length === target.length) correctWords += 1;
    }
    const currentTarget = practice.words[wordIndex]?.text ?? '';
    for (let c = 0; c < wordInput.length; c += 1) {
      typedChars += 1;
      if (wordInput[c] === currentTarget[c]) correctChars += 1;
    }
    return { typedChars, correctChars, committedWords, correctWords };
  }, [wordResults, wordIndex, wordInput, practice.words]);

  const accuracy = typingStats.typedChars === 0
    ? 100
    : Math.round((typingStats.correctChars / typingStats.typedChars) * 100);
  const elapsedMs = startedAt === 0 ? 0 : Date.now() - startedAt;
  const minutes = elapsedMs / 60000;
  // Below a second the number is noise, not a speed.
  const speed = elapsedMs < 1000
    ? 0
    : settings.speedUnit === 'chars'
      ? Math.round(typingStats.correctChars / minutes)
      : Math.round(typingStats.correctWords / minutes);
  const practiceComplete = wordIndex >= practice.words.length && practice.words.length > 0;

  // The speech follows the typing: the driver pauses when the learner falls
  // behind and re-reads from the typing position when they run ahead.
  useEffect(() => {
    if (mode !== 'type' || muted) return;
    if (wordIndex > 0 || wordInput.length > 0) sync.syncTo(Math.min(wordIndex, practice.words.length - 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wordIndex, mode, muted]);

  const commitWord = useCallback((typed) => {
    const target = practice.words[wordIndex]?.text ?? '';
    const clean = comparable(typed) === comparable(target);
    setWordResults((results) => {
      const next = results.slice();
      next[wordIndex] = typed;
      return next;
    });
    if (clean || settings.forgive) {
      setWordIndex((value) => value + 1);
      setWordInput('');
      return;
    }
    // Without "forgive mistakes" the learner stays on the word until it is
    // typed correctly; the word keeps its error marking in the text.
    setWordInput(typed);
  }, [practice.words, settings.forgive, wordIndex]);

  const onWordChange = useCallback((event) => {
    const value = event.target.value;
    if (value === '') {
      setWordInput('');
      return;
    }
    if (value.includes(' ')) {
      commitWord(value.slice(0, value.indexOf(' ')));
      return;
    }
    if (startedAt === 0) setStartedAt(Date.now());
    setWordInput(value);
  }, [commitWord, startedAt]);

  const onWordKeyDown = useCallback((event) => {
    if (event.key === 'Backspace' && wordInput.length === 0 && wordIndex > 0) {
      event.preventDefault();
      const previous = wordIndex - 1;
      setWordIndex(previous);
      setWordInput(wordResults[previous] ?? '');
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (wordInput.length > 0) commitWord(wordInput);
    }
  }, [commitWord, wordIndex, wordInput, wordResults]);

  const resetTyping = useCallback(() => {
    setWordIndex(0);
    setWordInput('');
    setWordResults([]);
    setStartedAt(0);
  }, []);

  const updateSettings = useCallback((patch) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      saveTypingSettings(next);
      return next;
    });
  }, []);

  const stopSpeaking = useCallback(() => {
    tts.cancel();
    setPlaying(false);
    setSpokenWord(-1);
    if (playedRef.current.since !== 0) {
      playedRef.current.ms += Date.now() - playedRef.current.since;
      playedRef.current.since = 0;
      flushActivity();
    }
  }, [tts, flushActivity]);

  const playActive = useCallback(() => {
    if (unit === undefined) return;
    if (playedRef.current.since === 0) playedRef.current.since = Date.now();
    const wholeParagraph = scope === 'paragraph';
    const text = wholeParagraph ? paragraph.text : unit.text;
    const words = wholeParagraph ? paragraph.words : (unit.words ?? []);
    const base = wholeParagraph ? 0 : (activeEntry?.displayOffset ?? 0);
    setTtsNote('');
    tts.cancel();
    setPlaying(true);
    tts.speak(text, {
      onWord: (wordIndex_, charIndex) => {
        let position = wordIndex_;
        if (typeof charIndex === 'number' && charIndex >= 0) {
          const found = words.findIndex((word) => word.start <= charIndex && charIndex < word.end);
          if (found >= 0) position = found;
        }
        setSpokenWord(base + position);
      },
      onEnd: () => {
        setPlaying(false);
        setSpokenWord(-1);
        if (playedRef.current.since !== 0) {
          playedRef.current.ms += Date.now() - playedRef.current.since;
          playedRef.current.since = 0;
        }
        if (repeat) {
          window.setTimeout(() => { playActive(); }, 500);
        }
      },
      onError: (error) => {
        setPlaying(false);
        setSpokenWord(-1);
        setTtsNote(error?.message ?? t('reader.speakFailed'));
      },
    });
  }, [scope, paragraph, unit, activeEntry, repeat, tts, t]);

  // The shelf asks the book to read itself out loud.
  const playedTokenRef = useRef(0);
  useEffect(() => {
    if (autoPlayToken === undefined || autoPlayToken === 0) return;
    if (autoPlayToken === playedTokenRef.current) return;
    playedTokenRef.current = autoPlayToken;
    playActive();
  }, [autoPlayToken]);

  // Pronouncing a word uses the cloud voice; the built-in voice is the
  // fallback, so a word is always audible.
  const pronounce = useCallback((text) => {
    const selected = tts.getVoice();
    const voiceId = selected?.cloud === true
      ? selected.id
      : (cloudVoicesRef.current[0] ? `mm:${cloudVoicesRef.current[0].id}` : undefined);
    void speakWord(text, {
      voiceId,
      rate: tts.getRate(),
      onError: (error) => { setTtsNote(error?.message ?? t('reader.speakFailed')); },
    });
  }, [tts, t]);

  // Clicking a word opens its card; the card can pronounce it, explain it and
  // save it into the vocabulary list.
  const openWordCard = useCallback((word, event) => {
    // "Dialysis read": once the budget for this page is spent, the word card
    // stays closed and the learner has to read the context.
    if (modes.limitLookups && lookupsUsed >= LOOKUP_BUDGET) {
      setLookupsUsed((value) => value + 1);
      setTtsNote(t('reader.lookupsSpent'));
      pronounce(word.text);
      return;
    }
    const sentence = paragraph.entries[word.sentencePosition]?.unit.text ?? '';
    setLookupsUsed((value) => value + 1);
    setCard({ word: word.text, sentence, x: event.clientX, y: event.clientY });
  }, [paragraph.entries, modes.limitLookups, lookupsUsed, t, pronounce]);

  // Saving is idempotent: an existing entry only gains the phonetic and the
  // definition it was missing.
  const saveWord = useCallback(async (payload) => {
    const id = normalizeWordId(payload.word);
    await addEntry({
      id,
      word: payload.word,
      bookId: book?.id ?? '',
      bookTitle: book?.title ?? '',
      sentence: payload.sentence ?? '',
      phonetic: payload.phonetic ?? '',
      definition: payload.definition ?? '',
      addedAt: Date.now(),
      state: 'learning',
      reviewCount: 0,
      lastReviewedAt: 0,
      nextReviewAt: Date.now(),
    });
    const entries = await listEntries();
    setVocabEntries(toVocabMap(entries));
  }, [book]);

  const removeWord = useCallback(async (word) => {
    await removeEntry(normalizeWordId(word));
    const entries = await listEntries();
    setVocabEntries(toVocabMap(entries));
  }, []);

  const startRecognizing = useCallback(() => {
    if (unit === undefined) return;
    const target = scope === 'paragraph' ? paragraph.text : unit.text;
    transcriptRef.current = '';
    setTranscript('');
    setInterim('');
    setSpokenResult(null);
    setSpeaking(true);
    const recognizer = createRecognizer({
      lang: 'en-US',
      onPartial: (text) => { setInterim(text); },
      onFinal: (text) => {
        transcriptRef.current = `${transcriptRef.current} ${text}`.trim();
        setTranscript(transcriptRef.current);
        setInterim('');
      },
      onEnd: () => {
        setSpeaking(false);
        const spoken = transcriptRef.current;
        if (spoken.length > 0) setSpokenResult(diffWords(target, spoken));
      },
      onError: (error) => {
        setSpeaking(false);
        setAsrFailed(true);
        // The message says what to do next instead of only what went wrong.
        setTtsNote(engineMessage(error, t('reader.recognizeFallback')));
      },
    });
    recognizerRef.current = recognizer;
    recognizer.start();
  }, [unit, scope, paragraph, t]);

  const stopRecognizing = useCallback(() => {
    recognizerRef.current?.stop?.();
    setSpeaking(false);
  }, []);

  // The reading is recorded and transcribed by the Host, so it works in the
  // desktop app where the browser has no speech recognition service.
  const startRecording = useCallback(async () => {
    setTtsNote('');
    setAsrFailed(false);
    setTranscript('');
    setInterim('');
    setSpokenResult(null);
    const target = scope === 'paragraph' ? paragraph.text : unit.text;
    const recorder = createRecorder({
      onStop: async (blob, url) => {
        setAudioUrl(url);
        try {
          const audio = await blobToBase64(blob);
          const result = await askAi('asr', { audio, mimeType: blob.type || 'audio/webm' });
          const text = typeof result?.text === 'string' ? result.text.trim() : '';
          setTranscript(text);
          if (text.length > 0) setSpokenResult(diffWords(target, text));
          else setTtsNote(t('reader.nothingRecognized'));
        } catch (error) {
          setTtsNote(error instanceof Error ? error.message : t('reader.recognizeFailed'));
        }
      },
      onError: (error) => { setTtsNote(engineMessage(error, `${t('reader.recordFailed')} ${t('reader.micHint')}`)); },
    });
    recorderRef.current = recorder;
    try {
      await recorder.start();
    } catch (error) {
      setTtsNote(engineMessage(error, `${t('reader.recordFailed')} ${t('reader.micHint')}`));
    }
  }, [paragraph.text, scope, t, unit.text]);

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop?.();
  }, []);

  // Moving by sentence, or by paragraph when the whole paragraph is the unit.
  const move = useCallback((delta) => {
    if (scope === 'paragraph') {
      const target = paragraphs[currentParagraphIndex + delta];
      if (target !== undefined) onIndexChange(target.unitIndexes[0]);
      return;
    }
    const next = Math.max(0, Math.min(units.length - 1, index + delta));
    onIndexChange(next);
  }, [scope, paragraphs, currentParagraphIndex, index, units.length, onIndexChange]);

  // The arrow keys turn the page while reading. They are ignored while the
  // learner is typing, so the caret in the input keeps working.
  useEffect(() => {
    if (mode !== 'listen' || unit === undefined) return undefined;
    const onKeyDown = (event) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target !== null && target !== undefined) {
        const tag = String(target.tagName ?? '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable === true) return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        move(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        move(1);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); };
  }, [mode, unit, move]);

  // The recognition can exist and still fail at runtime (the service is not
  // reachable in the desktop app). Then the recording takes over.
  const [asrFailed, setAsrFailed] = useState(false);
  // The Host transcribes the recording; the browser recognition is the backup.
  const [asrAvailable, setAsrAvailable] = useState(false);

  // One switch per reading aid.
  const toggleMode = useCallback((key) => {
    setModes((current) => ({ ...current, [key]: !current[key] }));
  }, []);

  // The table of contents lists the chapters when the book has a real chapter
  // structure; a book that is one long chapter falls back to its paragraphs,
  // each labelled with its opening words.
  const tocEntries = useMemo(() => {
    const titles = new Set(chapters.map((chapter) => String(chapter.title ?? '').trim()));
    if (titles.size > 1) {
      return chapters.map((chapter, position) => {
        const next = chapters[position + 1];
        const from = chapter.unitIndex;
        const to = next === undefined ? units.length : next.unitIndex;
        const words = units.slice(from, to).reduce((sum, unit) => sum + (unit?.words?.length ?? 0), 0);
        return {
          key: `chapter-${chapter.index}`,
          label: String(chapter.title ?? '').trim() || `${t('reader.chapter')} ${chapter.index + 1}`,
          hint: '',
          unitIndex: from,
          words,
        };
      });
    }
    return paragraphs.map((group, index) => {
      const words = group.unitIndexes.reduce((sum, unitIndex) => sum + (units[unitIndex]?.words?.length ?? 0), 0);
      const preview = group.unitIndexes
        .map((unitIndex) => units[unitIndex]?.text ?? '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 56);
      return {
        key: group.key,
        label: `${t('reader.paragraph')} ${index + 1}`,
        hint: preview,
        unitIndex: group.unitIndexes[0],
        words,
      };
    });
  }, [chapters, paragraphs, units, t]);

  if (unit === undefined) {
    return h(
      'div',
      { className: 'er-empty' },
      h('div', { className: 'er-empty-title' }, t('reader.emptyTitle')),
      h('div', { className: 'er-empty-hint' }, t('reader.emptyHint')),
    );
  }

  const chapter = chapters.find((entry) => entry.index === unit.chapterIndex);
  const recognitionSupported = isRecognitionSupported();
  const isParagraphScope = scope === 'paragraph';

  /**
   * The class of one display word.
   * @param {number} position - the display index
   * @returns {string}
   */
  const wordClass = (position) => {
    const practiceIndex = practiceIndexByDisplay.get(position);
    if (mode === 'type') {
      // In the typing mode the paragraph is the surface: the current word is
      // marked, the sentences outside the practice unit are context only.
      if (practiceIndex === undefined) return isParagraphScope ? '' : ' is-muted';
      return practiceIndex === wordIndex ? ' is-current' : '';
    }
    if (mode === 'speak' && spokenStates !== null && practiceIndex !== undefined) {
      const state = spokenStates[practiceIndex];
      if (state === 'ok') return ' is-ok';
      if (state === 'bad') return ' is-bad';
      if (state === null) return ' is-missing';
      return '';
    }
    if (mode === 'listen' && position === spokenWord) return ' is-spoken';
    if (practiceIndex === undefined) return isParagraphScope ? '' : ' is-muted';
    return '';
  };

  /**
   * Render one word of the paragraph while typing: the characters the learner
   * typed stay where they were typed, the wrong ones are painted red.
   * @param {number} position - the display index
   * @param {string} text - the word as it appears in the book
   * @returns {any} the word content
   */
  const renderTypedWord = (position, text) => {
    const practiceIndex = practiceIndexByDisplay.get(position);
    if (practiceIndex === undefined) return text;
    const target = practice.words[practiceIndex]?.text ?? text;
    const isCurrent = practiceIndex === wordIndex;
    const typed = isCurrent ? wordInput : (wordResults[practiceIndex] ?? '');
    const wrong = typed.length > 0 && comparable(typed) !== comparable(target);
    if (!isCurrent && !wrong) return text;
    const length = Math.max(target.length, typed.length);
    const chars = [];
    for (let i = 0; i < length; i += 1) {
      const typedChar = i < typed.length ? typed[i] : null;
      const targetChar = i < target.length ? target[i] : null;
      const character = typedChar ?? targetChar ?? '';
      const className = typedChar === null
        ? 'er-char is-pending-char'
        : typedChar === targetChar ? 'er-char' : 'er-char is-bad-char';
      chars.push(h('span', { key: i, className }, character));
    }
    // The punctuation of the original word stays outside the comparison.
    const suffix = text.startsWith(target) ? text.slice(target.length) : '';
    if (suffix.length > 0) chars.push(h('span', { key: 'suffix', className: 'er-char' }, suffix));
    return chars;
  };

  // The settings panel belongs to the reader, not to the typing mode:
  // the toolbar can open it in every mode.
  const settingsPanel = () => h(
          'div',
          { className: 'er-settings' },
          h(
            'div',
            { className: 'er-setting-row' },
            h('span', { className: 'er-setting-label' }, t('reader.fontStyle')),
            h(
              'div',
              { className: 'er-scope' },
              ['sans', 'serif', 'mono'].map((style) => h(
                'button',
                {
                  key: style,
                  type: 'button',
                  className: 'er-scope-item',
                  'aria-pressed': settings.fontStyle === style,
                  onClick: () => { updateSettings({ fontStyle: style }); },
                },
                t(`reader.font${style.charAt(0).toUpperCase()}${style.slice(1)}`),
              )),
            ),
          ),
          h(
            'div',
            { className: 'er-setting-row' },
            h('span', { className: 'er-setting-label' }, t('reader.fontSize')),
            h('input', {
              type: 'range',
              min: '16',
              max: '34',
              step: '1',
              value: String(settings.fontSize),
              onChange: (event) => { updateSettings({ fontSize: Number(event.target.value) }); },
            }),
            h('span', { className: 'er-setting-value' }, `${settings.fontSize}pt`),
          ),
          h(
            'div',
            { className: 'er-setting-row' },
            h('span', { className: 'er-setting-label' }, t('reader.lineHeight')),
            h('input', {
              type: 'range',
              min: '0.4',
              max: '1.4',
              step: '0.05',
              value: String(settings.lineHeight),
              onChange: (event) => { updateSettings({ lineHeight: Number(event.target.value) }); },
            }),
            h('span', { className: 'er-setting-value' }, `${settings.lineHeight.toFixed(2)}em`),
          ),
          h(
            'div',
            { className: 'er-setting-row' },
            h('span', { className: 'er-setting-label' }, t('reader.columnWidth')),
            h(
              'div',
              { className: 'er-scope' },
              ['narrow', 'normal', 'wide', 'full'].map((width) => h(
                'button',
                {
                  key: width,
                  type: 'button',
                  className: 'er-scope-item',
                  'aria-pressed': (settings.columnWidth ?? 'normal') === width,
                  onClick: () => { updateSettings({ columnWidth: width }); },
                },
                t(`reader.column${width.charAt(0).toUpperCase()}${width.slice(1)}`),
              )),
            ),
          ),
          h(
            'div',
            { className: 'er-setting-row' },
            h('span', { className: 'er-setting-label' }, t('reader.displaySpeed')),
            h(
              'div',
              { className: 'er-scope' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'er-scope-item',
                  'aria-pressed': settings.speedUnit === 'words',
                  onClick: () => { updateSettings({ speedUnit: 'words' }); },
                },
                t('reader.speedWords'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'er-scope-item',
                  'aria-pressed': settings.speedUnit === 'chars',
                  onClick: () => { updateSettings({ speedUnit: 'chars' }); },
                },
                t('reader.speedChars'),
              ),
            ),
          ),
          h(
            'label',
            { className: 'er-setting-row' },
            h('span', { className: 'er-setting-label' }, t('reader.forgiveMistakes')),
            h('input', {
              type: 'checkbox',
              checked: settings.forgive,
              onChange: (event) => { updateSettings({ forgive: event.target.checked }); },
            }),
            h('span', { className: 'er-setting-hint' }, t('reader.forgiveHint')),
          ),
          h(
            'label',
            { className: 'er-setting-row' },
            h('span', { className: 'er-setting-label' }, t('reader.hideInput')),
            h('input', {
              type: 'checkbox',
              checked: settings.hideInput,
              onChange: (event) => { updateSettings({ hideInput: event.target.checked }); },
            }),
          ),
          h(
            'div',
            { className: 'er-setting-row er-setting-column' },
            h('span', { className: 'er-setting-label' }, t('reader.replacements')),
            h('textarea', {
              className: 'er-replacements',
              value: replacementText,
              spellCheck: false,
              onChange: (event) => {
                setReplacementText(event.target.value);
                updateSettings({ replacements: parseReplacements(event.target.value) });
              },
            }),
            h('span', { className: 'er-setting-hint' }, t('reader.replacementsHint')),
          ),
  );

  const typingView = h(
    'div',
    { className: 'er-typing-view' },
    h(
      'div',
      { className: 'er-type-bar' },
      h('span', { className: 'er-type-metric' }, `${accuracy}%`),
      h('span', { className: 'er-type-metric' }, `${speed} ${settings.speedUnit === 'chars' ? t('reader.perMinuteChars') : t('reader.perMinuteWords')}`),
      h(
        'button',
        {
          type: 'button',
          className: 'er-type-icon',
          'aria-pressed': muted,
          title: muted ? t('reader.unmute') : t('reader.mute'),
          onClick: () => { setMuted((value) => { if (value) return false; tts.cancel(); return true; }); },
        },
        h(SoundIcon, { size: 14 }),
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'er-type-icon',
          'aria-pressed': settingsOpen,
          title: t('reader.typingSettings'),
          onClick: () => { setSettingsOpen((value) => !value); },
        },
        h(SettingsIcon, { size: 15 }),
      ),
    ),
  );

  const isClozeScope = scope === 'cloze';
  const unitWordCount = practice.words.length;
  const toLearnCount = practice.words.filter((word) => vocabEntries[normalizeWordId(word.text)] !== undefined).length;
  const knownPercent = unitWordCount === 0
    ? 0
    : Math.round(((unitWordCount - toLearnCount) / unitWordCount) * 100);
  const estMinutes = Math.max(1, Math.ceil(unitWordCount / 200));

  const renderReadBar = () => h(
    'div',
    { className: 'er-read-bar' },
    h(
      'button',
      {
        type: 'button',
        className: 'er-round-icon er-exit-button',
        title: t('reader.exitBook'),
        'aria-label': t('reader.exitBook'),
        onClick: () => { onExit?.(); },
      },
      h(ExitIcon, { size: 15 }),
    ),
    h(
      'button',
      {
        type: 'button',
        className: 'er-round-icon er-notes-button',
        title: t('notes.title'),
        'aria-label': t('notes.title'),
        onClick: () => { setNotesOpen(true); },
      },
      h(NoteIcon, { size: 15 }),
      noteCount > 0 ? h('span', { className: 'er-notes-badge' }, String(noteCount)) : null,
    ),
    h(
      'select',
      {
        className: 'er-select',
        value: String(unit.chapterIndex),
        onChange: (event) => {
          const target = chapters.find((entry) => String(entry.index) === event.target.value);
          if (target !== undefined) onIndexChange(target.unitIndex);
        },
      },
      chapters.map((entry) => h('option', { key: entry.index, value: String(entry.index) }, entry.title)),
    ),
    h(
      'span',
      { className: 'er-counter' },
      format(t('reader.position'), {
        p: currentParagraphIndex + 1,
        pt: paragraphs.length,
        s: sentencePosition + 1,
        st: sentenceTotal,
      }),
    ),
    h('span', { className: 'er-counter er-read-title', title: book?.title ?? '' }, book?.title ?? ''),
    h(
      'button',
      {
        type: 'button',
        className: 'er-wordlist-button',
        title: t('reader.openWordList'),
        onClick: () => { onOpenWordList?.(); },
      },
      t('reader.wordList'),
      Object.keys(vocabEntries).length > 0
        ? h('span', { className: 'er-wordlist-count' }, String(Object.keys(vocabEntries).length))
        : null,
    ),
    h(
      'button',
      {
        type: 'button',
        className: 'er-round-icon er-read-extra',
        title: t('mindmap.open'),
        'aria-label': t('mindmap.open'),
        onClick: () => { openMindMap(); },
      },
      h(MindMapIcon, { size: 15 }),
    ),
    h(
      'button',
      {
        type: 'button',
        className: 'er-round-icon er-read-extra',
        title: t('podcast.open'),
        'aria-label': t('podcast.open'),
        onClick: () => { openPodcast(); },
      },
      h(PodcastIcon, { size: 15 }),
    ),
    h(
      'div',
      { className: 'er-read-stats' },
      h('span', { className: 'er-read-stat' }, `${unitWordCount} ${t('reader.words')}`),
      h('span', { className: 'er-read-stat is-learn' }, `${toLearnCount} ${t('reader.toLearn')}`),
      h('span', { className: 'er-read-stat' }, `est. ${estMinutes} min`),
      h('span', { className: 'er-read-stat is-known' }, `Known ${knownPercent}%`),
    ),
  );

  // Where the learning-modes panel opens: next to the tool that opened it and
  // below the sticky mode row, so nothing can hide it.
  const modesPanelStyle = useMemo(() => {
    if (modesAnchor === null) return { left: 12, top: 12, width: 300 };
    const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth;
    const viewportHeight = typeof window === 'undefined' ? 768 : window.innerHeight;
    const width = 300;
    const rowBottom = modesRowRef.current?.getBoundingClientRect?.().bottom ?? 0;
    const left = Math.max(12, Math.min(modesAnchor.left - width - 12, viewportWidth - width - 12));
    const top = Math.max(12, Math.min(Math.max(modesAnchor.bottom, rowBottom) + 8, viewportHeight - 160));
    return { left, top, width };
  }, [modesAnchor]);

  const renderModesPanel = () => h(
    'div',
    { className: 'er-modes-panel', style: modesPanelStyle, ref: modesPanelRef },
    [
      ['highlight', t('reader.modeHighlight'), t('reader.modeHighlightHint')],
      ['gloss', t('reader.modeGloss'), t('reader.modeGlossHint')],
      ['translate', t('reader.modeTranslate'), t('reader.modeTranslateHint')],
      ['blur', t('reader.modeBlur'), t('reader.modeBlurHint')],
      ['bionic', t('reader.modeBionic'), t('reader.modeBionicHint')],
      ['limitLookups', t('reader.modeLimit'), t('reader.modeLimitHint')],
    ].map(([key, label, hint]) => h(
      'div',
      { key, className: 'er-mode-row' },
      h(
        'span',
        { className: 'er-mode-row-main' },
        h('span', { className: 'er-mode-row-label' }, label),
        h('span', { className: 'er-mode-row-hint' }, hint),
      ),
      h(
        'button',
        {
          type: 'button',
          role: 'switch',
          className: 'er-switch',
          'aria-checked': modes[key],
          onClick: () => { toggleMode(key); },
        },
      ),
    )),
  );


  const renderToc = () => h(
    Modal,
    { title: t('reader.tocTitle'), onClose: () => { setTocOpen(false); } },
    h(
      'div',
      { className: 'er-toc' },
      tocEntries.map((entry) => h(
        'button',
        {
          key: entry.key,
          type: 'button',
          className: `er-toc-row${entry.unitIndex === currentParagraphFirstUnit ? ' is-current' : ''}`,
          onClick: () => { setTocOpen(false); onIndexChange(entry.unitIndex); },
        },
        h(
          'span',
          { className: 'er-toc-main' },
          h('span', { className: 'er-toc-title' }, entry.label),
          entry.hint === '' ? null : h('span', { className: 'er-toc-hint' }, entry.hint),
        ),
        h('span', { className: 'er-toc-meta' }, `${entry.words} ${t('reader.words')}`),
      )),
    ),
  );

  const renderTools = () => {
    const tool = (key, icon, label, options = {}) => h(
      'button',
      {
        type: 'button',
        className: 'er-read-tool',
        ref: options.ref,
        title: options.title ?? label,
        'aria-pressed': options.pressed,
        disabled: options.disabled,
        onClick: options.onClick,
      },
      h('span', { className: 'er-read-tool-icon' }, icon),
      h('span', { className: 'er-read-tool-label' }, label),
    );
    return h(
      'div',
      { className: 'er-read-tools' },
      tool('modes', h(HighlighterIcon, { size: 17 }), t('reader.toolModes'), {
        ref: modesButtonRef,
        pressed: modePanelOpen,
        onClick: () => {
          const rect = modesButtonRef.current?.getBoundingClientRect?.();
          if (rect !== undefined && rect !== null) {
            setModesAnchor({ left: rect.left, top: rect.top, bottom: rect.bottom, right: rect.right });
          }
          setModePanelOpen((value) => !value);
        },
      }),
      tool('cloze', h(ClozeIcon, { size: 17 }), t('reader.toolCloze'), {
        pressed: isClozeScope,
        disabled: clozeWords.length === 0,
        onClick: () => { setScope(isClozeScope ? 'sentence' : 'cloze'); stopSpeaking(); setModePanelOpen(false); },
      }),
      tool('settings', h(SettingsIcon, { size: 17 }), t('reader.toolSettings'), {
        pressed: settingsOpen,
        onClick: () => { setSettingsOpen((value) => !value); setModePanelOpen(false); },
      }),
      tool('toc', h(ListIcon, { size: 17 }), t('reader.tocTitle'), {
        onClick: () => { setTocOpen(true); setModePanelOpen(false); },
      }),
    );
  };

  // The colour of a saved word follows its state: known words are green,
  // words still being learned are amber.
  const stateClass = (word) => {
    if (!modes.highlight) return '';
    const entry = vocabEntries[normalizeWordId(word.text)];
    if (entry === undefined) return '';
    return entry.state === 'known' ? ' is-known' : ' is-learning';
  };

  // Bionic reading: the beginning of a word is bold so the eye jumps over it.
  const bionicText = (text) => {
    if (!modes.bionic) return text;
    const cut = Math.max(1, Math.ceil(text.length * 0.4));
    return [h('b', { key: 'b' }, text.slice(0, cut)), text.slice(cut)];
  };

  // Blur text: the sentence stays blurred until it is tapped. The blur has to
  // sit on the words, because a filter does not apply to inline elements.
  const sentenceClass = (paragraphIndex, sentencePosition) => {
    if (!modes.blur) return '';
    return revealed[`${paragraphIndex}:${sentencePosition}`] ? ' is-revealed' : ' is-blurred';
  };
  const wordBlurClass = (paragraphIndex, sentencePosition) => {
    if (!modes.blur) return '';
    return revealed[`${paragraphIndex}:${sentencePosition}`] ? '' : ' is-blurred-word';
  };

  // The notes of one paragraph: a note belongs to the paragraph whose
  // sentences it was taken from.
  const notesOfParagraph = (group) => {
    const unitIndexes = group?.unitIndexes ?? [];
    if (unitIndexes.length === 0) return [];
    return bookNotes.filter((note) => unitIndexes.includes(note.unitIndex));
  };

  // The text of a paragraph, used as the quote of a note taken on it.
  const quoteOfParagraph = (group) => {
    const unitIndexes = group?.unitIndexes ?? [];
    return unitIndexes.map((unitIndex) => units[unitIndex]?.text ?? '').join(' ').trim();
  };

  // The translation under a paragraph. It shows when the full-text switch is
  // on, or when this paragraph was translated on its own.
  const renderParagraphTranslation = (paragraphIndex) => {
    const value = translations[paragraphIndex];
    if (!modes.translate && value === undefined) return null;
    return h(
      'div',
      { className: 'er-translation' },
      value ?? (translations[paragraphIndex] === '' ? '' : '…'),
    );
  };

  // The three buttons in the right gutter of a paragraph: take a note,
  // translate it, read it aloud.
  const renderParagraphActions = (group, paragraphIndex) => {
    const unitIndexes = group?.unitIndexes ?? [];
    if (unitIndexes.length === 0) return null;
    const notes = notesOfParagraph(group);
    const translated = translations[paragraphIndex] !== undefined;
    const speaking = speakingParagraph === paragraphIndex;
    const translating = translatingParagraph === paragraphIndex;
    /**
     * One gutter button.
     * @param {string} title - the tooltip and the accessible name.
     * @param {any} icon - the glyph.
     * @param {Function} onClick - called with the click event.
     * @param {string} extra - extra class names for the state.
     * @param {any} badge - an optional badge on the button.
     * @returns {any} the element tree.
     */
    const action = (title, icon, onClick, extra = '', badge = null) => h(
      'button',
      {
        type: 'button',
        className: `er-paragraph-action${extra}`,
        title,
        'aria-label': title,
        onClick: (event) => {
          event.stopPropagation();
          onClick(event);
        },
      },
      icon,
      badge,
    );
    return h(
      'div',
      { className: 'er-paragraph-actions' },
      action(
        t('notes.addForParagraph'),
        h(PencilIcon, { size: 13 }),
        (event) => { openParagraphNote(group, event.currentTarget); },
        notes.length > 0 ? ' is-noted' : '',
        notes.length > 0 ? h('span', { className: 'er-paragraph-note-count' }, String(notes.length)) : null,
      ),
      action(
        translating ? t('reader.translatePending') : t('reader.translateThis'),
        h(GlobeIcon, { size: 14 }),
        () => { void translateParagraph(group, paragraphIndex); },
        translated ? ' is-translated' : '',
      ),
      action(
        speaking ? t('reader.stopThis') : t('reader.playThis'),
        speaking ? h(PauseIcon, { size: 13 }) : h(PlayIcon, { size: 13 }),
        () => { speakParagraph(group, paragraphIndex); },
        speaking ? ' is-speaking' : '',
      ),
    );
  };

  // Open the note editor next to the paragraph it belongs to.
  const openParagraphNote = (group, element) => {
    const rect = element?.getBoundingClientRect?.();
    setNoteEditor({
      unitIndex: group.unitIndexes[0],
      unitIndexes: group.unitIndexes,
      quote: quoteOfParagraph(group).slice(0, 800),
      rect: rect === undefined || rect === null
        ? null
        : { left: rect.left, top: rect.top, bottom: rect.bottom, right: rect.right },
    });
    setNoteDraft('');
    setNoteError('');
  };

  // Save the note the learner is writing.
  const saveParagraphNote = useCallback(async () => {
    const text = noteDraft.trim();
    if (text === '' || noteEditor === null) return;
    try {
      await addNote({
        bookId: book?.id ?? '',
        unitIndex: noteEditor.unitIndex,
        quote: noteEditor.quote,
        text,
      });
      setNoteDraft('');
      setNoteError('');
      setNotesVersion((value) => value + 1);
    } catch (reason) {
      setNoteError(reason?.message ?? t('notes.saveFailed'));
    }
  }, [book?.id, noteDraft, noteEditor, t]);

  // Drop one of the notes of this paragraph.
  const dropParagraphNote = useCallback(async (id) => {
    try {
      await removeNote(id);
      setNotesVersion((value) => value + 1);
    } catch (reason) {
      setNoteError(reason?.message ?? t('notes.saveFailed'));
    }
  }, [t]);

  // Where the note editor opens: towards the rail, which is the space next to
  // the text; when that is too narrow, it opens to the left and stays glued to
  // the button it belongs to.
  const noteEditorStyle = useMemo(() => {
    if (noteEditor?.rect == null) return { left: 12, top: 12, width: 320 };
    const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth;
    const viewportHeight = typeof window === 'undefined' ? 768 : window.innerHeight;
    const width = 320;
    const rect = noteEditor.rect;
    const left = viewportWidth - rect.right >= width + 16
      ? rect.right + 8
      : Math.max(12, rect.right - width);
    const top = Math.max(12, Math.min(rect.top - 8, viewportHeight - 180));
    return { left, top, width };
  }, [noteEditor]);

  const renderNoteEditor = () => {
    if (noteEditor === null) return null;
    const notes = bookNotes.filter((note) => noteEditor.unitIndexes.includes(note.unitIndex));
    return h(
      'div',
      { className: 'er-note-editor', style: noteEditorStyle, ref: noteEditorRef },
      h(
        'div',
        { className: 'er-note-editor-head' },
        h('span', { className: 'er-note-editor-title' }, t('notes.paragraphTitle')),
        h(
          'button',
          {
            type: 'button',
            className: 'er-note-editor-close',
            title: t('notes.close'),
            'aria-label': t('notes.close'),
            onClick: () => { setNoteEditor(null); },
          },
          '✕',
        ),
      ),
      h('div', { className: 'er-note-editor-quote' }, `“${noteEditor.quote}”`),
      h('textarea', {
        className: 'er-note-editor-input',
        value: noteDraft,
        rows: 3,
        placeholder: t('notes.paragraphPlaceholder'),
        onChange: (event) => { setNoteDraft(event.target.value); },
      }),
      h(
        'div',
        { className: 'er-note-editor-actions' },
        h(
          'button',
          {
            type: 'button',
            className: 'er-btn er-btn-primary',
            disabled: noteDraft.trim() === '',
            onClick: () => { void saveParagraphNote(); },
          },
          h(NoteIcon, { size: 13 }),
          t('notes.save'),
        ),
      ),
      noteError === '' ? null : h('div', { className: 'er-note-editor-error' }, noteError),
      notes.length === 0
        ? null
        : h(
          'div',
          { className: 'er-note-editor-list' },
          notes.map((note) => h(
            'div',
            { key: note.id, className: 'er-note-editor-item' },
            h('div', { className: 'er-note-editor-text' }, note.text),
            h(
              'button',
              {
                type: 'button',
                className: 'er-note-editor-delete',
                title: t('notes.delete'),
                'aria-label': t('notes.delete'),
                onClick: () => { void dropParagraphNote(note.id); },
              },
              h(TrashIcon, { size: 12 }),
            ),
          )),
        ),
    );
  };

  const renderPlainParagraph = (group, key) => {
    const paragraphIndex = paragraphs.indexOf(group);
    const sentences = [];
    for (const word of wordsOfGroup(group, units)) {
      const position = word.sentencePosition ?? 0;
      let bucket = sentences[sentences.length - 1];
      if (bucket === undefined || bucket.position !== position) {
        bucket = { position, words: [] };
        sentences.push(bucket);
      }
      bucket.words.push(word);
    }
    return h(
      'div',
      { key, className: 'er-paragraph-row' },
      h(
        'div',
        { className: 'er-paragraph-main' },
        h(
          'div',
          { className: 'er-page-paragraph is-context' },
          h('p', { className: 'er-paragraph-body' }, sentences.map((bucket) => h(
            'span',
            {
              key: bucket.position,
              className: `er-sentence${sentenceClass(paragraphIndex, bucket.position)}`,
              onClick: () => {
                if (!modes.blur) return;
                const id = `${paragraphIndex}:${bucket.position}`;
                setRevealed((current) => ({ ...current, [id]: true }));
              },
            },
            bucket.words.flatMap((word, position) => [
              h(
                'span',
                {
                  key: `${key}-${bucket.position}-${position}`,
                  className: `er-word${stateClass(word)}${wordBlurClass(paragraphIndex, bucket.position)}`,
                  title: t('reader.clickToLookup'),
                  onClick: (event) => { event.stopPropagation(); openWordCard(word, event); },
                },
                bionicText(word.text),
              ),
              ' ',
            ]),
          ))),
          renderParagraphTranslation(paragraphIndex),
        ),
      ),
      renderParagraphActions(group, paragraphIndex),
    );
  };

  const renderParagraph = () => {
    const sentences = [];
    paragraph.words.forEach((word, position) => {
      const sentencePosition = word.sentencePosition ?? 0;
      let bucket = sentences[sentences.length - 1];
      if (bucket === undefined || bucket.position !== sentencePosition) {
        bucket = { position: sentencePosition, words: [] };
        sentences.push(bucket);
      }
      bucket.words.push({ word, position });
    });
    return sentences.map((bucket) => h(
      'span',
      {
        key: bucket.position,
        className: `er-sentence${sentenceClass(currentParagraphIndex, bucket.position)}${bucket.position === (unit?.sentenceIndex ?? 0) ? ' is-active-sentence' : ''}`,
        onClick: () => {
          if (!modes.blur) return;
          const id = `${currentParagraphIndex}:${bucket.position}`;
          setRevealed((current) => ({ ...current, [id]: true }));
        },
      },
      bucket.words.flatMap(({ word, position }) => {
        const entry = vocabEntries[normalizeWordId(word.text)];
        const hard = entry !== undefined;
        const blank = clozeIndexes.has(position);
        const className = `er-word${wordClass(position)}${stateClass(word)}`;
        const content = blank
          ? h('span', { className: 'er-cloze-blank' }, '____')
          : (mode === 'type'
            ? renderTypedWord(position, word.text)
            : (modes.bionic ? bionicText(word.text) : word.text));
        const gloss = hard && modes.gloss && entry.definition !== undefined && entry.definition !== ''
          ? h('span', { className: 'er-hard-gloss' }, entry.definition)
          : null;
        const wordNode = h(
          'span',
          {
            key: `${position}-${word.start}`,
            className,
            title: mode === 'type' ? t('reader.clickToHear') : t('reader.clickToLookup'),
            onClick: (event) => {
              // In the typing mode the field keeps the focus, so a click only
              // pronounces the word; elsewhere it opens the word card.
              event.stopPropagation();
              if (mode === 'type') pronounce(word.text);
              else openWordCard(word, event);
            },
          },
          content,
        );
        return [
          gloss === null
            ? wordNode
            : h('span', { key: `wrap-${position}`, className: 'er-hard-wrap' }, wordNode, gloss),
          ' ',
        ];
      }),
    ));
  };

  const renderModeRow = () => h(
    'div',
    { className: 'er-modes', ref: modesRowRef },
    h(
      'button',
      { type: 'button', className: 'er-mode', 'aria-pressed': mode === 'listen', onClick: () => { setMode('listen'); stopSpeaking(); } },
      h(SoundIcon, { size: 15 }), t('reader.modeListen'),
    ),
    h(
      'button',
      { type: 'button', className: 'er-mode', 'aria-pressed': mode === 'type', onClick: () => { setMode('type'); stopSpeaking(); } },
      h(KeyboardIcon, { size: 15 }), t('reader.modeType'),
    ),
    h(
      'button',
      { type: 'button', className: 'er-mode', 'aria-pressed': mode === 'speak', onClick: () => { setMode('speak'); stopSpeaking(); } },
      h(MicIcon, { size: 15 }), t('reader.modeSpeak'),
    ),
    h('span', { className: 'er-scope-label' }, t('reader.scopeLabel')),
    h(
      'div',
      { className: 'er-scope', role: 'group', 'aria-label': t('reader.scopeLabel') },
      h(
        'button',
        { type: 'button', className: 'er-scope-item', 'aria-pressed': scope === 'sentence', onClick: () => { setScope('sentence'); stopSpeaking(); } },
        t('reader.scopeSentence'),
      ),
      h(
        'button',
        { type: 'button', className: 'er-scope-item', 'aria-pressed': scope === 'paragraph', onClick: () => { setScope('paragraph'); stopSpeaking(); } },
        t('reader.scopeParagraph'),
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'er-scope-item',
          'aria-pressed': isClozeScope,
          disabled: clozeWords.length === 0,
          onClick: () => { setScope('cloze'); stopSpeaking(); },
        },
        t('reader.scopeCloze'),
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'er-mode er-translate-toggle',
          'aria-pressed': modes.translate,
          title: t('reader.modeTranslateHint'),
          onClick: () => { toggleMode('translate'); },
        },
        h(TranslateIcon, { size: 15 }),
        t('reader.modeTranslate'),
      ),
    ),
  );

  const renderFoot = () => h(
    'div',
    { className: 'er-read-foot' },
    h(
      'div',
      { className: 'er-controls' },
      h(
        'button',
        { type: 'button', className: 'er-btn er-btn-primary', onClick: playing ? stopSpeaking : playActive },
        playing ? h(PauseIcon, { size: 14 }) : h(PlayIcon, { size: 14 }),
        playing ? t('reader.stop') : t('reader.play'),
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'er-btn er-btn-icon',
          title: isParagraphScope ? t('reader.previousParagraph') : t('reader.previous'),
          onClick: () => { move(-1); },
        },
        h(PrevIcon, { size: 14 }),
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'er-btn er-btn-icon',
          title: isParagraphScope ? t('reader.nextParagraph') : t('reader.next'),
          onClick: () => { move(1); },
        },
        h(NextIcon, { size: 14 }),
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'er-round-icon',
          title: t('reader.repeat'),
          'aria-pressed': repeat,
          onClick: () => { setRepeat((value) => !value); },
        },
        h(RepeatIcon, { size: 16 }),
      ),
    ),
    h(
      'div',
      { className: 'er-controls' },
      h('span', { className: 'er-label' }, t('reader.speed')),
      h(
        'select',
        { className: 'er-select', value: String(rate), onChange: (event) => { const next = Number(event.target.value); setRate(next); tts.setRate(next); } },
        RATES.map((value) => h('option', { key: value, value: String(value) }, `${value}x`)),
      ),
      h('span', { className: 'er-label' }, t('reader.voice')),
      h(
        'select',
        {
          className: 'er-select',
          value: voiceId,
          onChange: (event) => { setVoiceId(event.target.value); tts.setVoice(event.target.value); },
        },
        voices.length === 0
          ? h('option', { value: '' }, t('reader.noVoice'))
          : voices.map((voice) => h(
            'option',
            { key: voice.id, value: voice.id },
            voice.cloud === true ? `${voice.name} · MiniMax` : `${voice.name} (${voice.lang})`,
          )),
      ),
      h('span', { className: 'er-read-position' }, `${currentParagraphIndex + 1} / ${paragraphs.length}`),
    ),
  );

  return h(
    'div',
    { className: 'er-reader' },
    renderReadBar(),
    h(
      'div',
      { className: 'er-read-main' },
      h(
        'div',
        { className: 'er-read-body', ref: readBodyRef },
        renderModeRow(),
        h(
          'div',
          {
            ref: readingRef,
            className: 'er-reading-page er-paragraph',
            style: {
              fontFamily: FONT_FAMILIES[settings.fontStyle] ?? FONT_FAMILIES.serif,
              fontSize: `${settings.fontSize}px`,
              lineHeight: String(1.2 + settings.lineHeight),
              '--er-text-size': `${settings.fontSize}px`,
              '--er-column-width': COLUMN_WIDTHS[settings.columnWidth] ?? COLUMN_WIDTHS.normal,
            },
          },
          // The hint belongs to the page: it sits at the top of the card, so
          // it is seen once and never floats below the text.
          mode === 'listen'
            ? h(
              'div',
              { className: 'er-page-note is-first' },
              t('reader.tapWordHint'),
              h('span', { className: 'er-page-note-keys' }, t('reader.keyHint')),
            )
            : null,
          pageRange.groups.map((group, position) => {
            const groupIndex = pageRange.start + position;
            if (groupIndex !== currentParagraphIndex) return renderPlainParagraph(group, groupIndex);
            return h(
              'div',
              { key: groupIndex, className: 'er-paragraph-row is-active' },
              h(
                'div',
                { className: 'er-paragraph-main' },
                h(
                  'div',
                  { className: 'er-page-paragraph is-active', ref: activeRef },
                  h('p', { className: 'er-paragraph-body' }, renderParagraph()),
                  renderParagraphTranslation(groupIndex),
                ),
              ),
              renderParagraphActions(group, groupIndex),
            );
          }),
        ),
        mode === 'type' ? typingView : null,
        ttsNote ? h('div', { className: 'er-error' }, ttsNote) : null,
        mode === 'type'
          ? h(
            'div',
            { className: 'er-panel er-type-panel' },
            h(
              'div',
              { className: `er-input-row${settings.hideInput ? ' is-hidden' : ''}` },
              h('input', {
                ref: wordInputRef,
                className: 'er-word-input',
                value: wordInput,
                onChange: onWordChange,
                onKeyDown: onWordKeyDown,
                placeholder: practice.words[wordIndex]?.text ?? '',
                spellCheck: false,
                autoCapitalize: 'off',
                autoCorrect: 'off',
                autoComplete: 'off',
              }),
            ),
            h(
              'div',
              { className: 'er-controls' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'er-btn er-btn-primary',
                  disabled: !practiceComplete,
                  onClick: () => { move(1); },
                },
                isClozeScope ? t('reader.nextParagraph') : (isParagraphScope ? t('reader.nextParagraph') : t('reader.nextSentence')),
              ),
              h('button', { type: 'button', className: 'er-btn', onClick: resetTyping }, t('reader.retry')),
              h('button', { type: 'button', className: 'er-btn', onClick: playActive }, h(RepeatIcon, { size: 14 }), t('reader.listenOnce')),
            ),
          )
          : null,
        mode === 'speak'
          ? h(
            'div',
            { className: 'er-panel' },
            h(
              'div',
              { className: 'er-controls' },
              asrAvailable
                ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'er-btn er-btn-primary',
                    onClick: speaking ? stopRecording : startRecording,
                  },
                  h(MicIcon, { size: 14 }),
                  speaking ? t('reader.stopReading') : t('reader.startReading'),
                )
                : recognitionSupported && !asrFailed
                  ? h(
                    'button',
                    { type: 'button', className: 'er-btn er-btn-primary', onClick: speaking ? stopRecognizing : startRecognizing },
                    h(MicIcon, { size: 14 }),
                    speaking ? t('reader.stopReading') : t('reader.startReading'),
                  )
                  : h(
                    'button',
                    { type: 'button', className: 'er-btn er-btn-primary', onClick: audioUrl ? undefined : startRecording },
                    h(MicIcon, { size: 14 }),
                    audioUrl ? t('reader.replayRecording') : t('reader.startRecording'),
                  ),
              h('button', { type: 'button', className: 'er-btn', onClick: () => { setSpokenResult(null); setTranscript(''); setInterim(''); } }, t('reader.retry')),
            ),
            (!asrAvailable && (!recognitionSupported || asrFailed))
              ? h('div', { className: 'er-note' }, asrFailed ? t('reader.recognizeFallback') : t('reader.noRecognition'))
              : null,
            audioUrl ? h('audio', { controls: true, src: audioUrl, style: { width: '100%' } }) : null,
            h('div', { className: 'er-transcript' }, transcript || interim || t('reader.transcriptEmpty')),
            spokenResult === null
              ? null
              : h(
                'div',
                { className: 'er-panel' },
                h(
                  'div',
                  { className: 'er-stats' },
                  h('span', { className: 'er-stat' }, h('span', { className: 'er-label' }, t('reader.accuracy')), h('span', { className: 'er-stat-value' }, `${Math.round((spokenResult.accuracy ?? 0) * 100)}%`)),
                  h('span', { className: 'er-stat' }, h('span', { className: 'er-label' }, t('reader.missingWords')), h('span', { className: 'er-stat-value' }, String(spokenResult.missing ?? 0))),
                  h('span', { className: 'er-stat' }, h('span', { className: 'er-label' }, t('reader.extraWords')), h('span', { className: 'er-stat-value' }, String(spokenResult.extra ?? 0))),
                ),
                h(
                  'div',
                  { className: 'er-chips' },
                  (spokenResult.words ?? []).map((entry, position) => h(
                    'span',
                    { key: `${position}-${entry.word}`, className: `er-chip${entry.status === 'ok' ? ' is-ok' : entry.status === 'wrong' ? ' is-bad' : entry.status === 'missing' ? ' is-missing' : ' is-extra'}` },
                    entry.word,
                  )),
                ),
              ),
          )
          : null,
        null,
      ),
      renderTools(),
    ),
    renderFoot(),
    notesOpen
      ? h(NotesPanel, {
        t,
        bookId: book?.id ?? '',
        quote: unit.text ?? '',
        unitIndex: index,
        onClose: () => { setNotesOpen(false); },
        onJump: (target) => { onIndexChange(target); },
        onChanged: () => { setNotesVersion((value) => value + 1); },
      })
      : null,
    settingsOpen
      ? h(
        Modal,
        { title: t('reader.settings'), onClose: () => { setSettingsOpen(false); } },
        settingsPanel(),
      )
      : null,
    tocOpen ? renderToc() : null,
    card === null
      ? null
      : h(WordCard, {
        t,
        word: card.word,
        sentence: card.sentence,
        position: { x: card.x, y: card.y },
        entry: vocabEntries[normalizeWordId(card.word)],
        onClose: () => { setCard(null); },
        onSave: saveWord,
        onRemove: removeWord,
        onOpenWordList: () => { setCard(null); onOpenWordList?.(); },
      }),
    // The two floating panels live in the body: they are anchored to the
    // reader, but they must not be clipped by it.
    floating(modePanelOpen ? renderModesPanel() : null),
    floating(noteEditor === null ? null : renderNoteEditor()),
    mindMapOpen
      ? h(MindMapView, {
        t,
        scope: chapterTitle,
        data: mindMapView,
        loading: mindMapLoading,
        error: mindMapError,
        onClose: () => { setMindMapOpen(false); },
        onRegenerate: () => { void generateMindMap(); },
        onJump: jumpFromMindMap,
      })
      : null,
    podcastOpen
      ? h(PodcastView, {
        t,
        scope: chapterTitle,
        scopes: podcastScopes,
        scopeKey: podcastScope === '' ? String(chapterIndex) : podcastScope,
        onScope: (key) => { setPodcastScope(String(key)); },
        episodes: podcastEpisodes,
        activeId: podcastActiveId,
        lineIndex: podcastLine,
        playing: podcastPlaying,
        loading: podcastLoading,
        error: podcastError,
        rate,
        onClose: () => { setPodcastOpen(false); stopPodcast(); },
        onGenerate: () => { void generatePodcast(); },
        onSelect: (episodeId) => { setPodcastActiveId(episodeId); setPodcastLine(-1); },
        onPlay: (episodeId, lineIndex) => { speakPodcastLine(episodeId, lineIndex); },
        onStop: () => { stopPodcast(); },
        onRate: (next) => { setRate(next); tts.setRate(next); },
        onInterject: () => { void interject(); },
        interjecting,
        interjectError,
        onInterjectText: (text) => { void interjectText(text); },
        canRecord,
        voices: englishVoices.map((voice) => ({ id: voice.id, name: voice.name })),
        hostVoice: podcastVoices.host,
        guestVoice: podcastVoices.guest,
        onHostVoice: (id) => { setPodcastVoices((current) => ({ ...current, host: id })); },
        onGuestVoice: (id) => { setPodcastVoices((current) => ({ ...current, guest: id })); },
        onDelete: (episodeId) => {
          void removePodcast(episodeId).then(() => {
            if (podcastActiveId === episodeId) {
              setPodcastActiveId(null);
              setPodcastLine(-1);
            }
            void refreshPodcasts();
          });
        },
      })
      : null,
  );
}
