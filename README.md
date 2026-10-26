# English Reader for DeepSeek Harness

Import an ebook, then read it sentence by sentence — **listen to it**, **type
along with the speech**, or **read aloud and check the transcript**. Your
books stay on your machine.

The plugin adds an **English Reader** panel to the left sidebar of the
DeepSeek Harness. Everything the learner uses runs in the page: the file
import, the parsing, the matching UI and the speech recognition.

> 中文说明：导入 EPUB / TXT / Markdown / HTML / PDF 后逐句精读——听朗读、跟着
> 同步语音打字、或朗读后与原文比对。书存在浏览器 IndexedDB，文件不出本机。
> 完整的中文技术文档见 [`plugin/README.md`](plugin/README.md)。

![the reader](docs/reader.png)

## What you get

| | |
| --- | --- |
| **Import** | drag in an **EPUB, TXT, Markdown, HTML or PDF**; PDF is loaded through a lazy chunk, so the first screen stays fast |
| **Library** | a shelf with cover thumbnails (or a list), search, and three read statistics: time read, time played, reading speed |
| **Per book** | listen straight from the cover, word frequency, book details, rename, delete, and an AI-drawn cover when the book has none |
| **Listen** | read the current practice unit aloud with word-level highlighting; adjustable speed (0.5x–2x) and voice, and a loop |
| **Type** | type **in place**, in the paragraph itself — the current word is highlighted, mistakes are marked red, accuracy and speed sit above, and the speech follows what you type |
| **Read aloud** | speech recognition is transcribed and aligned word by word with the original, marking what you skipped, misread or added; falls back to a recording you grade yourself |
| **Tap a word** | a word card with phonetics, part of speech, definition, examples — and how the word reads in *this* sentence, generated live |
| **Vocabulary** | star a word to keep it: a drawer with a progress ring (known / learning / to learn), today's additions, search and filters |
| **Spaced review** | a saved word enters the review queue immediately, scheduled 1 / 2 / 4 / 7 / 15 / 30 days out |
| **Online library** | search Project Gutenberg and import a public-domain book without leaving the app |
| **Notes** | a note per sentence, kept next to the book in the local database |

## The library

![library](docs/library.png)

## The vocabulary list

![vocabulary](docs/vocabulary.png)

## Install

```bash
git clone https://github.com/colsonSung/dsh-english-reader.git
cd dsh-english-reader
./install.sh              # installs into the profile of the running Harness
```

`install.sh` takes an optional profile name (`./install.sh web`) and is
idempotent. It installs the package into the profile and adds the bundle row
to `<profile>/cordis.patch.yml`. **Restart the Harness afterwards** — the
host half of a plugin is loaded at start-up.

Manual equivalent:

```bash
dsh plugin --profile web add ./plugin
```

```yaml
# <profile>/cordis.patch.yml
- insert:
    - id: english-reader
      name: 'dsh-english-reader'
```

After the restart, an **English Reader** icon appears in the left sidebar's
Global panels.

## Optional: the AI channel

Everything above works with no key at all. The browser's own Web Speech API
provides the voices, and the Harness's own model answers the word cards.

If you want the cloud voices, the speech recognition and the AI-drawn
covers, give the Host half a MiniMax key. It is read from the environment, or
from a private file outside the workspace:

```bash
export MINIMAX_API_KEY=...                          # 1. the environment
mkdir -p ~/.dsh/english-reader && echo -n '...' \
  > ~/.dsh/english-reader/minimax.key && chmod 600 \
  ~/.dsh/english-reader/minimax.key                # 2. a private file
```

The key never enters the bundle and never reaches the browser. With no key
the plugin degrades quietly: word cards fall back to the Harness model,
cloud voices fall back to the browser's.

## Optional: the online library

The 🌐 button in the library opens Project Gutenberg. The catalog is fetched
once by the Host (it is about 21 MB, so it does not belong in a bundle) and
cached under `~/.dsh/english-reader/` for seven days.

## How it works

The plugin has two halves.

The **client half** is the panel: it parses the file in the page, stores the
book in IndexedDB, renders the shelf and the reader, and drives the Web
Speech APIs. It registers one sidebar panel icon and one main page.

The **host half** owns the two things a page cannot do safely: it holds the
API key, and it talks to the provider. It registers one route,
`/api/english-reader`, through the Connection service's Fetch registry, so
the caller is authenticated with the same browser session the rest of the
application uses:

| Method | What it does |
| --- | --- |
| `word` / `translate` / `breakdown` | the AI assist answers, with the Harness model as the fallback |
| `tts` | the reading voice, synthesised by the provider |
| `asr` | the transcription of your own reading |
| `cover` | a generated book cover |
| `voices` | the available voices |
| `status` | which channels are available |
| `source` | the Gutenberg catalog search and download |

## Preview harness

The shelf and the reader can be rendered without a running Harness. The
preview mounts the real page component with a mock client context and a
seeded shelf:

```bash
cd plugin/tools/preview
node build.mjs            # → preview.bundle.js
python3 -m http.server 8080
# then open http://localhost:8080/   (add ?view=reader for the reading page)
```

IndexedDB needs a real origin, so the preview must be served over http.

## Build and test

```bash
cd plugin
pnpm install
node build.mjs                 # → client.js and client.pdf.js
node --test tests/*.test.mjs    # 155 passing
```

`client.js` and `client.pdf.js` are the shipped browser bundles and are
committed, so a clone installs without a build step. The build is only needed
after editing `plugin/src/`.

The build stamps the current time into the bundle and the page shows it, so a
window that still holds an older bundle is recognisable at a glance. That
also means `client.js` is **not** byte-reproducible across builds.

## Repository layout

```
plugin/              the DeepSeek Harness bundle
  index.js           the Host half: the /api/english-reader route
  src/client-entry.js  the client half: panel icon, page, dictionaries
  src/host/          the Host services: AI, MiniMax, Gutenberg
  src/lib/           parsers, the reading engine, the local store
  src/ui/            the shelf, the reader, the word card, the vocabulary
  tests/             155 tests over the parsers, the engine and the UI
  tools/preview/     a standalone harness that renders the reader
docs/                screenshots
install.sh           installs the bundle into a profile
```

## Known limits

* **Scanned PDFs** have no text layer to extract. The plugin says so and
  asks for an EPUB or TXT instead.
* **Speech recognition** needs the browser's Web Speech API. It works in
  Chrome and Safari; some Electron runtimes have no recognition service, and
  the plugin then degrades to "record it back and grade yourself".
* **Browsers that do not dispatch `boundary` events** (Safari, Firefox) fall
  back to an estimate for the word-level highlighting.
* **MOBI / AZW3 / FB2** are not supported: there is no reliable pure-frontend
  parser for them, so the import is refused with a clear message.
* A book with one chapter is listed by paragraph instead of by chapter.

## License

[MIT](LICENSE) © 2026 Ethan Song
