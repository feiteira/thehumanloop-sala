import { DateTime } from 'luxon';

export type DateSource = 'name' | 'text' | 'file' | 'none';

const MONTHS: Record<string, number> = {};
const NAMES: string[][] = [
  ['january', 'janeiro', 'enero', 'jan', 'ene'],
  ['february', 'fevereiro', 'febrero', 'feb', 'fev'],
  ['march', 'março', 'marco', 'marzo', 'mar'],
  ['april', 'abril', 'apr', 'abr'],
  ['may', 'maio', 'mayo', 'mai'],
  ['june', 'junho', 'junio', 'jun'],
  ['july', 'julho', 'julio', 'jul'],
  ['august', 'agosto', 'aug', 'ago'],
  ['september', 'setembro', 'septiembre', 'setiembre', 'sep', 'sept', 'set'],
  ['october', 'outubro', 'octubre', 'oct', 'out'],
  ['november', 'novembro', 'noviembre', 'nov'],
  ['december', 'dezembro', 'diciembre', 'dec', 'dez', 'dic'],
];
NAMES.forEach((names, i) => names.forEach((n) => (MONTHS[n] = i + 1)));

function valid(y: number, m: number, d: number, now: DateTime): string | null {
  if (y < 100) y += y > (now.year % 100) + 1 ? 1900 : 2000;
  if (y < 1950 || y > now.year + 1) return null;
  const dt = DateTime.fromObject({ year: y, month: m, day: d });
  return dt.isValid ? dt.toISODate() : null;
}

/** Finds the first plausible date in a string. Day-first, as written in Portugal and Spain. */
export function findDate(s: string, now: DateTime = DateTime.now()): string | null {
  const text = s.toLowerCase();
  const patterns: [RegExp, (m: RegExpExecArray) => string | null][] = [
    // 2024-03-12, 2024_03_12, 2024.03.12, 20240312
    [/(?<!\d)(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})(?!\d)/, (m) => valid(+m[1]!, +m[2]!, +m[3]!, now)],
    // 12-03-2024, 12.03.24, 12/03/2024, 12_03_2024
    [/(?<!\d)(\d{1,2})[-_./](\d{1,2})[-_./](\d{2}|\d{4})(?!\d)/, (m) => valid(+m[3]!, +m[2]!, +m[1]!, now)],
    // 12 de março de 2024, 12 March 2024, 12 mar 2024
    [/(?<!\d)(\d{1,2})(?:\.|º|ª)?\s+(?:de\s+)?([a-zçñ]+)\.?,?\s+(?:de\s+)?(\d{4})(?!\d)/, (m) => (MONTHS[m[2]!] ? valid(+m[3]!, MONTHS[m[2]!]!, +m[1]!, now) : null)],
    // March 12, 2024
    [/([a-z]+)\s+(\d{1,2}),?\s+(\d{4})(?!\d)/, (m) => (MONTHS[m[1]!] ? valid(+m[3]!, MONTHS[m[1]!]!, +m[2]!, now) : null)],
  ];
  let best: { index: number; date: string } | null = null;
  for (const [re, conv] of patterns) {
    const g = new RegExp(re.source, 'g');
    for (let m = g.exec(text); m; m = g.exec(text)) {
      const date = conv(m);
      if (date && (!best || m.index < best.index)) best = { index: m.index, date };
      if (date) break;
    }
  }
  return best?.date ?? null;
}

/** The date of an imported document: from its name, else its text, else the file's date. */
export function detectDate(fileName: string, text: string, modifiedMs: number, now: DateTime = DateTime.now()): { date: string; source: DateSource } {
  const base = fileName.replace(/\.[^.]+$/, '');
  const fromName = findDate(base, now);
  if (fromName) return { date: fromName, source: 'name' };
  const fromText = findDate(text.slice(0, 2000), now);
  if (fromText) return { date: fromText, source: 'text' };
  if (modifiedMs > 0) return { date: DateTime.fromMillis(modifiedMs).toISODate()!, source: 'file' };
  return { date: now.toISODate()!, source: 'none' };
}
