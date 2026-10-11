import type { Appointment, Attachment, Folder, Page } from '../model/types';
import { sectionsOf } from '../model/sections';

// A plain FHIR R4 view of the practice, so other systems can read what Sala exports.
// Sala's own lossless copy is the JSONL under data/; this is for everyone else.

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const div = (text: string) =>
  `<div xmlns="http://www.w3.org/1999/xhtml">${esc(text).split('\n').map((l) => `<p>${l}</p>`).join('')}</div>`;

export function patient(f: Folder) {
  const telecom = [
    f.contact.email && { system: 'email', value: f.contact.email },
    f.contact.phone && { system: 'phone', value: f.contact.phone },
  ].filter(Boolean);
  // A photo the therapist added; drawn portraits are Sala's own and are not exported as photos.
  const photo = f.picture?.kind === 'photo' ? /^data:([^;]+);base64,(.*)$/.exec(f.picture.data) : null;
  return {
    resourceType: 'Patient',
    id: f.id,
    active: f.status === 'active',
    name: [{ text: f.label }],
    ...(telecom.length ? { telecom } : {}),
    ...(f.contact.language ? { communication: [{ language: { coding: [{ system: 'urn:ietf:bcp:47', code: f.contact.language }] }, preferred: true }] } : {}),
    ...(photo ? { photo: [{ contentType: photo[1], data: photo[2] }] } : {}),
  };
}

export function encounter(p: Page) {
  const start = p.time ? `${p.date}T${p.time}:00` : p.date;
  return {
    resourceType: 'Encounter',
    id: p.id,
    status: 'finished',
    class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB' },
    subject: { reference: `Patient/${p.folder_id}` },
    period: { start },
    ...(p.duration_min ? { length: { value: p.duration_min, unit: 'min', system: 'http://unitsofmeasure.org', code: 'min' } } : {}),
  };
}

export function composition(p: Page, sectionTitle: (template: string, key: string) => string, includeProcessNote: boolean) {
  // The template's sections, then any text kept from an earlier template.
  const sections = sectionsOf(p)
    .filter((s) => s.text.trim())
    .map((s) => ({ title: sectionTitle(p.template, s.key), text: { status: 'generated', div: div(s.text) } }));
  if (includeProcessNote && p.process_note.trim()) {
    sections.push({ title: sectionTitle('private', 'process_note'), text: { status: 'generated', div: div(p.process_note) } });
  }
  return {
    resourceType: 'Composition',
    id: p.id,
    status: 'final',
    type: { text: `Session note (${p.template.toUpperCase()})` },
    subject: { reference: `Patient/${p.folder_id}` },
    encounter: { reference: `Encounter/${p.id}` },
    date: p.date,
    author: [{ display: 'Therapist' }],
    title: p.title || `Session ${p.date}`,
    section: sections,
  };
}

export function appointment(a: Appointment, end: string, start: string) {
  const status = { proposed: 'proposed', confirmed: 'booked', cancelled: 'cancelled', done: 'fulfilled' }[a.status];
  return {
    resourceType: 'Appointment',
    id: a.id,
    status,
    start,
    end,
    minutesDuration: a.duration_min,
    ...(a.repeat ? { comment: `Repeats every ${a.repeat.interval_weeks} week(s)${a.repeat.until ? ` until ${a.repeat.until}` : ''}` } : {}),
    participant: a.folder_id ? [{ actor: { reference: `Patient/${a.folder_id}` }, status: 'accepted' }] : [],
    ...(a.folder_id ? {} : { description: a.title }),
  };
}

export function documentReference(att: Attachment, path: string) {
  return {
    resourceType: 'DocumentReference',
    id: att.id,
    status: 'current',
    subject: { reference: `Patient/${att.folder_id}` },
    ...(att.page_id ? { context: { encounter: [{ reference: `Encounter/${att.page_id}` }] } } : {}),
    content: [{ attachment: { contentType: att.mime, title: att.filename, size: att.size, url: path } }],
  };
}
