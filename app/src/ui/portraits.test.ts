import { describe, expect, it } from 'vitest';
import { newSeeds, portraitUri } from './portraits';

const svg = (uri: string) => new TextDecoder().decode(Uint8Array.from(atob(uri.replace(/^data:image\/svg\+xml;base64,/, '')), (c) => c.charCodeAt(0)));

describe('drawn portraits', () => {
  it('draw the same face for the same seed, and different faces for different folders', () => {
    expect(portraitUri('folder-1')).toBe(portraitUri('folder-1'));
    const faces = new Set(Array.from({ length: 30 }, (_, i) => portraitUri(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)));
    expect(faces.size).toBe(30);
  });

  it('are drawn here, with nothing to fetch', () => {
    const s = svg(portraitUri('x'));
    expect(s).toMatch(/^<svg/);
    // Its metadata names the artist and licence; nothing in it refers to a file elsewhere.
    expect(s).not.toMatch(/(href|src)\s*=\s*["']https?:|url\(\s*["']?https?:|@import/);
  });

  it('follow the chosen look', () => {
    expect(portraitUri('same', 'feminine')).not.toBe(portraitUri('same', 'masculine'));
    expect(new Set(newSeeds(15)).size).toBe(15);
  });
});
