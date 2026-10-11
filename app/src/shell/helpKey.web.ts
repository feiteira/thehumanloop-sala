// F1 opens the manual at the section for the screen in use. Listened to in the capture phase,
// like the other shortcuts (shell/activity.web.ts), so it works while typing in a field. Not
// while a dialog or the Locking curtain is open: Help would open behind it.

const CAPTURE = { capture: true } as const;

export function watchHelpKey(onHelp: () => void): () => void {
  const handler = (e: KeyboardEvent) => {
    if (e.key !== 'F1' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    e.preventDefault();
    if (e.repeat || document.querySelector('[aria-modal="true"]')) return;
    onHelp();
  };
  window.addEventListener('keydown', handler, CAPTURE);
  return () => window.removeEventListener('keydown', handler, CAPTURE);
}
