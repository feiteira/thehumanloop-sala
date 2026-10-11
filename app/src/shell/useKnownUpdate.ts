import { useSyncExternalStore } from 'react';
import { knownUpdate, subscribeUpdates, type UpdateInfo } from '../services/updates';

/** What the last update check found, if one ran (see services/updates.ts). */
export function useKnownUpdate(): UpdateInfo | null {
  return useSyncExternalStore(subscribeUpdates, knownUpdate);
}
