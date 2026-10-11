import { DateTime } from 'luxon';
import { newRecoveryPhrase } from '../core/crypto/keyring';
import type { UiLocale } from '../core/i18n/locales';
import type { Platform } from '../platform/types';
import { Practice } from './practice';

/** The example practice's passphrase, shown on its lock screen. */
export const EXAMPLE_PASSPHRASE = 'sala';

/**
 * Fills the example practice (the "Sala (example)" launcher) with the fictional demo practice,
 * dated around today, and locks it. The desktop shell empties its folder at every start and exit.
 */
export async function createExamplePractice(platform: Platform, locale: UiLocale): Promise<void> {
  const { seedDemoPractice } = await import('../demo/demoPractice');
  const practice = await Practice.create(platform, { passphrase: EXAMPLE_PASSPHRASE, recoveryPhrase: newRecoveryPhrase() });
  await seedDemoPractice(practice.store, locale, DateTime.now().setZone('Europe/Lisbon'));
  await practice.lock();
}
