import type { RestoreResult } from '../../services/trash';
import type { I18n } from '../../ui/i18n';

/** What Restore did: all back, some back, or nothing back (and then whether it was erased). */
export function restoreMessage(r: RestoreResult, item: string, i18n: I18n): string {
  if (!r.failed) return i18n.t('trash.restored', { item });
  if (r.restored) return i18n.tp('folder.undoPartial', r.failed);
  return i18n.t(r.erased ? 'trash.notRestoredErased' : 'trash.notRestored', { item });
}
