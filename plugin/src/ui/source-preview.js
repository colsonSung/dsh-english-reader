/**
 * 源文件预览：把学习者导入的那份原件取回来看看。
 *
 * 书库里存的是解析之后的正文，但学习者真正拥有的东西是那个文件本身——
 * EPUB、PDF、纯文本或 HTML。这个弹窗把那份原件从宿主读回来（`fetchSourceFile`），
 * 按格式分别呈现，并且允许学习者把它下载带走：
 *
 *   - PDF：用懒加载的 pdf.js 逐页画到 canvas 上；
 *   - EPUB：解开 ZIP，按 container.xml → OPF → spine 的次序取出内容文档，
 *     在一个禁用了脚本的 iframe 里显示（书里的插图和样式表会内联进去，
 *     否则 iframe 指不到压缩包里的文件）；
 *   - TXT / MD：解成文字，放进可以滚动的 pre；
 *   - HTML：原样放进禁用了脚本的 iframe。
 *
 * 弹窗只管「看」。下载这件事交给父组件：书库里怎么存的，父组件最清楚。
 */
import { createElement as h, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { strFromU8, unzipSync } from 'fflate';

import { Modal } from './library.js';
import { fetchSourceFile, formatBytes } from '../lib/source-file.js';
import { loadChunk } from '../lib/chunks.js';
import { decodeText } from '../lib/parsers/source.js';
import {
  collapseWhitespace,
  dirname,
  findElements,
  getAttr,
  parseHtmlDocument,
  parseXhtmlDocument,
  parseXml,
  resolvePath,
} from '../lib/parsers/dom.js';

/** 预览的三种状态。 */
const STATUS_LOADING = 'loading';
const STATUS_READY = 'ready';
const STATUS_ERROR = 'error';

/** PDF 页面按这个倍率画出来。 */
const PDF_SCALE = 1.25;

/** 图片类型：按扩展名猜，猜不到就不内联。 */
const IMAGE_MIME = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jpe: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
};

/**
 * 把 `{key}` 占位符填上——locale 服务自己不做插值。
 *
 * @param {string} template - 带占位符的原文。
 * @param {Record<string, number|string>} values - 占位符的值。
 * @returns {string} 填好的文字。
 */
function format(template, values) {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    String(template ?? ''),
  );
}

/**
 * 把一个错误变成一句人话。
 *
 * @param {any} error - 抛出来的东西。
 * @returns {string} 错误说明。
 */
function messageOf(error) {
  if (error && typeof error.message === 'string' && error.message !== '') return error.message;
  return String(error ?? '');
}

/**
 * 在 chunk 的导出里找 `getDocument`。
 *
 * pdf.js 的打包方式不同，命名空间可能挂在 `default` 上，所以几种形状都试一遍。
 *
 * @param {any} pdfjs - chunk 的导出。
 * @returns {((options: any) => any) | null} 打开文档的函数。
 */
function resolveGetDocument(pdfjs) {
  if (!pdfjs) return null;
  if (typeof pdfjs.getDocument === 'function') return pdfjs.getDocument;
  if (pdfjs.default && typeof pdfjs.default.getDocument === 'function') {
    return pdfjs.default.getDocument.bind(pdfjs.default);
  }
  if (typeof pdfjs.default === 'function') return pdfjs.default;
  return null;
}

/**
 * 读出压缩包里的一个文本条目。
 *
 * @param {Record<string, Uint8Array>} entries - 解开后的条目。
 * @param {string} path - 条目的路径。
 * @returns {string | null} 文本，条目不在或不是文本时是 null。
 */
function readEntry(entries, path) {
  const entry = entries[path];
  if (!entry) return null;
  try {
    return strFromU8(entry);
  } catch {
    return null;
  }
}

/**
 * 从 `META-INF/container.xml` 里找出 OPF 的路径。
 *
 * EPUB 解析器（`src/lib/parsers/epub.js`）里有同样的逻辑，但那个函数没有导出，
 * 所以这里照着它的写法重了一份：container.xml 坏掉的书不少，属性名用正则再捞一次。
 *
 * @param {string | null} containerXml - container.xml 的内容。
 * @returns {string} OPF 在压缩包里的路径。
 */
