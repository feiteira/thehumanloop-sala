import { DateTime } from 'luxon';
import type { Appointment, Folder } from '../model/types';
import { hasDates, startOf } from './occurrences';

// RFC 5545 export of the therapist's appointments, for their own calendar apps.

export type IcsTitleStyle = 'initials' | 'name' | 'neutral';

export function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Folds content lines at 75 octets, as the RFC requires. */
export function foldLine(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (out.length ? 74 : 75)) {
      out.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += n;
  }
  out.push(current);
  return out.join('\r\n ');
}

export function initials(label: string): string {
  const parts = label.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
  return parts.map((p) => `${p[0]!.toUpperCase()}.`).join('') || '—';
}

const local = (dt: DateTime) => dt.toFormat("yyyyMMdd'T'HHmmss");
const utc = (dt: DateTime) => dt.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");

export function toIcs(
  appointments: Appointment[],
  folders: Map<string, Folder>,
  opts: { titleStyle: IcsTitleStyle; neutralTitle: string; now?: Date },
): string {
  const stamp = utc(DateTime.fromJSDate(opts.now ?? new Date()));
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Sala//Sala//EN', 'CALSCALE:GREGORIAN'];
  for (const a of appointments) {
    if (a.deleted || a.status === 'cancelled') continue;
    // A series with every date skipped, or that ends before it starts, has nothing to show.
    if (!hasDates(a)) continue;
    const folder = a.folder_id ? folders.get(a.folder_id) : undefined;
    const title = folder
      ? opts.titleStyle === 'name'
        ? folder.label
        : opts.titleStyle === 'initials'
          ? `${opts.neutralTitle} · ${initials(folder.label)}`
          : opts.neutralTitle
      : a.title;
    const start = startOf(a);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${a.id}@sala`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=${a.tz}:${local(start)}`,
      `DTEND;TZID=${a.tz}:${local(start.plus({ minutes: a.duration_min }))}`,
      `SUMMARY:${escapeText(title)}`,
    );
    if (a.location) lines.push(`LOCATION:${escapeText(a.location)}`);
    if (a.repeat) {
      const until = a.repeat.until
        ? `;UNTIL=${utc(DateTime.fromISO(a.repeat.until, { zone: a.tz }).endOf('day'))}`
        : '';
      lines.push(`RRULE:FREQ=WEEKLY;INTERVAL=${a.repeat.interval_weeks}${until}`);
      for (const ex of a.repeat.exceptions) {
        const exStart = DateTime.fromISO(`${ex}T${a.start_local.slice(11)}`, { zone: a.tz });
        lines.push(`EXDATE;TZID=${a.tz}:${local(exStart)}`);
      }
    }
    if (a.status === 'proposed') lines.push('STATUS:TENTATIVE');
    else lines.push('STATUS:CONFIRMED');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
