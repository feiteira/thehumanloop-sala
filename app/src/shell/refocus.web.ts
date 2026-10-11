// Gives the keyboard focus back to where it was before a box such as Find opened, so closing
// it lets the therapist carry on typing. Never takes the focus from something that has it
// since (a dialog opened from the box, a screen that came in its place).

/** The element holding the focus now. */
export function focusedElement(): unknown {
  return document.activeElement;
}

/** Focuses `el` again when it is still on the page and nothing else has the focus. */
export function refocus(el: unknown): void {
  const active = document.activeElement;
  if (active && active !== document.body) return;
  if (el instanceof HTMLElement && el !== document.body && el.isConnected) el.focus();
}
