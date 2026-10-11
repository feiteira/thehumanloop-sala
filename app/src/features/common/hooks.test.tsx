import React, { useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { DateTime, Settings } from 'luxon';
import { inZone, useNow } from './hooks';

afterEach(() => {
  Settings.now = () => Date.now();
});

function Probe({ tz }: { tz: string }) {
  const now = useNow(tz);
  return <>{`${now.zoneName} ${now.toISODate()}`}</>;
}

describe('useNow', () => {
  it('reads now in the practice zone, whatever the computer’s zone', () => {
    // 22:30 UTC on 30 September: still the 30th in New York, already 1 October in Madrid.
    Settings.now = () => Date.UTC(2026, 8, 30, 22, 30);
    expect(renderToStaticMarkup(<Probe tz="Europe/Madrid" />)).toBe('Europe/Madrid 2026-10-01');
    expect(renderToStaticMarkup(<Probe tz="America/New_York" />)).toBe('America/New_York 2026-09-30');
  });

  it('reads the new zone in the very first render after the zone changes', () => {
    Settings.now = () => Date.UTC(2026, 8, 30, 22, 30);
    const seen: string[] = [];
    // The zone arrives after the first render, as when the practice setting loads. Setting
    // state during render re-renders at once with the hooks' state kept, and no effect runs
    // in between, so a zone applied by an effect would still show New York the second time.
    function Switching() {
      const [tz, setTz] = useState('America/New_York');
      const now = useNow(tz);
      seen.push(`${now.zoneName} ${now.toISODate()}`);
      if (tz !== 'Europe/Madrid') setTz('Europe/Madrid');
      return null;
    }
    renderToStaticMarkup(<Switching />);
    expect(seen).toEqual(['America/New_York 2026-09-30', 'Europe/Madrid 2026-10-01']);
  });

  it('applies the zone to any instant, keeping the moment', () => {
    const instant = DateTime.fromISO('2026-09-30T22:30:00Z', { zone: 'utc' });
    const madrid = inZone(instant, 'Europe/Madrid');
    expect(madrid.zoneName).toBe('Europe/Madrid');
    expect(madrid.toISODate()).toBe('2026-10-01');
    expect(madrid.toMillis()).toBe(instant.toMillis());
    expect(inZone(madrid, 'Europe/Madrid')).toBe(madrid);
  });
});
