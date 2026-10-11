import { strToU8, zipSync } from 'fflate';
import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { odtToText, rtfToText } from './convert';
import { guessMapping, parseCsv, rowsToPatients, setColumnField } from './csv';
import { detectDate, findDate } from './dates';
import { parseIcs } from './ics';
import { importTokens, labelSimilarity, matchFolder, sameName } from './plan';

const NOW = DateTime.fromISO('2026-09-28');

describe('dates', () => {
  it.each([
    ['2024-03-12 sessão.docx', '2024-03-12'],
    ['sessao_20240312.pdf', '2024-03-12'],
    ['12-03-2024.txt', '2024-03-12'],
    ['12.03.24 notas', '2024-03-12'],
    ['Consulta 5_3_2025', '2025-03-05'],
  ])('reads %s from a file name', (name, want) => {
    expect(findDate(name, NOW)).toBe(want);
  });

  it.each([
    ['Sessão de 12 de março de 2024. A paciente…', '2024-03-12'],
    ['Sesión del 3 de septiembre de 2025', '2025-09-03'],
    ['Session on 12 March 2024', '2024-03-12'],
    ['March 12, 2024 — intake', '2024-03-12'],
  ])('reads the first date in text: %s', (text, want) => {
    expect(findDate(text, NOW)).toBe(want);
  });

  it('rejects impossible and far-future dates', () => {
    expect(findDate('31-02-2024', NOW)).toBeNull();
    expect(findDate('2099-01-01', NOW)).toBeNull();
    expect(findDate('phone 912345678', NOW)).toBeNull();
  });

  it('falls back from name to text to the file date', () => {
    expect(detectDate('notas.txt', 'Sessão 12/03/2024', 0, NOW)).toEqual({ date: '2024-03-12', source: 'text' });
    expect(detectDate('notas.txt', 'nada', DateTime.fromISO('2025-01-02').toMillis(), NOW)).toEqual({ date: '2025-01-02', source: 'file' });
  });
});

describe('converters', () => {
  it('reads OpenDocument text', () => {
    const xml = '<office:document-content><office:body><office:text><text:h text:outline-level="1">Sessão 1</text:h><text:p>A Inês falou do sono &amp; do trabalho.</text:p><text:p>Linha<text:line-break/>dois<text:s text:c="2"/>fim</text:p></office:text></office:body></office:document-content>';
    const odt = zipSync({ mimetype: strToU8('application/vnd.oasis.opendocument.text'), 'content.xml': strToU8(xml) });
    expect(odtToText(odt)).toBe('# Sessão 1\n\nA Inês falou do sono & do trabalho.\n\nLinha\ndois  fim');
  });

  it('reads RTF with accents, unicode and ignored tables', () => {
    const rtf = String.raw`{\rtf1\ansi\ansicpg1252{\fonttbl{\f0 Calibri;}}{\colortbl;\red0\green0\blue0;}{\*\generator Word;}\f0 Sess\'e3o com a In\'eas\par Pr\u243?xima semana: \u8220?di\'e1rio\u8221?.\par}`;
    expect(rtfToText(rtf)).toBe('Sessão com a Inês\nPróxima semana: “diário”.');
  });
});

describe('csv', () => {
  it('guesses columns from Portuguese and Spanish headers', () => {
    const t = parseCsv('﻿Nome;Email;Telemóvel;Data de início;Notas\nAna Silva;ana@example.org;912000000;2025-01-10;Encaminhada\n;;;;\n');
    expect(guessMapping(t.header)).toEqual(['label', 'email', 'phone', 'start', 'notes']);
    const es = parseCsv('Nombre,Correo,Teléfono\nLuis Gómez,luis@example.org,600000000\n');
    const patients = rowsToPatients(es, guessMapping(es.header));
    expect(patients).toEqual([{ label: 'Luis Gómez', email: 'luis@example.org', phone: '600000000', start: '', notes: '', tags: [] }]);
  });

  it('makes the name from first-name and surname columns, and never takes a birth date for the start', () => {
    const t = parseCsv('sep=;\nNome;Apelido;Data de nascimento;Data da primeira consulta;Telefone;Telemóvel\nAna;Silva;1980-02-03;2025-01-10;210000000;910000000\n');
    const mapping = guessMapping(t.header);
    expect(mapping).toEqual(['label', 'label', 'ignore', 'start', 'phone', 'ignore']);
    // A second phone column can be added by hand; the start date stays in one column only.
    const both = setColumnField(mapping, 5, 'phone');
    expect(both).toEqual(['label', 'label', 'ignore', 'start', 'phone', 'phone']);
    expect(setColumnField(both, 2, 'start')).toEqual(['label', 'label', 'start', 'ignore', 'phone', 'phone']);
    expect(rowsToPatients(t, both)[0]).toMatchObject({ label: 'Ana Silva', start: '2025-01-10', phone: '210000000 / 910000000' });
    expect(guessMapping(['Nombre', 'Apellidos', 'Fecha de nacimiento', 'Fecha de alta'])).toEqual(['label', 'label', 'ignore', 'start']);
    expect(guessMapping(['Name', 'First name', 'Last name', 'Date of birth'])).toEqual(['ignore', 'label', 'label', 'ignore']);
  });
});

