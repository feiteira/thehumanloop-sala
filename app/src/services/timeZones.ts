import { DateTime } from 'luxon';
import type { UiLocale } from '../core/i18n/locales';
import { fold } from '../core/text/normalize';

// Choosing the practice's time zone: Portugal's and Spain's first, then every zone the
// computer knows, found by city, country or region in any of Sala's languages.

/** Portugal's and Spain's zones, shown first. */
export const IBERIAN_ZONES = ['Europe/Lisbon', 'Atlantic/Madeira', 'Atlantic/Azores', 'Europe/Madrid', 'Atlantic/Canary', 'Africa/Ceuta'] as const;

/**
 * Names a therapist may type that IANA ids do not contain: Portuguese and Spanish city and
 * country names for the places most PT/ES practices deal with. `pt` and `es` are also the
 * names shown in those languages.
 */
const NAMES: Record<string, { en?: string; pt?: string; es?: string; also?: string[] }> = {
  'Europe/Lisbon': { pt: 'Lisboa', es: 'Lisboa', also: ['Portugal', 'Porto', 'Oporto', 'Coimbra', 'Faro'] },
  'Atlantic/Madeira': { also: ['Funchal'] },
  'Atlantic/Azores': { en: 'Azores', pt: 'Açores', es: 'Azores', also: ['Ponta Delgada'] },
  'Europe/Madrid': { also: ['España', 'Espanha', 'Spain', 'Barcelona', 'Valencia', 'Sevilla', 'Bilbao', 'Zaragoza', 'Málaga'] },
  'Atlantic/Canary': { en: 'Canary Islands', pt: 'Canárias', es: 'Canarias', also: ['Las Palmas', 'Tenerife'] },
  'Africa/Ceuta': { also: ['Melilla'] },
  'Europe/London': { pt: 'Londres', es: 'Londres', also: ['United Kingdom', 'Reino Unido', 'England'] },
  'Europe/Dublin': { also: ['Irlanda', 'Ireland'] },
  'Europe/Paris': { pt: 'Paris', es: 'París', also: ['França', 'Francia', 'France'] },
  'Europe/Berlin': { pt: 'Berlim', es: 'Berlín', also: ['Alemanha', 'Alemania', 'Germany'] },
  'Europe/Brussels': { pt: 'Bruxelas', es: 'Bruselas', also: ['Bélgica', 'Belgium'] },
  'Europe/Amsterdam': { pt: 'Amesterdão', es: 'Ámsterdam', also: ['Países Baixos', 'Países Bajos', 'Netherlands'] },
  'Europe/Luxembourg': { pt: 'Luxemburgo', es: 'Luxemburgo' },
  'Europe/Zurich': { pt: 'Zurique', es: 'Zúrich', also: ['Suíça', 'Suiza', 'Switzerland'] },
  'Europe/Rome': { pt: 'Roma', es: 'Roma', also: ['Itália', 'Italia', 'Italy'] },
  'America/Sao_Paulo': { pt: 'São Paulo', es: 'São Paulo', also: ['Brasil', 'Brazil', 'Rio de Janeiro'] },
  'America/New_York': { pt: 'Nova Iorque', es: 'Nueva York' },
  'America/Mexico_City': { pt: 'Cidade do México', es: 'Ciudad de México', also: ['México', 'Mexico'] },
  'America/Bogota': { pt: 'Bogotá', es: 'Bogotá', also: ['Colômbia', 'Colombia'] },
  'America/Argentina/Buenos_Aires': { also: ['Argentina'] },
  'America/Santiago': { also: ['Chile'] },
  'America/Lima': { also: ['Perú', 'Peru'] },
  'Africa/Luanda': { also: ['Angola'] },
  'Africa/Maputo': { also: ['Moçambique', 'Mozambique'] },
  'Atlantic/Cape_Verde': { en: 'Cape Verde', pt: 'Cabo Verde', es: 'Cabo Verde', also: ['Praia'] },
  'Asia/Macau': { pt: 'Macau', es: 'Macao' },
};

let allZones: string[] | null = null;

/** Every IANA zone the computer knows, canonical names only. */
export function knownTimeZones(): string[] {
  if (!allZones) {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    let list: string[] = [];
    try {
      list = intl.supportedValuesOf?.('timeZone') ?? [];
    } catch {
      list = [];
    }
    allZones = [...new Set([...IBERIAN_ZONES, ...Object.keys(NAMES), ...list, 'UTC'])].filter((z) => canonicalTimeZone(z) !== null);
  }
  return allZones;
}

/**
 * The zone's canonical IANA name, whatever its case or alias ("europe/lisbon", "Portugal" →
 * "Europe/Lisbon"), or null when the computer knows no such zone.
 */
export function canonicalTimeZone(input: string): string | null {
  const z = input.trim();
  if (!z) return null;
  try {
    const resolved = new Intl.DateTimeFormat('en-US', { timeZone: z }).resolvedOptions().timeZone;
    return DateTime.local().setZone(resolved).isValid ? resolved : null;
  } catch {
    return null;
  }
}

/** The place a zone is named after, in the therapist's language where Sala knows it. */
export function zoneCity(zone: string, locale: UiLocale): string {
  return NAMES[zone]?.[locale] ?? zone.split('/').pop()!.replace(/_/g, ' ');
}

/** "UTC+01:00" now, for the list. */
export function zoneOffset(zone: string, now: DateTime = DateTime.now()): string {
  return now.setZone(zone).toFormat("'UTC'ZZ");
}

const haystack = (zone: string) => {
  const n = NAMES[zone];
  return fold([zone.replace(/[_/]/g, ' '), n?.en ?? '', n?.pt ?? '', n?.es ?? '', ...(n?.also ?? [])].join(' '));
};

/**
 * Zones matching what was typed: every word must appear (any case, accents optional).
 * Portugal's and Spain's zones and the current one come first; an exact name or alias the
 * computer knows comes first of all.
 */
export function searchTimeZones(query: string, opts: { current?: string; device?: string; limit?: number } = {}): string[] {
  const words = fold(query).split(/[\s/,_]+/).filter(Boolean);
  const first = [opts.current, ...IBERIAN_ZONES, opts.device].filter((z): z is string => !!z);
  const order = [...new Set([...first, ...knownTimeZones()])];
  const hits = words.length ? order.filter((z) => words.every((w) => haystack(z).includes(w))) : order;
  const exact = canonicalTimeZone(query);
  const out = exact && !hits.includes(exact) ? [exact, ...hits] : exact ? [exact, ...hits.filter((z) => z !== exact)] : hits;
  return opts.limit ? out.slice(0, opts.limit) : out;
}
