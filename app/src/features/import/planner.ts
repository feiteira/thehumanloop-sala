import { decodeText } from '../../core/bytes';
import { odtToText, rtfToText, tidy } from '../../core/import/convert';
import { type CsvField, type CsvTable, rowsToPatients } from '../../core/import/csv';
import { detectDate, findDate } from '../../core/import/dates';
import { parseIcs } from '../../core/import/ics';
import { type ImportPlan, matchFolder, type PlannedFolder, type PlannedItem, type PlanSource } from '../../core/import/plan';
import type { UiLocale } from '../../core/i18n/locales';
import { uuid } from '../../core/ids';
import { type Folder, MAX_DOCUMENT_BYTES } from '../../core/model/types';
import { parseLocalDate } from '../../core/text/dates';
import { fold } from '../../core/text/normalize';
import { baseName, mimeOf } from '../../core/text/mime';
import { type CsvDetails, type IcsDetails, kindOfFile } from '../../services/importer';
import type { FileEntry, Platform } from '../../platform/types';
import { docxToMarkdown, type OcrLanguage, pdfText, pdfPageImages, recognise } from './engines';

// Turns what the therapist picked into a plan to review. Reading happens here, on this
// computer; nothing is written to the practice until the plan is imported.

export type Status = (s: { key: 'reading' | 'recognising'; name: string; percent?: number }) => void;

export const MAX_FILE_BYTES = 100 * 1024 * 1024;

function newPlan(source: PlanSource): ImportPlan {
  return { id: uuid(), createdAt: new Date().toISOString(), folders: [], items: [], state: 'review', source };
}

/**
 * The planned folder for a name. The same name as an existing folder is added to it (the
 * therapist can still keep them separate); a likely match is only suggested.
 */
function folderFor(plan: ImportPlan, label: string, existing: Folder[]): PlannedFolder {
  const found = plan.folders.find((f) => f.label === label);
  if (found) return found;
  const { exact, similar } = matchFolder(label, existing);
  const f: PlannedFolder = { key: uuid(), label, existingId: exact?.id ?? null, suggestedId: similar?.id ?? null, include: true };
  plan.folders.push(f);
  return f;
}

function baseItem(entry: Pick<FileEntry, 'path' | 'name'>, folderKey: string | null): PlannedItem {
  return {
    id: uuid(), kind: 'page', folderKey, source: entry.path, name: entry.name, date: '', dateSource: 'none', time: null, duration: null,
    text: '', provenance: 'text', engine: null, confidence: null, keepOriginal: false, mime: mimeOf(entry.name), include: true, warning: null, done: false,
  };
}

/** Reads one file into a planned page (or document). */
export async function readFile(platform: Platform, entry: FileEntry, folderKey: string | null, lang: OcrLanguage, status: Status): Promise<PlannedItem> {
  const item = baseItem(entry, folderKey);
  const kind = kindOfFile(entry.name);
  const dated = (text: string) => {
    const d = detectDate(entry.name, text, entry.modified_ms);
    item.date = d.date;
    item.dateSource = d.source;
  };
  // Files that cannot become a page can still be kept as documents, when the therapist ticks them.
  const documentOnly = (warning: string | null, include: boolean) => {
    item.kind = 'attachment';
    item.warning = warning;
    item.include = include;
    dated('');
    return item;
  };
  if (entry.size > 0) item.size = entry.size;
  // Too large even to keep as a document: listed, but it cannot be ticked.
  if (entry.size > MAX_DOCUMENT_BYTES) return documentOnly('tooBig', false);
  if (kind === 'unsupportedImage') return documentOnly('heic', false);
  if (kind === 'attachmentOnly' || kind === 'other') {
    return documentOnly(entry.name.toLowerCase().endsWith('.doc') ? 'docLegacy' : kind === 'other' ? 'unsupported' : null, kind === 'attachmentOnly');
  }
  if (entry.size > MAX_FILE_BYTES) return documentOnly('tooLarge', false);
  status({ key: 'reading', name: entry.name });
  const bytes = await platform.files.read(entry.path);
  try {
    if (kind === 'text') {
      item.text = tidy(decodeText(bytes));
      item.provenance = 'text';
    } else if (kind === 'docx') {
      item.text = await docxToMarkdown(bytes);
      item.provenance = 'docx';
    } else if (kind === 'odt') {
      item.text = odtToText(bytes);
      item.provenance = 'odt';
    } else if (kind === 'rtf') {
      item.text = rtfToText(decodeText(bytes));
      item.provenance = 'rtf';
    } else if (kind === 'pdf') {
      const pdf = await pdfText(bytes);
      if (!pdf.scanned) {
        item.text = pdf.text;
        item.provenance = 'pdf';
        item.engine = 'pdf.js';
      } else {
        const pages = await pdfPageImages(bytes);
        const texts: string[] = [];
        let conf = 0;
        for (const [i, img] of pages.entries()) {
          status({ key: 'recognising', name: entry.name, percent: Math.round((i / pages.length) * 100) });
          const r = await recognise(img, lang);
          texts.push(r.text);
          conf += r.confidence;
        }
        item.text = texts.join('\n\n');
        item.provenance = 'ocr';
        item.engine = `tesseract.js (${lang})`;
        item.confidence = pages.length ? conf / pages.length : 0;
        item.keepOriginal = true;
      }
    } else if (kind === 'image') {
      status({ key: 'recognising', name: entry.name, percent: 0 });
      const r = await recognise(new Blob([bytes.slice()], { type: mimeOf(entry.name) }), lang);
      item.text = r.text;
      item.provenance = 'ocr';
      item.engine = `tesseract.js (${lang})`;
      item.confidence = r.confidence;
      item.keepOriginal = true;
    }
  } catch {
    item.kind = 'attachment';
    item.warning = 'unsupported';
  }
  dated(item.text);
  if (item.kind === 'page' && !item.text.trim()) {
    item.kind = 'attachment';
  }
  return item;
}

