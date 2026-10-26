# Security policy

## The short version

Your books stay on your machine. The plugin never uploads the file you
imported — it is parsed in the page and stored in the browser's IndexedDB.

It does make **two** outbound calls, and only when you ask for them:

| Call | When | What leaves your machine |
| --- | --- | --- |
| Project Gutenberg | you open the online library | a search query, then a public-domain book download |
| an AI provider | you click a word, ask for a translation, or use a cloud voice | the word, the sentence it came from, and the text you asked to be spoken |

No API key is stored in the plugin. If a MiniMax key is configured, it lives
in the environment or in a private file outside the workspace, and it is read
by the Host half only — the browser bundle never sees it.

| What | Where it lives | How to change it |
| --- | --- | --- |
| plugin bundle row | `<profile>/cordis.patch.yml` | remove the `english-reader` entry |
| your books and notes | the browser's IndexedDB, database `english-reader` | delete the site data, or remove a book from the shelf |
| MiniMax API key | `MINIMAX_API_KEY`, or `~/.dsh/english-reader/minimax.key` | delete the file; the plugin falls back to the browser's own voices |
| Gutenberg catalog cache | `~/.dsh/english-reader/gutenberg-catalog.csv` | delete it; it is re-downloaded on demand |

There is no token to rotate, because no token is issued by the plugin.

## What the plugin can reach

* **The browser's IndexedDB.** It owns the `english-reader` database: the
  book shelf, the vocabulary list and the reading notes. It reads and writes
  that database and nothing else.
* **The Host route `/api/english-reader`.** The client half posts to this
  route, which is registered through the Connection service's Fetch registry.
  The caller is authenticated with the same browser session the rest of the
  application uses. The route accepts a fixed set of methods (`word`,
  `translate`, `breakdown`, `tts`, `asr`, `cover`, `voices`, `status`,
  `source`) and rejects anything else.
* **The workspace?** No. The plugin never reads or writes workspace files.
  An imported ebook is read by the browser's own file picker, not by the
  Host.

## What it does not do

* **No telemetry, no analytics, no crash reporting.**
* **No reading of `~/.dsh/credentials.yaml` or any other credential store.**
  The only credential it looks for is its own MiniMax key, in the two places
  listed above.
* **No background processes, no scheduled tasks, no daemons.** The Gutenberg
  catalog is fetched only when the online library is opened.
* **No uploading of your books.** Import, parsing, highlighting and notes are
  all local.

## Third-party code and third-party services

* The shipped `plugin/client.pdf.js` **inlines PDF.js** (Apache-2.0) and its
  worker source. The worker is handed to PDF.js as a blob URL, so it makes no
  additional network request. `plugin/client.js` inlines no third-party
  library: React is marked external and comes from the Harness shell's own
  module table.
* **Project Gutenberg** serves the catalog and the public-domain books. The
  catalog is cached for seven days under `~/.dsh/english-reader/`.
* **MiniMax** (`api.minimaxi.com`) serves the chat model, the text-to-speech
  voice, the speech recognition and the generated book covers. The plugin
  talks to it only when a key is configured, and falls back to the browser's
  own speech synthesis and to the Harness model otherwise.

## Reporting a problem

Please report security issues privately through GitHub's
[security advisory](https://docs.github.com/en/code-security/security-advisories)
form for this repository rather than opening a public issue.
