/**
 * The plugin's stylesheet.
 *
 * Only host theme tokens are used, so the reader follows the active palette
 * and light/dark switching without a second stylesheet of its own.
 */
export const STYLE = `
.er-page{display:flex;flex-direction:column;height:100%;min-height:0;position:relative;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font,inherit);font-size:13px}
.er-toolbar{display:flex;align-items:center;gap:12px;padding:10px 18px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none}
.er-tabs{display:flex;gap:2px;padding:2px;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-2)}
.er-tab{appearance:none;border:0;border-radius:calc(var(--dsw-radius-md,8px) - 2px);padding:5px 14px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;cursor:pointer}
.er-tab:hover{background:var(--dsw-alias-interactive-bg-hover)}
.er-tab[aria-selected="true"]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-weight:500}
.er-tab:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.er-toolbar-meta{margin-left:auto;display:flex;align-items:center;gap:10px;color:var(--dsw-alias-label-tertiary);font-size:12px}
.er-body{flex:1;min-height:0;overflow:auto;padding:20px 22px 40px}
.er-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;height:100%;min-height:220px;color:var(--dsw-alias-label-tertiary);text-align:center}
.er-empty-title{font-size:15px;color:var(--dsw-alias-label-secondary)}
.er-empty-hint{font-size:12px;max-width:420px;line-height:1.7}
.er-drop{display:flex;flex-direction:column;align-items:center;gap:8px;padding:30px 20px;border:1px dashed var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);cursor:pointer;text-align:center}
.er-drop:hover,.er-drop.is-over{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-bg-layer-2)}
.er-drop:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.er-drop-title{font-size:14px;color:var(--dsw-alias-label-primary)}
.er-drop-hint{font-size:12px;color:var(--dsw-alias-label-tertiary)}
/* A notice, not a banner: the reading surface must not be interrupted by a
   full width red box. */
.er-error{display:inline-flex;align-self:flex-start;align-items:center;gap:6px;margin-top:10px;padding:5px 10px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-state-error-primary);font-size:11.5px;line-height:1.4}
.er-error::before{content:'';width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}
.er-note{margin-top:10px;padding:9px 12px;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px}
.er-books{list-style:none;margin:18px 0 0;padding:0;display:flex;flex-direction:column;gap:8px}
.er-book{display:flex;align-items:center;gap:14px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-bg-layer-1)}
.er-book-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px}
.er-book-title{font-size:14px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.er-book-meta{font-size:12px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.er-book-progress{height:3px;border-radius:2px;background:var(--dsw-alias-bg-layer-3);overflow:hidden}
.er-book-progress>span{display:block;height:100%;background:var(--dsw-alias-state-business-primary)}
.er-book-actions{display:flex;gap:6px;flex:none}
/* Filled buttons keep their fill on hover: washing them out made the light
   label unreadable. The reference app dims the fill instead. */
.er-btn{appearance:none;display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:var(--dsw-radius-md,8px);border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer;transition:background-color .12s ease,border-color .12s ease,filter .12s ease}
.er-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.er-btn:disabled{cursor:default}
.er-btn:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.er-btn-primary{background:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-bg-base)}
.er-btn-primary:hover:not(:disabled){background:var(--dsw-alias-state-business-primary);filter:brightness(.94)}
.er-btn-primary:disabled{background:var(--dsw-alias-bg-layer-3);border-color:var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary);filter:none}
.er-btn-danger:hover:not(:disabled){border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.er-btn-icon{padding:6px 8px}
.er-reader{display:flex;flex-direction:column;gap:16px;min-width:0;height:100%;min-height:0}
.er-reader-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
/* A select without an arrow does not read as a dropdown: the chevron is
   drawn with the text colour, so it follows the theme. */
.er-select{appearance:none;-webkit-appearance:none;padding:6px 26px 6px 10px;border-radius:var(--dsw-radius-md,8px);border:1px solid var(--dsw-alias-border-l1);background-color:var(--dsw-alias-bg-layer-1);background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%);background-position:calc(100% - 14px) 52%,calc(100% - 9px) 52%;background-size:5px 5px,5px 5px;background-repeat:no-repeat;color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;max-width:200px;text-overflow:ellipsis;cursor:pointer}
.er-select:hover{border-color:var(--dsw-alias-border-l2);background-color:var(--dsw-alias-interactive-bg-hover)}
.er-select:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.er-select option{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.er-counter{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.er-paragraph{font-family:Georgia,'Songti SC','Times New Roman',serif;font-size:18px;line-height:1.95;color:var(--dsw-alias-label-primary);padding:20px 22px;border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);word-break:break-word}
.er-word{display:inline-block;padding:1px 3px;border-radius:var(--dsw-radius-sm,6px);cursor:pointer;transition:background-color .12s ease,color .12s ease}
/* A Chinese character is a word of its own: the padding that spaces out an
   English word would leave a gap between every character. */
.er-word.is-cjk{padding:1px 0}
.er-word:hover{background:var(--dsw-alias-interactive-bg-hover)}
.er-word.is-spoken{background:var(--dsw-alias-bg-layer-3)}
.er-word.is-current{color:var(--dsw-alias-state-business-primary)}
.er-word.is-ok{color:var(--dsw-alias-state-success-primary)}
.er-word.is-bad{color:var(--dsw-alias-state-error-primary);text-decoration:underline wavy var(--dsw-alias-state-error-primary)}
.er-word.is-missing{color:var(--dsw-alias-state-warn-primary);text-decoration:underline dotted var(--dsw-alias-state-warn-primary)}
.er-word.is-extra{color:var(--dsw-alias-label-tertiary);text-decoration:line-through}
.er-char.is-bad-char{color:var(--dsw-alias-state-error-primary)}
.er-char.is-pending-char{color:var(--dsw-alias-label-tertiary)}
.er-type-bar{position:sticky;top:0;z-index:3;display:flex;align-items:center;gap:16px;font-size:13px;padding:6px 0;background:var(--dsw-alias-bg-base)}
.er-type-panel{position:sticky;bottom:0;z-index:3;background:var(--dsw-alias-bg-base);padding:12px 0 8px;border-top:1px solid var(--dsw-alias-border-l1)}
.er-type-metric{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}
.er-type-icon{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;padding:4px 6px;border-radius:var(--dsw-radius-sm,6px);font-size:14px;line-height:1;display:inline-flex;align-items:center}
.er-type-icon:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.er-type-icon[aria-pressed="true"]{opacity:.55}
.er-settings{display:flex;flex-direction:column;gap:10px;padding:12px 14px;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1)}
.er-setting-row{display:flex;align-items:center;gap:10px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.er-setting-label{width:88px;flex:none;color:var(--dsw-alias-label-secondary)}
.er-setting-value{width:58px;flex:none;text-align:right;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.er-setting-hint{color:var(--dsw-alias-label-tertiary);font-size:11px}
.er-input-row{display:flex;justify-content:center;padding:12px 0}
.er-input-row.is-hidden{opacity:0;height:0;padding:0;overflow:hidden;pointer-events:none}
.er-word-input{width:min(560px,100%);box-sizing:border-box;padding:10px 16px;border-radius:var(--dsw-radius-md,8px);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:20px;text-align:center}
.er-word-input:focus{outline:none;border-color:var(--dsw-alias-state-business-primary)}
.er-word-input::placeholder{color:var(--dsw-alias-label-tertiary);opacity:.55}
.er-word.is-muted{color:var(--dsw-alias-label-tertiary)}
.er-scope-label{font-size:12px;color:var(--dsw-alias-label-tertiary);margin-left:6px;align-self:center}
.er-scope{display:inline-flex;gap:2px;padding:2px;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-2);align-self:center}
.er-scope-item{appearance:none;border:0;border-radius:calc(var(--dsw-radius-md,8px) - 2px);padding:5px 12px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
.er-scope-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.er-scope-item[aria-pressed="true"]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
/* The mode row stays put while the text scrolls: the controls are always
   within reach. */
.er-modes{display:flex;gap:6px;flex-wrap:wrap;position:sticky;top:0;z-index:6;padding:8px 0;margin:-8px 0 6px;background:var(--dsw-alias-bg-base);backdrop-filter:blur(6px)}
.er-mode{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:var(--dsw-radius-md,8px);border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;cursor:pointer}
.er-mode:hover{background:var(--dsw-alias-interactive-bg-hover)}
.er-mode[aria-pressed="true"]:hover{background:var(--dsw-alias-bg-layer-1)}
.er-mode[aria-pressed="true"]{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary)}
.er-mode:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.er-panel{display:flex;flex-direction:column;gap:12px}
.er-controls{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.er-typing{width:100%;box-sizing:border-box;min-height:92px;padding:12px 14px;border-radius:var(--dsw-radius-md,8px);border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:15px;line-height:1.7;resize:vertical}
.er-typing:focus{outline:none;border-color:var(--dsw-alias-state-business-primary)}
.er-stats{display:flex;gap:18px;flex-wrap:wrap;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.er-stat{display:flex;align-items:baseline;gap:5px}
.er-stat-value{font-size:14px;color:var(--dsw-alias-label-primary)}
.er-transcript{min-height:40px;padding:10px 12px;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);font-size:14px;line-height:1.7;color:var(--dsw-alias-label-secondary)}
.er-chips{display:flex;flex-wrap:wrap;gap:6px}
.er-chip{padding:3px 8px;border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-layer-2);font-size:13px;color:var(--dsw-alias-label-secondary)}
.er-chip.is-ok{color:var(--dsw-alias-state-success-primary)}
.er-chip.is-bad{color:var(--dsw-alias-state-error-primary);background:transparent;border:1px solid var(--dsw-alias-state-error-primary)}
.er-chip.is-missing{color:var(--dsw-alias-state-warn-primary)}
.er-chip.is-extra{color:var(--dsw-alias-label-tertiary);text-decoration:line-through}
.er-toggle{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer}
.er-toggle input{accent-color:var(--dsw-alias-state-business-primary)}
.er-label{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.er-wordlist-button{display:inline-flex;align-items:center;gap:6px;flex:none;appearance:none;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md,8px);padding:4px 10px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
.er-wordlist-button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
/* The mind map and the podcast sit next to the vocabulary button. They are
   icon only: the bar is one line, and a label each would push the reading
   figures off the edge. */
.er-read-extra{width:28px;height:28px;flex:none;color:var(--dsw-alias-label-secondary)}
.er-read-extra:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.er-wordlist-count{display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-bg-base);font-size:10px;line-height:1}
.er-wordcard{position:fixed;z-index:1100;box-sizing:border-box;padding:14px 16px;border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);font-size:13px;color:var(--dsw-alias-label-primary)}
.er-wordcard-head{display:flex;align-items:flex-start;gap:10px}
.er-wordcard-word{flex:1;min-width:0;font-size:18px;font-weight:600;word-break:break-word}
.er-wordcard-actions{display:flex;gap:2px;flex:none}
.er-wordcard-icon{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;padding:3px 5px;border-radius:var(--dsw-radius-sm,6px);font-size:14px;line-height:1}
.er-wordcard-icon:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.er-wordcard-icon.is-saved{color:var(--dsw-alias-state-warn-primary)}
.er-wordcard-phonetic{margin-top:6px;font-size:13px;color:var(--dsw-alias-label-secondary)}
.er-wordcard-pos{margin-top:2px;font-size:12px;color:var(--dsw-alias-label-tertiary);font-style:italic}
.er-wordcard-definition{margin-top:8px;font-size:14px;line-height:1.6}
.er-wordcard-error{margin-top:8px;font-size:12px;color:var(--dsw-alias-state-error-primary)}
.er-wordcard-loading{margin-top:8px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.er-wordcard-examples{margin-top:10px;display:flex;flex-direction:column;gap:8px}
.er-wordcard-example{padding-left:8px;border-left:2px solid var(--dsw-alias-border-l2)}
.er-wordcard-example-en{font-size:13px;line-height:1.5}
.er-wordcard-example-zh{margin-top:2px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.er-wordcard-note{margin-top:10px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1);font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.er-wordcard-foot{margin-top:12px;display:flex;gap:8px}
.er-setting-column{align-items:flex-start;flex-direction:column;gap:6px}
.er-replacements{width:100%;box-sizing:border-box;min-height:64px;padding:8px 10px;border-radius:var(--dsw-radius-md,8px);border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.6;resize:vertical}
.er-replacements:focus{outline:none;border-color:var(--dsw-alias-state-business-primary)}
/* The drawer belongs to the plugin area: it never covers the host chrome. */
.er-wordlist{position:absolute;inset:0;z-index:1050}
.er-wordlist.is-closed{pointer-events:none}
.er-wordlist-mask{position:absolute;inset:0;background:rgba(0,0,0,.22);opacity:1;transition:opacity .22s ease}
.er-wordlist.is-closed .er-wordlist-mask{opacity:0}
.er-wordlist-panel{transform:translateX(-100%);transition:transform .24s cubic-bezier(.32,.72,0,1)}
.er-wordlist.is-open .er-wordlist-panel{transform:none}
.er-wordlist-panel{position:absolute;top:0;left:0;bottom:0;width:min(320px,88%);display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1);border-right:1px solid var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary)}
.er-wordlist-head{display:flex;align-items:center;gap:10px;padding:16px 18px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none}
.er-wordlist-title{flex:1;font-size:15px;font-weight:600;letter-spacing:.01em}
.er-wordlist-close{appearance:none;border:0;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:15px;line-height:1;cursor:pointer;width:26px;height:26px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center}
.er-wordlist-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.er-wordlist-body{flex:1;min-height:0;overflow:auto;padding:18px}
.er-wordlist-progress{display:flex;flex-direction:column;align-items:center;gap:14px;padding-bottom:18px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.er-wordlist-ring{flex:none}
.er-wordlist-ring-track{fill:none;stroke:var(--dsw-alias-border-l2);stroke-width:7}
.er-wordlist-ring-value{fill:none;stroke:var(--dsw-alias-state-business-primary);stroke-width:7;transition:stroke-dasharray .3s ease}
.er-wordlist-ring-text{fill:var(--dsw-alias-label-primary);font-size:17px;font-weight:600}
.er-wordlist-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;width:100%;text-align:center}
.er-wordlist-stat{display:flex;flex-direction:column;align-items:center;gap:3px;padding:10px 4px;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-2)}
.er-wordlist-dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--dsw-alias-label-tertiary)}
.er-wordlist-dot.is-known{background:var(--dsw-alias-state-success-primary)}
.er-wordlist-dot.is-learning{background:var(--dsw-alias-state-business-primary)}
.er-wordlist-dot.is-tolearn{background:var(--dsw-alias-label-tertiary)}
.er-wordlist-stat-label{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.er-wordlist-stat-value{font-size:19px;font-weight:600;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;line-height:1.1}
.er-wordlist-added{color:var(--dsw-alias-label-tertiary);font-size:12px;text-align:center;margin-top:2px}
.er-wordlist-review{display:flex;align-items:center;gap:10px;padding:14px 0}
.er-wordlist-review-button{flex:1;appearance:none;border:1px solid var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-bg-base);border-radius:var(--dsw-radius-md,8px);padding:9px 12px;font:inherit;font-size:13px;font-weight:500;cursor:pointer}
.er-wordlist-review-button:hover:not(:disabled){filter:brightness(.94)}
.er-wordlist-review-button:disabled{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary)}
.er-wordlist-filters{display:flex;flex-direction:column;gap:8px;padding:2px 0 14px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.er-wordlist-chips{display:flex;gap:6px;flex-wrap:wrap}
.er-wordlist-chip{appearance:none;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:5px 12px;font:inherit;font-size:12px;cursor:pointer}
.er-wordlist-chip:hover{background:var(--dsw-alias-interactive-bg-hover)}
.er-wordlist-chip.is-active{background:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-bg-base)}
.er-wordlist-searchwrap{position:relative;display:flex;align-items:center}
.er-wordlist-search-icon{position:absolute;left:9px;color:var(--dsw-alias-label-tertiary);pointer-events:none}
.er-wordlist-search{width:100%;box-sizing:border-box;padding:8px 10px 8px 30px;border-radius:var(--dsw-radius-md,8px);border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px}
.er-wordlist-search:focus{outline:none;border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-bg-layer-1)}
.er-wordlist-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.er-wordlist-row{display:flex;align-items:flex-start;gap:10px;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-1)}
.er-wordlist-row-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.er-wordlist-row-head{display:flex;align-items:baseline;gap:8px}
.er-wordlist-word{appearance:none;border:0;background:transparent;padding:0;font:inherit;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left}
.er-wordlist-word:hover{color:var(--dsw-alias-state-business-primary)}
.er-wordlist-phonetic{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.er-wordlist-definition{font-size:12px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.er-wordlist-row.is-known{border-color:var(--dsw-alias-state-success-primary)}
.er-wordlist-meta{display:flex;gap:10px;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.er-wordlist-time,.er-wordlist-book{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.er-wordlist-actions{display:flex;align-items:center;gap:4px;flex:none}
.er-wordlist-speak{display:inline-flex;align-items:center;gap:4px;appearance:none;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);border-radius:var(--dsw-radius-sm,6px);padding:3px 6px;font:inherit;font-size:11px;cursor:pointer}
.er-wordlist-speak:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.er-wordlist-speak-text{display:none}
.er-wordlist-delete{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;padding:4px;border-radius:var(--dsw-radius-sm,6px)}
.er-wordlist-delete:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-state-error-primary)}
.er-wordlist-empty{padding:36px 12px;text-align:center;font-size:12.5px;color:var(--dsw-alias-label-tertiary);line-height:1.8}
.er-wordlist-note{margin-top:10px;padding:8px 10px;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-3);font-size:12px;color:var(--dsw-alias-label-secondary)}
.er-library{display:flex;flex-direction:column;gap:14px;margin-top:16px}
.er-library-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px}
.er-library-stat{display:flex;flex-direction:column;gap:2px;padding:12px 14px;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1)}
.er-library-stat-value{font-size:18px;font-weight:600;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.er-library-stat-label{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.er-library-toolbar{display:flex;align-items:center;gap:10px}
.er-library-search{flex:1;min-width:0}
.er-library-search input{width:100%;box-sizing:border-box;padding:7px 12px;border-radius:var(--dsw-radius-md,8px);border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}
.er-library-search input:focus{outline:none;border-color:var(--dsw-alias-state-business-primary)}
.er-view-switch{display:flex;gap:2px;padding:2px;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-2)}
.er-view-switch-item{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:5px 10px;border-radius:calc(var(--dsw-radius-md,8px) - 2px);font-size:13px;line-height:1}
.er-view-switch-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.er-view-switch-item[aria-pressed="true"]:hover{background:var(--dsw-alias-bg-layer-1)}
.er-view-switch-item[aria-pressed="true"]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.er-book-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:20px 16px}
.er-book-card{display:flex;flex-direction:column;gap:6px}
.er-book-cover-button{appearance:none;border:0;background:transparent;padding:0;cursor:pointer;border-radius:var(--dsw-radius-md,8px);overflow:hidden;display:block;width:100%}
.er-cover{position:relative;width:100%;aspect-ratio:2/3;border-radius:var(--dsw-radius-md,8px);overflow:hidden;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);box-shadow:0 1px 3px rgba(0,0,0,.12)}
.er-cover-image{width:100%;height:100%;object-fit:cover;display:block}
/* A book without a cover still looks like a book: a calm gradient with the
   initials, not an empty white rectangle. */
.er-cover-fallback{width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:12px;text-align:center;font-size:30px;font-weight:600;letter-spacing:.04em;color:var(--dsw-alias-label-secondary);background:linear-gradient(150deg,var(--dsw-alias-bg-layer-3) 0%,var(--dsw-alias-bg-layer-2) 55%,var(--dsw-alias-state-business-primary) 190%)}
.er-cover-fallback::after{content:'';width:28px;height:2px;border-radius:1px;background:var(--dsw-alias-border-l2)}
.er-cover-progress{position:absolute;left:0;right:0;bottom:0;height:4px;background:rgba(0,0,0,.18)}
.er-cover-progress>span{box-shadow:0 0 6px rgba(0,0,0,.25)}
.er-cover-progress>span{display:block;height:100%;background:var(--dsw-alias-state-business-primary)}
.er-book-cover-small{width:44px;flex:none}
.er-book-card-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.er-book-card-meta{font-size:11px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.er-book-card-stats{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.er-book-card-actions{display:flex;gap:6px;margin-top:2px}
.er-book-card-actions .er-btn-primary{flex:1;justify-content:center}
.er-book-list{display:flex;flex-direction:column;gap:8px}
.er-book-stats{font-size:11px;color:var(--dsw-alias-label-tertiary)}

.er-appbar{display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none}
.er-appbar-left,.er-appbar-right{display:flex;align-items:center;gap:6px;min-width:96px}
.er-appbar-right{justify-content:flex-end}
.er-segmented{display:flex;gap:2px;margin:0 auto;padding:3px;border-radius:999px;background:var(--dsw-alias-bg-layer-2)}
.er-segmented-item{appearance:none;border:0;border-radius:999px;padding:7px 18px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;cursor:pointer}
.er-segmented-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.er-segmented-item[aria-selected="true"]:hover{background:var(--dsw-alias-bg-layer-1)}
.er-segmented-item[aria-selected="true"]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-weight:500;box-shadow:0 1px 2px rgba(0,0,0,.08)}
.er-round-button{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:15px;line-height:1;cursor:pointer}
.er-round-button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.er-library-title{text-align:center;font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary);margin:2px 0 10px}
.er-library-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:16px}
.er-library-card{padding:14px 18px;border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}
.er-library-card-label{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary);margin-bottom:6px}
.er-library-card-value{display:flex;align-items:baseline;gap:4px}
.er-library-card-number{font-size:26px;font-weight:600;line-height:1.1;font-variant-numeric:tabular-nums}
.er-library-card-number.is-read{color:var(--dsw-alias-state-warn-primary)}
.er-library-card-number.is-played{color:var(--dsw-alias-state-business-primary)}
.er-library-card-number.is-speed{color:var(--dsw-alias-state-success-primary)}
.er-library-card-unit{font-size:12px;color:var(--dsw-alias-label-secondary)}
.er-book-grid{grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:20px 16px}
.er-shelf-card{position:relative;display:flex;flex-direction:column;gap:4px}
.er-shelf-cover-button{appearance:none;border:0;background:transparent;padding:0;cursor:pointer;display:block;width:100%}
.er-shelf-cover{position:relative;width:100%;aspect-ratio:2/3;transition:transform .16s ease,box-shadow .16s ease;border-radius:var(--dsw-radius-md,8px);overflow:hidden;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);box-shadow:0 1px 3px rgba(0,0,0,.14)}
/* The two round buttons are the whole point of a cover: a learner starts the
   book from them, so they are drawn on the cover at all times instead of
   waiting for a hover. Both are discs of the panel's own surface colour, with
   the label colour for the glyph, so they follow the light and the dark
   theme; the drop shadow is what lifts them off a pale cover. The native
   button chrome is switched off, or the browser rounds the box instead of
   drawing a circle, and the corner shape is pinned to a plain circle, because
   the shell draws every box with a soft superellipse and a disc must be a
   disc. */
.er-cover-action{position:absolute;bottom:8px;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;appearance:none;-webkit-appearance:none;padding:0;border:0;border-radius:50%;corner-shape:round;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.30),0 0 0 1px var(--dsw-alias-border-l2);transition:transform .15s ease,box-shadow .15s ease}
.er-cover-action:hover{transform:scale(1.07);box-shadow:0 4px 12px rgba(0,0,0,.36),0 0 0 1px var(--dsw-alias-border-l2)}
.er-cover-action:active{transform:scale(.94)}
.er-cover-action:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
/* The play button is the bigger of the two: it carries the triangle of the
   reader's transport control. The glyph is a share of the disc, so the
   button shrinks with the cover instead of with a font size. */
.er-cover-listen{left:8px;width:34px;height:34px}
.er-cover-listen svg{width:70%;height:70%;position:relative;left:-1px}
.er-cover-menu{right:8px;width:22px;height:22px}
.er-cover-menu svg{width:62%;height:62%}
.er-shelf-card:hover .er-shelf-cover{transform:translateY(-2px);box-shadow:0 6px 16px rgba(0,0,0,.14)}
.er-shelf-title{font-size:12.5px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.er-shelf-percent{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.er-book-menu{position:absolute;z-index:20;top:100%;right:0;margin-top:4px;min-width:168px;padding:4px;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);display:flex;flex-direction:column}
.er-book-menu-top{position:absolute;top:46px;right:16px}
.er-book-menu-label{padding:6px 10px;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.er-book-menu-item{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;text-align:left;padding:7px 10px;border-radius:var(--dsw-radius-sm,6px);cursor:pointer}
.er-book-menu-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.er-book-menu-item.is-danger{color:var(--dsw-alias-state-error-primary)}
.er-book-menu-item.is-active{font-weight:600;color:var(--dsw-alias-state-business-primary)}
.er-modal-mask{position:fixed;inset:0;z-index:1200;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.35)}
.er-modal{width:min(460px,92vw);max-height:80vh;overflow:auto;padding:16px 18px;border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary)}
/* The mind map and the podcast player need more room than a form. */
.er-modal.is-wide{width:min(980px,94vw);max-height:86vh}
.er-modal-head{display:flex;align-items:center;gap:10px;margin-bottom:12px}
.er-modal-title{flex:1;font-size:14px;font-weight:600}
.er-modal-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}
.er-rename-input{width:100%;box-sizing:border-box;padding:8px 10px;border-radius:var(--dsw-radius-md,8px);border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}
.er-frequency{display:flex;flex-direction:column;gap:4px}
.er-frequency-row{display:grid;grid-template-columns:96px 1fr 40px;align-items:center;gap:8px;font-size:12px}
.er-frequency-word{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}
.er-frequency-bar{height:7px;border-radius:4px;background:var(--dsw-alias-bg-layer-3);overflow:hidden}
.er-frequency-bar>span{display:block;height:100%;background:var(--dsw-alias-state-business-primary)}
.er-frequency-count{text-align:right;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.er-details{display:flex;flex-direction:column;gap:6px}
.er-details-row{display:flex;gap:10px;font-size:12.5px}
.er-details-label{flex:none;width:110px;color:var(--dsw-alias-label-tertiary)}
.er-details-value{flex:1;color:var(--dsw-alias-label-primary)}
.er-wordlist.is-page{position:static;inset:auto;display:block}
.er-wordlist.is-page .er-wordlist-mask{display:none}
.er-wordlist.is-page .er-wordlist-panel{position:static;width:auto;height:auto;box-shadow:none;border-right:0;border-radius:0;background:transparent}
.er-wordlist.is-page .er-wordlist-head{padding:4px 24px 16px}
.er-wordlist.is-page .er-wordlist-body{overflow:visible;padding:0 24px 32px;max-width:720px;margin:0 auto;width:100%}
.er-wordlist.is-page .er-wordlist-progress{flex-direction:row;align-items:center;gap:28px;padding:20px 22px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-bg-layer-1)}
.er-wordlist.is-page .er-wordlist-stats{max-width:400px}
.er-wordlist.is-page .er-wordlist-added{text-align:left;align-self:flex-start}
.er-wordlist.is-page .er-wordlist-review-button{flex:none;padding:9px 20px}
.er-wordlist.is-page .er-wordlist-list{max-width:640px}


/* The whole tile opens the book, so the overlay sits under the two round
   buttons: a click on the play button must not fall through to it. */
.er-cover-open{position:absolute;inset:0;border:0;background:transparent;cursor:pointer;z-index:0}
.er-cover-action{z-index:2}
.er-shelf-cover .er-cover-image{z-index:0}
/* The list view shows a small cover: the two round buttons must not overlap
   each other on a thumbnail that is only 46 pixels wide. */
.er-book-cover-small{width:46px;flex:none;position:relative}
.er-book-cover-small .er-cover-action{width:17px;height:17px;bottom:3px;box-shadow:0 1px 4px rgba(0,0,0,.32),0 0 0 1px var(--dsw-alias-border-l2)}
.er-book-cover-small .er-cover-listen{left:3px}
.er-book-cover-small .er-cover-menu{right:3px}
.er-book-cover-small .er-cover-progress{height:3px}
/* In the list view the menu opens to the right of the small cover, so it is
   not cut off by the edge of the panel. */
.er-book-cover-small .er-book-menu{left:100%;right:auto;top:0;margin:0 0 0 8px}


.er-read-bar{display:flex;align-items:center;gap:12px;flex-wrap:nowrap;padding:10px 16px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none;white-space:nowrap;overflow:hidden}
.er-read-title{min-width:0;max-width:34ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:0 1 auto;font-size:14px;font-weight:500;color:var(--dsw-alias-label-primary);letter-spacing:.01em}
.er-read-stats{display:flex;align-items:center;gap:10px;margin-left:auto;flex:none}
.er-read-stat{font-size:11.5px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.er-read-stat.is-learn{color:var(--dsw-alias-state-warn-primary)}
.er-read-stat.is-known{color:var(--dsw-alias-state-success-primary)}
.er-read-main{display:flex;align-items:stretch;gap:18px;flex:1;min-height:0}
.er-read-body{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;gap:14px;overflow:auto;padding-right:4px}
/* The reading tools float as a slim card of round tiles, the way the
   reference reader does it. */
.er-read-tools{flex:none;display:flex;flex-direction:column;gap:2px;align-items:center;align-self:flex-start;position:sticky;top:4px;padding:8px 6px;border-radius:24px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);box-shadow:0 8px 22px rgba(0,0,0,.10)}
.er-read-tool{display:flex;flex-direction:column;align-items:center;gap:4px;width:60px;padding:5px 2px 4px;border-radius:16px;border:0;background:transparent}
.er-read-tool:hover{background:var(--dsw-alias-interactive-bg-hover)}
.er-read-tool[aria-pressed="true"]{color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-bg-layer-2)}
.er-read-tool:disabled{opacity:.4;cursor:default}
/* The icon sits in a soft round tile; the active one is filled. */
/* Each tool gets a soft tinted tile with a coloured glyph, the way the
   reference app draws them; the active one is the solid brand colour. */
.er-read-tool-icon{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 13%,transparent);color:var(--dsw-alias-state-business-primary);transition:background-color .15s ease,color .15s ease,transform .15s ease}
.er-read-tool:hover .er-read-tool-icon{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 22%,transparent);transform:translateY(-1px)}
.er-read-tool[aria-pressed="true"] .er-read-tool-icon{background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-bg-base)}
.er-read-tool:disabled{opacity:.45;cursor:default}
.er-read-tool:disabled:hover .er-read-tool-icon{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 13%,transparent);color:var(--dsw-alias-state-business-primary)}
.er-read-tool-label{font-size:10px;line-height:1.15;text-align:center;color:var(--dsw-alias-label-tertiary)}
.er-read-tool[aria-pressed="true"] .er-read-tool-label{color:var(--dsw-alias-state-business-primary);font-weight:500}
.er-read-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:16px;padding:10px 16px;border-top:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-bg-layer-1);flex:none}
/* The player uses round buttons, like the reference app. */
.er-read-foot .er-btn-icon,.er-round-icon{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;padding:0;border-radius:50%;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary)}
.er-read-foot .er-btn-icon:hover,.er-round-icon:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.er-round-icon[aria-pressed="true"]{background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-bg-base)}
.er-round-icon[aria-pressed="true"]:hover{background:var(--dsw-alias-state-business-primary);filter:brightness(.94);color:var(--dsw-alias-bg-base)}
.er-read-foot .er-btn-primary{display:inline-flex;align-items:center;gap:7px;border-radius:999px;padding:7px 16px 7px 13px}
.er-read-position{font-size:11.5px;color:var(--dsw-alias-label-tertiary);margin-left:6px}
.er-word.is-hard{background:rgba(240,200,60,.28);border-radius:3px;padding:1px 2px}
.er-hard-wrap{display:inline-flex;flex-direction:column;align-items:center;vertical-align:top}
.er-hard-gloss{margin-top:2px;max-width:180px;font-size:10.5px;line-height:1.35;color:var(--dsw-alias-label-tertiary);text-align:center}
.er-cloze-blank{display:inline-block;min-width:48px;border-bottom:1px dashed var(--dsw-alias-label-tertiary);color:transparent}


/* The column width follows the setting; the reading area never gets wider
   than the window. */
.er-reading-page{display:flex;flex-direction:column;gap:10px;max-width:var(--er-column-width,74ch);margin:0 auto;width:100%}
/* The reading surface leans on size and colour, not on boxes: the paragraph
   being read is large and dark, the ones around it are smaller and quiet. */
.er-page-paragraph{margin:0}
/* The context paragraphs follow the size the learner picked, a little smaller. */
.er-page-paragraph.is-context{font-size:calc(var(--er-text-size, 19px) * .82);line-height:1.85;color:var(--dsw-alias-label-tertiary);opacity:.92}
.er-page-paragraph.is-active{font-size:var(--er-text-size, 19px);line-height:2;color:var(--dsw-alias-label-primary)}
.er-sentence.is-active-sentence{background:var(--dsw-alias-bg-layer-2);border-radius:4px;box-shadow:0 0 0 3px var(--dsw-alias-bg-layer-2)}

/* Every paragraph carries a row of buttons in its right gutter: take a note,
   translate it, read it aloud. The text keeps its own column; the buttons only
   take the gutter next to it.
   The buttons lie in one row, not in a column: a column of three is taller
   than a single line of text, so it would stretch every short paragraph and
   leave a hole under it. A row is as tall as one line, so the paragraph keeps
   the height of its own text. */
.er-paragraph-row{display:flex;align-items:flex-start;gap:10px}
.er-paragraph-main{flex:1;min-width:0}
.er-paragraph-actions{flex:none;display:flex;flex-direction:row;align-items:center;gap:2px}
.er-paragraph-action{position:relative;flex:none;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;transition:opacity .15s ease,color .15s ease,background-color .15s ease}
/* The buttons wait for the pointer: they are hidden until the paragraph is
   hovered (or the button itself is focused). A touch screen has no hover,
   so there they stay where they are. */
@media (hover: hover){
  .er-paragraph-action{opacity:0}
  .er-paragraph-row:hover .er-paragraph-action,.er-paragraph-action:focus-visible{opacity:1}
}
.er-paragraph-action:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.er-paragraph-action:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
/* The buttons that already did something keep their mark: a note, a
   translation, a paragraph being read. */
.er-paragraph-action.is-noted{opacity:1;color:var(--dsw-alias-state-warn-primary)}
.er-paragraph-action.is-translated{opacity:1;color:var(--dsw-alias-state-success-primary)}
.er-paragraph-action.is-speaking{opacity:1;color:var(--dsw-alias-state-business-primary)}
.er-paragraph-note-count{position:absolute;top:-4px;right:-4px;min-width:14px;height:14px;padding:0 3px;border-radius:7px;background:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-bg-base);font-size:9px;line-height:14px;text-align:center}

/* The note editor floats next to the paragraph it belongs to. */
.er-note-editor{position:fixed;z-index:1200;box-sizing:border-box;max-height:min(62vh,460px);overflow:auto;padding:12px 14px;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);font-size:13px;color:var(--dsw-alias-label-primary)}
.er-note-editor-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.er-note-editor-title{flex:1;min-width:0;font-size:12.5px;font-weight:500;color:var(--dsw-alias-label-primary)}
.er-note-editor-close{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;padding:2px 4px;border-radius:6px;font-size:12px;line-height:1}
.er-note-editor-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.er-note-editor-quote{font-size:11.5px;line-height:1.55;color:var(--dsw-alias-label-tertiary);font-style:italic;margin-bottom:8px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.er-note-editor-input{width:100%;box-sizing:border-box;padding:8px 10px;border-radius:var(--dsw-radius-sm,6px);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;line-height:1.6;resize:vertical}
.er-note-editor-input:focus{outline:none;border-color:var(--dsw-alias-state-business-primary)}
.er-note-editor-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:8px}
.er-note-editor-list{display:flex;flex-direction:column;gap:6px;margin-top:10px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1)}
.er-note-editor-item{display:flex;align-items:flex-start;gap:8px;padding:7px 9px;border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-layer-2)}
.er-note-editor-text{flex:1;min-width:0;font-size:12px;line-height:1.55;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word}
.er-note-editor-delete{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;padding:2px;border-radius:6px;display:inline-flex;flex:none}
.er-note-editor-delete:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-state-error-primary)}
.er-note-editor-error{margin-top:8px;font-size:11.5px;color:var(--dsw-alias-state-error-primary)}


/* The learning-modes panel floats above the page: it is anchored to the tool
   that opened it and positioned in viewport coordinates, so the sticky mode
   row can never paint over it and it can never be cut off by a scroll
   container. */
.er-modes-panel{position:fixed;z-index:1200;box-sizing:border-box;max-height:min(62vh,440px);overflow:auto;padding:10px 12px;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent)}
.er-mode-row{display:flex;align-items:center;gap:10px;padding:7px 0;cursor:pointer}
.er-mode-row+.er-mode-row{border-top:1px solid var(--dsw-alias-border-l1)}
.er-mode-row-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.er-mode-row-label{font-size:12.5px;color:var(--dsw-alias-label-primary)}
.er-mode-row-hint{font-size:11px;line-height:1.35;color:var(--dsw-alias-label-tertiary)}
.er-mode-row input{accent-color:var(--dsw-alias-state-business-primary)}
.er-toc{display:flex;flex-direction:column;gap:2px;max-height:56vh;overflow:auto}
.er-toc-row{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;text-align:left;display:flex;align-items:baseline;gap:10px;padding:7px 8px;border-radius:var(--dsw-radius-sm,6px);cursor:pointer}
.er-toc-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.er-toc-row.is-current{color:var(--dsw-alias-state-business-primary);font-weight:600}
.er-toc-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.er-toc-meta{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.er-paragraph-body{margin:0}
.er-sentence{border-radius:3px;transition:filter .18s ease,background-color .18s ease;background:transparent;border:0;padding:0}
.er-sentence.is-blurred{cursor:pointer}
.er-sentence.is-revealed{filter:none}
.er-word.is-blurred-word{filter:blur(3.6px);transition:filter .18s ease}
.er-sentence.is-blurred:hover .er-word.is-blurred-word{filter:blur(1.6px)}
.er-translation{margin-top:6px;font-size:13px;line-height:1.7;color:var(--dsw-alias-label-secondary)}
.er-word.is-known{color:var(--dsw-alias-state-success-primary)}
.er-word.is-learning{color:var(--dsw-alias-state-warn-primary)}


.er-switch{position:relative;flex:none;width:34px;height:20px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);cursor:pointer;padding:0}
.er-switch::after{content:'';position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-secondary);transition:transform .15s ease,background-color .15s ease}
.er-switch[aria-checked="true"]{background:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary)}
.er-switch[aria-checked="true"]::after{transform:translateX(14px);background:var(--dsw-alias-bg-base)}


.er-translate-toggle{margin-left:6px}
.er-toc-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.er-toc-hint{font-size:11px;color:var(--dsh-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}


.er-source{display:flex;flex-direction:column;gap:12px}
.er-source-search{display:flex;gap:8px}
.er-source-search input{flex:1;min-width:0;padding:8px 10px;border-radius:var(--dsw-radius-md,8px);border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}
.er-source-search input:focus{outline:none;border-color:var(--dsw-alias-state-business-primary)}
.er-source-note{font-size:11.5px;color:var(--dsw-alias-label-tertiary);line-height:1.6}
.er-source-hint{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.er-source-list{display:flex;flex-direction:column;gap:8px;max-height:46vh;overflow:auto}
.er-source-row{display:flex;align-items:center;gap:12px;padding:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md,8px)}
.er-source-cover{width:44px;height:62px;flex:none;object-fit:cover;border-radius:4px;background:var(--dsw-alias-bg-layer-2)}
.er-source-main{flex:1;min-width:0}
.er-source-title{font-size:13.5px;font-weight:600;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.er-source-author{font-size:12px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.er-source-subjects{font-size:11px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}


.er-page-note{margin-top:14px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1);font-size:11.5px;color:var(--dsw-alias-label-tertiary);letter-spacing:.01em}
.er-page-note.is-first{margin-top:0;margin-bottom:14px;padding:0 0 10px;border-top:0;border-bottom:1px solid var(--dsw-alias-border-l1)}
.er-page-note-keys{margin-left:10px;padding-left:10px;border-left:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary);opacity:.8}


/* Feedback while the model draws a cover. */
.er-notice{display:inline-flex;align-items:center;gap:8px;align-self:flex-start;padding:7px 14px;border-radius:999px;font-size:12.5px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}
.er-notice.is-ok{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 45%,transparent);color:var(--dsw-alias-state-success-primary)}
.er-notice.is-error{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent);color:var(--dsw-alias-state-error-primary)}
.er-cover-busy{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;background:rgba(0,0,0,.55);color:#fff;font-size:11.5px;text-align:center;padding:10px}
.er-cover-spinner{width:15px;height:15px;border-radius:50%;border:2px solid currentColor;border-top-color:transparent;animation:er-spin .8s linear infinite;flex:none}
@keyframes er-spin{to{transform:rotate(360deg)}}


.er-crash{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;height:100%;text-align:center;padding:40px}
.er-crash-title{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary)}
.er-crash-hint{font-size:12.5px;color:var(--dsw-alias-label-secondary);max-width:360px;line-height:1.7}


.er-library-head{display:flex;align-items:baseline;justify-content:center;gap:10px;margin-bottom:10px}
.er-library-head .er-library-title{margin:0}
.er-library-build{font-size:10.5px;color:var(--dsw-alias-label-tertiary);opacity:.7;font-variant-numeric:tabular-nums}


.er-exit-button{width:28px;height:28px;flex:none}


.er-crash-detail{margin-top:6px;max-width:520px;padding:8px 12px;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-2);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;color:var(--dsw-alias-label-primary);word-break:break-word}
.er-crash-frame{max-width:520px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10.5px;color:var(--dsw-alias-label-tertiary);word-break:break-all}
.er-crash-actions{display:flex;gap:8px;margin-top:10px}


/* The reader's notes. */
.er-notes{display:flex;flex-direction:column;gap:14px;max-height:60vh;overflow:auto}
.er-note-new{display:flex;flex-direction:column;gap:8px}
.er-note-quote{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary);font-style:italic}
.er-note-input{width:100%;box-sizing:border-box;padding:8px 10px;border-radius:var(--dsw-radius-md,8px);border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;line-height:1.6;resize:vertical}
.er-note-input:focus{outline:none;border-color:var(--dsw-alias-state-business-primary)}
.er-note-actions{display:flex;justify-content:flex-end}
.er-notes-list{display:flex;flex-direction:column;gap:8px}
.er-note{display:flex;flex-direction:column;gap:4px;padding:10px 12px;border-radius:var(--dsw-radius-md,8px);border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}
.er-note-text{font-size:13px;line-height:1.65;color:var(--dsw-alias-label-primary);white-space:pre-wrap}
.er-note-meta{display:flex;align-items:center;gap:10px;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.er-note-link{appearance:none;border:0;background:transparent;color:var(--dsw-alias-state-business-primary);font:inherit;font-size:11px;cursor:pointer;padding:0}
.er-note-link:hover{text-decoration:underline}
.er-note-delete{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;padding:2px;border-radius:var(--dsw-radius-sm,6px);display:inline-flex}
.er-note-delete:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-state-error-primary)}
.er-notes-empty{padding:22px 8px;text-align:center;font-size:12.5px;color:var(--dsw-alias-label-tertiary)}
.er-notes-button{position:relative;width:28px;height:28px;flex:none}
.er-notes-badge{position:absolute;top:-4px;right:-4px;min-width:15px;height:15px;padding:0 3px;border-radius:8px;background:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-bg-base);font-size:9.5px;line-height:15px;text-align:center}


/* The import card: a toast at the bottom of the panel that says what the
   import is doing. It floats over the shelf, so the body gets extra room
   while it is up — the card must never hide a book. */
.er-page.is-importing .er-body{padding-bottom:112px}
.er-import{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);z-index:1300;box-sizing:border-box;display:flex;align-items:flex-start;gap:10px;width:min(420px,calc(100% - 32px));padding:11px 14px;border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);pointer-events:none}
.er-import-spinner{width:16px;height:16px;margin-top:2px;flex:none;border-radius:50%;border:2px solid var(--dsw-alias-state-business-primary);border-top-color:transparent;animation:er-spin .8s linear infinite}
.er-import-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
.er-import-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.er-import-label{font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-primary)}
.er-import-count{font-size:11.5px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.er-import-file{font-size:12px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.er-import-track{height:4px;border-radius:2px;background:var(--dsw-alias-bg-layer-3);overflow:hidden}
.er-import-bar{display:block;height:100%;border-radius:2px;background:var(--dsw-alias-state-business-primary);transition:width .25s ease}
.er-import-stage{font-size:11.5px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

`;