/** "Patients/Ana Silva/…": each top-level sub-folder becomes a Sala folder. */
export async function planFolderTree(platform: Platform, root: string, existing: Folder[], lang: OcrLanguage, status: Status): Promise<ImportPlan> {
  const plan = newPlan('tree');
  const entries = await platform.files.list(root, true);
  const rootLabel = baseName(root.replace(/[\\/]+$/, ''));
  const topDirs = new Map<string, string>(); // path → label
  for (const e of entries) if (e.is_dir && e.depth === 1) topDirs.set(e.path, e.name);
  for (const e of entries) {
    if (e.is_dir) continue;
    const top = [...topDirs.keys()].find((d) => e.path.startsWith(d + '/') || e.path.startsWith(d + '\\'));
    const label = top ? topDirs.get(top)! : rootLabel;
    const folder = folderFor(plan, label, existing);
    plan.items.push(await readFile(platform, e, folder.key, lang, status));
  }
  return plan;
}

/** Individual files, all going into one folder the therapist names at review. */
export async function planFiles(platform: Platform, paths: string[], existing: Folder[], lang: OcrLanguage, status: Status, targetLabel: string): Promise<ImportPlan> {
  const plan = newPlan('files');
  const folder = folderFor(plan, targetLabel, existing);
  for (const path of paths) {
    const name = baseName(path);
    const listing = await platform.files.list(path.slice(0, path.length - name.length).replace(/[\\/]$/, ''), false).catch(() => [] as FileEntry[]);
    const meta = listing.find((e) => e.path === path);
    plan.items.push(await readFile(platform, { path, name, is_dir: false, size: meta?.size ?? 0, modified_ms: meta?.modified_ms ?? 0, depth: 1 }, folder.key, lang, status));
  }
  return plan;
}

/** A patient list: one folder per row. A folder that already exists is updated only when ticked. */
export function planCsv(table: CsvTable, mapping: CsvField[], existing: Folder[], source: string): ImportPlan {
  const plan = newPlan('csv');
  for (const p of rowsToPatients(table, mapping)) {
    const folder = folderFor(plan, p.label, existing);
    const item = baseItem({ path: source, name: p.label }, folder.key);
    item.kind = 'folder';
    item.provenance = 'csv';
    item.mime = 'text/csv';
    item.date = p.start ? (findDate(p.start) ?? '') : '';
    if (p.start && !item.date) item.warning = 'startUnread';
    const details: CsvDetails = { email: p.email, phone: p.phone, notes: p.notes, tags: p.tags, start: p.start };
    item.text = JSON.stringify(details);
    item.include = !folder.existingId;
    folder.include = item.include;
    plan.items.push(item);
  }
  return plan;
}

/**
 * Calendar events. An event whose title is a folder's name goes into that folder; the others
 * are left unticked, with the folder their title looks like offered, for the therapist to choose.
 */
export function planIcs(text: string, tz: string, existing: Folder[], source: string): ImportPlan {
  const plan = newPlan('ics');
  const keyFor = new Map<string, string>();
  for (const f of existing) {
    const pf: PlannedFolder = { key: uuid(), label: f.label, existingId: f.id, suggestedId: null, include: true };
    plan.folders.push(pf);
    keyFor.set(f.id, pf.key);
  }
  const seriesItems = new Map<string, PlannedItem>();
  const events = parseIcs(text, tz).sort((a, b) => Number(!!a.movedFrom) - Number(!!b.movedFrom) || a.start_local.localeCompare(b.start_local));
  for (const ev of events) {
    const { exact, similar } = matchFolder(ev.summary, existing);
    const series = ev.movedFrom ? seriesItems.get(ev.movedFrom) : undefined;
    const folderKey = series ? series.folderKey : exact ? keyFor.get(exact.id)! : null;
    const item = baseItem({ path: source, name: ev.summary || '—' }, folderKey);
    item.kind = 'appointment';
    item.provenance = 'ics';
    item.mime = 'text/calendar';
    item.date = ev.start_local.slice(0, 10);
    item.time = ev.start_local.slice(11);
    item.duration = ev.duration_min;
    item.suggestedFolderKey = !folderKey && similar ? keyFor.get(similar.id)! : null;
    item.suggestedBy = item.suggestedFolderKey ? 'name' : null;
    item.nameSuggestion = item.suggestedFolderKey;
    const details: IcsDetails = { ...ev, seriesItemId: series?.id ?? null };
    item.text = JSON.stringify(details);
    if (ev.unsupportedRepeat) item.warning = 'repeatUnsupported';
    item.include = !!folderKey && !ev.unsupportedRepeat;
    if (ev.repeatWeeks && ev.uid && !seriesItems.has(ev.uid)) seriesItems.set(ev.uid, item);
    plan.items.push(item);
  }
  return plan;
}

