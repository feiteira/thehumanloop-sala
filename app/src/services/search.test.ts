import { describe, expect, it } from 'vitest';
import { emptyContact, type Draft } from '../core/model/types';
import { Store } from '../core/store/store';
import { SqlJsDb } from '../platform/sqljs';
import { findWord, makeExcerpt, matchesAll, searchAll, tokenize } from './search';

const folder = (label: string, more: Partial<Draft<'folder'>> = {}): Draft<'folder'> => ({
  label, colour: 'teal', status: 'active', tags: [], contact: emptyContact(), cover_note: '', archived_at: null, merged_into: null, ...more,
});
const page = (folderId: string, date: string, body: string, more: Partial<Draft<'page'>> = {}): Draft<'page'> => ({
  folder_id: folderId, date, time: null, duration_min: null, template: 'free', title: '', sections: { body }, process_note: '', import_provenance: null, ...more,
});
const sticky = (folderId: string, text: string, state: 'stuck' | 'peeled' = 'stuck'): Draft<'sticky'> => ({
  folder_id: folderId, page_id: null, text, colour: 'yellow', next_session: false, origin: 'therapist', state, peeled_at: state === 'peeled' ? '2026-09-01T10:00:00.000Z' : null,
});
const attachment = (folderId: string, filename: string, ocr: string | null): Draft<'attachment'> => ({
  folder_id: folderId, page_id: null, filename, mime: 'image/png', size: 10, blob_id: 'b', sha256: 's', local_only: false, source: 'scan', ocr_text: ocr,
});

async function practice() {
  const store = await Store.open(await SqlJsDb.create());
  const ana = await store.put('folder', folder('Ana Lopes', { tags: ['sono'], contact: { ...emptyContact(), phone: '+351 912 345 678', email: 'ana.lopes@example.org' } }));
  const ines = await store.put('folder', folder('Inês Salgado', { cover_note: 'Encaminhada pelo médico de família' }));
  const mariana = await store.put('folder', folder('Mariana Silva'));
  const joao = await store.put('folder', folder('João Pires', { status: 'archived', archived_at: '2026-06-30T12:00:00.000Z', tags: ['sono'] }));
  return { store, ana, ines, mariana, joao };
}

describe('tokenize', () => {
  it('folds accents and capitals, drops a tag’s # and stray punctuation, and repeats', () => {
    expect(tokenize('  Inês  #SONO, “mãe” inês ')).toEqual(['ines', 'sono', 'mae']);
    expect(tokenize('+351 912-345')).toEqual(['+351', '912-345']);
    expect(tokenize('   ')).toEqual([]);
  });
});

describe('makeExcerpt', () => {
  it('cuts around the first word at word edges and marks every word in the original spelling', () => {
    const text = 'Long introduction about the week before anything happened at all. Then she spoke about her Mãe and about sleep again, and about the long weekend ahead of them.';
    const e = makeExcerpt(text, ['mae', 'sleep'], 60, 20);
    expect(e.text.startsWith('…')).toBe(true);
    expect(e.text.endsWith('…')).toBe(true);
    const marked = e.marks.map(([a, b]) => e.text.slice(a, b));
    expect(marked).toContain('Mãe');
    expect(e.text).toBe('…spoke about her Mãe and about sleep again, and about the…');
    expect(marked).toEqual(['Mãe', 'sleep']);
  });

  it('collapses whitespace and keeps short text whole', () => {
    expect(makeExcerpt('Ask  about\nthe sleep   diary', ['sleep'])).toEqual({ text: 'Ask about the sleep diary', marks: [[14, 19]] });
  });

  it('returns the start of the text when none of the words is in it', () => {
    expect(makeExcerpt('abc def', ['xyz'])).toEqual({ text: 'abc def', marks: [] });
  });

  it('marks words only where they begin a word, and merges overlapping marks', () => {
    expect(makeExcerpt('sleeping, asleep', ['sleep', 'sleepi']).marks).toEqual([[0, 6]]);
  });
});

describe('findWord', () => {
  it('finds a word only at the start of a word, after any letter-less character', () => {
    expect(findWord('esta semana com a ana', 'ana')).toBe(18);
    expect(findWord('semana', 'ana')).toBe(-1);
    expect(findWord('#sono e (ana)', 'ana')).toBe(9);
    expect(findWord('ana.lopes@example.org', 'lopes@ex')).toBe(4);
    expect(findWord('tel +351 912', '+351')).toBe(4);
    expect(findWord('a@b.pt', '@b')).toBe(1);
  });
});

