import { describe, expect, it } from 'vitest';
import { composition } from '../export/fhir';
import { isBlankPage, pageText, sectionsOf } from './sections';
import type { Page } from './types';
import { validate, ValidationError } from './validate';

const page = (p: Partial<Page>): Page => ({
  id: 'p1', created_at: '2026-09-21T09:00:00.000Z', updated_at_hlc: '', deleted: false, folder_id: 'f1', date: '2026-09-21', time: null,
  duration_min: null, template: 'free', title: '', sections: {}, process_note: '', import_provenance: null, ...p,
});

describe('sectionsOf', () => {
  it('lists the template’s sections first, empty ones too, then text kept from an earlier template', () => {
    // An imported page (free text) switched to DAP.
    const p = page({ template: 'dap', sections: { body: 'Imported notes', data: 'Slept badly', plan: '', zeta: 'From elsewhere', history: '   ' } });
    expect(sectionsOf(p)).toEqual([
      { key: 'data', text: 'Slept badly', inTemplate: true },
      { key: 'assessment', text: '', inTemplate: true },
      { key: 'plan', text: '', inTemplate: true },
      { key: 'body', text: 'Imported notes', inTemplate: false },
      { key: 'zeta', text: 'From elsewhere', inTemplate: false },
    ]);
  });

  it('knows the intake template', () => {
    expect(sectionsOf(page({ template: 'intake' })).map((s) => s.key)).toEqual(['reason', 'history', 'observations', 'formulation', 'plan']);
  });

  it('gives previews in reading order and tells blank pages apart', () => {
    const p = page({ template: 'soap', sections: { plan: 'Review', subjective: 'Tired', body: 'Old  notes' } });
    expect(pageText(p)).toBe('Tired Review Old notes');
    expect(isBlankPage(page({ sections: { body: '  ' } }))).toBe(true);
    expect(isBlankPage(page({ process_note: 'Mine' }))).toBe(false);
    expect(isBlankPage(page({ title: 'Intake' }))).toBe(false);
  });
});

describe('FHIR composition', () => {
  it('includes text from an earlier template', () => {
    const c = composition(page({ template: 'dap', sections: { data: 'Slept badly', body: 'Imported notes' } }), (_t, key) => key.toUpperCase(), false);
    expect(c.section.map((s) => s.title)).toEqual(['DATA', 'BODY']);
    expect(c.section[1]!.text.div).toContain('Imported notes');
  });
});

describe('validate page', () => {
  const draft = (date: string) => {
    const { id: _i, created_at: _c, updated_at_hlc: _h, deleted: _d, ...rest } = page({ date });
    return rest;
  };
  it('refuses a date that does not exist', () => {
    expect(() => validate('page', draft('2026-02-30'))).toThrow(ValidationError);
    expect(() => validate('page', draft('2026-13-01'))).toThrow(ValidationError);
    expect(validate('page', draft('2028-02-29')).date).toBe('2028-02-29');
  });
  it('accepts the intake template and keeps sections of another template', () => {
    const v = validate('page', { ...draft('2026-09-21'), template: 'intake', sections: { reason: 'Sleep', data: 'Kept' } });
    expect(v.sections).toEqual({ reason: 'Sleep', history: '', observations: '', formulation: '', plan: '', data: 'Kept' });
  });
});
