import type { UiLocale } from './core/i18n/locales';
import type { Folder } from './core/model/types';
import { createWebsiteMock } from './demo/websiteMock';
import type { Platform } from './platform/types';
import type { Practice } from './services/practice';

// Sala's bridge to The Human Loop in the open-source edition, which has no connection to it:
// nothing here shows anything or makes a request. (In the full edition this file stands in
// for loopBridge.tsx when the open-source edition is made.)

export type LoopScreenName = string;

export async function attachLoop(_practice: Practice): Promise<void> {}
export function detachLoop(): void {}
export function useLoopJoined(): boolean | null {
  return false;
}
export function LoopScreen(_props: { screen: LoopScreenName; params?: object }): null {
  return null;
}
export function AlertHost(): null {
  return null;
}
export function Companion(_props: { folder: Folder }): null {
  return null;
}
export function LoopHome(): null {
  return null;
}
export function LoopNavItem(_props: { active: boolean }): null {
  return null;
}

export function demoHttp(opts: { locale: UiLocale; latestVersion?: string }): NonNullable<Platform['http']> {
  const website = createWebsiteMock({ latestVersion: opts.latestVersion });
  return { fetch: async (url, init) => (await website(url, init)) ?? new Response(null, { status: 404 }) };
}
export async function joinDemoLoop(_practice: Practice): Promise<void> {}
