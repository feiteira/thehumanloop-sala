import React from 'react';
import { useI18n } from '../ui/i18n';
import { IconButton } from '../ui/primitives';
import { useRouter } from './router';

/** The "?" on each main screen: opens the manual at the matching section. */
export function HelpButton({ topic }: { topic: string }) {
  const { t } = useI18n();
  const { go } = useRouter();
  return <IconButton icon="help" label={t('help.openHelp')} onPress={() => go({ name: 'help', topic })} testID={`help-${topic}`} />;
}
