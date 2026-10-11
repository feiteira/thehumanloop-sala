import { describe, expect, it } from 'vitest';
import { TOPICS } from '../features/help/manual';
import { helpTopicFor } from './helpTopic';
import type { Route } from './router';

describe('helpTopicFor', () => {
  it('opens a section of the manual for every screen', () => {
    const routes: Route[] = [
      { name: 'today' }, { name: 'shelf', q: 'ana' }, { name: 'calendar' }, { name: 'import' },
      { name: 'folder', id: 'x' }, { name: 'folder', id: 'x', tab: 'calendar' }, { name: 'folder', id: 'x', tab: 'documents' },
      { name: 'folder', id: 'x', tab: 'themes' }, { name: 'folder', id: 'x', tab: 'history' },
      { name: 'settings' }, { name: 'settings', section: 'backup' }, { name: 'settings', section: 'data' }, { name: 'settings', section: 'privacy' }, { name: 'settings', section: 'calendar' },
      { name: 'settings', section: 'about' }, { name: 'settings', section: 'security' }, { name: 'settings', section: 'general' },
    ];
    for (const r of routes) expect(TOPICS[helpTopicFor(r)!], JSON.stringify(r)).toBeDefined();
    expect(helpTopicFor({ name: 'folder', id: 'x', tab: 'calendar' })).toBe('appointment');
    expect(helpTopicFor({ name: 'folder', id: 'x', tab: 'themes' })).toBe('themes');
    expect(helpTopicFor({ name: 'help', topic: 'shelf' })).toBeNull();
  });

  it('follows the section of Settings on screen, General when none is named', () => {
    expect(helpTopicFor({ name: 'settings' })).toBe('unlock');
    expect(helpTopicFor({ name: 'settings', section: 'general' })).toBe('unlock');
    expect(helpTopicFor({ name: 'settings', section: 'backup' })).toBe('settings');
    expect(helpTopicFor({ name: 'settings', section: 'data' })).toBe('export');
    expect(helpTopicFor({ name: 'settings', section: 'privacy' })).toBe('privacy');
  });
});
