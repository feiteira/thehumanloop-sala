import { DateTime } from 'luxon';
import type { Route } from './router';

// Where the therapist was when Sala locked itself, so unlocking takes them back there. Kept
// in memory only: it never reaches the disk, and closing Sala forgets it.

interface Saved {
  practiceId: string;
  route: Route;
  /** The practice's time zone, in which "the same day" is judged. */
  tz: string;
  at: number;
}

/** Places worth returning to. The Human Loop's screens reload what they show, so not those. */
function resumable(route: Route): boolean {
  return route.name !== 'loop' && route.name !== 'loopHome';
}

const dayOf = (at: number, tz: string) => DateTime.fromMillis(at, { zone: tz }).toISODate();

export class ResumePoint {
  private saved: Saved | null = null;

  /** After an idle lock: remember where the practice was. `tz` is the practice's time zone. */
  remember(practiceId: string, route: Route, tz: string, at = Date.now()): void {
    this.saved = resumable(route) ? { practiceId, route, tz, at } : null;
  }

  /** After a lock the therapist chose, or when the practice goes away. */
  forget(): void {
    this.saved = null;
  }

  /**
   * The place to return to when `practiceId` is unlocked, once. Only on the same day as the
   * lock, in the practice's time zone: a new day starts on Today.
   */
  take(practiceId: string, now = Date.now()): Route | null {
    const s = this.saved;
    this.saved = null;
    if (!s || s.practiceId !== practiceId || now < s.at || dayOf(s.at, s.tz) !== dayOf(now, s.tz)) return null;
    return s.route;
  }
}
