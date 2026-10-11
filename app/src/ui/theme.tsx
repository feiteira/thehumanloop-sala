import React, { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import type { FolderColour, StickyColour } from '../core/model/types';

// Design tokens. Ink teal carries the furniture; burnt yellow is kept for meaning
// (primary actions, focus, the human moments). Dark mode is never pure black and
// gains depth from lighter surfaces rather than shadows. Text and focus colours meet WCAG AA
// on the surfaces they are used on; theme.test.ts checks every pair, so add new pairs there.

export interface Palette {
  background: string;
  surface: string;
  surfaceAlt: string;
  surfaceSunken: string;
  border: string;
  divider: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  textDisabled: string;
  primary: string;
  onPrimary: string;
  primarySubtle: string;
  accent: string;
  accentPressed: string;
  onAccent: string;
  accentText: string;
  cream: string;
  /** Keyboard focus rings: 3:1 or more against every surface. */
  focus: string;
  /** The brand's ink tile in both themes (Sala mark, The Human Loop item, BETA ribbon, toasts); `accent` reads on it too. */
  ink: string;
  onInk: string;
  successBg: string;
  successText: string;
  warningBg: string;
  warningText: string;
  infoBg: string;
  infoText: string;
  dangerBg: string;
  dangerBorder: string;
  dangerText: string;
  overlay: string;
  shadow: string;
  primaryStrong: string;
  primarySubtleStrong: string;
  dangerBgAlt: string;
  dangerTextStrong: string;
  disabledBg: string;
  disabledText: string;
  timeTextOnPrimary: string;
  folder: Record<FolderColour, string>;
  sticky: Record<StickyColour, { bg: string; text: string; edge: string }>;
}

const light: Palette = {
  background: '#F4F3ED',
  surface: '#FFFFFF',
  surfaceAlt: '#EFF3F2',
  surfaceSunken: '#EAEBE2',
  border: '#D8DDD8',
  divider: '#E3E6DF',
  text: '#122A31',
  textSecondary: '#445E67',
  textMuted: '#4F6A73',
  textDisabled: '#ADBEC1',
  primary: '#16323A',
  onPrimary: '#FFFFFF',
  primarySubtle: '#E4ECEB',
  accent: '#F2BC45',
  accentPressed: '#C4830D',
  onAccent: '#0A181D',
  accentText: '#8A5B06',
  cream: '#FBF3E4',
  focus: '#8A5B06',
  ink: '#16323A',
  onInk: '#FFFFFF',
  successBg: '#DDF0E4',
  successText: '#1F6B43',
  warningBg: '#FBEFD3',
  warningText: '#8A5B06',
  infoBg: '#E3EDF0',
  infoText: '#22515C',
  dangerBg: '#F9E0DC',
  dangerBorder: '#E5AC9E',
  dangerText: '#A33022',
  overlay: 'rgba(10,24,29,0.5)',
  shadow: 'rgba(16,38,44,0.08)',
  primaryStrong: '#0F252B',
  primarySubtleStrong: '#D8E5E2',
  dangerBgAlt: '#FBE9E5',
  dangerTextStrong: '#8A241A',
  disabledBg: '#EFEAE0',
  disabledText: '#A99F90',
  timeTextOnPrimary: 'rgba(255,255,255,0.65)',
  folder: {
    teal: '#2F6B75',
    sage: '#6E98A1',
    yellow: '#E0A526',
    coral: '#D0674F',
    blue: '#3F6FB0',
    plum: '#7D5A8C',
    sand: '#B39564',
    grey: '#7E8C8F',
  },
  sticky: {
    yellow: { bg: '#FCE9A8', text: '#3D2F05', edge: '#E8C95E' },
    pink: { bg: '#F8D3D0', text: '#4A1A15', edge: '#E3A49D' },
    green: { bg: '#D6EDD9', text: '#173A22', edge: '#9FCDA8' },
    blue: { bg: '#D5E6F2', text: '#16324A', edge: '#9DC1DC' },
  },
};

const dark: Palette = {
  background: '#0A181D',
  surface: '#10262C',
  surfaceAlt: '#16323A',
  surfaceSunken: '#071114',
  border: '#2A4B53',
  divider: '#1D3840',
  text: '#E7EFEC',
  textSecondary: '#A0B9BE',
  textMuted: '#90ACB2',
  textDisabled: '#56727A',
  primary: '#7FA3AB',
  onPrimary: '#0A181D',
  primarySubtle: '#1E4149',
  accent: '#F2BC45',
  accentPressed: '#F6CE7B',
  onAccent: '#0A181D',
  accentText: '#F2BC45',
  cream: '#1E4149',
  focus: '#F2BC45',
  ink: '#24505A',
  onInk: '#E7EFEC',
  successBg: '#1E4634',
  successText: '#7ED9A5',
  warningBg: '#4A3714',
  warningText: '#F2BC45',
  infoBg: '#173B44',
  infoText: '#8FC3CD',
  dangerBg: '#4A201B',
  dangerBorder: '#8C4535',
  dangerText: '#F1998C',
  overlay: 'rgba(3,9,11,0.6)',
  shadow: 'rgba(3,9,11,0.4)',
  primaryStrong: '#B7D3D9',
  primarySubtleStrong: '#24505A',
  dangerBgAlt: '#3A1B16',
  dangerTextStrong: '#F5B3A6',
  disabledBg: '#2B2138',
  disabledText: '#6E6478',
  timeTextOnPrimary: 'rgba(10,24,29,0.65)',
  folder: {
    teal: '#5FA3AE',
    sage: '#8FB5BD',
    yellow: '#F2BC45',
    coral: '#EB8B74',
    blue: '#7FA6DD',
    plum: '#B08CC0',
    sand: '#D1B684',
    grey: '#A3B1B4',
  },
  sticky: {
    yellow: { bg: '#5A4A1A', text: '#FCEFC4', edge: '#7A652A' },
    pink: { bg: '#553030', text: '#F9DDDA', edge: '#774545' },
    green: { bg: '#27432F', text: '#DDF2E1', edge: '#3B5E45' },
    blue: { bg: '#243E52', text: '#DCEBF6', edge: '#355872' },
  },
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;
export const radius = { sm: 6, md: 10, lg: 16, xl: 24, pill: 999 } as const;

// Brand type (ui/fonts.css): Alegreya Sans for UI text, which react-native-web already uses
// by default (see vite.config.ts), and the Alegreya serif for display text.
export const font = {
  sans: '"Alegreya Sans", "Segoe UI", system-ui, -apple-system, Roboto, "Noto Sans", Ubuntu, sans-serif',
  serif: 'Alegreya, Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, "Cascadia Mono", "DejaVu Sans Mono", Menlo, monospace',
} as const;

export const type = {
  display: { fontSize: 28, lineHeight: 34, fontWeight: '600' as const, fontFamily: font.serif },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '600' as const },
  heading: { fontSize: 17, lineHeight: 24, fontWeight: '600' as const },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' as const },
  small: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '600' as const },
  tiny: { fontSize: 12, lineHeight: 16, fontWeight: '500' as const },
};

export type ThemeMode = 'system' | 'light' | 'dark';

export interface Theme {
  scheme: 'light' | 'dark';
  c: Palette;
}

const ThemeContext = createContext<Theme>({ scheme: 'light', c: light });

export function ThemeProvider({ mode, children }: { mode: ThemeMode; children: ReactNode }) {
  const system = useColorScheme();
  const scheme = mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : mode;
  const value = useMemo<Theme>(() => ({ scheme, c: scheme === 'dark' ? dark : light }), [scheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = (): Theme => useContext(ThemeContext);

export const palettes = { light, dark };
