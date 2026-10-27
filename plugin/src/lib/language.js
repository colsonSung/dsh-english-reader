/**
 * Which language a piece of text is in.
 *
 * The reader speaks and listens. Both need to know the language of the text
 * they are working on: an English voice cannot read Chinese aloud, and an
 * English recogniser cannot hear Chinese.
 *
 * The book itself is the only signal available, so the decision is made from
 * the characters: text that contains Han characters is Chinese, everything
 * else is English.
 */

/** 汉字。 */
const HAN = /\p{Script=Han}/u;

/**
 * The language of a text.
 *
 * @param {string} text
 * @returns {'zh'|'en'}
 */
export function detectLanguage(text) {
  const value = String(text ?? '');
  if (value.trim() === '') return 'en';
  return HAN.test(value) ? 'zh' : 'en';
}

/**
 * The language of a whole book: the language most of its paragraphs are in.
 *
 * @param {{ paragraphs?: string[] }[]} chapters
 * @returns {'zh'|'en'}
 */
export function detectBookLanguage(chapters) {
  let han = 0;
  let latin = 0;
  for (const chapter of chapters ?? []) {
    for (const paragraph of chapter?.paragraphs ?? []) {
      const value = String(paragraph ?? '');
      for (const ch of value) {
        if (HAN.test(ch)) han += 1;
        else if (/[A-Za-z]/.test(ch)) latin += 1;
      }
    }
  }
  // A handful of Latin characters in a Chinese book (an ISBN, an English word)
  // must not tip the decision; the other way round, a Chinese quote inside an
  // English book must not either.
  return han > latin ? 'zh' : 'en';
}

/**
 * The BCP 47 tag the speech APIs expect.
 *
 * @param {'zh'|'en'} language
 * @returns {string}
 */
export function speechLang(language) {
  return language === 'zh' ? 'zh-CN' : 'en-US';
}

/**
 * Whether a voice speaks a given language.
 *
 * @param {{ lang?: string }} voice
 * @param {'zh'|'en'} language
 * @returns {boolean}
 */
export function voiceMatchesLanguage(voice, language) {
  const lang = String(voice?.lang ?? '').toLowerCase();
  if (lang === '') return false;
  return language === 'zh' ? lang.startsWith('zh') : lang.startsWith('en');
}
