import { createAvatar } from '@dicebear/core';
import * as personas from '@dicebear/personas';
import type { PortraitLook } from '../core/model/types';

// Drawn portraits for folders: "Personas" by Draftbit (CC BY 4.0), drawn on this device by
// DiceBear (MIT). Nothing is fetched. The same seed and look always draw the same face.

type Options = Partial<personas.Options>;

// A calm, friendly selection: natural hair colours, soft clothing colours, open or smiling
// eyes and a smile. Repeating an entry makes it more likely (glasses on about one face in six).
const BASE: Options = {
  body: ['squared', 'rounded', 'small', 'checkered'],
  clothingColor: ['e98a6d', '6b8fc7', '5fb3a8', '8f7cc4', '7fb069', 'f2bc45', 'd98aa0', '8a9aa8'],
  eyes: ['open', 'open', 'open', 'happy', 'happy', 'glasses'],
  mouth: ['smile', 'bigSmile', 'lips'],
  hairColor: ['2c1b18', '4a312c', '724133', 'a55728', 'b58143', 'd6b370', 'b8b8b8'],
  facialHair: ['beardMustache', 'goatee', 'shadow'],
};

type Hair = NonNullable<personas.Options['hair']>;
const LONGER: Hair = ['long', 'bobCut', 'curly', 'curlyBun', 'bobBangs', 'straightBun', 'extraLong', 'bunUndercut'];
const SHORTER: Hair = ['shortCombover', 'curlyHighTop', 'buzzcut', 'bald', 'balding', 'fade', 'shortComboverChops'];

const LOOKS: Record<PortraitLook, Options> = {
  any: { hair: [...LONGER, ...SHORTER], facialHairProbability: 10 },
  feminine: { hair: LONGER, facialHairProbability: 0 },
  masculine: { hair: SHORTER, facialHairProbability: 35 },
};

const cache = new Map<string, string>();

/** The portrait as an SVG data URL, on a transparent background. */
export function portraitUri(seed: string, look: PortraitLook = 'any'): string {
  const key = `${look}:${seed}`;
  let uri = cache.get(key);
  if (!uri) {
    if (cache.size > 600) cache.clear();
    // Base64, not DiceBear's utf8 data URL: react-native-web encodes utf8 SVG URLs again, which breaks them.
    uri = `data:image/svg+xml;base64,${base64(createAvatar(personas, { seed, ...BASE, ...LOOKS[look] }).toString())}`;
    cache.set(key, uri);
  }
  return uri;
}

function base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Fresh seeds for a gallery of portraits to choose from. */
export function newSeeds(n: number): string[] {
  return Array.from({ length: n }, () => Math.random().toString(36).slice(2, 12));
}
