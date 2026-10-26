/**
 * The online library: books from an online catalogue.
 *
 * The Host holds the catalogue (it is large and must not live in the bundle),
 * so the page only asks for a list of hits and for the file itself. A book
 * that arrives is parsed by the same parser the local imports use, so the
 * shelf, the reader and the statistics do not care where a book came from.
 */
import { createElement as h, useCallback, useEffect, useState } from 'react';
import { Modal } from './library.js';
import { askSource, downloadSourceBook } from '../lib/source.js';

/**
 * The online library modal.
 *
 * @param {object} props
 * @param {Function} props.t - translator
 * @param {Function} props.onClose
 * @param {Function} props.onImported - called with the imported book
 * @returns {any} the element tree
 */
export function OnlineLibrary({ t, onClose, onImported }) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');

  const runSearch = useCallback(async (text) => {
    setLoading(true);
    setError('');
    try {
      const list = await askSource({ action: 'search', query: text, limit: 40 });
      setHits(Array.isArray(list) ? list : []);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : String(searchError));
      setHits([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // The catalogue is searched once when the panel opens.
  useEffect(() => { void runSearch(''); }, [runSearch]);

  const importBook = useCallback(async (hit) => {
    setBusyId(hit.id);
    setError('');
    try {
      const file = await downloadSourceBook(hit.id);
      await onImported(file, hit);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : String(importError));
    } finally {
      setBusyId(null);
    }
  }, [onImported]);

  return h(
    Modal,
    { title: t('source.title'), onClose },
    h(
      'div',
      { className: 'er-source' },
      h(
        'div',
        { className: 'er-source-search' },
        h('input', {
          type: 'search',
          value: query,
          placeholder: t('source.placeholder'),
          onChange: (event) => { setQuery(event.target.value); },
          onKeyDown: (event) => {
            if (event.key === 'Enter') void runSearch(query);
          },
        }),
        h(
          'button',
          { type: 'button', className: 'er-btn er-btn-primary', onClick: () => { void runSearch(query); } },
          t('source.search'),
        ),
      ),
      h('div', { className: 'er-source-note' }, t('source.note')),
      error ? h('div', { className: 'er-error' }, error) : null,
      loading ? h('div', { className: 'er-source-hint' }, t('source.loading')) : null,
      h(
        'div',
        { className: 'er-source-list' },
        hits.map((hit) => h(
          'div',
          { key: hit.id, className: 'er-source-row' },
          hit.cover === undefined
            ? null
            : h(
              'img',
              {
                className: 'er-source-cover',
                src: hit.cover,
                alt: '',
                loading: 'lazy',
                // The archive does not have a cover image for every book.
                onError: (event) => { event.currentTarget.style.visibility = 'hidden'; },
              },
            ),
          h(
            'div',
            { className: 'er-source-main' },
            h('div', { className: 'er-source-title' }, hit.title),
            h('div', { className: 'er-source-author' }, hit.author || '—'),
            h(
              'div',
              { className: 'er-source-subjects' },
              (hit.subjects ?? []).slice(0, 2).join(' · '),
            ),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'er-btn er-btn-primary',
              disabled: busyId !== null,
              onClick: () => { void importBook(hit); },
            },
            busyId === hit.id ? t('source.downloading') : t('source.get'),
          ),
        )),
      ),
    ),
  );
}
