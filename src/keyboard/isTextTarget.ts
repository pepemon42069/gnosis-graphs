/** True when the event target is a text-editing surface — gates canvas-scoped keys (§5). */
export function isTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return true
  if (target.isContentEditable) return true
  return target.closest('.cm-editor') !== null
}
