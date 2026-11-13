import { describe, expect, it } from 'vitest';
import { acceleratorFromEvent, formatHotkey, validateHotkey } from '../src/shared/hotkey';

const ev = (code: string, mods: Partial<{ ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }> = {}) => ({
  code,
  ctrlKey: !!mods.ctrl,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
  metaKey: !!mods.meta,
});

describe('acceleratorFromEvent', () => {
  it('baut Kombinationen layoutunabhängig aus event.code', () => {
    expect(acceleratorFromEvent(ev('KeyD', { ctrl: true }))).toBe('Ctrl+D');
    expect(acceleratorFromEvent(ev('KeyZ', { ctrl: true, shift: true }))).toBe('Ctrl+Shift+Z');
    expect(acceleratorFromEvent(ev('Digit3', { alt: true }))).toBe('Alt+3');
    expect(acceleratorFromEvent(ev('F5'))).toBe('F5');
    expect(acceleratorFromEvent(ev('Numpad7', { ctrl: true }))).toBe('Ctrl+num7');
  });

  it('liefert null, solange nur Modifier gedrückt sind', () => {
    expect(acceleratorFromEvent(ev('ControlLeft', { ctrl: true }))).toBeNull();
    expect(acceleratorFromEvent(ev('ShiftRight', { shift: true }))).toBeNull();
  });

  it('liefert null für unbekannte Tasten', () => {
    expect(acceleratorFromEvent(ev('IntlBackslash', { ctrl: true }))).toBeNull();
  });
});

describe('validateHotkey', () => {
  it('akzeptiert typische Kombinationen', () => {
    for (const acc of ['Ctrl+D', 'CommandOrControl+D', 'Alt+Q', 'Ctrl+Shift+F', 'F2', 'Shift+F9']) {
      expect(validateHotkey(acc), acc).toBeNull();
    }
  });

  it('lehnt Kollisionen und Einzeltasten ab', () => {
    expect(validateHotkey('Ctrl+C')).toMatch(/game/);
    expect(validateHotkey('CommandOrControl+V')).toMatch(/game/);
    expect(validateHotkey('D')).toMatch(/Ctrl or Alt/);
    expect(validateHotkey('Shift+D')).toMatch(/Ctrl or Alt/);
    expect(validateHotkey('Super+D')).toMatch(/Windows/);
  });
});

describe('formatHotkey', () => {
  it('beschriftet Tasten auf Englisch', () => {
    expect(formatHotkey('CommandOrControl+D')).toEqual(['Ctrl', 'D']);
    expect(formatHotkey('Ctrl+Shift+Space')).toEqual(['Ctrl', 'Shift', 'Space']);
    expect(formatHotkey('Alt+num4')).toEqual(['Alt', 'Num 4']);
  });
});