function resolveOpfPath(containerXml) {
  if (!containerXml) {
    throw new Error('EPUB 预览失败：缺少 META-INF/container.xml');
  }
  let doc = null;
  try {
    doc = parseXml(containerXml);
  } catch {
    doc = null;
  }
  if (doc) {
    for (const rootfile of findElements(doc.documentElement, 'rootfile')) {
      const fullPath = getAttr(rootfile, 'full-path');
      if (fullPath) return resolvePath('', fullPath);
    }
  }
  const match = /full-path\s*=\s*"([^"]+)"/i.exec(containerXml);
  if (match) return resolvePath('', match[1]);
  throw new Error('EPUB 预览失败：container.xml 中没有指向 OPF 的 rootfile');
}

/**
 * 读出 OPF 里的 manifest。
 *
 * @param {any} opfDoc - 解析好的 OPF 文档。
 * @returns {{ id: string, href: string, mediaType: string }[]} 清单条目。
 */
function readManifest(opfDoc) {
  const manifest = findElements(opfDoc.documentElement, 'manifest')[0] ?? opfDoc.documentElement;
  const items = [];
  for (const item of findElements(manifest, 'item')) {
    const href = getAttr(item, 'href');
    if (!href) continue;
    items.push({
      id: getAttr(item, 'id') ?? '',
      href,
      mediaType: (getAttr(item, 'media-type') ?? '').toLowerCase(),
    });
  }
  return items;
}

/**
 * 读出 OPF 里的 spine（阅读顺序）。
 *
 * @param {any} opfDoc - 解析好的 OPF 文档。
 * @returns {{ idref: string, linear: boolean }[]} 阅读顺序里的引用。
 */
function readSpine(opfDoc) {
  const spine = findElements(opfDoc.documentElement, 'spine')[0] ?? opfDoc.documentElement;
  const refs = [];
  for (const itemref of findElements(spine, 'itemref')) {
    const idref = getAttr(itemref, 'idref');
    if (!idref) continue;
    const linear = (getAttr(itemref, 'linear') ?? 'yes').toLowerCase();
    refs.push({ idref, linear: linear !== 'no' });
  }
  return refs;
}

/**
 * 猜一个文件的图片类型。
 *
 * @param {string} path - 文件路径。
 * @returns {string} MIME 类型，猜不到时是空串。
 */
function imageMime(path) {
  const name = String(path ?? '').split('#')[0].split('?')[0];
  const dot = name.lastIndexOf('.');
  if (dot < 0) return '';
  return IMAGE_MIME[name.slice(dot + 1).toLowerCase()] ?? '';
}

/**
 * 把字节编成 base64。
 *
 * @param {Uint8Array} bytes - 字节。
 * @returns {string} base64 文本，没有 btoa 时是空串。
 */
function toBase64(bytes) {
  if (typeof globalThis.btoa !== 'function') return '';
  let binary = '';
  const step = 0x8000;
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode.apply(null, bytes.subarray(index, index + step));
  }
  try {
    return globalThis.btoa(binary);
  } catch {
    return '';
  }
}

/**
 * 取一个内容文档的标题：正文里的第一个 h1 或 h2。
 *
 * @param {string} text - 内容文档的源码。
 * @returns {string} 标题，文档里没有标题时是空串。
 */
function titleOf(text) {
  let doc = null;
  try {
    doc = parseXhtmlDocument(text);
  } catch {
    doc = null;
  }
  if (!doc || !doc.documentElement) return '';
  const heading = findElements(doc.documentElement, 'h1')[0] ?? findElements(doc.documentElement, 'h2')[0] ?? null;
  return collapseWhitespace(heading?.textContent ?? '');
}

/**
 * 把一个内容文档里的资源换成能直接显示的东西。
 *
 * EPUB 里的图片和样式表都躺在压缩包里，iframe 没有 base 地址，指不到它们。
 * 所以图片换成 data URL，样式表直接内联进文档——不然预览出来的书是没有排版的
 * 纯文字，像坏了一样。改不动的地方就原样留着。
 *
 * 这件事只在「要看的那一章」上做：一本书几百章，每章都把图片编一遍 base64
 * 太费劲了。
 *
 * @param {string} text - 内容文档的源码。
 * @param {Record<string, Uint8Array>} entries - 解开后的条目。
 * @param {string} docDir - 文档自己所在的目录。
 * @returns {string} 可以显示的文档。
 */
