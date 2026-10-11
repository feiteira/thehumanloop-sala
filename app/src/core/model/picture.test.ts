import { describe, expect, it } from 'vitest';
import { patient } from '../export/fhir';
import { emptyContact, type Draft, type Folder } from './types';
import { validate, ValidationError } from './validate';

const folder = (picture: unknown): Draft<'folder'> =>
  ({ label: 'Ana', colour: 'teal', status: 'active', tags: [], contact: emptyContact(), cover_note: '', archived_at: null, merged_into: null, picture }) as Draft<'folder'>;

const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';

describe('folder pictures', () => {
  it('accepts no picture, a drawn portrait, or a small photo', () => {
    expect(() => validate('folder', folder(undefined))).not.toThrow();
    expect(() => validate('folder', folder(null))).not.toThrow();
    expect(() => validate('folder', folder({ kind: 'drawn', seed: 'abc123', look: 'feminine' }))).not.toThrow();
    expect(() => validate('folder', folder({ kind: 'photo', data: PHOTO }))).not.toThrow();
  });

  it('refuses anything else', () => {
    for (const bad of [
      { kind: 'drawn', seed: '', look: 'any' },
      { kind: 'drawn', seed: 'x', look: 'female' },
      { kind: 'photo', data: 'https://example.com/me.jpg' },
      { kind: 'photo', data: 'data:image/svg+xml;base64,PHN2Zz4=' },
      { kind: 'photo', data: `data:image/jpeg;base64,${'A'.repeat(200_001)}` },
      { kind: 'video' },
    ]) {
      expect(() => validate('folder', folder(bad)), JSON.stringify(bad).slice(0, 60)).toThrow(ValidationError);
    }
  });

  it('exports a photo in FHIR, but not a drawn portrait', () => {
    const base = { ...folder(null), id: 'f1', created_at: '', updated_at_hlc: '', deleted: false } as Folder;
    expect(patient({ ...base, picture: { kind: 'photo', data: PHOTO } }).photo).toEqual([{ contentType: 'image/jpeg', data: '/9j/4AAQSkZJRgABAQ==' }]);
    expect(patient({ ...base, picture: { kind: 'drawn', seed: 'x', look: 'any' } })).not.toHaveProperty('photo');
  });
});
