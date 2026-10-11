import mammoth from 'mammoth/mammoth.browser.js';
import * as pdfjs from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { createWorker, OEM, type Worker } from 'tesseract.js';
import { tidy } from '../../core/import/convert';

// Readers that need a browser engine (DOM, canvas, workers). All run locally from bundled
// files: nothing is fetched from the internet.

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type OcrLanguage = 'por' | 'spa' | 'eng';

export interface OcrResult {
  text: string;
  confidence: number; // 0–100
  lowWords: string[];
}

/** Word (.docx) → Markdown: headings, paragraphs, lists and emphasis; layout is dropped. */
export async function docxToMarkdown(bytes: Uint8Array): Promise<string> {
  const { value } = await mammoth.convertToHtml({ arrayBuffer: bytes.slice().buffer });
  return htmlToMarkdown(value);
}

export function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const inline = (n: Node): string => {
    if (n.nodeType === Node.TEXT_NODE) return n.textContent ?? '';
    if (!(n instanceof Element)) return '';
    const inner = [...n.childNodes].map(inline).join('');
    switch (n.tagName) {
      case 'STRONG':
      case 'B':
        return inner.trim() ? `**${inner}**` : inner;
      case 'EM':
      case 'I':
        return inner.trim() ? `*${inner}*` : inner;
      case 'BR':
        return '\n';
      default:
        return inner;
    }
  };
  const blocks: string[] = [];
  const walk = (el: Element, depth = 0) => {
    for (const child of [...el.children]) {
      const tag = child.tagName;
      if (/^H[1-6]$/.test(tag)) blocks.push(`${'#'.repeat(Number(tag[1]))} ${inline(child).trim()}`);
      else if (tag === 'P') blocks.push(inline(child).trim());
      else if (tag === 'UL' || tag === 'OL') {
        const items = [...child.children].filter((c) => c.tagName === 'LI');
        blocks.push(items.map((li, i) => `${'  '.repeat(depth)}${tag === 'OL' ? `${i + 1}.` : '-'} ${inline(li).trim()}`).join('\n'));
      } else if (tag === 'TABLE') {
        blocks.push([...child.querySelectorAll('tr')].map((tr) => [...tr.children].map((c) => inline(c).trim()).join(' | ')).join('\n'));
      } else walk(child, depth);
    }
  };
  walk(doc.body);
  return tidy(blocks.filter(Boolean).join('\n\n'));
}

/** Text from a PDF's text layer, and whether the PDF looks scanned (little or no text). */
export async function pdfText(bytes: Uint8Array): Promise<{ text: string; pages: number; scanned: boolean }> {
  const task = pdfjs.getDocument({ data: bytes.slice(), disableFontFace: true });
  const doc = await task.promise;
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let line = '';
    const lines: string[] = [];
    for (const item of content.items) {
      if (!('str' in item)) continue;
      line += item.str;
      if (item.hasEOL) {
        lines.push(line);
        line = '';
      }
    }
    if (line) lines.push(line);
    parts.push(lines.join('\n'));
  }
  const text = tidy(parts.join('\n\n'));
  await task.destroy();
  return { text, pages: parts.length, scanned: text.replace(/\s/g, '').length < 20 * Math.max(1, parts.length) };
}

/** Renders PDF pages to PNG images (for recognising scanned PDFs, and to keep beside the text). */
export async function pdfPageImages(bytes: Uint8Array, maxPages = 30): Promise<Blob[]> {
  const task = pdfjs.getDocument({ data: bytes.slice() });
  const doc = await task.promise;
  const out: Blob[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvas, viewport }).promise;
    out.push(await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('render failed'))), 'image/png')));
  }
  await task.destroy();
  return out;
}

let worker: { lang: string; w: Promise<Worker> } | null = null;

function getWorker(lang: OcrLanguage): Promise<Worker> {
  const langs = lang === 'eng' ? 'eng' : `${lang}+eng`;
  if (worker?.lang === langs) return worker.w;
  void worker?.w.then((w) => w.terminate());
  const base = new URL('ocr/', document.baseURI).href;
  worker = {
    lang: langs,
    w: createWorker(langs, OEM.LSTM_ONLY, {
      workerPath: `${base}worker.min.js`,
      corePath: `${base}core`,
      langPath: `${base}lang`,
      gzip: true,
      workerBlobURL: false,
      cacheMethod: 'none',
    }),
  };
  return worker.w;
}

/** Recognises printed (and, less reliably, handwritten) text in an image, on this computer. */
export async function recognise(image: Blob, lang: OcrLanguage): Promise<OcrResult> {
  const w = await getWorker(lang);
  const { data } = await w.recognize(image, {}, { text: true, blocks: true });
  const lowWords: string[] = [];
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const line of para.lines) {
        for (const word of line.words) if (word.confidence < 60 && word.text.trim().length > 1) lowWords.push(word.text);
      }
    }
  }
  return { text: tidy(data.text), confidence: data.confidence, lowWords };
}

export async function stopOcr(): Promise<void> {
  const w = worker;
  worker = null;
  if (w) await (await w.w).terminate();
}
