import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { type Attachment, emptyContact, type Folder, type Page } from '../model/types';
import { buildSalaZip, type ExportLabels, type ExportRecord } from './sala';

const labels: ExportLabels = {
  sectionTitle: (t, k) => `${t}:${k}`,
  neutralAppointment: 'Appointment',
  stickyHeading: 'Sticky notes',
  themesHeading: 'Themes',
  processNoteHeading: 'Process note',
  readme: 'Sala export',
};
const base = (id: string) => ({ id, created_at: '2026-09-21T09:00:00.000Z', updated_at_hlc: '000000000000001-00000-dev', deleted: false });
const folder: Folder = {
  ...base('f1'), label: 'Inês S.', colour: 'teal', status: 'active', tags: [], contact: emptyContact(), cover_note: '', archived_at: null, merged_into: null,
};
const page = (id: string, p: Partial<Page>): Page => ({
  ...base(id), folder_id: 'f1', date: '2026-09-21', time: null, duration_min: null, template: 'free', title: '', sections: {}, process_note: '', import_provenance: null, ...p,
});
const attachment = (id: string, pageId: string | null): Attachment => ({
  ...base(id), folder_id: 'f1', page_id: pageId, filename: `${id}.pdf`, mime: 'application/pdf', size: 3, blob_id: id, sha256: '', local_only: false, source: 'upload', ocr_text: null,
});

async function build(records: ExportRecord[]) {
  const zip = await buildSalaZip(records, { appVersion: 'test', practiceId: 'p', includeProcessNotes: false, labels, readAttachment: async () => new Uint8Array([1, 2, 3]) });
  return unzipSync(zip);
}

describe('pageMarkdown', () => {
  it('writes the template’s sections, then text kept from an earlier template', async () => {
    const files = await build([
      { kind: 'folder', record: folder },
      { kind: 'page', record: page('p1', { template: 'dap', sections: { data: 'Slept badly', assessment: '', plan: 'Diary', body: 'Imported notes' } }) },
      { kind: 'page', record: page('p2', { date: '2026-09-28', sections: { body: 'Free notes', plan: 'Kept plan' } }) },
    ]);
    const dap = strFromU8(files['notes/Inês S./2026-09-21.md']!);
    expect(dap).toContain('## dap:data\n\nSlept badly');
    expect(dap.indexOf('## dap:plan')).toBeLessThan(dap.indexOf('## dap:body\n\nImported notes'));
    expect(dap).not.toContain('dap:assessment');
    const free = strFromU8(files['notes/Inês S./2026-09-28.md']!);
    // A free page's own notes need no heading; the kept plan gets one.
    expect(free).toContain('Free notes\n\n## free:plan\n\nKept plan');
    expect(free).not.toContain('free:body');
  });

  it('writes intake pages', async () => {
    const files = await build([
      { kind: 'folder', record: folder },
      { kind: 'page', record: page('p1', { template: 'intake', sections: { reason: 'Sleep', formulation: 'Worry at night' } }) },
    ]);
    const md = strFromU8(files['notes/Inês S./2026-09-21.md']!);
    expect(md).toContain('## intake:reason\n\nSleep');
    expect(md).toContain('## intake:formulation\n\nWorry at night');
  });
});

describe('themes in the Markdown', () => {
  it('lists marked words with their themes, leaving out words no longer in the note', async () => {
    const body = 'Slept badly. Worry about work.';
    const mark = (words: string, themes: string[], start = body.indexOf(words)) => ({ id: words, section: 'body', start, end: start + words.length, quote: words, themes, created_at: '2026-09-21T10:00:00.000Z' });
    const files = await build([
      { kind: 'folder', record: folder },
      { kind: 'page', record: page('p1', { sections: { body }, passages: [mark('Worry about work', ['worry', 'work']), mark('Slept badly', ['sleep']), mark('Gone words', ['x'], 0)] }) },
    ]);
    const md = strFromU8(files['notes/Inês S./2026-09-21.md']!);
    expect(md).toContain('## Themes\n\n- “Slept badly” — sleep\n- “Worry about work” — worry, work\n');
    expect(md).not.toContain('Gone words');
  });
});

describe('FHIR documents', () => {
  it('never point at a deleted page', async () => {
    const files = await build([
      { kind: 'folder', record: folder },
      { kind: 'page', record: page('live', {}) },
      { kind: 'page', record: { ...page('gone', {}), deleted: true } },
      { kind: 'attachment', record: attachment('a1', 'live') },
      { kind: 'attachment', record: attachment('a2', 'gone') },
    ]);
    const docs = strFromU8(files['fhir/DocumentReference.ndjson']!).trim().split('\n').map((l) => JSON.parse(l) as { id: string; context?: unknown });
    expect(docs.find((d) => d.id === 'a1')?.context).toEqual({ encounter: [{ reference: 'Encounter/live' }] });
    expect(docs.find((d) => d.id === 'a2')?.context).toBeUndefined();
  });
});
