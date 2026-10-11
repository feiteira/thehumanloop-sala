import { describe, expect, it } from 'vitest';
import { type Palette, palettes } from './theme';

// WCAG 2.1 contrast: 4.5:1 for text (most of Sala's text is 12–15 px), 3:1 for focus rings
// against what they are drawn over. The pairs are the ones the screens use; a new pairing
// of text and background belongs here too.

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

type Key = { [K in keyof Palette]: Palette[K] extends string ? K : never }[keyof Palette];

const SURFACES: Key[] = ['background', 'surface', 'surfaceAlt', 'surfaceSunken', 'primarySubtle'];

const TEXT: [Key, Key[]][] = [
  // Body, secondary and muted text sit on every surface, including selected rows (primarySubtle).
  ['text', [...SURFACES, 'cream']],
  ['textSecondary', [...SURFACES, 'cream']],
  ['textMuted', SURFACES],
  // Links and accent text; status text in notices, badges and the sidebar's backup line.
  ['accentText', ['background', 'surface', 'surfaceAlt', 'cream']],
  ['successText', ['successBg', 'surface']],
  ['warningText', ['warningBg', 'surface']],
  ['infoText', ['infoBg', 'surface']],
  ['dangerText', ['dangerBg', 'surface', 'background']],
  // Text on filled controls and on the ink tile.
  ['onAccent', ['accent']],
  ['onPrimary', ['primary']],
  ['onInk', ['ink']],
  ['accent', ['ink']],
];

describe.each(['light', 'dark'] as const)('%s theme', (scheme) => {
  const c = palettes[scheme];

  it.each(TEXT)('%s reads at 4.5:1', (fg, bgs) => {
    for (const bg of bgs) expect(contrast(c[fg], c[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });

  it('sticky note text reads at 4.5:1', () => {
    for (const [name, s] of Object.entries(c.sticky)) expect(contrast(s.text, s.bg), name).toBeGreaterThanOrEqual(4.5);
  });

  it('focus rings stand out at 3:1 from every surface', () => {
    for (const bg of [...SURFACES, 'cream'] as Key[]) expect(contrast(c.focus, c[bg]), `focus on ${bg}`).toBeGreaterThanOrEqual(3);
  });

  it('keeps primary, secondary and muted text in that order', () => {
    const order = [c.text, c.textSecondary, c.textMuted].map((x) => contrast(x, c.background));
    expect(order[0]).toBeGreaterThan(order[1]!);
    expect(order[1]).toBeGreaterThan(order[2]!);
  });
});
