import type { I18n } from '../../ui/i18n';
import type { Toasts } from '../../ui/Toast';

/** After an Undo: says so when some records could not be brought back (they stay deleted). */
export function undoneExcept(toast: Toasts, i18n: I18n, failed: number): void {
  if (failed) toast.show({ message: i18n.tp('folder.undoPartial', failed) });
}
