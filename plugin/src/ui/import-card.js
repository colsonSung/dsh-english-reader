/**
 * The import progress card.
 *
 * A toast at the bottom of the panel that says what the import is doing
 * right now: which file, which stage, and how far the bar has come. It never
 * blocks the shelf — the learner can keep browsing while a book is parsed.
 */
import { createElement as h } from 'react';
import { progressPercent } from '../lib/import-progress.js';

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
 * The line under the bar: where the import is right now.
 *
 * A parser that can count its own work (PDF pages, EPUB chapters) says so;
 * the others just name the stage.
 *
 * @param {Function} t - translator
 * @param {string} stage - the stage id.
 * @param {{ current?: number, total?: number, unit?: string } | null} detail
 * @returns {string}
 */
function stageLabel(t, stage, detail) {
  if (detail && detail.total > 0) {
    if (detail.unit === 'page') {
      return format(t('library.importPages'), { current: detail.current, total: detail.total });
    }
    if (detail.unit === 'chapter') {
      return format(t('library.importChapters'), { current: detail.current, total: detail.total });
    }
  }
  return t(`library.importStage.${stage}`);
}

/**
 * The import progress card.
 *
 * @param {object} props
 * @param {Function} props.t - translator
 * @param {{ name?: string, index?: number, total?: number, stage?: string,
 *   ratio?: number, detail?: object | null } | null} props.progress
 * @returns {any} the element tree
 */
export function ImportCard({ t, progress }) {
  if (progress === null || progress === undefined) return null;
  const percent = progressPercent(progress);
  const total = Math.max(1, progress.total ?? 1);
  const index = Math.min(Math.max(0, progress.index ?? 0), total - 1);
  const name = String(progress.name ?? '');
  return h(
    'div',
    { className: 'er-import', role: 'status', 'aria-live': 'polite' },
    h('span', { className: 'er-import-spinner' }),
    h(
      'div',
      { className: 'er-import-body' },
      h(
        'div',
        { className: 'er-import-head' },
        h('span', { className: 'er-import-label' }, t('library.importing')),
        h('span', { className: 'er-import-count' }, `${index + 1} / ${total}`),
      ),
      h('div', { className: 'er-import-file', title: name }, name),
      h(
        'div',
        { className: 'er-import-track' },
        h('span', { className: 'er-import-bar', style: { width: `${percent}%` } }),
      ),
      h('div', { className: 'er-import-stage' }, stageLabel(t, progress.stage ?? 'read', progress.detail ?? null)),
    ),
  );
}