describe('ics', () => {
  it('reads timed events with their time zone and weekly repeats', () => {
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0',
      'BEGIN:VEVENT', 'UID:a', 'SUMMARY:Ana Silva', 'DTSTART;TZID=Europe/Madrid:20250310T170000', 'DTEND;TZID=Europe/Madrid:20250310T175000', 'RRULE:FREQ=WEEKLY;INTERVAL=2', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:b', 'SUMMARY:Holiday', 'DTSTART;VALUE=DATE:20250401', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:c', 'SUMMARY:Rui', 'DTSTART:20250311T090000Z', 'DTEND:20250311T100000Z', 'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const events = parseIcs(ics, 'Europe/Lisbon');
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ summary: 'Ana Silva', start_local: '2025-03-10T17:00', tz: 'Europe/Madrid', duration_min: 50, repeatWeeks: 2 });
    expect(events[1]).toMatchObject({ summary: 'Rui', start_local: '2025-03-11T09:00', tz: 'Europe/Lisbon', duration_min: 60, repeatWeeks: null });
  });

  it('keeps the first date of a series whose UNTIL falls before its start', () => {
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0',
      'BEGIN:VEVENT', 'UID:a', 'SUMMARY:Ana Silva', 'DTSTART;TZID=Europe/Lisbon:20261005T090000', 'DTEND;TZID=Europe/Lisbon:20261005T095000', 'RRULE:FREQ=WEEKLY;UNTIL=20261004T225959Z', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:b', 'SUMMARY:Rui', 'DTSTART;TZID=Europe/Lisbon:20261005T090000', 'RRULE:FREQ=WEEKLY;UNTIL=20261102T235959Z', 'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const events = parseIcs(ics, 'Europe/Lisbon');
    expect(events[0]).toMatchObject({ start_local: '2026-10-05T09:00', repeatWeeks: 1, until: '2026-10-05' });
    expect(events[1]).toMatchObject({ until: '2026-11-02' });
  });

  const cal = (...lines: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...lines, 'END:VCALENDAR'].join('\r\n');

  it('turns COUNT into the date of the last session', () => {
    const events = parseIcs(cal(
      'BEGIN:VEVENT', 'UID:a', 'SUMMARY:Ana Silva', 'DTSTART;TZID=Europe/Lisbon:20261005T090000', 'RRULE:FREQ=WEEKLY;COUNT=10', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:b', 'SUMMARY:Rui', 'DTSTART;TZID=Europe/Lisbon:20261005T100000', 'RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=3', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:c', 'SUMMARY:Laura', 'DTSTART;TZID=Europe/Lisbon:20261005T110000', 'RRULE:FREQ=WEEKLY;COUNT=1', 'END:VEVENT',
    ), 'Europe/Lisbon');
    expect(events.map((e) => [e.repeatWeeks, e.until])).toEqual([[1, '2026-12-07'], [2, '2026-11-02'], [1, '2026-10-05']]);
  });

  it('keeps skipped dates, and turns a moved date into an exception plus a single appointment', () => {
    const events = parseIcs(cal(
      'BEGIN:VEVENT', 'UID:a', 'SUMMARY:Ana Silva', 'DTSTART;TZID=Europe/Lisbon:20261005T090000', 'DTEND;TZID=Europe/Lisbon:20261005T095000',
      'RRULE:FREQ=WEEKLY;BYDAY=MO', 'EXDATE;TZID=Europe/Lisbon:20261012T090000,20261019T090000', 'END:VEVENT',
      // The session of 26 October moved to Tuesday; the one of 2 November was cancelled.
      'BEGIN:VEVENT', 'UID:a', 'RECURRENCE-ID;TZID=Europe/Lisbon:20261026T090000', 'SUMMARY:Ana Silva', 'DTSTART;TZID=Europe/Lisbon:20261027T150000', 'DTEND;TZID=Europe/Lisbon:20261027T155000', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:a', 'RECURRENCE-ID:20261102T090000Z', 'STATUS:CANCELLED', 'SUMMARY:Ana Silva', 'DTSTART:20261102T090000Z', 'END:VEVENT',
    ), 'Europe/Lisbon');
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ uid: 'a', repeatWeeks: 1, exceptions: ['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02'], movedFrom: null });
    expect(events[1]).toMatchObject({ uid: 'a', start_local: '2026-10-27T15:00', duration_min: 50, repeatWeeks: null, movedFrom: 'a' });
  });

  it('skips cancelled events and series, and flags repeats Sala cannot follow', () => {
    const events = parseIcs(cal(
      'BEGIN:VEVENT', 'UID:x', 'SUMMARY:Cancelled', 'STATUS:CANCELLED', 'DTSTART;TZID=Europe/Lisbon:20261005T090000', 'RRULE:FREQ=WEEKLY', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:x', 'RECURRENCE-ID;TZID=Europe/Lisbon:20261012T090000', 'SUMMARY:Cancelled', 'DTSTART;TZID=Europe/Lisbon:20261013T090000', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:d', 'SUMMARY:Daily', 'DTSTART;TZID=Europe/Lisbon:20261005T090000', 'RRULE:FREQ=DAILY;COUNT=5', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:t', 'SUMMARY:Twice a week', 'DTSTART;TZID=Europe/Lisbon:20261005T090000', 'RRULE:FREQ=WEEKLY;BYDAY=MO,TH', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:m', 'SUMMARY:Every 4 weeks', 'DTSTART;TZID=Europe/Lisbon:20261005T090000', 'RRULE:FREQ=WEEKLY;INTERVAL=4', 'END:VEVENT',
    ), 'Europe/Lisbon');
    expect(events.map((e) => [e.summary, e.repeatWeeks, e.unsupportedRepeat])).toEqual([
      ['Daily', null, true],
      ['Twice a week', null, true],
      ['Every 4 weeks', null, true],
    ]);
  });
});

