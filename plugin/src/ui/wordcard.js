/**
 * The word card.
 *
 * Clicking a word in the reader opens this card next to the word: the word
 * itself, its pronunciation, and an AI-written dictionary entry (phonetic,
 * part of speech, Chinese definition, examples, and how the word reads in this
 * particular sentence). The word can be saved into the vocabulary list from
 * here.
 */
import { speakWord } from '../lib/speech.js';
import { createElement as h, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { askAi } from '../lib/ai.js';

const CARD_WIDTH = 340;

/**
 * Speak a word: the cloud voice first, the browser's own voice as the
 * fallback.
 * @param {string} text
 */
function speak(text) {
  void speakWord(text);
}

/**
 * The floating word card.
 * @param {object} props
 * @param {Function} props.t - translator
 * @param {string} props.word - the clicked word
 * @param {string} props.sentence - the sentence it appears in
 * @param {{ x: number, y: number }} props.position - the click position
 * @param {object|null} props.entry - the vocabulary entry, when the word is saved
 * @param {Function} props.onClose
 * @param {Function} props.onSave - called with the card data when the learner saves the word
 * @param {Function} props.onRemove - called with the word when the learner removes it
 * @param {Function} props.onOpenWordList - called when the learner opens the vocabulary list
 * @returns {any} the element tree
 */
export function WordCard({ t, word, sentence, position, entry, onClose, onSave, onRemove, onOpenWordList }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const cardRef = useRef(null);

  // Ask the host for the entry; every word gets its own request.
  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError('');
    askAi('word', { word, sentence })
      .then((result) => { if (!cancelled) setData(result ?? {}); })
      .catch((reason) => { if (!cancelled) setError(reason?.message ?? t('reader.aiFailed')); });
    return () => { cancelled = true; };
  }, [word, sentence, t]);

  // A word saved before the answer arrived keeps the phonetic and the
  // definition once the model has answered.
  useEffect(() => {
    if (data === null || entry === undefined) return;
    if ((entry.definition ?? '') === (data.definition ?? '') && (entry.phonetic ?? '') === (data.phonetic ?? '')) return;
    void onSave({ word, sentence, phonetic: data.phonetic ?? '', definition: data.definition ?? '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, entry?.id]);

  // Clicking outside closes the card, and so does Escape.
  useEffect(() => {
    const onPointerDown = (event) => {
      if (cardRef.current?.contains(event.target) === true) return;
      onClose();
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [onClose]);

  // Keep the card inside the viewport.
  const style = useMemo(() => {
    const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth;
    const viewportHeight = typeof window === 'undefined' ? 768 : window.innerHeight;
    const left = Math.max(12, Math.min(position.x - CARD_WIDTH / 2, viewportWidth - CARD_WIDTH - 12));
    const top = position.y + 18 + 320 > viewportHeight ? Math.max(12, position.y - 330) : position.y + 18;
    return { left, top, width: CARD_WIDTH };
  }, [position]);

  const saved = entry !== null && entry !== undefined;

  const card = h(
    'div',
    { ref: cardRef, className: 'er-wordcard', style },
    h(
      'div',
      { className: 'er-wordcard-head' },
      h('div', { className: 'er-wordcard-word' }, word),
      h(
        'div',
        { className: 'er-wordcard-actions' },
        h('button', { type: 'button', className: 'er-wordcard-icon', title: t('reader.speakWord'), onClick: () => { speak(word); } }, '🔊'),
        h(
          'button',
          {
            type: 'button',
            className: `er-wordcard-icon${saved ? ' is-saved' : ''}`,
            title: saved ? t('reader.removeFromVocab') : t('reader.addToVocab'),
            onClick: async () => {
              setSaving(true);
              try {
                if (saved) await onRemove(word);
                else await onSave({ word, sentence, phonetic: data?.phonetic ?? '', definition: data?.definition ?? '' });
              } finally {
                setSaving(false);
              }
            },
          },
          saved ? '★' : '☆',
        ),
        h('button', { type: 'button', className: 'er-wordcard-icon', title: t('reader.copyWord'), onClick: () => { void navigator.clipboard?.writeText(word); } }, '⧉'),
        h('button', { type: 'button', className: 'er-wordcard-icon', title: t('reader.close'), onClick: onClose }, '✕'),
      ),
    ),
    data?.phonetic ? h('div', { className: 'er-wordcard-phonetic' }, data.phonetic) : null,
    data?.partOfSpeech ? h('div', { className: 'er-wordcard-pos' }, data.partOfSpeech) : null,
    data?.definition ? h('div', { className: 'er-wordcard-definition' }, data.definition) : null,
    error ? h('div', { className: 'er-wordcard-error' }, error) : null,
    error === '' && data === null ? h('div', { className: 'er-wordcard-loading' }, t('reader.aiLoading')) : null,
    Array.isArray(data?.examples) && data.examples.length > 0
      ? h(
        'div',
        { className: 'er-wordcard-examples' },
        data.examples.slice(0, 3).map((example, index) => h(
          'div',
          { key: index, className: 'er-wordcard-example' },
          h('div', { className: 'er-wordcard-example-en' }, example.en),
          example.zh ? h('div', { className: 'er-wordcard-example-zh' }, example.zh) : null,
        )),
      )
      : null,
    data?.contextNote ? h('div', { className: 'er-wordcard-note' }, data.contextNote) : null,
    h(
      'div',
      { className: 'er-wordcard-foot' },
      h(
        'button',
        {
          type: 'button',
          className: 'er-btn',
          disabled: saving,
          onClick: async () => {
            await onSave({ word, sentence, phonetic: data?.phonetic ?? '', definition: data?.definition ?? '' });
          },
        },
        saved ? t('reader.saved') : t('reader.saveToVocab'),
      ),
      h('button', { type: 'button', className: 'er-btn', onClick: onOpenWordList }, t('reader.openWordList')),
    ),
  );

  if (typeof document === 'undefined') return card;
  return createPortal(card, document.body);
}
