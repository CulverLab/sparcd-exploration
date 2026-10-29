export type StandaloneModifier = 'Shift' | 'Control';
type KeyEvent = Pick<KeyboardEvent, 'key' | 'code' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'> & { repeat?: boolean; isComposing?: boolean };
const physicalKey = (event: KeyEvent) => event.code || event.key;

/** A modifier is an action only after one uninterrupted, context-stable tap. */
export class StandaloneModifierGesture<Context> {
  private held = new Map<string, string>();
  private pointers = new Set<number>();
  private pending: { key: StandaloneModifier; physical: string; context: Context } | null = null;

  keyDown(event: KeyEvent, context: Context | null): void {
    this.recoverCommandRelease(event);
    const physical = physicalKey(event);
    const alreadyHeld = this.held.has(physical);
    this.held.set(physical, event.key);
    // Repeats never create another gesture or apply while the key is held.
    if (alreadyHeld || event.repeat) return;
    this.cancel();
    if (context === null || event.isComposing || this.held.size !== 1 || this.pointers.size) return;
    if (event.altKey || event.metaKey) return;
    if ((event.key === 'Shift' && !event.ctrlKey) || (event.key === 'Control' && !event.shiftKey)) {
      this.pending = { key: event.key, physical, context };
    }
  }

  keyUp(event: KeyEvent, context: Context | null): StandaloneModifier | null {
    this.recoverCommandRelease(event);
    const physical = physicalKey(event);
    this.held.delete(physical);
    const pending = this.pending;
    this.cancel();
    if (!pending || pending.physical !== physical || pending.key !== event.key ||
        pending.context !== context || this.held.size || this.pointers.size || event.isComposing ||
        event.altKey || event.metaKey || (event.key === 'Shift' ? event.ctrlKey : event.shiftKey)) return null;
    return pending.key;
  }

  private recoverCommandRelease(event: KeyEvent): void {
    if (event.metaKey || ![...this.held.values()].includes('Meta')) return;
    // macOS can omit keyup for letters used with Command (and sometimes
    // Command itself). Once its flag clears, discard that stale chord. Keep
    // modifiers whose flags still prove they are held; never re-arm their tap.
    this.cancel();
    for (const [physical, key] of this.held) {
      const stillHeld = (key === 'Shift' && event.shiftKey) ||
        (key === 'Control' && event.ctrlKey) || (key === 'Alt' && event.altKey);
      if (!stillHeld) this.held.delete(physical);
    }
  }

  observe(context: Context): void {
    if (this.pending?.context !== context) this.cancel();
  }

  pointerDown(id: number): void { this.cancel(); this.pointers.add(id); }
  pointerUp(id: number): void { this.cancel(); this.pointers.delete(id); }
  cancel(): void { this.pending = null; }
  reset(): void { this.cancel(); this.held.clear(); this.pointers.clear(); }
}
