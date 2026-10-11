import type { Entity, Kind } from '../model/types';
import { fold } from '../text/normalize';
import type { SqlParam } from './db';

// Each kind is one table: the base columns, the record as JSON in `data`, and a few
// columns copied out of the record purely so they can be indexed and queried.

interface TableSpec<K extends Kind> {
  table: string;
  columns: Record<string, { type: 'TEXT' | 'INTEGER'; from: (r: Entity<K>) => SqlParam }>;
  indexes: string[][];
}

const bool = (b: boolean) => (b ? 1 : 0);

export const TABLES: { [K in Kind]: TableSpec<K> } = {
  folder: {
    table: 'folders',
    columns: {
      status: { type: 'TEXT', from: (r) => r.status },
      search: { type: 'TEXT', from: (r) => fold([r.label, ...r.tags, r.cover_note].join(' ')) },
    },
    indexes: [['status']],
  },
  page: {
    table: 'pages',
    columns: {
      folder_id: { type: 'TEXT', from: (r) => r.folder_id },
      date: { type: 'TEXT', from: (r) => r.date },
      search: { type: 'TEXT', from: (r) => fold([r.title, ...Object.values(r.sections)].join(' ')) },
    },
    indexes: [['folder_id', 'date'], ['date']],
  },
  sticky: {
    table: 'stickies',
    columns: {
      folder_id: { type: 'TEXT', from: (r) => r.folder_id },
      page_id: { type: 'TEXT', from: (r) => r.page_id },
      state: { type: 'TEXT', from: (r) => r.state },
      next_session: { type: 'INTEGER', from: (r) => bool(r.next_session) },
    },
    indexes: [['folder_id', 'state'], ['state', 'next_session']],
  },
  appointment: {
    table: 'appointments',
    columns: {
      folder_id: { type: 'TEXT', from: (r) => r.folder_id },
      start_local: { type: 'TEXT', from: (r) => r.start_local },
      // Last local date the appointment can occur on ('9999-12-31' for open-ended series).
      last_date: {
        type: 'TEXT',
        from: (r) => (r.repeat ? (r.repeat.until ?? '9999-12-31') : r.start_local.slice(0, 10)),
      },
      recurring: { type: 'INTEGER', from: (r) => bool(r.repeat !== null) },
    },
    indexes: [['folder_id'], ['start_local'], ['last_date']],
  },
  appointment_type: { table: 'appointment_types', columns: {}, indexes: [] },
  availability: { table: 'availability', columns: {}, indexes: [] },
  availability_exception: {
    table: 'availability_exceptions',
    columns: { date: { type: 'TEXT', from: (r) => r.date } },
    indexes: [['date']],
  },
  attachment: {
    table: 'attachments',
    columns: {
      folder_id: { type: 'TEXT', from: (r) => r.folder_id },
      page_id: { type: 'TEXT', from: (r) => r.page_id },
      search: { type: 'TEXT', from: (r) => fold([r.filename, r.ocr_text ?? ''].join(' ')) },
    },
    indexes: [['folder_id'], ['page_id']],
  },
  setting: { table: 'settings', columns: {}, indexes: [] },
};

function createTable<K extends Kind>(spec: TableSpec<K>): string {
  const extra = Object.entries(spec.columns).map(([name, c]) => `, ${name} ${c.type}`).join('');
  const idx = spec.indexes
    .map((cols) => `CREATE INDEX IF NOT EXISTS idx_${spec.table}_${cols.join('_')} ON ${spec.table} (${cols.join(', ')});`)
    .join('\n');
  return `CREATE TABLE IF NOT EXISTS ${spec.table} (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  hlc TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL${extra}
);
CREATE INDEX IF NOT EXISTS idx_${spec.table}_hlc ON ${spec.table} (hlc);
${idx}`;
}

/** Ordered migrations. Never edit a published one — append a new step. */
export const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: [
      `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
      ...(Object.values(TABLES) as TableSpec<Kind>[]).map(createTable),
      // Local-only bookkeeping: never exported or synced.
      `CREATE TABLE IF NOT EXISTS import_jobs (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        state TEXT NOT NULL,
        data TEXT NOT NULL
      );`,
    ].join('\n'),
  },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;
