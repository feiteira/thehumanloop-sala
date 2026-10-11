// The practice data model. Every record carries the same base fields so that export,
// import and (later) sync can treat all kinds alike.

export interface Base {
  id: string;
  created_at: string; // ISO 8601 UTC
  updated_at_hlc: string;
  deleted: boolean;
}

export const FOLDER_COLOURS = ['teal', 'sage', 'yellow', 'coral', 'blue', 'plum', 'sand', 'grey'] as const;
export type FolderColour = (typeof FOLDER_COLOURS)[number];

/** Which kind of face a drawn portrait shows. The therapist chooses; Sala never guesses. */
export const PORTRAIT_LOOKS = ['any', 'feminine', 'masculine'] as const;
export type PortraitLook = (typeof PORTRAIT_LOOKS)[number];

/** Largest photo kept on a folder (a data URL of a small square JPEG). */
export const PHOTO_MAX_CHARS = 200_000;

/** The longest folder label, in characters. */
export const FOLDER_LABEL_MAX = 120;

/** The largest file kept as a document, whether added by hand or imported. */
export const MAX_DOCUMENT_BYTES = 200 * 1024 * 1024;

/**
 * The picture on a folder, to find the person at a glance: a drawn portrait (chosen by its
 * seed and look) or a small photo. Without one, the folder shows a portrait drawn from its id.
 */
export type FolderPicture =
  | { kind: 'drawn'; seed: string; look: PortraitLook }
  | { kind: 'photo'; data: string };

export const STICKY_COLOURS = ['yellow', 'pink', 'green', 'blue'] as const;
export type StickyColour = (typeof STICKY_COLOURS)[number];

export interface Contact {
  email: string;
  phone: string;
  language: string; // BCP 47 primary tag, '' when unknown
  time_zone: string; // IANA, '' = the practice's time zone
}

export interface Folder extends Base {
  label: string;
  colour: FolderColour;
  status: 'active' | 'archived';
  tags: string[];
  contact: Contact;
  /** Short free text shown on the cover (e.g. referral source, start date). */
  cover_note: string;
  archived_at: string | null;
  /** Set when this folder was merged into another; readers follow the pointer. */
  merged_into: string | null;
  /** The linked patient on The Human Loop (their vault id). Kept only in this practice. */
  loop_vault_id?: string | null;
  picture?: FolderPicture | null;
}

export const TEMPLATES = ['free', 'dap', 'soap', 'intake'] as const;
export type Template = (typeof TEMPLATES)[number];

export const TEMPLATE_SECTIONS: Record<Template, readonly string[]> = {
  free: ['body'],
  dap: ['data', 'assessment', 'plan'],
  soap: ['subjective', 'objective', 'assessment', 'plan'],
  /** A first session: why the person came, their story, the first understanding of it. */
  intake: ['reason', 'history', 'observations', 'formulation', 'plan'],
};

export interface ImportProvenance {
  source_name: string;
  source_kind: 'folder' | 'docx' | 'odt' | 'rtf' | 'text' | 'pdf' | 'ocr' | 'csv' | 'ics' | 'sala';
  engine: string | null; // e.g. 'tesseract.js 7 (por)'
  confidence: number | null; // 0–100 for recognised text
  imported_at: string;
}

export interface Page extends Base {
  folder_id: string;
  date: string; // YYYY-MM-DD, the session date
  time: string | null; // HH:mm
  duration_min: number | null;
  template: Template;
  title: string;
  /**
   * Keyed by TEMPLATE_SECTIONS[template]; may also hold text written under another template,
   * which is kept (see core/model/sections.ts).
   */
  sections: Record<string, string>;
  /** Private process note — kept apart and excluded from exports unless asked for. */
  process_note: string;
  import_provenance: ImportProvenance | null;
  /** Words of the note marked with themes (none on pages written before themes existed). */
  passages?: Passage[];
}

/**
 * Words of a page's note marked with one or more themes. Kept on the page itself, so they go
 * wherever the page goes: delete and Undo, backups, exports. `start` and `end` are offsets
 * into `sections[section]`; `quote` holds the words, to find them again if the text changed
 * where the offsets could not follow (see core/model/passages.ts). Never in the private
 * process note, which is not a section.
 */
export interface Passage {
  id: string;
  section: string;
  start: number;
  end: number;
  quote: string;
  themes: string[];
  created_at: string;
}

export interface Sticky extends Base {
  folder_id: string;
  page_id: string | null; // null = stuck to the folder cover
  text: string;
  colour: StickyColour;
  next_session: boolean;
  origin: 'therapist' | 'ai' | 'patient';
  state: 'stuck' | 'peeled' | 'discarded';
  peeled_at: string | null;
}

export const STICKY_MAX = 280;

export interface Repeat {
  interval_weeks: 1 | 2;
  until: string | null; // YYYY-MM-DD inclusive
  /** Local dates (YYYY-MM-DD) of occurrences removed from the series. */
  exceptions: string[];
}

export type AppointmentStatus = 'proposed' | 'confirmed' | 'cancelled' | 'done';

export interface Appointment extends Base {
  folder_id: string | null; // null = not tied to a patient (supervision, admin time…)
  title: string; // used when folder_id is null
  type_id: string | null;
  start_local: string; // YYYY-MM-DDTHH:mm, wall-clock time in `tz`
  tz: string; // IANA time zone
  duration_min: number;
  repeat: Repeat | null;
  location: string;
  status: AppointmentStatus;
  note: string;
  /** For a single occurrence moved out of a series: the series it came from. */
  series_id: string | null;
}

export interface AppointmentType extends Base {
  name: string;
  duration_min: number;
  colour: FolderColour;
  for_new_patients: boolean;
  archived: boolean;
}

export interface AvailabilityRule extends Base {
  weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7; // ISO: Monday = 1
  start: string; // HH:mm
  end: string; // HH:mm
}

export interface AvailabilityException extends Base {
  date: string; // YYYY-MM-DD
  kind: 'off' | 'extra';
  start: string | null; // null with 'off' = the whole day
  end: string | null;
}

export interface Attachment extends Base {
  folder_id: string;
  page_id: string | null;
  filename: string;
  mime: string;
  size: number;
  blob_id: string;
  sha256: string;
  local_only: boolean;
  source: 'upload' | 'scan' | 'import';
  /** Text recognised from a scan, kept for search and for checking against the image. */
  ocr_text: string | null;
}

export interface Setting extends Base {
  // id is the setting key
  value: unknown;
}

export interface KindMap {
  folder: Folder;
  page: Page;
  sticky: Sticky;
  appointment: Appointment;
  appointment_type: AppointmentType;
  availability: AvailabilityRule;
  availability_exception: AvailabilityException;
  attachment: Attachment;
  setting: Setting;
}

export type Kind = keyof KindMap;
export type Entity<K extends Kind> = KindMap[K];
export type Draft<K extends Kind> = Omit<Entity<K>, keyof Base> & Partial<Pick<Base, 'id'>>;

export const KINDS: readonly Kind[] = [
  'folder',
  'page',
  'sticky',
  'appointment',
  'appointment_type',
  'availability',
  'availability_exception',
  'attachment',
  'setting',
];

export const emptyContact = (): Contact => ({ email: '', phone: '', language: '', time_zone: '' });
