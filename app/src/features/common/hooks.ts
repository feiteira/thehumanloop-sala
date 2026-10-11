import { useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { usePractice } from '../../shell/AppState';
import { deviceTimeZone, practiceTimeZone, SETTING } from '../../services/settings';

/** The practice's time zone (a setting), falling back to the computer's. */
export function usePracticeTz(): string {
  const practice = usePractice();
  const [tz, setTz] = useState(deviceTimeZone());
  useEffect(() => {
    const load = () => void practiceTimeZone(practice.store).then(setTz);
    load();
    return practice.store.subscribe((kinds) => kinds.has('setting') && load());
  }, [practice]);
  return tz;
}

/** `instant` seen in `tz`: the same moment, with dates and hours read in that zone. */
export function inZone(instant: DateTime, tz: string): DateTime {
  return instant.zoneName === tz ? instant : instant.setZone(tz);
}

/**
 * "Now" in the practice time zone, refreshed every minute. The zone is applied while
 * rendering, so the first render after the zone changes already reads the new zone's date.
 */
export function useNow(tz: string): DateTime {
  const [now, setNow] = useState(() => DateTime.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(DateTime.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return useMemo(() => inZone(now, tz), [now, tz]);
}

/** How long typing pauses before a search runs. */
export const SEARCH_PAUSE_MS = 150;

/**
 * What is typed in a search field, once typing pauses: a search reads every folder, so it runs
 * when the therapist stops, not on every key. Emptying the field counts at once.
 */
export function useSettledText(text: string, ms = SEARCH_PAUSE_MS): string {
  const [settled, setSettled] = useState(text);
  const empty = !text.trim();
  useEffect(() => {
    if (empty) return setSettled(text);
    const timer = setTimeout(() => setSettled(text), ms);
    return () => clearTimeout(timer);
  }, [text, ms, empty]);
  return empty ? text : settled;
}

export { SETTING };