function inlineAssets(text, entries, docDir) {
  let doc = null;
  try {
    doc = parseXhtmlDocument(text);
  } catch {
    doc = null;
  }
  if (!doc || !doc.documentElement) return text;

  const root = doc.documentElement;
  let changed = false;

  for (const link of findElements(root, 'link')) {
    const rel = (getAttr(link, 'rel') ?? '').toLowerCase();
    if (!rel.includes('stylesheet')) continue;
    const href = getAttr(link, 'href');
    if (!href) continue;
    const css = readEntry(entries, resolvePath(docDir, href));
    if (!css) continue;
    const style = doc.createElement('style');
    style.textContent = css;
    if (!link.parentNode?.replaceChild(style, link)) continue;
    changed = true;
  }

  for (const image of findElements(root, 'img')) {
    const src = getAttr(image, 'src');
    if (!src || /^(data:|blob:|https?:|\/\/)/i.test(src)) continue;
    const path = resolvePath(docDir, src);
    const entry = entries[path];
    if (!entry || entry.length === 0) continue;
    const mime = imageMime(path);
    if (!mime) continue;
    const encoded = toBase64(entry);
    if (encoded === '') continue;
    image.setAttribute('src', `data:${mime};base64,${encoded}`);
    changed = true;
  }

  if (!changed) return text;
  return `<!DOCTYPE html>\n${root.outerHTML}`;
}

/**
 * 读出 EPUB 的内容文档（按阅读顺序）。
 *
 * @param {Uint8Array} bytes - 整个 EPUB 文件。
 * @returns {{ documents: { id: string, title: string, path: string }[],
 *   entries: Record<string, Uint8Array> }} 内容文档与解开后的条目。
 */
function readEpubDocuments(bytes) {
  let entries;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new Error('EPUB 预览失败：文件不是有效的 EPUB（无法解压）');
  }

  const opfPath = resolveOpfPath(readEntry(entries, 'META-INF/container.xml'));
  const opfText = readEntry(entries, opfPath);
  if (!opfText) throw new Error('EPUB 预览失败：找不到 OPF 文件');
  let opfDoc = null;
  try {
    opfDoc = parseXml(opfText) ?? parseHtmlDocument(opfText);
  } catch {
    opfDoc = null;
  }
  if (!opfDoc) throw new Error('EPUB 预览失败：OPF 文件无法解析');

  const opfDir = dirname(opfPath);
  const manifest = readManifest(opfDoc);
  const spine = readSpine(opfDoc);
  const byId = new Map(manifest.map((item) => [item.id, item]));

  const documents = [];
  for (const ref of spine) {
    // 脚注之类的东西不在阅读顺序里。
    if (!ref.linear) continue;
    const item = byId.get(ref.idref);
    if (!item) continue;
    const path = resolvePath(opfDir, item.href);
    const text = readEntry(entries, path);
    if (!text) continue;
    documents.push({
      id: item.id || path,
      title: titleOf(text) || item.id || path,
      path,
    });
  }
  if (documents.length === 0) throw new Error('EPUB 预览失败：没有找到可显示的章节');
  return { documents, entries };
}

/**
 * 打开一个 PDF。
 *
 * pdf.js 太大，不能打进主 bundle，所以要现加载那个 chunk；加载不到就直说，
 * 而不是让预览一直空着。
 *
 * @param {Uint8Array} bytes - PDF 的字节。
 * @returns {Promise<any>} pdf.js 的文档对象。
 */
async function loadPdfDocument(bytes) {
  let pdfjs = null;
  try {
    pdfjs = await loadChunk('./client.pdf.js');
  } catch {
    throw new Error('PDF 预览暂不可用，请改用 EPUB 或 TXT');
  }
  const getDocument = resolveGetDocument(pdfjs);
  if (!getDocument) throw new Error('PDF 预览暂不可用，请改用 EPUB 或 TXT');
  let document = null;
  try {
    // pdf.js 要一个干净的 Uint8Array：Node 的 Buffer 是它的子类，会被拒掉。
    const task = getDocument({ data: new Uint8Array(bytes) });
    document = await task.promise;
  } catch (error) {
    throw new Error(`PDF 打开失败：${messageOf(error)}`);
  }
  if (!document) throw new Error('PDF 打开失败：无法打开文档');
  return document;
}

