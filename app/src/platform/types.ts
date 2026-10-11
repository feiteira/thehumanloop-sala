import type { Kdf } from '../core/crypto/kdf';
import type { Db } from '../core/store/db';

// Everything the app needs from the device, behind one interface. The desktop shell,
// the browser demo and (later) the phone apps each provide an implementation.
// The only network access is `http`, used solely by the optional connection to
// The Human Loop (the desktop shell only allows its hosts).

export interface FileEntry {
  path: string;
  name: string;
  is_dir: boolean;
  size: number;
  modified_ms: number;
  depth: number;
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface AppInfo {
  version: string;
  os: string;
  data_dir: string;
  /** Started as the example practice ("Sala (example)"), which resets at every start. */
  example: boolean;
}

export class PlatformError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface Platform {
  kind: 'desktop' | 'demo';
  info(): Promise<AppInfo>;

  /** Device preferences readable before unlock (language, theme). Never practice content. */
  prefs: {
    get(): Promise<Record<string, string>>;
    set(values: Record<string, string>): Promise<void>;
  };

  /** The keyring file, which holds only wrapped keys. */
  keyring: {
    read(): Promise<string | null>;
    write(json: string): Promise<void>;
  };

  practice: {
    exists(): Promise<boolean>;
    /** Opens the encrypted database. Throws PlatformError('WRONG_KEY') for a wrong key. */
    open(key: Uint8Array, create: boolean): Promise<Db>;
    /** Removes the practice, keyring and attachments from this device. */
    erase(): Promise<void>;
  };

  kdf: Kdf;

  /** HTTPS to The Human Loop, or null where it is not available. */
  http: { fetch: (url: string, init?: RequestInit) => Promise<Response> } | null;

  /** Attachment storage. Bytes arrive already encrypted. */
  blobs: {
    write(id: string, bytes: Uint8Array): Promise<void>;
    read(id: string): Promise<Uint8Array>;
    remove(id: string): Promise<void>;
  };

  /** Files and folders the therapist picked. */
  files: {
    read(path: string): Promise<Uint8Array>;
    write(path: string, bytes: Uint8Array): Promise<void>;
    list(path: string, recursive: boolean): Promise<FileEntry[]>;
    remove(path: string): Promise<void>;
    exists(path: string): Promise<boolean>;
    join(dir: string, name: string): string;
  };

  dialogs: {
    pickFolder(title: string): Promise<string | null>;
    pickFiles(title: string, filters: FileFilter[], multiple: boolean): Promise<string[]>;
    saveFile(title: string, defaultName: string, filters: FileFilter[]): Promise<string | null>;
  };

  /** Opens a page of Sala's website (the download page) in the person's browser. */
  openLink(url: string): Promise<void>;

  /** Sets the window title, where there is one. */
  setTitle(title: string): Promise<void>;

  /** Called when the window is about to close (final backup). */
  onBeforeExit(handler: () => Promise<void>): () => void;
}