describe('matching names', () => {
  it('matches the same name in another order or without accents', () => {
    expect(labelSimilarity('Silva, Ana', 'Ana Silva')).toBe(1);
    expect(labelSimilarity('Inês Sousa', 'ines sousa')).toBe(1);
    expect(labelSimilarity('Ana Silva', 'Ana Costa')).toBe(0.5);
    const existing = [{ id: '1', label: 'Ana Silva' }, { id: '2', label: 'Rui Marques' }];
    expect(matchFolder('SILVA Ana', existing)).toEqual({ exact: existing[0], similar: existing[0] });
    expect(matchFolder('Ana Costa', existing)).toEqual({ exact: null, similar: null });
  });

  it('keeps initials, so two people who differ by one are never merged', () => {
    expect(importTokens('Inês S.')).toEqual(['ines', 's']);
    expect(sameName('Inês S.', 'ines s')).toBe(true);
    expect(sameName('Inês S.', 'Inês R.')).toBe(false);
    expect(labelSimilarity('Inês S.', 'Inês R.')).toBe(0.5);
    const existing = [{ id: 'r', label: 'Inês R.' }, { id: 'sousa', label: 'Inês Sousa' }];
    // "S." can only be a surname starting with S: a likely match, offered but not merged.
    expect(matchFolder('Inês S.', existing)).toEqual({ exact: null, similar: existing[1] });
    expect(labelSimilarity('Inês S.', 'Inês Sousa')).toBeLessThan(1);
    expect(matchFolder('Inês R.', existing).exact?.id).toBe('r');
    expect(matchFolder('Inês T.', existing)).toEqual({ exact: null, similar: null });
  });

  it('offers a folder for a longer calendar title without merging it', () => {
    const existing = [{ id: '1', label: 'Ana Silva' }];
    expect(matchFolder('Sessão - Ana Silva', existing)).toEqual({ exact: null, similar: existing[0] });
  });
});