/**
 * 源文件预览。
 *
 * @param {object} props
 * @param {Function} props.t - translator
 * @param {object} props.book - 书籍记录，`book.source` 是源文件的元信息。
 * @param {Function} props.onClose - 关闭时调用。
 * @param {Function} props.onDownload - 点下载时调用（真正下载由父组件做）。
 * @returns {any} the element tree
 */
export function SourcePreview({ t, book, onClose, onDownload }) {
  const [status, setStatus] = useState(STATUS_LOADING);
  const [error, setError] = useState('');
  const [file, setFile] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [documentIndex, setDocumentIndex] = useState(0);
  const [text, setText] = useState('');
  const [html, setHtml] = useState('');
  const [pdfDoc, setPdfDoc] = useState(null);
  const [page, setPage] = useState(1);
  const [chapterHtml, setChapterHtml] = useState('');
  const canvasRef = useRef(null);
  const pdfDocRef = useRef(null);
  const entriesRef = useRef(null);

  const sourceFormat = String(book?.source?.format ?? book?.format ?? '').toLowerCase();
  const bookId = String(book?.id ?? '');

  // 取回源文件，并按格式准备好可以显示的东西。
  useEffect(() => {
    let alive = true;
    setStatus(STATUS_LOADING);
    setError('');
    setFile(null);
    setDocuments([]);
    setDocumentIndex(0);
    setText('');
    setHtml('');
    setPdfDoc(null);
    setPage(1);
    setChapterHtml('');
    entriesRef.current = null;

    const run = async () => {
      try {
        const fetched = await fetchSourceFile(bookId);
        if (!alive) return;
        setFile(fetched);
        if (sourceFormat === 'epub') {
          const opened = readEpubDocuments(fetched.bytes);
          if (!alive) return;
          entriesRef.current = opened.entries;
          setDocuments(opened.documents);
        } else if (sourceFormat === 'txt' || sourceFormat === 'md') {
          setText(decodeText(fetched.bytes));
        } else if (sourceFormat === 'html') {
          setHtml(decodeText(fetched.bytes));
        } else if (sourceFormat === 'pdf') {
          const pdfDocument = await loadPdfDocument(fetched.bytes);
          // 弹窗已经关了，这份文档就没有人要了。
          if (!alive) {
            void pdfDocument.destroy?.();
            return;
          }
          pdfDocRef.current = pdfDocument;
          setPdfDoc(pdfDocument);
        } else {
          throw new Error(`暂不支持预览这种格式：${sourceFormat || '未知'}`);
        }
        if (!alive) return;
        setStatus(STATUS_READY);
      } catch (loadError) {
        if (!alive) return;
        setError(messageOf(loadError));
        setStatus(STATUS_ERROR);
      }
    };

    void run();
    return () => {
      alive = false;
      // 离开时把 pdf.js 的文档放掉，不然它会一直占着那份字节。
      const pdfDocument = pdfDocRef.current;
      pdfDocRef.current = null;
      if (pdfDocument) void pdfDocument.destroy?.();
    };
  }, [bookId, sourceFormat]);

  // 选中的那一章：把它的资源内联好，再交给 iframe。
  useEffect(() => {
    if (sourceFormat !== 'epub') return undefined;
    const entries = entriesRef.current;
    const chapter = documents[documentIndex];
    if (!entries || !chapter) return undefined;
    const source = readEntry(entries, chapter.path) ?? '';
    setChapterHtml(inlineAssets(source, entries, dirname(chapter.path)));
    return undefined;
  }, [sourceFormat, documents, documentIndex]);

  // 把当前页画到 canvas 上。
  useEffect(() => {
    if (pdfDoc === null) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let alive = true;
    const paint = async () => {
      try {
        const pdfPage = await pdfDoc.getPage(page);
        if (!alive) return;
        const viewport = pdfPage.getViewport({ scale: PDF_SCALE });
        const context = canvas.getContext('2d');
        if (!context) return;
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await pdfPage.render({ canvasContext: context, viewport }).promise;
      } catch (renderError) {
        if (!alive) return;
        setError(messageOf(renderError));
        setStatus(STATUS_ERROR);
      }
    };
    void paint();
    return () => { alive = false; };
  }, [pdfDoc, page, status]);

  const fileName = String(book?.source?.fileName ?? file?.fileName ?? book?.title ?? '');
  const size = Number(book?.source?.size ?? file?.bytes?.length ?? 0);
  const totalPages = Number(pdfDoc?.numPages ?? 0);

  const meta = useMemo(
    () => `${t('source.format')}：${sourceFormat.toUpperCase()} · ${t('source.size')}：${formatBytes(size)}`,
    [sourceFormat, size, t],
  );

  const selected = useMemo(
    () => documents[documentIndex] ?? null,
    [documents, documentIndex],
  );

  const changePage = useCallback((next) => {
    setPage((value) => Math.min(Math.max(1, next), Math.max(1, totalPages)));
  }, [totalPages]);

  const download = useCallback(() => {
    onDownload?.(book);
  }, [book, onDownload]);

  const close = useCallback(() => {
    onClose?.();
  }, [onClose]);

  const renderPdf = () => h(
    'div',
    { className: 'er-source-body' },
    h(
      'div',
      { className: 'er-source-nav' },
      h(
        'button',
        {
          type: 'button',
          className: 'er-btn',
          disabled: page <= 1,
          onClick: () => { changePage(page - 1); },
        },
        t('source.previousPage'),
      ),
      h('span', {}, format(t('source.page'), { current: page, total: totalPages })),
      h(
        'button',
        {
          type: 'button',
          className: 'er-btn',
          disabled: totalPages > 0 && page >= totalPages,
          onClick: () => { changePage(page + 1); },
        },
        t('source.nextPage'),
      ),
    ),
    h(
      'div',
      { className: 'er-source-pages' },
      h('canvas', { className: 'er-source-page', ref: canvasRef }),
    ),
  );

  const renderEpub = () => h(
    'div',
    { className: 'er-source-body' },
    h(
      'div',
      { className: 'er-source-nav' },
      h('span', {}, t('source.chapter')),
      h(
        'select',
        {
          className: 'er-source-picker',
          value: String(documentIndex),
          onChange: (event) => { setDocumentIndex(Number(event.target.value) || 0); },
        },
        documents.map((chapter, index) => h(
          'option',
          { key: `${chapter.id}:${index}`, value: String(index) },
          chapter.title,
        )),
      ),
    ),
    selected === null || chapterHtml === ''
      ? null
      : h('iframe', {
        className: 'er-source-frame',
        srcDoc: chapterHtml,
        // 空值 sandbox：脚本、表单、顶层跳转全部被挡掉。
        sandbox: '',
        title: selected.title,
      }),
  );

  const renderText = () => h(
    'div',
    { className: 'er-source-body' },
    h('pre', { className: 'er-source-text' }, text),
  );

  const renderHtml = () => h(
    'div',
    { className: 'er-source-body' },
    h('iframe', {
      className: 'er-source-frame',
      srcDoc: html,
      sandbox: '',
      title: fileName,
    }),
  );

  const renderContent = () => {
    if (status === STATUS_LOADING) {
      return h('div', { className: 'er-source-body' }, h('div', { className: 'er-source-loading' }, t('source.fileLoading')));
    }
    if (status === STATUS_ERROR) {
      return h(
        'div',
        { className: 'er-source-body' },
        h(
          'div',
          { className: 'er-source-error' },
          h('div', {}, t('source.failed')),
          error === '' ? null : h('div', {}, error),
        ),
      );
    }
    if (sourceFormat === 'pdf') return renderPdf();
    if (sourceFormat === 'epub') return renderEpub();
    if (sourceFormat === 'txt' || sourceFormat === 'md') return renderText();
    if (sourceFormat === 'html') return renderHtml();
    return null;
  };

  return h(
    Modal,
    { title: t('source.previewTitle'), onClose: close, size: 'wide' },
    h(
      'div',
      { className: 'er-source' },
      h(
        'div',
        { className: 'er-source-head' },
        h('div', { className: 'er-source-title', title: `${t('source.fileName')}：${fileName}` }, fileName),
        h('div', { className: 'er-source-meta' }, meta),
        h('div', { className: 'er-source-meta' }, t('source.previewNote')),
      ),
      renderContent(),
      h(
        'div',
        { className: 'er-source-foot' },
        h('button', { type: 'button', className: 'er-btn er-btn-primary', onClick: download }, t('source.download')),
        h('button', { type: 'button', className: 'er-btn', onClick: close }, t('source.close')),
      ),
    ),
  );
}
