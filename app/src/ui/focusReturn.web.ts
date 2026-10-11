// Keeps a keyboard user's place when the control they are on goes away (an Undo toast that
// closes under the focus): note where focus came from as it entered the box, and send it
// back there. Otherwise focus falls to the page and Tab starts again from the top.

/**
 * For a focus event inside `box`: the element focus came from, or `prev` when it only moved
 * within the box. Null when it came from nowhere (the page itself, another window).
 */
export function focusOrigin(e: unknown, box: unknown, prev: unknown): unknown {
  const ev = e as { relatedTarget?: unknown; nativeEvent?: { relatedTarget?: unknown } } | null;
  const from = ev?.relatedTarget ?? ev?.nativeEvent?.relatedTarget;
  if (from instanceof Node && box instanceof Node && box.contains(from)) return prev;
  return from instanceof HTMLElement ? from : null;
}

/** If the focus is inside `box`, moves it to `to`, when that is still on the page. */
export function returnFocus(box: unknown, to: unknown): void {
  const active = document.activeElement;
  if (!(box instanceof Node) || !active || !box.contains(active)) return;
  if (to instanceof HTMLElement && to.isConnected) to.focus();
}

/** The element holding the focus now. */
export function focusedElement(): unknown {
  return document.activeElement;
}

/**
 * After a dialog closed: gives the focus back to `to` (the control that opened it), when it is
 * still on the page and nothing that matters has the focus: the page itself, a container that
 * the closing dialog left it on, or, for a dialog opened from another one, wherever that one
 * put it as it took the focus back. Never takes it from a control or field elsewhere.
 */
export function focusBackTo(to: unknown): void {
  if (!(to instanceof HTMLElement) || to === document.body || !to.isConnected) return;
  const active = document.activeElement;
  const adrift =
    !active || active === document.body || !active.isConnected ||
    (active instanceof HTMLElement && active.tabIndex < 0 && !active.matches('input, textarea, select, [contenteditable="true"]'));
  const dialog = to.closest('[aria-modal="true"]');
  if (adrift || (dialog && active && dialog.contains(active))) to.focus();
}
