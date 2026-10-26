/**
 * The book audio podcast.
 *
 * The model writes a two-host English dialogue about the chapter that is being
 * read, and the speech engine reads that dialogue aloud line by line. The
 * engine and the episodes live in the parent, so this module owns no state at
 * all: it renders the episode list, the transcript and the player, and reports
 * every action of the learner back through the callbacks.
 *
 * The learner can also talk back: while the episode plays, the microphone
 * button lets the learner say something, and the words show up in the
 * transcript like a third voice. The recording itself belongs to the parent.
 *
 * The styles live inside this module, because the plugin stylesheet belongs to
 * somebody else. They are installed with the view and removed with it, and
 * they use the host theme tokens only, so the podcast follows the active
 * palette like the rest of the reader.
 */
import { createElement as h, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from './library.js';
import { MicIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon, TrashIcon } from './icons.js';

/** The plugin that owns the stylesheet of this module. */
const PLUGIN_ID = '@local/english-reader';

/** The speech rates the learner can pick. */
const RATES = [0.75, 1, 1.25, 1.5, 2];

/** The styles of the podcast view; host theme tokens only. */
const PODCAST_STYLE = `
.er-pod{display:flex;flex-direction:column;gap:12px;min-width:0}
.er-pod-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 12px;border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}
.er-pod-head-label{font-size:12px;color:var(--dsw-alias-label-tertiary);flex:none}
.er-pod-head-scope{flex:1;min-width:0;font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* The scope picker reuses the plugin's own select, so it looks like every
   other dropdown of the reader. */
.er-pod-head .er-pod-scope-select{flex:1;min-width:0;max-width:280px}
.er-pod-head-actions{display:flex;align-items:center;gap:8px;flex:none}
.er-pod-generate{display:inline-flex;align-items:center;gap:7px;padding:6px 12px;border-radius:var(--dsw-radius-md,8px);border:1px solid var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-bg-base);font:inherit;font-size:12px;cursor:pointer}
.er-pod-generate:hover:not(:disabled){filter:brightness(.94)}
.er-pod-generate:disabled{cursor:default;background:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary);filter:none}
.er-pod-generate:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.er-pod-generating{display:inline-flex;align-items:center;gap:7px}
.er-pod-spinner{width:11px;height:11px;flex:none;border-radius:50%;border:1.5px solid var(--dsw-alias-state-business-primary);border-top-color:transparent;animation:er-pod-spin .8s linear infinite}
@keyframes er-pod-spin{to{transform:rotate(360deg)}}
.er-pod-error{display:inline-flex;align-self:flex-start;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-state-error-primary);font-size:11.5px;line-height:1.4}
.er-pod-error::before{content:'';width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}
.er-pod-body{display:grid;grid-template-columns:minmax(210px,300px) 1fr;gap:14px;align-items:start;min-width:0}
.er-pod-column{display:flex;flex-direction:column;gap:8px;min-width:0}
.er-pod-column-title{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.er-pod-list{display:flex;flex-direction:column;gap:8px;max-height:44vh;overflow:auto;padding-right:2px}
.er-pod-episode{display:flex;align-items:flex-start;gap:8px;padding:10px 11px;border-radius:var(--dsw-radius-md,8px);border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);cursor:pointer}
.er-pod-episode:hover{background:var(--dsw-alias-interactive-bg-hover)}
.er-pod-episode.is-active{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-bg-layer-2)}
.er-pod-episode-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.er-pod-episode-title{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.er-pod-episode-scope{font-size:11px;color:var(--dsw-alias-state-business-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.er-pod-episode-summary{font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-secondary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.er-pod-episode-date{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.er-pod-episode-delete{flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:var(--dsw-radius-sm,6px);border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.er-pod-episode-delete:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-state-error-primary)}
.er-pod-transcript{display:flex;flex-direction:column;gap:8px;min-width:0}
.er-pod-lines{display:flex;flex-direction:column;gap:6px;max-height:36vh;overflow:auto;padding-right:2px}
.er-pod-line{display:flex;gap:10px;padding:7px 9px;border-radius:var(--dsw-radius-md,8px);border:1px solid transparent;cursor:pointer}
.er-pod-line:hover{background:var(--dsw-alias-interactive-bg-hover)}
.er-pod-line.is-current{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-state-business-primary);box-shadow:var(--dsw-elevation-prominent)}
.er-pod-line-speaker{flex:none;width:48px;padding-top:2px;font-size:10.5px;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.er-pod-line-speaker.is-host{color:var(--dsw-alias-state-business-primary)}
.er-pod-line-speaker.is-guest{color:var(--dsw-alias-state-success-primary)}
.er-pod-line-speaker.is-you{color:var(--dsw-alias-state-warn-primary)}
.er-pod-line-text{flex:1;min-width:0;font-size:13px;line-height:1.6;color:var(--dsw-alias-label-primary)}
.er-pod-player{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px;border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}
.er-pod-btn{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:var(--dsw-radius-md,8px);border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}
.er-pod-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.er-pod-btn:disabled{cursor:default;color:var(--dsw-alias-label-tertiary)}
.er-pod-btn-play{background:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-bg-base)}
.er-pod-btn-play:hover:not(:disabled){filter:brightness(.94)}
.er-pod-btn-play:disabled{background:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary);filter:none}
/* The microphone turns red and pulses while the learner is talking. */
.er-pod-mic.is-recording{background:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-bg-base);animation:er-pod-pulse 1.2s ease-in-out infinite}
.er-pod-mic.is-recording:hover:not(:disabled){filter:brightness(.94)}
@keyframes er-pod-pulse{0%,100%{box-shadow:0 0 0 0 var(--dsw-alias-state-error-primary)}50%{box-shadow:0 0 0 6px transparent}}
.er-pod-rate{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.er-pod-rate-select{appearance:none;-webkit-appearance:none;padding:5px 24px 5px 9px;border-radius:var(--dsw-radius-md,8px);border:1px solid var(--dsw-alias-border-l1);background-color:var(--dsw-alias-bg-layer-1);background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%);background-position:calc(100% - 13px) 52%,calc(100% - 8px) 52%;background-size:5px 5px,5px 5px;background-repeat:no-repeat;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}
.er-pod-counter{margin-left:auto;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.er-pod-empty{padding:18px 12px;border-radius:var(--dsw-radius-md,8px);border:1px dashed var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);font-size:12px;text-align:center}
/* The two voices of the show, under the episode list. */
.er-pod-voices{display:flex;flex-direction:column;gap:8px;margin-top:2px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1)}
.er-pod-voice{display:flex;flex-direction:column;gap:4px}
.er-pod-voice-label{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.er-pod-voice .er-pod-voice-select{width:100%;max-width:none}
/* Talking into the episode: the input box and the note that replaces the
   microphone when the window cannot record. */
.er-pod-talk{display:flex;flex-direction:column;gap:6px}
.er-pod-talk-note{display:inline-flex;align-self:flex-start;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-state-warn-primary);font-size:11.5px;line-height:1.4}
.er-pod-talk-note::before{content:'';width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}
.er-pod-talk-row{display:flex;align-items:center;gap:8px}
.er-pod-talk-input{flex:1;min-width:0;padding:6px 10px;border-radius:var(--dsw-radius-md,8px);border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px}
.er-pod-talk-input::placeholder{color:var(--dsw-alias-label-tertiary)}
.er-pod-talk-input:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.er-pod-talk-send{background:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-bg-base)}
.er-pod-talk-send:hover:not(:disabled){filter:brightness(.94)}
.er-pod-talk-send:disabled{background:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary);filter:none}
@media (max-width:760px){.er-pod-body{grid-template-columns:1fr}.er-pod-counter{margin-left:0}}
`;

/** The installed stylesheet, shared by every mount of the view. */
let styleElement = null;

/** How many mounts are using the stylesheet right now. */
let styleUsers = 0;

/**
 * Install the stylesheet of this module into the document head.
 *
 * The stylesheet is shared: the first mount installs it and the last unmount
 * removes it, so the plugin leaves nothing behind when the view closes.
 *
 * @returns {() => void} the cleanup
 */
function installStyles() {
  if (typeof document === 'undefined') return () => {};
  if (styleElement === null) {
    styleElement = document.createElement('style');
    styleElement.setAttribute('data-plugin', PLUGIN_ID);
    styleElement.textContent = PODCAST_STYLE;
    document.head.appendChild(styleElement);
  }
  styleUsers += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    styleUsers = Math.max(0, styleUsers - 1);
    if (styleUsers > 0 || styleElement === null) return;
    styleElement.remove();
    styleElement = null;
  };
}

