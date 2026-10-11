import { describe, expect, it } from 'vitest';
import { makeI18n } from '../../ui/i18n';
import { restoreMessage } from './trashText';

const en = makeI18n('en');
const item = 'Page of 17 Aug 2026';

describe('what Restore says', () => {
  it('says it is back when everything came back', () => {
    expect(restoreMessage({ restored: 3, failed: 0, erased: 0 }, item, en)).toBe('Restored: Page of 17 Aug 2026');
  });

  it('says what did not come back when some did', () => {
    expect(restoreMessage({ restored: 2, failed: 1, erased: 1 }, item, en)).toBe('Brought back, except 1 item that could not be restored.');
  });

  it('never says "brought back" when nothing came back, and says when it was erased', () => {
    expect(restoreMessage({ restored: 0, failed: 1, erased: 1 }, item, en)).toMatch(/^Could not restore Page of 17 Aug 2026, because .* no longer on this computer/);
    expect(restoreMessage({ restored: 0, failed: 1, erased: 0 }, item, en)).toBe('Could not restore Page of 17 Aug 2026. It is still in Recently deleted.');
  });
});
