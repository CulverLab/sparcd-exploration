import { describe, expect, it } from 'vitest';
import { StandaloneModifierGesture, type StandaloneModifier } from '../src/lib/standaloneModifier';

const context = {};
const event = (key: string, code = key, extra = {}) => ({
  key, code, shiftKey: key === 'Shift', ctrlKey: key === 'Control', altKey: false, metaKey: false, repeat: false, ...extra,
});
const release = (key: string, code = key, extra = {}) => event(key, code, { shiftKey: false, ctrlKey: false, ...extra });
const variants = [['Shift', 'ShiftLeft'], ['Shift', 'ShiftRight'], ['Control', 'ControlLeft'], ['Control', 'ControlRight']] as const;

describe('standalone modifier gestures', () => {
  it.each(variants)('applies %s from %s once on release, ignoring held-key repeats', (key, code) => {
    const gesture = new StandaloneModifierGesture<object>();
    gesture.keyDown(event(key, code), context);
    gesture.keyDown(event(key, code, { repeat: true }), context);
    expect(gesture.keyUp(release(key, code), context)).toBe(key);
    expect(gesture.keyUp(release(key, code), context)).toBeNull();
  });

  for (const key of ['Shift', 'Control'] as StandaloneModifier[]) {
    it.each(['a', ' ', 'Tab', 'ArrowRight', 'Escape'])(`${key} combined with %s never becomes a standalone action`, other => {
      const gesture = new StandaloneModifierGesture<object>();
      gesture.keyDown(event(key), context);
      gesture.keyDown(event(other, other, { shiftKey: key === 'Shift', ctrlKey: key === 'Control' }), context);
      expect(gesture.keyUp(release(other), context)).toBeNull();
      expect(gesture.keyUp(release(key), context)).toBeNull();
    });
    it(`${key} cannot start while another key or pointer is held`, () => {
      const gesture = new StandaloneModifierGesture<object>();
      gesture.keyDown(event('a'), context); gesture.keyDown(event(key), context);
      expect(gesture.keyUp(release(key), context)).toBeNull();
      gesture.reset(); gesture.pointerDown(1); gesture.keyDown(event(key), context);
      expect(gesture.keyUp(release(key), context)).toBeNull();
      gesture.pointerUp(1);
    });
    it(`${key} does not fire after a pointer action or explicit gesture cancellation`, () => {
      const gesture = new StandaloneModifierGesture<object>();
      gesture.keyDown(event(key), context); gesture.pointerDown(1); gesture.pointerUp(1);
      expect(gesture.keyUp(release(key), context)).toBeNull();
      gesture.keyDown(event(key), context); gesture.cancel();
      expect(gesture.keyUp(release(key), context)).toBeNull();
    });
    it(`${key} is cancelled by a context change even if the original context returns`, () => {
      const gesture = new StandaloneModifierGesture<object>();
      gesture.keyDown(event(key), context); gesture.observe({}); gesture.observe(context);
      expect(gesture.keyUp(release(key), context)).toBeNull();
    });
    it(`${key} is rejected in blocked contexts, composition, and after focus loss`, () => {
      const gesture = new StandaloneModifierGesture<object>();
      gesture.keyDown(event(key), null);
      expect(gesture.keyUp(release(key), context)).toBeNull();
      gesture.keyDown(event(key), context);
      expect(gesture.keyUp(release(key), null)).toBeNull();
      gesture.keyDown(event(key, key, { isComposing: true }), context);
      expect(gesture.keyUp(release(key), context)).toBeNull();
      gesture.keyDown(event(key), context); gesture.reset();
      expect(gesture.keyUp(release(key), context)).toBeNull();
      // A new genuine tap works after an interrupted gesture.
      gesture.keyDown(event(key), context);
      expect(gesture.keyUp(release(key), context)).toBe(key);
    });
    it.each([{ altKey: true }, { metaKey: true }, key === 'Shift' ? { ctrlKey: true } : { shiftKey: true }])(`${key} rejects another held modifier %o`, flags => {
      const gesture = new StandaloneModifierGesture<object>();
      gesture.keyDown(event(key, key, flags), context);
      expect(gesture.keyUp(release(key), context)).toBeNull();
    });
  }

  it('pressing both sides or both modifier types cancels the gesture', () => {
    for (const second of [['Shift', 'ShiftRight'], ['Control', 'ControlLeft']] as const) {
      const gesture = new StandaloneModifierGesture<object>();
      gesture.keyDown(event('Shift', 'ShiftLeft'), context);
      gesture.keyDown(event(second[0], second[1], { shiftKey: true }), context);
      expect(gesture.keyUp(release(second[0], second[1]), context)).toBeNull();
      expect(gesture.keyUp(release('Shift', 'ShiftLeft'), context)).toBeNull();
    }
  });
  it('a repeat without a fresh keydown never arms an action', () => {
    const gesture = new StandaloneModifierGesture<object>();
    gesture.keyDown(event('Control', 'ControlLeft', { repeat: true }), context);
    expect(gesture.keyUp(release('Control', 'ControlLeft'), context)).toBeNull();
  });
  it.each(variants)('recovers %s from %s after Command swallows letter keyup', (key, code) => {
    const gesture = new StandaloneModifierGesture<object>();
    gesture.keyDown(event('Meta', 'MetaLeft', { metaKey: true }), context);
    gesture.keyDown(event('a', 'KeyA', { metaKey: true }), context);
    // macOS can suppress the shortcut letter's release while Command is down.
    expect(gesture.keyUp(release('Meta', 'MetaLeft'), context)).toBeNull();
    gesture.keyDown(event(key, code), context);
    expect(gesture.keyUp(release(key, code), context)).toBe(key);
  });

  it.each(variants)('recovers %s from %s even when Command keyup is missing', (key, code) => {
    const gesture = new StandaloneModifierGesture<object>();
    gesture.keyDown(event('Meta', 'MetaRight', { metaKey: true }), context);
    gesture.keyDown(event('s', 'KeyS', { metaKey: true }), context);
    // The next event's modifier flags prove Command has been released.
    gesture.keyDown(event(key, code), context);
    expect(gesture.keyUp(release(key, code), context)).toBe(key);
  });

  it('Command recovery preserves held modifiers and never applies their interrupted taps', () => {
    const gesture = new StandaloneModifierGesture<object>();
    gesture.keyDown(event('Shift', 'ShiftLeft'), context);
    gesture.keyDown(event('Meta', 'MetaLeft', { metaKey: true, shiftKey: true }), context);
    gesture.keyDown(event('s', 'KeyS', { metaKey: true, shiftKey: true }), context);
    expect(gesture.keyUp(release('Meta', 'MetaLeft', { shiftKey: true }), context)).toBeNull();
    gesture.keyDown(event('Control', 'ControlLeft', { shiftKey: true }), context);
    expect(gesture.keyUp(release('Control', 'ControlLeft', { shiftKey: true }), context)).toBeNull();
    expect(gesture.keyUp(release('Shift', 'ShiftLeft'), context)).toBeNull();
    gesture.keyDown(event('Shift', 'ShiftLeft'), context);
    expect(gesture.keyUp(release('Shift', 'ShiftLeft'), context)).toBe('Shift');
  });

});
