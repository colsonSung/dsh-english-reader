/**
 * The plugin's own glyphs.
 *
 * Every icon inherits the host's text color so it follows the active theme;
 * only the panel row's inactive state dims it.
 */
import { createElement as h } from 'react';

/**
 * Build a stroked SVG glyph.
 * @param {{ size?: number, className?: string, children: any[] }} options
 * @returns {any} the element tree
 */
function glyph({ size = 16, className, children }) {
  return h(
    'svg',
    {
      viewBox: '0 0 16 16',
      width: size,
      height: size,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.5,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
      className,
      style: { display: 'block', flex: 'none' },
    },
    children,
  );
}

/** An open book. */
export function BookIcon(props) {
  return glyph({
    ...props,
    children: [
      h('path', { key: 'a', d: 'M2.6 3.3h3.2c.7 0 1.3.3 1.7.8.4-.5 1-.8 1.7-.8h3.2v8.3h-3.2c-.7 0-1.3.3-1.7.8-.4-.5-1-.8-1.7-.8H2.6z' }),
      h('path', { key: 'b', d: 'M7.5 4.1v8.3' }),
    ],
  });
}

/** A speaker with sound waves. */
export function SoundIcon(props) {
  return glyph({
    ...props,
    children: [
      h('path', { key: 'a', d: 'M3.2 6.4h1.9L8 4.1v7.8l-2.9-2.3H3.2z' }),
      h('path', { key: 'b', d: 'M10.3 6.3a2.6 2.6 0 0 1 0 3.4' }),
      h('path', { key: 'c', d: 'M12.1 4.6a5 5 0 0 1 0 6.8' }),
    ],
  });
}

/** A solid triangle: play. */
export function PlayIcon(props) {
  return glyph({
    ...props,
    children: [h('path', { key: 'a', d: 'M4.8 3.2 12.4 8l-7.6 4.8z', fill: 'currentColor', stroke: 'none' })],
  });
}

/** Two bars: pause. */
export function PauseIcon(props) {
  return glyph({
    ...props,
    children: [
      h('rect', { key: 'a', x: 4.4, y: 3.4, width: 2.4, height: 9.2, rx: 0.8, fill: 'currentColor', stroke: 'none' }),
      h('rect', { key: 'b', x: 9.2, y: 3.4, width: 2.4, height: 9.2, rx: 0.8, fill: 'currentColor', stroke: 'none' }),
    ],
  });
}

/** A microphone: read aloud. */
export function MicIcon(props) {
  return glyph({
    ...props,
    children: [
      h('rect', { key: 'a', x: 6.1, y: 2.4, width: 3.8, height: 6.6, rx: 1.9 }),
      h('path', { key: 'b', d: 'M3.9 7.6a4.1 4.1 0 0 0 8.2 0' }),
      h('path', { key: 'c', d: 'M8 11.7v1.9' }),
    ],
  });
}

/** A keyboard: typing practice. */
export function KeyboardIcon(props) {
  return glyph({
    ...props,
    children: [
      h('rect', { key: 'a', x: 1.6, y: 4.2, width: 12.8, height: 7.6, rx: 1.4 }),
      h('path', { key: 'b', d: 'M4.3 6.6h.01M6.6 6.6h.01M8.9 6.6h.01M11.2 6.6h.01M5.2 9.4h5.6' }),
    ],
  });
}

/** A downward arrow into a tray: import. */
export function ImportIcon(props) {
  return glyph({
    ...props,
    children: [
      h('path', { key: 'a', d: 'M8 2.6v6.6' }),
      h('path', { key: 'b', d: 'M5.3 7 8 9.7 10.7 7' }),
      h('path', { key: 'c', d: 'M2.8 11.2v1.2a1 1 0 0 0 1 1h8.4a1 1 0 0 0 1-1v-1.2' }),
    ],
  });
}

/** A waste bin. */
export function TrashIcon(props) {
  return glyph({
    ...props,
    children: [
      h('path', { key: 'a', d: 'M2.9 4.4h10.2' }),
      h('path', { key: 'b', d: 'M6.2 4.4V3.2a.8.8 0 0 1 .8-.8h2a.8.8 0 0 1 .8.8v1.2' }),
      h('path', { key: 'c', d: 'M4.2 4.4l.6 8.2a1 1 0 0 0 1 .9h4.4a1 1 0 0 0 1-.9l.6-8.2' }),
    ],
  });
}

