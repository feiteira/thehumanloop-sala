import Papa from 'papaparse';

export type CsvField = 'ignore' | 'label' | 'email' | 'phone' | 'start' | 'notes' | 'tags';

export interface CsvTable {
  header: string[];
  rows: string[][];
}

export function parseCsv(text: string): CsvTable {
  let body = text.replace(/^﻿/, '');
  // Excel may write "sep=;" on the first line to name the delimiter.
  const sep = /^sep=(.)\r?\n/i.exec(body);
  if (sep) body = body.slice(sep[0].length);
  const parsed = Papa.parse<string[]>(body, { skipEmptyLines: 'greedy', ...(sep ? { delimiter: sep[1] } : {}) });
  const [header = [], ...rows] = parsed.data;
  return { header: header.map((h) => h.trim()), rows };
}

/** Only one column can hold the start date; every other field can come from several (Name + Surname). */
export const isSingleField = (f: CsvField): boolean => f === 'start';

const FULL_NAME = /^(name|nome|nombre|patient|paciente|cliente|client|utente|full ?name|nome completo|nombre completo)$/i;
const FIRST_NAME = /^(first ?name|given ?name|primeiro nome|nome pr[oó]prio)$/i;
const SURNAME = /^(last ?name|surname|family ?name|apelidos?|[uú]ltimo nome|sobrenome|apellidos?|primer apellido|segundo apellido)$/i;
const BIRTH = /nasc|nacim|birth|\bdob\b|anivers|cumplea/i;

const GUESS: [CsvField, RegExp][] = [
  ['email', /e-?mail|correo/i],
  ['phone', /phone|telefone|tel[eé]fono|telem[oó]vel|m[oó]vil|mobile|contact/i],
  ['start', /start|in[ií]cio|inicio|desde|since|data|fecha|date/i],
  ['notes', /notes?|notas?|observa|coment/i],
  ['tags', /tags?|etiquetas?|categor/i],
];

/** The columns that make up the name: first-name and surname columns, else one full-name column. */
function nameColumns(header: string[]): Set<number> {
  const idx = (re: RegExp) => header.flatMap((h, i) => (re.test(h.trim()) ? [i] : []));
  const full = idx(FULL_NAME);
  const first = idx(FIRST_NAME);
  const last = idx(SURNAME);
  // "Nome" beside "Apelido" (or "Nombre" beside "Apellidos") is the first name.
  if (last.length) return new Set([...(first.length ? first : full.slice(0, 1)), ...last]);
  return new Set(first.length ? first : full.slice(0, 1));
}

/**
 * A first guess at which column is which, from the header names in en, pt or es. First-name
 * and surname columns together make the name, else one full-name column does. A date of birth
 * is never taken for the start date.
 */
export function guessMapping(header: string[]): CsvField[] {
  const names = nameColumns(header);
  const used = new Set<CsvField>();
  return header.map((raw, i) => {
    const h = raw.trim();
    if (names.has(i)) return 'label';
    if (FULL_NAME.test(h) || FIRST_NAME.test(h) || SURNAME.test(h) || BIRTH.test(h)) return 'ignore';
    for (const [field, re] of GUESS) {
      if (!used.has(field) && re.test(h)) {
        used.add(field);
        return field;
      }
    }
    return 'ignore';
  });
}

/** Choosing a field for one column: a single-column field moves away from the column that had it. */
export function setColumnField(mapping: CsvField[], column: number, field: CsvField): CsvField[] {
  return mapping.map((m, j) => (j === column ? field : isSingleField(field) && m === field ? 'ignore' : m));
}

export interface CsvPatient {
  label: string;
  email: string;
  phone: string;
  start: string;
  notes: string;
  tags: string[];
}

const JOIN: Record<Exclude<CsvField, 'ignore'>, string> = { label: ' ', email: ', ', phone: ' / ', start: ' ', notes: '\n', tags: ',' };

export function rowsToPatients(table: CsvTable, mapping: CsvField[]): CsvPatient[] {
  const out: CsvPatient[] = [];
  for (const row of table.rows) {
    const get = (f: Exclude<CsvField, 'ignore'>) =>
      mapping
        .map((m, i) => (m === f ? (row[i] ?? '').trim() : ''))
        .filter(Boolean)
        .join(JOIN[f]);
    const label = get('label').replace(/\s+/g, ' ');
    if (!label) continue;
    out.push({
      label,
      email: get('email'),
      phone: get('phone'),
      start: get('start'),
      notes: get('notes'),
      tags: get('tags').split(/[,;]/).map((t) => t.trim()).filter(Boolean),
    });
  }
  return out;
}
