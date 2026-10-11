import { describe, expect, it } from 'vitest';
import { createMemoryPlatform } from '../platform/memory';
import { checkForUpdate, compareVersions, dailyCheck, knownUpdate, MANIFEST_URL, setDailyCheck } from './updates';

/** A device whose "website" answers with the given manifest, counting requests. */
function device(manifest: unknown, status = 200) {
  const requests: string[] = [];
  const platform = createMemoryPlatform({
    http: {
      fetch: async (url: string) => {
        requests.push(url);
        if (status === 0) throw new TypeError('offline');
        return new Response(JSON.stringify(manifest), { status, headers: { 'content-type': 'application/json' } });
      },
    },
  });
  // This device runs 0.1.0, whatever the app's own version is.
  const info = platform.info;
  platform.info = async () => ({ ...(await info()), version: '0.1.0' });
  return { platform, requests };
}

const at = (iso: string) => new Date(iso);

describe('update check', () => {
  it('compares versions as numbers, with pre-releases before their release', () => {
    expect(compareVersions('0.10.0', '0.9.2')).toBe(1);
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0);
    expect(compareVersions('0.1.0', '0.1.1')).toBe(-1);
    expect(compareVersions('1.0.0', '1.0.0-beta.2')).toBe(1);
    expect(compareVersions('1.0.0-beta.10', '1.0.0-beta.2')).toBe(1);
    expect(compareVersions('v0.2', '0.1.9')).toBe(1);
  });

  it('asks only for the public manifest, and reports a newer version', async () => {
    const { platform, requests } = device({ product: 'Sala', version: '0.2.0', published: '2026-10-05T10:00:00Z' });
    const info = await checkForUpdate(platform);
    expect(requests).toEqual([MANIFEST_URL]);
    expect(info).toEqual({ current: '0.1.0', latest: '0.2.0', published: '2026-10-05T10:00:00Z', newer: true });
    expect(knownUpdate()?.newer).toBe(true);
  });

  it('says so when this is the latest version', async () => {
    const { platform } = device({ version: '0.1.0' });
    expect((await checkForUpdate(platform)).newer).toBe(false);
  });

  it('makes no request until the therapist turns the daily check on', async () => {
    const { platform, requests } = device({ version: '0.2.0' });
    expect(await dailyCheck(platform)).toBeNull();
    await setDailyCheck(platform, false);
    expect(await dailyCheck(platform)).toBeNull();
    expect(requests).toEqual([]);
  });

  it('checks at most once a day, and remembers the answer in between', async () => {
    const { platform, requests } = device({ version: '0.2.0' });
    await setDailyCheck(platform, true);
    expect((await dailyCheck(platform, at('2026-10-06T09:00:00Z')))?.latest).toBe('0.2.0');
    expect((await dailyCheck(platform, at('2026-10-06T20:00:00Z')))?.newer).toBe(true);
    expect(requests).toHaveLength(1);
    await dailyCheck(platform, at('2026-10-07T09:30:00Z'));
    expect(requests).toHaveLength(2);
  });

  it('stays quiet when the website cannot be reached or read', async () => {
    const offline = device({}, 0);
    await setDailyCheck(offline.platform, true);
    expect(await dailyCheck(offline.platform)).toBeNull();
    await expect(checkForUpdate(offline.platform)).rejects.toThrow();
    await expect(checkForUpdate(device({ version: 'latest!' }).platform)).rejects.toThrow();
    await expect(checkForUpdate(device({ version: '0.2.0' }, 404).platform)).rejects.toThrow();
  });
});
