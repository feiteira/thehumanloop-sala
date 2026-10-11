// Ctrl+Z (⌘+Z on a Mac) for the Undo toast. Text fields keep their own undo: the key is
// ignored while one has focus. It is ignored too while a modal is open (a dialog, or the
// curtain shown while Sala locks), so it never undoes something behind it.
export function watchUndoKey(onUndo: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onKey = (e: KeyboardEvent) => {
    if (e.key.toLowerCase() !== 'z' || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.defaultPrevented) return;
    const el = e.target instanceof HTMLElement ? e.target : null;
    if (el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
    // react-native-web marks every open Modal this way, focused or not.
    if (document.querySelector('[aria-modal="true"]')) return;
    e.preventDefault();
    onUndo();
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