/**
 * Fill `{name}` placeholders in a locale string. The locale service has no
 * interpolation of its own, so the plugin does it here.
 *
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
 * A short local date for an episode.
 *
 * @param {number} timestamp - the milliseconds since the epoch.
 * @returns {string} the date, or an empty string when there is none.
 */
function formatDate(timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The kind of the speaker of a line, used for the colour of its label.
 *
 * The learner is a speaker of their own: their words arrive as `you`.
 *
 * @param {string} speaker - the raw speaker token.
 * @returns {'host'|'guest'|'you'|'other'}
 */
function speakerKind(speaker) {
  const token = typeof speaker === 'string' ? speaker.trim().toLowerCase() : '';
  if (token === 'host') return 'host';
  if (token === 'guest') return 'guest';
  if (token === 'you') return 'you';
  return 'other';
}

/**
 * The label of the speaker of a line. The hosts and the learner get a name,
 * every other token is shown as it came in.
 *
 * @param {Function} t - translator.
 * @param {string} speaker - the raw speaker token.
 * @returns {string}
 */
function speakerLabel(t, speaker) {
  const kind = speakerKind(speaker);
  if (kind === 'host') return t('podcast.host');
  if (kind === 'guest') return t('podcast.guest');
  if (kind === 'you') return t('podcast.you');
  if (typeof speaker !== 'string' || speaker.trim() === '') return t('podcast.speakerUnknown');
  return speaker;
}

/**
 * The book audio podcast.
 *
 * The view is fully controlled by the parent: it renders the episodes, the
 * transcript of the active episode and the player, and it calls the
 * callbacks. It never fetches an episode, never stores one and never speaks.
 *
 * The new parts are optional: without `scopes` the header shows the plain
 * scope string, without `onInterject` there is no microphone button, without
 * `onInterjectText` there is no input box and without `voices` there is no
 * voice picker.
 *
 * @param {object} props
 * @param {Function} props.t - translator
 * @param {string} props.scope - what a new episode would cover
 * @param {{ key: string, label: string }[]} [props.scopes] - the scopes a new episode can cover
 * @param {string} [props.scopeKey] - the scope that is selected
 * @param {Function} [props.onScope] - pick another scope, called with its key
 * @param {object[]} props.episodes - the episodes, newest first
 * @param {string|null} props.activeId - the episode being played
 * @param {number} props.lineIndex - the line being spoken, or -1
 * @param {boolean} props.playing - whether the speech is running
 * @param {boolean} props.loading - whether an episode is being generated
 * @param {string} props.error - the message of the last failure
 * @param {number} props.rate - the speech rate
 * @param {Function} props.onClose - close the view
 * @param {Function} props.onGenerate - ask for a new episode about the scope
 * @param {Function} props.onSelect - pick an episode, called with its id
 * @param {Function} props.onPlay - play an episode from a line
 * @param {Function} props.onStop - stop the playback
 * @param {Function} props.onRate - change the speech rate
 * @param {Function} props.onDelete - remove an episode
 * @param {Function} [props.onInterject] - talk into the episode
 * @param {boolean} [props.interjecting] - whether the learner is talking now
 * @param {string} [props.interjectError] - the message of the last failure of the recording
 * @param {boolean} [props.canRecord] - whether this window can record at all
 * @param {Function} [props.onInterjectText] - hand a typed line to the parent
 * @param {{ id: string, name: string }[]} [props.voices] - the voices the show can use
 * @param {string} [props.hostVoice] - the voice of the host
 * @param {string} [props.guestVoice] - the voice of the guest
 * @param {Function} [props.onHostVoice] - pick the voice of the host
 * @param {Function} [props.onGuestVoice] - pick the voice of the guest
 * @returns {any} the element tree
 */
export function PodcastView({
  t,
  scope,
  scopes,
  scopeKey,
  onScope,
  episodes,
  activeId,
  lineIndex,
  playing,
  loading,
  error,
  rate,
  onClose,
  onGenerate,
  onSelect,
  onPlay,
  onStop,
  onRate,
  onDelete,
  onInterject,
  interjecting,
  interjectError,
  canRecord,
  onInterjectText,
  voices,
  hostVoice,
  guestVoice,
  onHostVoice,
  onGuestVoice,
}) {
  // The stylesheet lives as long as the view.
  useEffect(() => installStyles(), []);

  const list = useMemo(() => (Array.isArray(episodes) ? episodes : []), [episodes]);
  const active = useMemo(
    () => list.find((episode) => episode?.id === activeId) ?? null,
    [list, activeId],
  );
  const dialogue = useMemo(
    () => (Array.isArray(active?.dialogue) ? active.dialogue : []),
    [active],
  );
  const total = dialogue.length;
  const current = Number.isInteger(lineIndex) && lineIndex >= 0 && lineIndex < total
    ? lineIndex
    : -1;
  // Where the playback stands: the line being spoken, or the first line when
  // nothing is spoken yet.
  const position = current >= 0 ? current : 0;
  const isPlaying = playing === true;
  const isLoading = loading === true;
  const hasActive = active !== null;

  // The scopes a new episode can cover. The parent builds the labels.
  const scopeOptions = useMemo(
    () => (Array.isArray(scopes) ? scopes.filter((item) => item !== null && item !== undefined) : []),
    [scopes],
  );
  // The scope that is selected, when it is one of the scopes.
  const selectedScope = useMemo(
    () => scopeOptions.find((item) => String(item.key) === String(scopeKey)) ?? null,
    [scopeOptions, scopeKey],
  );
  // Without a scope to choose from the header falls back to the plain scope
  // string, and the learner cannot change it.
  const showScopeSelect = scopeOptions.length > 0 && selectedScope !== null;

  // The learner may talk into the episode; the recording belongs to the parent.
  // A window that cannot record shows no microphone at all: the learner types
  // the line instead.
  const canRecordHere = canRecord !== false;
  const canInterject = typeof onInterject === 'function' && canRecordHere;
  const isInterjecting = interjecting === true;

  // The typed line: the draft belongs to the panel, the words to the parent.
  const [draft, setDraft] = useState('');
  const canType = typeof onInterjectText === 'function';

  /**
   * Hand the typed line to the parent and empty the box.
   */
  const sendTalk = useCallback(() => {
    const text = draft.trim();
    if (text === '') return;
    onInterjectText?.(text);
    setDraft('');
  }, [draft, onInterjectText]);

  // The voices of the show. Without them the picker does not show at all.
  const voiceOptions = useMemo(
    () => (Array.isArray(voices) ? voices.filter((item) => item !== null && item !== undefined) : []),
    [voices],
  );
  // A voice that is not among the voices falls back to the first one, so the
  // picker never shows an empty box.
  const hostVoiceValue = voiceOptions.some((item) => String(item.id) === String(hostVoice))
    ? String(hostVoice)
    : String(voiceOptions[0]?.id ?? '');
  const guestVoiceValue = voiceOptions.some((item) => String(item.id) === String(guestVoice))
    ? String(guestVoice)
    : String(voiceOptions[0]?.id ?? '');

  // The line being spoken is kept in view.
  const lineRefs = useRef(new Map());
  useEffect(() => {
    if (current < 0) return;
    const element = lineRefs.current.get(current);
    // jsdom and some embedded views have no scrollIntoView.
    if (typeof element?.scrollIntoView === 'function') {
      element.scrollIntoView({ block: 'nearest' });
    }
  }, [current]);

  /**
   * One episode of the list.
   *
   * @param {object} episode - the episode to render.
   * @param {number} index - its position in the list.
   * @returns {any} the element tree
   */
  const renderEpisode = (episode, index) => {
    const id = episode?.id ?? '';
    const title = typeof episode?.title === 'string' && episode.title.trim() !== ''
      ? episode.title
      : t('podcast.untitled');
    const episodeScope = typeof episode?.scope === 'string' ? episode.scope : '';
    const summary = typeof episode?.summary === 'string' ? episode.summary : '';
    const date = formatDate(episode?.createdAt);
    return h(
      'div',
      {
        key: id === '' ? `episode-${index}` : id,
        className: `er-pod-episode${id === activeId ? ' is-active' : ''}`,
        'data-episode-id': String(id),
        onClick: () => { onSelect?.(id); },
      },
      h(
        'div',
        { className: 'er-pod-episode-main' },
        h('div', { className: 'er-pod-episode-title' }, title),
        episodeScope === '' ? null : h('div', { className: 'er-pod-episode-scope' }, episodeScope),
        summary === '' ? null : h('div', { className: 'er-pod-episode-summary' }, summary),
        date === '' ? null : h('div', { className: 'er-pod-episode-date' }, date),
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'er-pod-episode-delete',
          title: t('podcast.deleteEpisode'),
          'aria-label': t('podcast.deleteEpisode'),
          // The delete button lives inside the row: the row must not open the
          // episode when the learner removes it.
          onClick: (event) => {
            event.stopPropagation();
            onDelete?.(id);
          },
        },
        h(TrashIcon, { size: 13 }),
      ),
    );
  };

  /**
   * One line of the transcript.
   *
   * @param {{ speaker?: string, text?: string }} line - the line to render.
   * @param {number} index - its position in the dialogue.
   * @returns {any} the element tree
   */
  const renderLine = (line, index) => h(
    'div',
    {
      key: index,
      className: `er-pod-line${index === current ? ' is-current' : ''}`,
      'data-line-index': String(index),
      ref: (node) => {
        if (node === null || node === undefined) lineRefs.current.delete(index);
        else lineRefs.current.set(index, node);
      },
      onClick: () => { onPlay?.(activeId, index); },
    },
    h(
      'span',
      { className: `er-pod-line-speaker is-${speakerKind(line?.speaker)}` },
      speakerLabel(t, line?.speaker),
    ),
    h('span', { className: 'er-pod-line-text' }, typeof line?.text === 'string' ? line.text : ''),
  );

  const scopeText = typeof scope === 'string' && scope.trim() !== ''
    ? scope
    : t('podcast.scopeUnknown');
  const errorText = typeof error === 'string' ? error.trim() : '';
  const interjectErrorText = typeof interjectError === 'string' ? interjectError.trim() : '';
  const rateValue = Number.isFinite(Number(rate)) ? Number(rate) : 1;
  const counter = format(t('podcast.lineCounter'), { current: current >= 0 ? current + 1 : 0, total });

  return h(
    Modal,
    { title: t('podcast.title'), onClose, size: 'wide' },
    h(
      'div',
      { className: 'er-pod' },
      h(
        'div',
        { className: 'er-pod-head' },
        h('span', { className: 'er-pod-head-label' }, t('podcast.scopeLabel')),
        showScopeSelect
          ? h(
            'select',
            {
              className: 'er-select er-pod-scope-select',
              value: String(selectedScope.key),
              'aria-label': t('podcast.scopeLabel'),
              onChange: (event) => {
                // The key of the scope goes back to the parent as it came in,
                // so a parent that uses numbers is not confused by strings.
                const picked = scopeOptions.find((item) => String(item.key) === event.target.value);
                onScope?.(picked?.key ?? event.target.value);
              },
            },
            scopeOptions.map((item) => h(
              'option',
              { key: String(item.key), value: String(item.key) },
              typeof item.label === 'string' && item.label.trim() !== '' ? item.label : String(item.key),
            )),
          )
          : h('span', { className: 'er-pod-head-scope' }, scopeText),
        h(
          'div',
          { className: 'er-pod-head-actions' },
          h(
            'button',
            {
              type: 'button',
              className: 'er-pod-generate',
              disabled: isLoading,
              onClick: () => { onGenerate?.(); },
            },
            isLoading
              ? h(
                'span',
                { className: 'er-pod-generating' },
                h('span', { className: 'er-pod-spinner' }),
                t('podcast.generating'),
              )
              : h('span', { className: 'er-pod-generate-label' }, t('podcast.generate')),
          ),
        ),
      ),
      errorText === '' ? null : h('div', { className: 'er-pod-error' }, errorText),
      interjectErrorText === '' ? null : h('div', { className: 'er-pod-error' }, interjectErrorText),
      h(
        'div',
        { className: 'er-pod-body' },
        h(
          'div',
          { className: 'er-pod-column er-pod-column-list' },
          h('div', { className: 'er-pod-column-title' }, t('podcast.episodesTitle')),
          list.length === 0
            ? h('div', { className: 'er-pod-empty' }, t('podcast.emptyEpisodes'))
            : h('div', { className: 'er-pod-list' }, list.map((episode, index) => renderEpisode(episode, index))),
          voiceOptions.length === 0
            ? null
            : h(
              'div',
              { className: 'er-pod-voices' },
              h('div', { className: 'er-pod-column-title' }, t('podcast.voicesTitle')),
              h(
                'label',
                { className: 'er-pod-voice' },
                h('span', { className: 'er-pod-voice-label' }, t('podcast.hostVoice')),
                h(
                  'select',
                  {
                    className: 'er-select er-pod-voice-select',
                    value: hostVoiceValue,
                    'aria-label': t('podcast.hostVoice'),
                    onChange: (event) => {
                      // The id of the voice goes back to the parent as it came
                      // in, so a parent that uses numbers is not confused.
                      const picked = voiceOptions.find((item) => String(item.id) === event.target.value);
                      onHostVoice?.(picked?.id ?? event.target.value);
                    },
                  },
                  voiceOptions.map((item) => h(
                    'option',
                    { key: String(item.id), value: String(item.id) },
                    typeof item.name === 'string' && item.name.trim() !== '' ? item.name : String(item.id),
                  )),
                ),
              ),
              h(
                'label',
                { className: 'er-pod-voice' },
                h('span', { className: 'er-pod-voice-label' }, t('podcast.guestVoice')),
                h(
                  'select',
                  {
                    className: 'er-select er-pod-voice-select',
                    value: guestVoiceValue,
                    'aria-label': t('podcast.guestVoice'),
                    onChange: (event) => {
                      const picked = voiceOptions.find((item) => String(item.id) === event.target.value);
                      onGuestVoice?.(picked?.id ?? event.target.value);
                    },
                  },
                  voiceOptions.map((item) => h(
                    'option',
                    { key: String(item.id), value: String(item.id) },
                    typeof item.name === 'string' && item.name.trim() !== '' ? item.name : String(item.id),
                  )),
                ),
              ),
            ),
        ),
        h(
          'div',
          { className: 'er-pod-column er-pod-transcript' },
          h('div', { className: 'er-pod-column-title' }, t('podcast.transcriptTitle')),
          total === 0
            ? h('div', { className: 'er-pod-empty' }, t('podcast.emptyTranscript'))
            : h('div', { className: 'er-pod-lines' }, dialogue.map((line, index) => renderLine(line, index))),
          canType || !canRecordHere
            ? h(
              'div',
              { className: 'er-pod-talk' },
              canRecordHere
                ? null
                : h('div', { className: 'er-pod-talk-note' }, t('podcast.noRecording')),
              canType
                ? h(
                  'div',
                  { className: 'er-pod-talk-row' },
                  h('input', {
                    type: 'text',
                    className: 'er-pod-talk-input',
                    value: draft,
                    placeholder: t('podcast.typeToTalk'),
                    'aria-label': t('podcast.typeToTalk'),
                    onChange: (event) => { setDraft(event.target.value); },
                    onKeyDown: (event) => {
                      if (event.key !== 'Enter') return;
                      event.preventDefault();
                      sendTalk();
                    },
                  }),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'er-pod-btn er-pod-talk-send',
                      disabled: draft.trim() === '',
                      onClick: () => { sendTalk(); },
                    },
                    t('podcast.send'),
                  ),
                )
                : null,
            )
            : null,
          h(
            'div',
            { className: 'er-pod-player' },
            h(
              'button',
              {
                type: 'button',
                className: 'er-pod-btn er-pod-prev',
                disabled: !hasActive || position <= 0,
                title: t('podcast.prevLine'),
                'aria-label': t('podcast.prevLine'),
                onClick: () => { onPlay?.(activeId, Math.max(0, position - 1)); },
              },
              h(PrevIcon, { size: 14 }),
            ),
            h(
              'button',
              {
                type: 'button',
                className: isPlaying ? 'er-pod-btn er-pod-btn-play er-pod-stop' : 'er-pod-btn er-pod-btn-play er-pod-play',
                disabled: !hasActive,
                title: isPlaying ? t('podcast.stop') : t('podcast.play'),
                'aria-label': isPlaying ? t('podcast.stop') : t('podcast.play'),
                onClick: () => {
                  if (isPlaying) {
                    onStop?.();
                    return;
                  }
                  onPlay?.(activeId, position);
                },
              },
              isPlaying ? h(PauseIcon, { size: 14 }) : h(PlayIcon, { size: 14 }),
              h('span', { className: 'er-pod-btn-label' }, isPlaying ? t('podcast.stop') : t('podcast.play')),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'er-pod-btn er-pod-next',
                disabled: !hasActive || total === 0 || position >= total - 1,
                title: t('podcast.nextLine'),
                'aria-label': t('podcast.nextLine'),
                onClick: () => { onPlay?.(activeId, Math.min(total - 1, position + 1)); },
              },
              h(NextIcon, { size: 14 }),
            ),
            canInterject
              ? h(
                'button',
                {
                  type: 'button',
                  className: isInterjecting
                    ? 'er-pod-btn er-pod-mic is-recording'
                    : 'er-pod-btn er-pod-mic',
                  title: isInterjecting ? t('podcast.interacting') : t('podcast.interjectHint'),
                  'aria-label': isInterjecting ? t('podcast.interacting') : t('podcast.interject'),
                  // The same button starts and stops the recording: the parent
                  // knows whether it is listening already.
                  onClick: () => { onInterject(); },
                },
                h(MicIcon, { size: 14 }),
                h(
                  'span',
                  { className: 'er-pod-btn-label' },
                  isInterjecting ? t('podcast.interacting') : t('podcast.interject'),
                ),
              )
              : null,
            h(
              'label',
              { className: 'er-pod-rate' },
              h('span', { className: 'er-pod-rate-label' }, t('podcast.rate')),
              h(
                'select',
                {
                  className: 'er-pod-rate-select',
                  value: String(rateValue),
                  onChange: (event) => { onRate?.(Number(event.target.value)); },
                },
                RATES.map((value) => h('option', { key: value, value: String(value) }, `${value}x`)),
              ),
            ),
            h('span', { className: 'er-pod-counter' }, counter),
          ),
        ),
      ),
    ),
  );
}
