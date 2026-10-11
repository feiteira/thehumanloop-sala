import type { ExportLabels } from '../core/export/sala';
import { KNOWN_SECTIONS } from '../core/model/sections';
import type { I18n, MessageKey } from '../ui/i18n';

/** A section's title: the translated name, or the key itself for a section Sala does not know. */
export function sectionLabel(i18n: Pick<I18n, 't'>, key: string): string {
  return KNOWN_SECTIONS.includes(key) ? i18n.t(`page.sections.${key}` as MessageKey) : key;
}

export function exportLabels(i18n: I18n): ExportLabels {
  return {
    sectionTitle: (template, key) =>
      template === 'private' ? i18n.t('exportLabels.processNoteHeading') : sectionLabel(i18n, key),
    neutralAppointment: i18n.t('calendar.neutralTitle'),
    stickyHeading: i18n.t('exportLabels.stickyHeading'),
    themesHeading: i18n.t('exportLabels.themesHeading'),
    processNoteHeading: i18n.t('exportLabels.processNoteHeading'),
    readme: i18n.t('exportLabels.readme'),
  };
}
