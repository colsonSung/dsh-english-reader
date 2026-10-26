/**
 * The import progress model.
 *
 * Importing a book is slow: an EPUB is unzipped and parsed, a PDF is walked
 * page by page, a cover is drawn and the book is written into the local
 * store. The learner has to see that something is happening, and the bar has
 * to move honestly — a bar that jumps from 0% to 100% is worse than no bar.
 *
 * So an import is four stages, and each stage owns a slice of the whole bar:
 *
 *   read  →  parse  →  cover  →  save
 *   5%       80%        10%      5%
 *
 * The parse stage carries most of the weight because it is where the time
 * goes, and it is the only stage that reports a ratio from inside.
 *
 * This module is pure: it turns a progress record into a fraction, so both
 * the page and the card agree on what the bar means.
 */

/** The stages of an import, in the order they happen. */
export const IMPORT_STAGES = [
  { id: 'read', base: 0, span: 0.05 },
  { id: 'parse', base: 0.05, span: 0.8 },
  { id: 'cover', base: 0.85, span: 0.1 },
  { id: 'save', base: 0.95, span: 0.05 },
];

/** The stage ids, in order — the page walks them one after another. */
export const IMPORT_STAGE_IDS = IMPORT_STAGES.map((stage) => stage.id);

/**
 * The stage a record belongs to, or the first stage when it names none.
 * @param {string} stage
 * @returns {{ id: string, base: number, span: number }}
 */
function stageOf(stage) {
  return IMPORT_STAGES.find((entry) => entry.id === stage) ?? IMPORT_STAGES[0];
}

/**
 * How much of the whole import one stage is worth.
 *
 * @param {string} stage - the stage id.
 * @param {number} ratio - how far the stage is done, between 0 and 1.
 * @returns {number} a fraction between 0 and 1.
 */
export function stageFraction(stage, ratio) {
  const step = stageOf(stage);
  const value = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
  return step.base + step.span * value;
}

/**
 * The whole import as one fraction.
 *
 * Every file counts the same: the bar advances by one file's worth when a
 * file is done, so importing five books moves it in five steps.
 *
 * @param {{ index?: number, total?: number, stage?: string, ratio?: number } | null} progress
 * @returns {number} a fraction between 0 and 1.
 */
export function overallFraction(progress) {
  if (!progress) return 0;
  const total = Math.max(1, progress.total ?? 1);
  const index = Math.min(Math.max(0, progress.index ?? 0), total - 1);
  const done = (index + stageFraction(progress.stage, progress.ratio)) / total;
  return Math.min(1, Math.max(0, done));
}

/**
 * The whole import as a percentage, for the bar and the label.
 *
 * @param {object | null} progress
 * @returns {number} an integer between 0 and 100.
 */
export function progressPercent(progress) {
  return Math.round(overallFraction(progress) * 100);
}
