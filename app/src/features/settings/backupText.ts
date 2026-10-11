import type { BackupErrorCode } from '../../services/data';
import type { I18n } from '../../ui/i18n';

/** What went wrong with a backup, in words the therapist can act on. */
export function backupErrorText(t: I18n['t'], code: BackupErrorCode): string {
  switch (code) {
    case 'FOLDER_MISSING':
      return t('status.errorFolderMissing');
    case 'PERMISSION':
      return t('status.errorPermission');
    case 'DISK_FULL':
      return t('status.errorDiskFull');
    default:
      return t('status.errorGeneric');
  }
}