/**
 * An event's title as compared with others' (accents and case aside), or null for an event
 * without one: untitled events have nothing in common.
 */
function titleKey(item: PlannedItem): string | null {
  if (item.kind !== 'appointment') return null;
  try {
    const summary = (JSON.parse(item.text || '{}') as Partial<IcsDetails>).summary?.trim();
    return summary ? fold(summary) : null;
  } catch {
    return null;
  }
}

/** Events with the same title as `item` (accents and case aside) that have no folder yet. */
export function sameTitleWithoutFolder(plan: ImportPlan, item: PlannedItem): PlannedItem[] {
  const title = titleKey(item);
  if (!title) return [];
  return plan.items.filter((i) => i.kind === 'appointment' && !i.done && i.folderKey === null && titleKey(i) === title);
}

/** Whether an item can be ticked for import: a file too large to keep cannot. */
export const canInclude = (item: Pick<PlannedItem, 'warning'>): boolean => item.warning !== 'tooBig';

const seriesOf = (item: PlannedItem): string | null => {
  try {
    return (JSON.parse(item.text || '{}') as Partial<IcsDetails>).seriesItemId ?? null;
  } catch {
    return null;
  }
};

/**
 * Files a calendar event in a folder (or in none). A series and its moved dates always go
 * together, so one patient's session never lands in another's folder; filing ticks them, except
 * dates that repeat in a way Sala cannot follow, unless that is the one the therapist chose.
 * Other events with the same title and no folder only get that folder as a suggestion ("Put it
 * in …"): a title such as "Session" may stand for many people, so nothing is filed for them.
 */
export function fileEvent(plan: ImportPlan, itemId: string, folderKey: string | null): ImportPlan {
  const item = plan.items.find((i) => i.id === itemId);
  if (!item) return plan;
  const headOf = (i: PlannedItem) => seriesOf(i) ?? i.id;
  const head = headOf(item);
  const items = plan.items.map((i) => {
    if (i.done || headOf(i) !== head) return i;
    if (!folderKey) return { ...i, folderKey: null };
    return { ...i, folderKey, include: i.id === item.id || i.include || i.warning !== 'repeatUnsupported' };
  });
  return { ...plan, items: suggestSameTitle(items, item.id) };
}

/** The folder an event's own title looks like (see `planIcs`). */
const nameSuggestionOf = (i: PlannedItem): string | null =>
  i.nameSuggestion !== undefined ? i.nameSuggestion : i.suggestedBy === 'sameTitle' ? null : (i.suggestedFolderKey ?? null);

/**
 * What each event without a folder is offered: the folder another event of the same title is
 * in (the event `firstId` first, the one just filed), else the folder its own title looks like.
 * So the suggestion always says where an event of that title went, and goes when none did.
 */
function suggestSameTitle(items: PlannedItem[], firstId: string): PlannedItem[] {
  const titles = new Map(items.map((i) => [i.id, titleKey(i)]));
  const went = new Map<string, string>();
  const first = items.find((i) => i.id === firstId);
  for (const i of first ? [first, ...items] : items) {
    const title = titles.get(i.id);
    if (title && i.folderKey && !went.has(title)) went.set(title, i.folderKey);
  }
  return items.map((i) => {
    if (i.kind !== 'appointment' || i.done || i.folderKey !== null) return i;
    const own = nameSuggestionOf(i);
    const title = titles.get(i.id);
    const other = title ? went.get(title) : undefined;
    const suggestedFolderKey = other ?? own;
    const suggestedBy = other ? ('sameTitle' as const) : own ? ('name' as const) : null;
    if (i.suggestedFolderKey === suggestedFolderKey && i.suggestedBy === suggestedBy && i.nameSuggestion === own) return i;
    return { ...i, suggestedFolderKey, suggestedBy, nameSuggestion: own };
  });
}

/**
 * Dates written another way than yyyy-mm-dd, as a plan saved by an earlier version may hold
 * (a date typed by hand at review), read again; one that cannot be read is emptied, so review
 * asks for it.
 */
export function normaliseDates(plan: ImportPlan, locale: UiLocale, today: string): ImportPlan {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (plan.items.every((i) => !i.date || iso.test(i.date) || i.kind === 'appointment')) return plan;
  return {
    ...plan,
    items: plan.items.map((i) => (!i.date || iso.test(i.date) || i.kind === 'appointment' ? i : { ...i, date: parseLocalDate(i.date, locale, { today }) ?? '' })),
  };
}
