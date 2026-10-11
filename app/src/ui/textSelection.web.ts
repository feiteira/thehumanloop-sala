// The words selected in a text box, and selecting words in one, for marking passages of a
// note. A box keeps its selection when the focus moves to a button, so it can be read then.

/** The selection in a text box (a TextInput's node): start and end offsets in its text, and that text. */
export function selectionIn(node: unknown): { start: number; end: number; text: string } | null {
  if (!(node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement)) return null;
  const { selectionStart: start, selectionEnd: end, value: text } = node;
  return start === null || end === null ? null : { start, end, text };
}

/** Selects `start`–`end` in a text box and brings it to the focus, scrolled into view. */
export function selectIn(node: unknown, start: number, end: number): void {
  if (!(node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement)) return;
  node.focus({ preventScroll: true });
  node.setSelectionRange(start, end);
  // A growing box shows all its text: bring the selected words themselves into view, placed
  // (near enough) by how far into the text they are.
  const box = node.getBoundingClientRect();
  const top = box.top + box.height * (start / Math.max(1, node.value.length));
  const scroller = scrollParent(node);
  if (scroller) {
    const view = scroller.getBoundingClientRect();
    if (top < view.top + 40 || top > view.bottom - 80) scroller.scrollBy({ top: top - view.top - view.height / 3 });
  } else {
    node.scrollIntoView({ block: 'center' });
  }
}

function scrollParent(node: HTMLElement): HTMLElement | null {
  for (let el = node.parentElement; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) return el;
  }
  return null;
}
