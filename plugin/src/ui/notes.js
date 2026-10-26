/**
 * The notes panel: write a note on the sentence being read, and read back the
 * notes already taken.
 */
import { createElement as h, useCallback, useEffect, useState } from 'react';
import { addNote, listNotes, removeNote } from '../lib/notes.js';
import { Modal } from './library.js';
import { NoteIcon, TrashIcon } from './icons.js';

/**
 * Format a timestamp as a short local date and time.
 *
 * @param {number} timestamp - the milliseconds.
 * @returns {string} the formatted date.
 */
function formatTime(timestamp) {
  const date = new Date(timestamp ?? 0);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * The notes panel.
 *
 * @param {object} props
 * @param {Function} props.t - translator
 * @param {string} props.bookId - the book being read
 * @param {string} props.quote - the sentence the learner is on
 * @param {number} props.unitIndex - the position of that sentence
 * @param {Function} props.onClose
 * @param {Function} props.onJump - called with a unit index
 * @param {Function} [props.onChanged] - called when a note was written or removed
 * @returns {any} the element tree
 */
export function NotesPanel({ t, bookId, quote, unitIndex, onClose, onJump, onChanged }) {
  const [notes, setNotes] = useState([]);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    const list = await listNotes(bookId);
    setNotes(list);
  }, [bookId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const save = useCallback(async () => {
    const text = draft.trim();
    if (text === '') return;
    setSaving(true);
    try {
      await addNote({ bookId, unitIndex, quote, text });
      setDraft('');
      await refresh();
      onChanged?.();
    } finally {
      setSaving(false);
    }
  }, [bookId, draft, quote, refresh, unitIndex]);

  const drop = useCallback(async (id) => {
    await removeNote(id);
    await refresh();
    onChanged?.();
  }, [onChanged, refresh]);

  return h(
    Modal,
    { title: t('notes.title'), onClose },
    h(
      'div',
      { className: 'er-notes' },
      h(
        'div',
        { className: 'er-note-new' },
        h('div', { className: 'er-note-quote' }, quote === '' ? t('notes.noQuote') : `“${quote}”`),
        h('textarea', {
          className: 'er-note-input',
          value: draft,
          rows: 3,
          placeholder: t('notes.placeholder'),
          onChange: (event) => { setDraft(event.target.value); },
        }),
        h(
          'div',
          { className: 'er-note-actions' },
          h(
            'button',
            {
              type: 'button',
              className: 'er-btn er-btn-primary',
              disabled: saving || draft.trim() === '',
              onClick: () => { void save(); },
            },
            h(NoteIcon, { size: 14 }),
            t('notes.save'),
          ),
        ),
      ),
      notes.length === 0
        ? h('div', { className: 'er-notes-empty' }, t('notes.empty'))
        : h(
          'div',
          { className: 'er-notes-list' },
          notes.map((note) => h(
            'div',
            { key: note.id, className: 'er-note' },
            h('div', { className: 'er-note-quote' }, note.quote === '' ? '' : `“${note.quote}”`),
            h('div', { className: 'er-note-text' }, note.text),
            h(
              'div',
              { className: 'er-note-meta' },
              h('span', {}, formatTime(note.updatedAt ?? note.createdAt)),
              h(
                'button',
                {
                  type: 'button',
                  className: 'er-note-link',
                  onClick: () => { onClose?.(); onJump?.(note.unitIndex); },
                },
                t('notes.jump'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'er-note-delete',
                  title: t('notes.delete'),
                  onClick: () => { void drop(note.id); },
                },
                h(TrashIcon, { size: 13 }),
              ),
            ),
          )),
        ),
    ),
  );
}