describe('matchesAll', () => {
  it('needs every word, in any order', () => {
    expect(matchesAll('New appointment', ['appo', 'new'])).toBe(true);
    expect(matchesAll('New appointment', ['new', 'folder'])).toBe(false);
  });
});

describe('searchAll', () => {
  it('lists every folder of the shelf for a blank query', async () => {
    const { store } = await practice();
    const r = await searchAll(store, '  ');
    expect(r.folders.map((f) => f.folder.label).sort()).toEqual(['Ana Lopes', 'Inês Salgado', 'Mariana Silva']);
    expect(r.elsewhere).toBe(0);
  });

  it('needs every word, in any order, with accents and capitals ignored', async () => {
    const { store } = await practice();
    expect((await searchAll(store, 'salgado INES')).folders.map((f) => f.folder.label)).toEqual(['Inês Salgado']);
    expect((await searchAll(store, 'ines lopes')).folders).toEqual([]);
  });

  it('finds a folder by its cover note, email and phone digits, and says where', async () => {
    const { store, ines, ana } = await practice();
    const cover = await searchAll(store, 'medico familia');
    expect(cover.folders.map((f) => f.folder.id)).toEqual([ines.id]);
    expect(cover.folders[0]!.detail?.field).toBe('cover');

    const email = await searchAll(store, 'ana.lopes@example');
    expect(email.folders[0]?.folder.id).toBe(ana.id);
    expect(email.folders[0]?.detail?.field).toBe('email');

    for (const q of ['912345678', '912 345 678', '+351912', '345-678']) {
      const phone = await searchAll(store, q);
      expect(phone.folders.map((f) => f.folder.id), q).toEqual([ana.id]);
      expect(phone.folders[0]?.detail?.field).toBe('phone');
    }
    // Two digits are not enough to search phone numbers by their digits alone.
    expect((await searchAll(store, '4-5')).folders).toEqual([]);
  });

  it('finds a folder by the text of a sticky note that is still stuck', async () => {
    const { store, mariana } = await practice();
    await store.put('sticky', sticky(mariana.id, 'Cirurgia da mãe no dia 14'));
    await store.put('sticky', sticky(mariana.id, 'Old worry about exams', 'peeled'));
    const r = await searchAll(store, 'cirurgia mae');
    expect(r.folders.map((f) => f.folder.id)).toEqual([mariana.id]);
    expect(r.folders[0]?.detail?.field).toBe('sticky');
    expect(r.folders[0]?.detail?.excerpt.text).toBe('Cirurgia da mãe no dia 14');
    expect((await searchAll(store, 'exams')).folders).toEqual([]);
  });

  it('labels a page hit with its folder even when the folder itself does not match', async () => {
    const { store, ines } = await practice();
    const p = await store.put('page', page(ines.id, '2026-09-21', 'She talked about her mother and the sleep diary.'));
    const r = await searchAll(store, 'mother');
    expect(r.folders).toHaveLength(1);
    expect(r.folders[0]!.folder.label).toBe('Inês Salgado');
    expect(r.folders[0]!.direct).toBe(false);
    expect(r.folders[0]!.pages.map((h) => h.page.id)).toEqual([p.id]);
    const e = r.folders[0]!.pages[0]!.excerpt;
    expect(e.marks.map(([a, b]) => e.text.slice(a, b))).toEqual(['mother']);
  });

  it('splits the words between a folder and its pages, but never finds a page by its folder alone', async () => {
    const { store, ana, mariana } = await practice();
    const sleep = await store.put('page', page(ana.id, '2026-09-21', 'Dorme mal desde agosto.'));
    await store.put('page', page(ana.id, '2026-09-14', 'Trabalho e família.'));
    await store.put('page', page(mariana.id, '2026-09-20', 'Dorme bem esta semana.'));
    const r = await searchAll(store, 'ana dorme');
    // "ana" begins a word in Ana's name only: not in "Mariana", nor in "semana".
    expect(r.folders.map((f) => f.folder.id)).toEqual([ana.id]);
    expect(r.folders[0]?.pages.map((h) => h.page.id)).toEqual([sleep.id]);
    expect((await searchAll(store, 'lopes trabalho')).folders[0]?.pages).toHaveLength(1);
    expect((await searchAll(store, 'lopes ausente')).folders).toEqual([]);
  });

  it('finds documents by file name and by recognised text', async () => {
    const { store, ines } = await practice();
    const scan = await store.put('attachment', attachment(ines.id, 'consulta-março.png', 'Relatório do hospital: insónia persistente.'));
    const byText = await searchAll(store, 'insonia');
    expect(byText.folders[0]?.documents.map((d) => d.attachment.id)).toEqual([scan.id]);
    const ocr = byText.folders[0]!.documents[0]!.text!;
    expect(ocr.marks.map(([a, b]) => ocr.text.slice(a, b))).toEqual(['insónia']);
    const byName = await searchAll(store, 'marco consulta');
    expect(byName.folders[0]?.documents[0]?.text).toBeNull();
    expect(byName.folders[0]?.documents[0]?.name.marks.length).toBe(2);
  });

  it('keeps the archive apart and counts its matches', async () => {
    const { store, ana, joao } = await practice();
    await store.put('page', page(joao.id, '2026-05-01', 'Sono melhor.'));
    const active = await searchAll(store, 'sono');
    expect(active.folders.map((f) => f.folder.id)).toEqual([ana.id]);
    expect(active.elsewhere).toBe(1);
    const archive = await searchAll(store, 'sono', { archived: true });
    expect(archive.folders.map((f) => f.folder.id)).toEqual([joao.id]);
    expect(archive.folders[0]?.pages).toHaveLength(1);
    expect(archive.elsewhere).toBe(1);
  });

  it('leaves out deleted pages, deleted and merged folders, and private process notes', async () => {
    const { store, ana, mariana } = await practice();
    const gone = await store.put('page', page(ana.id, '2026-09-01', 'Pesadelos.'));
    await store.remove('page', [gone.id]);
    await store.put('page', page(ana.id, '2026-09-02', 'Nada.', { process_note: 'pesadelos' }));
    await store.update('folder', mariana.id, { merged_into: ana.id });
    expect((await searchAll(store, 'pesadelos')).folders).toEqual([]);
    expect((await searchAll(store, 'mariana')).folders).toEqual([]);
  });

  it('puts folders named by the words first, then other details, then notes and documents', async () => {
    const { store, ana } = await practice();
    const other = await store.put('folder', folder('Rita Sousa', { cover_note: 'Amiga da Ana' }));
    const third = await store.put('folder', folder('Pedro Costa'));
    await store.put('page', page(third.id, '2026-09-10', 'Falou da Ana.'));
    const r = await searchAll(store, 'ana');
    expect(r.folders.slice(0, 3).map((f) => f.folder.id)).toEqual([ana.id, expect.any(String), expect.any(String)]);
    const order = r.folders.map((f) => f.folder.id);
    expect(order.indexOf(other.id)).toBeLessThan(order.indexOf(third.id));
    const ranks = new Map(r.folders.map((f) => [f.folder.id, f.rank]));
    expect([ranks.get(ana.id), ranks.get(other.id), ranks.get(third.id)]).toEqual([0, 2, 3]);
  });

  it('ranks a name holding the word after one starting with it, and a cover note after both', async () => {
    const { store } = await practice();
    const abel = await store.put('folder', folder('Abel Sousa', { cover_note: 'Brother of Laura Costa' }));
    const laura = await store.put('folder', folder('Laura Costa'));
    const costa = await store.put('folder', folder('Costa Ramos'));
    const r = await searchAll(store, 'costa');
    expect(r.folders.map((f) => [f.folder.id, f.rank])).toEqual([[costa.id, 0], [laura.id, 1], [abel.id, 2]]);
    expect((await searchAll(store, '')).folders.every((f) => f.rank === 0)).toBe(true);
  });

  it('treats % and _ as plain characters', async () => {
    const { store, ines } = await practice();
    await store.put('page', page(ines.id, '2026-09-10', 'Progress 50% this week.'));
    await store.put('page', page(ines.id, '2026-09-11', 'Progress 500 this week.'));
    const r = await searchAll(store, '50%');
    expect(r.folders[0]?.pages).toHaveLength(1);
  });
});
