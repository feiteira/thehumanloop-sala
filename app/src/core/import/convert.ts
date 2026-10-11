import { strFromU8, unzipSync } from 'fflate';

// Text converters that need no browser APIs. Word, PDF and OCR live in the import engines.

/** OpenDocument text → plain text with paragraph breaks and "# " headings. */
export function odtToText(bytes: Uint8Array): string {
  const files = unzipSync(bytes, { filter: (f) => f.name === 'content.xml' });
  const xml = files['content.xml'];
  if (!xml) throw new Error('not an OpenDocument text file');
  const body = strFromU8(xml);
  const out: string[] = [];
  const re = /<text:(h|p)\b[^>]*?(?:\/>|>([\s\S]*?)<\/text:\1>)/g;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    const inner = (m[2] ?? '')
      .replace(/<text:tab\/>/g, '\t')
      .replace(/<text:line-break\/>/g, '\n')
      .replace(/<text:s(?: text:c="(\d+)")?\/>/g, (_, n: string | undefined) => ' '.repeat(Number(n ?? 1)))
      .replace(/<[^>]+>/g, '');
    const text = decodeXml(inner);
    out.push(m[1] === 'h' && text.trim() ? `# ${text}` : text);
  }
  return tidy(out.join('\n\n'));
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

/** RTF → plain text. Handles paragraphs, escapes, \\uN unicode and Windows-1252 \\'hh bytes. */
export function rtfToText(src: string): string {
  const cp1252 = new TextDecoder('windows-1252');
  let out = '';
  let depth = 0;
  const skipAt: number[] = []; // group depths whose content is not body text
  let ucSkip = 1;
  let pendingSkip = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    const skipping = skipAt.length > 0;
    if (ch === '{') {
      depth++;
      if (src.startsWith('{\\*', i) || /^\{\\(fonttbl|colortbl|stylesheet|info|pict|header|footer|listtable|listoverridetable|rsidtbl|generator|themedata|datastore|latentstyles)/.test(src.slice(i, i + 24))) {
        skipAt.push(depth);
      }
      continue;
    }
    if (ch === '}') {
      if (skipAt[skipAt.length - 1] === depth) skipAt.pop();
      depth--;
      continue;
    }
    if (ch === '\\') {
      const next = src[i + 1];
      if (next === '\\' || next === '{' || next === '}') {
        if (!skipping) out += next;
        i++;
        continue;
      }
      if (next === "'") {
        const byte = parseInt(src.slice(i + 2, i + 4), 16);
        if (!skipping && pendingSkip === 0 && !Number.isNaN(byte)) out += cp1252.decode(new Uint8Array([byte]));
        if (pendingSkip > 0) pendingSkip--;
        i += 3;
        continue;
      }
      const m = /^\\([a-z]+)(-?\d+)? ?/.exec(src.slice(i, i + 40));
      if (!m) {
        i++;
        continue;
      }
      const [all, word, arg] = m;
      i += all.length - 1;
      if (skipping) continue;
      if (word === 'par' || word === 'line') out += '\n';
      else if (word === 'tab') out += '\t';
      else if (word === 'uc') ucSkip = Number(arg ?? 1);
      else if (word === 'u') {
        let code = Number(arg);
        if (code < 0) code += 65536;
        out += String.fromCharCode(code);
        pendingSkip = ucSkip;
      }
      continue;
    }
    if (ch === '\r' || ch === '\n') continue;
    if (skipping) continue;
    if (pendingSkip > 0) {
      pendingSkip--;
      continue;
    }
    out += ch;
  }
  return tidy(out);
}

export function tidy(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