/** A right chevron: next sentence. */
export function NextIcon(props) {
  return glyph({
    ...props,
    children: [h('path', { key: 'a', d: 'M6 3.4 10.6 8 6 12.6' })],
  });
}

/** A left chevron: previous sentence. */
export function PrevIcon(props) {
  return glyph({
    ...props,
    children: [h('path', { key: 'a', d: 'M10 3.4 5.4 8 10 12.6' })],
  });
}

/** A circular arrow: repeat. */
export function RepeatIcon(props) {
  return glyph({
    ...props,
    children: [
      h('path', { key: 'a', d: 'M3.4 7.2A4.6 4.6 0 0 1 8 4.3h3.2' }),
      h('path', { key: 'b', d: 'M9.6 2.7 11.9 4.3 9.6 5.9' }),
      h('path', { key: 'c', d: 'M12.6 8.8A4.6 4.6 0 0 1 8 11.7H4.8' }),
      h('path', { key: 'd', d: 'M6.4 13.3 4.1 11.7 6.4 10.1' }),
    ],
  });
}

/** A highlighter: the word highlight switch. */
export function HighlighterIcon(props) {
  return glyph({
    ...props,
    children: [
      h('path', { key: 'a', d: 'M9.6 2.4 13.6 6.4 6.2 13.8H2.2v-4z' }),
      h('path', { key: 'b', d: 'M2.2 13.8h13.6' }),
    ],
  });
}

/** A dashed blank: the cloze mode. */
export function ClozeIcon(props) {
  return glyph({
    ...props,
    children: [
      h('path', { key: 'a', d: 'M2.4 11.2h11.2' }),
      h('path', { key: 'b', d: 'M4.4 7.4h7.2' }),
      h('path', { key: 'c', d: 'M2.4 3.6h11.2', 'stroke-dasharray': '2.4 2.2' }),
    ],
  });
}

/**
 * Three sliders: the settings.
 *
 * A gear drawn with rays reads as a sun at 16 pixels, so the settings use
 * the slider glyph, which stays legible when it is small.
 */
export function SettingsIcon(props) {
  return glyph({
    ...props,
    children: [
      h('path', { key: 'a', d: 'M2.6 4.4h10.8M2.6 8h10.8M2.6 11.6h10.8' }),
      h('circle', { key: 'b', cx: '5.8', cy: '4.4', r: '1.7' }),
      h('circle', { key: 'c', cx: '10.2', cy: '8', r: '1.7' }),
      h('circle', { key: 'd', cx: '5', cy: '11.6', r: '1.7' }),
    ],
  });
}

/** Three lines: the table of contents. */
export function ListIcon(props) {
  return glyph({
    ...props,
    children: [
      h('path', { key: 'a', d: 'M5.6 4h8.2M5.6 8h8.2M5.6 12h8.2' }),
      h('path', { key: 'b', d: 'M2.4 4h.8M2.4 8h.8M2.4 12h.8' }),
    ],
  });
}

/** A magnifier: search. */
export function SearchIcon(props) {
  return glyph({
    ...props,
    children: [
      h('circle', { key: 'a', cx: '7', cy: '7', r: '4.4' }),
      h('path', { key: 'b', d: 'm10.4 10.4 3 3' }),
    ],
  });
}

/** A translating "A/文": the full text translation switch. */
export function TranslateIcon(props) {
  return glyph({
    ...props,
    children: [
      h('path', { key: 'a', d: 'M2.6 4.2h5M5.1 4.2V3M4 4.2c0 2.4-1.1 4-2.6 5' }),
      h('path', { key: 'b', d: 'M3.4 9.2c1.4.9 2.6.4 3.4-1.4' }),
      h('path', { key: 'c', d: 'M7.6 3.4h6.2M7.6 6.4h6.2M7.6 9.4h6.2M7.6 12.4h4' }),
    ],
  });
}

/** An arrow leaving a frame: back to the library. */
export function ExitIcon(props) {
  return glyph({
    ...props,
    children: [
      h('path', { key: 'a', d: 'M6.4 3.4 2.6 8l3.8 4.6' }),
      h('path', { key: 'b', d: 'M2.6 8h10.8' }),
    ],
  });
}

/** A note: a page with lines on it. */
export function NoteIcon(props) {
  return glyph({
    ...props,
    children: [
      h('path', { key: 'a', d: 'M3.4 2.6h9.2v10.8l-3 2H3.4z' }),
      h('path', { key: 'b', d: 'M5.8 6h4.4M5.8 9h4.4M5.8 12h2.6' }),
    ],
  });
}
