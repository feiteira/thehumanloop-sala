import { PASSAGE_MAX, PASSAGE_THEMES_MAX, THEME_MAX, uniqueThemes } from './passages';
import type { Draft, Kind, Passage } from './types';
import { FOLDER_COLOURS, FOLDER_LABEL_MAX, PHOTO_MAX_CHARS, PORTRAIT_LOOKS, STICKY_COLOURS, STICKY_MAX, TEMPLATES, TEMPLATE_SECTIONS } from './types';

export class ValidationError extends Error {
  constructor(
    readonly kind: Kind,
    readonly field: string,
    readonly reason: string,
  ) {
    super(`${kind}.${field}: ${reason}`);
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const LOCAL = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;

/** 2026-02-30 has the right shape but is not a day of the calendar. */
function isCalendarDate(iso: string): boolean {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function check(cond: boolean, kind: Kind, field: string, reason: string): asserts cond {
  if (!cond) throw new ValidationError(kind, field, reason);
}

/**
 * A page's marked passages, checked and tidied: theme names trimmed and without repeats.
 * Passages of a section the page no longer has (its text was emptied) are dropped.
 */
function passagesOf(raw: unknown, sections: Record<string, string>): Passage[] {
  const kind = 'page';
  check(raw === undefined || raw === null || Array.isArray(raw), kind, 'passages', 'a list');
  const ids = new Set<string>();
  const out: Passage[] = [];
  for (const item of (raw ?? []) as Record<string, unknown>[]) {
    const { id, section, start, end, quote, themes, created_at } = (item ?? {}) as Record<string, unknown>;
    check(typeof id === 'string' && id.length > 0 && id.length <= 64 && !ids.has(id), kind, 'passages', 'each with its own id');
    ids.add(id);
    check(typeof section === 'string' && section.length > 0, kind, 'passages', 'section required');
    check(Number.isInteger(start) && Number.isInteger(end) && (start as number) >= 0 && (end as number) > (start as number), kind, 'passages', 'start before end');
    check(typeof quote === 'string' && quote.length > 0 && quote.length <= PASSAGE_MAX, kind, 'passages', `words required, up to ${PASSAGE_MAX} characters`);
    check(Array.isArray(themes) && themes.every((t) => typeof t === 'string'), kind, 'passages', 'themes required');
    const names = uniqueThemes(themes as string[]);
    check(names.length > 0 && names.length <= PASSAGE_THEMES_MAX, kind, 'passages', `one to ${PASSAGE_THEMES_MAX} themes`);
    check(names.every((n) => n.length <= THEME_MAX), kind, 'passages', `theme names up to ${THEME_MAX} characters`);
    check(typeof created_at === 'string' && created_at.length > 0, kind, 'passages', 'created_at required');
    if (!sections[section]) continue;
    out.push({ id, section, start: start as number, end: end as number, quote, themes: names, created_at });
  }
  return out;
}

/** Validates and tidies a draft before it is written. Returns the (possibly adjusted) draft. */
export function validate<K extends Kind>(kind: K, draft: Draft<K>): Draft<K> {
  const d = draft as Record<string, unknown>;
  switch (kind) {
    case 'folder': {
      const label = String(d.label ?? '').trim();
      check(label.length > 0 && label.length <= FOLDER_LABEL_MAX, kind, 'label', `required, up to ${FOLDER_LABEL_MAX} characters`);
      check((FOLDER_COLOURS as readonly string[]).includes(String(d.colour)), kind, 'colour', 'unknown colour');
      const tags = [...new Set(((d.tags as string[]) ?? []).map((t) => t.trim()).filter(Boolean))];
      const pic = d.picture as Record<string, unknown> | null | undefined;
      if (pic) {
        if (pic.kind === 'drawn') {
          check(typeof pic.seed === 'string' && pic.seed.length > 0 && pic.seed.length <= 64, kind, 'picture', 'seed required');
          check((PORTRAIT_LOOKS as readonly string[]).includes(String(pic.look)), kind, 'picture', 'unknown look');
        } else {
          check(pic.kind === 'photo', kind, 'picture', 'drawn or photo');
          check(typeof pic.data === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(pic.data), kind, 'picture', 'a JPEG, PNG or WebP data URL');
          check(pic.data.length <= PHOTO_MAX_CHARS, kind, 'picture', 'photo too large');
        }
      }
      return { ...draft, label, tags } as Draft<K>;
    }
    case 'page': {
      check(DATE.test(String(d.date)) && isCalendarDate(String(d.date)), kind, 'date', 'YYYY-MM-DD, a date that exists');
      check(d.time === null || TIME.test(String(d.time)), kind, 'time', 'HH:mm or null');
      check((TEMPLATES as readonly string[]).includes(String(d.template)), kind, 'template', 'unknown template');
      const dur = d.duration_min as number | null;
      check(dur === null || (Number.isInteger(dur) && dur > 0 && dur <= 24 * 60), kind, 'duration_min', '1–1440 or null');
      const sections: Record<string, string> = {};
      for (const key of TEMPLATE_SECTIONS[d.template as keyof typeof TEMPLATE_SECTIONS]) {
        sections[key] = String((d.sections as Record<string, string>)?.[key] ?? '');
      }
      // Keep text from sections of another template so switching template never loses words.
      for (const [key, value] of Object.entries((d.sections as Record<string, string>) ?? {})) {
        if (!(key in sections) && value.trim()) sections[key] = value;
      }
      return { ...draft, sections, passages: passagesOf(d.passages, sections) } as Draft<K>;
    }
    case 'sticky': {
      const text = String(d.text ?? '').trim();
      check(text.length > 0, kind, 'text', 'required');
      check(text.length <= STICKY_MAX, kind, 'text', `up to ${STICKY_MAX} characters`);
      check((STICKY_COLOURS as readonly string[]).includes(String(d.colour)), kind, 'colour', 'unknown colour');
      return { ...draft, text } as Draft<K>;
    }
    case 'appointment': {
      check(LOCAL.test(String(d.start_local)), kind, 'start_local', 'YYYY-MM-DDTHH:mm');
      check(typeof d.tz === 'string' && d.tz.length > 0, kind, 'tz', 'IANA time zone required');
      const dur = d.duration_min as number;
      check(Number.isInteger(dur) && dur > 0 && dur <= 24 * 60, kind, 'duration_min', '1–1440');
      check(d.folder_id !== null || String(d.title ?? '').trim().length > 0, kind, 'title', 'required without a folder');
      const r = d.repeat as { interval_weeks: number; until: string | null } | null;
      check(r === null || r.interval_weeks === 1 || r.interval_weeks === 2, kind, 'repeat', 'weekly or fortnightly');
      check(r === null || r.until === null || DATE.test(r.until), kind, 'repeat.until', 'YYYY-MM-DD or null');
      // A series that ends before it starts has no dates at all, yet would still be exported.
      check(r === null || r.until === null || r.until >= String(d.start_local).slice(0, 10), kind, 'repeat.until', 'on or after the start date');
      return draft;
    }
    case 'appointment_type': {
      const name = String(d.name ?? '').trim();
      check(name.length > 0 && name.length <= 80, kind, 'name', 'required, up to 80 characters');
      const dur = d.duration_min as number;
      check(Number.isInteger(dur) && dur > 0 && dur <= 24 * 60, kind, 'duration_min', '1–1440');
      return { ...draft, name } as Draft<K>;
    }
    case 'availability': {
      check(TIME.test(String(d.start)) && TIME.test(String(d.end)), kind, 'start', 'HH:mm');
      check(String(d.start) < String(d.end), kind, 'end', 'must be after start');
      check(Number.isInteger(d.weekday) && (d.weekday as number) >= 1 && (d.weekday as number) <= 7, kind, 'weekday', '1–7');
      return draft;
    }
    case 'availability_exception': {
      check(DATE.test(String(d.date)), kind, 'date', 'YYYY-MM-DD');
      if (d.start !== null || d.end !== null) {
        check(TIME.test(String(d.start)) && TIME.test(String(d.end)) && String(d.start) < String(d.end), kind, 'start', 'HH:mm range');
      }
      check(d.kind === 'off' || d.start !== null, kind, 'start', 'extra time needs a range');
      return draft;
    }
    case 'attachment': {
      check(String(d.filename ?? '').length > 0, kind, 'filename', 'required');
      return draft;
    }
    case 'setting':
      check(typeof d.id === 'string' && d.id.length > 0, kind, 'id', 'setting key required');
      return draft;
  }
  return draft;
}
