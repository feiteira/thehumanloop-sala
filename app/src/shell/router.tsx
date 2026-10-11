import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { LoopScreenName } from '../loopBridge';

export type FolderTab = 'pages' | 'themes' | 'calendar' | 'documents' | 'history' | 'companion';

export type Route =
  | { name: 'today' }
  | { name: 'shelf'; archived?: boolean; q?: string; tag?: string }
  | { name: 'folder'; id: string; tab?: FolderTab; pageId?: string; /** A marked passage of that page, selected in its note. */ passage?: string }
  | { name: 'calendar'; date?: string; view?: 'week' | 'day' }
  | { name: 'import' }
  | { name: 'settings'; section?: string }
  | { name: 'help'; topic?: string }
  | { name: 'loopHome' }
  | { name: 'loop'; screen: LoopScreenName; params?: object };

/** One place in the history. `key` stays the same while the place is only updated (`replace`). */
export interface Entry {
  key: number;
  route: Route;
}

interface RouterValue {
  route: Route;
  /** The current place's key: a screen keyed on it keeps its state through `replace`. */
  routeKey: number;
  /** Goes to `route`, unless it is where we already are. */
  go: (route: Route) => void;
  /** Changes the current place without adding a step to Back. */
  replace: (route: Route) => void;
  /** Rewrites the place `key` wherever it is in the history (a screen saving its filters as it is left). */
  update: (key: number, route: Route) => void;
  back: () => void;
  /** Removes every visit to a folder from the history, so Back never returns to a deleted folder. */
  dropFolder: (id: string) => void;
  canGoBack: boolean;
}

const MAX_STEPS = 50;

/** A route as a comparable string; fields left undefined do not count. */
export function routeId(route: Route): string {
  const clean = Object.entries(route)
    .filter(([, v]) => v !== undefined && v !== '' && v !== false)
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(clean);
}

export const sameRoute = (a: Route, b: Route): boolean => routeId(a) === routeId(b);

/** Adds a step, unless it is the place already showing. */
export function pushEntry(stack: Entry[], route: Route, key: number): Entry[] {
  const top = stack[stack.length - 1];
  if (top && sameRoute(top.route, route)) return stack;
  return [...stack.slice(-(MAX_STEPS - 1)), { key, route }];
}

/**
 * Rewrites the place `key` wherever it is in the history, keeping its key. The same history
 * when that place is gone or already says so.
 */
export function updateEntry(stack: Entry[], key: number, route: Route): Entry[] {
  if (!stack.some((e) => e.key === key && !sameRoute(e.route, route))) return stack;
  return stack.map((e) => (e.key === key ? { key, route } : e));
}

/** Takes a folder out of the history; neighbours left equal are joined. Never empty. */
export function dropFolderEntries(stack: Entry[], id: string, fallback: Entry): Entry[] {
  const kept: Entry[] = [];
  for (const e of stack) {
    if (e.route.name === 'folder' && e.route.id === id) continue;
    const prev = kept[kept.length - 1];
    if (prev && sameRoute(prev.route, e.route)) kept[kept.length - 1] = e;
    else kept.push(e);
  }
  return kept.length ? kept : [fallback];
}

const RouterContext = createContext<RouterValue | null>(null);

export function RouterProvider({ initial, children }: { initial: Route; children: ReactNode }) {
  const seq = useRef(0);
  const [stack, setStack] = useState<Entry[]>(() => [{ key: 0, route: initial }]);
  const go = useCallback((route: Route) => setStack((s) => pushEntry(s, route, ++seq.current)), []);
  const replace = useCallback(
    (route: Route) => setStack((s) => [...s.slice(0, -1), { key: s[s.length - 1]?.key ?? ++seq.current, route }]),
    [],
  );
  const update = useCallback((key: number, route: Route) => setStack((s) => updateEntry(s, key, route)), []);
  const back = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const dropFolder = useCallback(
    (id: string) => setStack((s) => dropFolderEntries(s, id, { key: ++seq.current, route: { name: 'shelf' } })),
    [],
  );
  const value = useMemo(() => {
    const top = stack[stack.length - 1]!;
    return { route: top.route, routeKey: top.key, go, replace, update, back, dropFolder, canGoBack: stack.length > 1 };
  }, [stack, go, replace, update, back, dropFolder]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  const r = useContext(RouterContext);
  if (!r) throw new Error('useRouter outside RouterProvider');
  return r;
}

/**
 * For a screen that changes what it shows in place, like the sections of Settings: keeps its
 * own step in the history naming what is on screen, so F1, Back and unlocking after an idle
 * lock find the same view. Adds no step to Back.
 */
export function useKeepRoute(route: Route): void {
  const { update, routeKey } = useRouter();
  const key = useRef(routeKey);
  const latest = useRef(route);
  latest.current = route;
  const id = routeId(route);
  useEffect(() => update(key.current, latest.current), [id, update]);
}
