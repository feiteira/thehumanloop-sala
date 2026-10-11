// Saves a page a moment after typing stops, one write at a time. What was typed is kept as
// pending until its write has succeeded, so a failed write can be tried again and a lock (or
// the window closing) can wait for the last words: `flush()` waits for the write already
// running, then writes whatever is still pending.

export type SaveState =
  | { kind: 'idle' }
  /** Typed, not yet written. */
  | { kind: 'pending' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: Date }
  | { kind: 'failed' };

export class Autosave<D> {
  private pending: D | null = null;
  private inflight: Promise<boolean> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly write: (draft: D) => Promise<unknown>,
    private readonly onState: (state: SaveState) => void = () => undefined,
    private readonly delayMs = 700,
  ) {}

  /** Something changed: `draft` is the whole latest version. Written after `delayMs` of quiet. */
  change(draft: D): void {
    this.pending = draft;
    this.onState({ kind: 'pending' });
    this.clearTimer();
    this.timer = setTimeout(() => void this.flush(), this.delayMs);
  }

  /** Whether something typed has not been written yet. */
  get hasPending(): boolean {
    return this.pending !== null;
  }

  /** Forgets what is pending (the page is being deleted). */
  discard(): void {
    this.clearTimer();
    this.pending = null;
  }

  /**
   * Writes what is pending now, after any write already running. Resolves true when nothing
   * is left unsaved, false when the write failed (what was typed stays pending). Never throws.
   */
  async flush(): Promise<boolean> {
    this.clearTimer();
    while (this.inflight) await this.inflight;
    const draft = this.pending;
    if (draft === null) return true;
    const run = this.run(draft);
    this.inflight = run;
    try {
      return await run;
    } finally {
      if (this.inflight === run) this.inflight = null;
    }
  }

  private async run(draft: D): Promise<boolean> {
    this.onState({ kind: 'saving' });
    try {
      await this.write(draft);
    } catch (e) {
      console.error('page not saved', e);
      this.onState({ kind: 'failed' });
      return false;
    }
    // Typing during the write left a newer version pending: that one is still to be written.
    if (this.pending === draft) this.pending = null;
    this.onState(this.pending === null ? { kind: 'saved', at: new Date() } : { kind: 'pending' });
    return true;
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
