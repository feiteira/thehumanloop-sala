// Like :focus-visible: show focus rings after keyboard use, not after a mouse click.
let keyboard = false;
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (!e.metaKey && !e.ctrlKey && !e.altKey) keyboard = true;
  }, true);
  window.addEventListener('pointerdown', () => (keyboard = false), true);
}
export const focusVisible = (): boolean => keyboard;
