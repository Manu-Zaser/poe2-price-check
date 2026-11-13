/**
 * Hilfsfunktionen für frei belegbare Hotkeys im Electron-Accelerator-Format
 * (https://www.electronjs.org/docs/latest/api/accelerator).
 */

export interface KeyLike {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

const MODIFIER_CODES = new Set([
  'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight',
]);

const SPECIAL: Record<string, string> = {
  Space: 'Space', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
  Insert: 'Insert', Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec',
};

/** Physische Taste (layoutunabhängig über event.code) → Accelerator-Taste. */
export function keyFromCode(code: string): string | null {
  let m: RegExpMatchArray | null;
  if ((m = code.match(/^Key([A-Z])$/))) return m[1];
  if ((m = code.match(/^Digit(\d)$/))) return m[1];
  if ((m = code.match(/^Numpad(\d)$/))) return `num${m[1]}`;
  if ((m = code.match(/^F(\d{1,2})$/)) && Number(m[1]) >= 1 && Number(m[1]) <= 24) return `F${m[1]}`;
  return SPECIAL[code] ?? null;
}

/** Tastendruck → Accelerator; null, solange nur Modifier gedrückt sind oder die Taste unbekannt ist. */
export function acceleratorFromEvent(e: KeyLike): string | null {
  if (MODIFIER_CODES.has(e.code)) return null;
  const key = keyFromCode(e.code);
  if (!key) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Super');
  parts.push(key);
  return parts.join('+');
}

const MODIFIERS = new Set(['Ctrl', 'Control', 'CommandOrControl', 'CmdOrCtrl', 'Alt', 'Shift', 'Super', 'Meta']);

/** Kombinationen, die mit dem Spiel oder Windows kollidieren. */
const BLOCKED = new Set(['Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+A', 'Ctrl+Alt+C', 'Alt+F4', 'Alt+Tab', 'Ctrl+Alt+Delete']);

function normalize(acc: string): string[] {
  return acc.split('+').map((p) => (p === 'CommandOrControl' || p === 'CmdOrCtrl' || p === 'Control' ? 'Ctrl' : p));
}

/** Fehlermeldung oder null, wenn der Hotkey zulässig ist. */
export function validateHotkey(acc: string): string | null {
  const parts = normalize(acc);
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  if (!key || MODIFIERS.has(key)) return 'Press a key in addition to Ctrl/Alt/Shift.';
  if (mods.includes('Super')) return 'The Windows key is reserved by Windows.';
  if (BLOCKED.has(parts.join('+'))) return `${formatHotkey(acc).join('+')} is needed by the game or by Windows.`;
  const isFKey = /^F\d{1,2}$/.test(key);
  const hasRealMod = mods.some((m) => m === 'Ctrl' || m === 'Alt');
  if (!isFKey && !hasRealMod) return 'Combine with Ctrl or Alt (otherwise the hotkey blocks typing in chat). F-keys also work on their own.';
  return null;
}

const LABELS: Record<string, string> = {
  Ctrl: 'Ctrl', Shift: 'Shift', Alt: 'Alt', Super: 'Win', Space: 'Space',
  Up: '↑', Down: '↓', Left: '←', Right: '→', Delete: 'Del', Insert: 'Ins', Home: 'Home', End: 'End',
  PageUp: 'PgUp', PageDown: 'PgDn', numadd: 'Num +', numsub: 'Num -', nummult: 'Num *', numdiv: 'Num /', numdec: 'Num .',
};

/** Accelerator → Beschriftungen der Tastenkappen, z. B. ["Strg", "D"]. */
export function formatHotkey(acc: string): string[] {
  return normalize(acc).map((p) => {
    const num = p.match(/^num(\d)$/);
    if (num) return `Num ${num[1]}`;
    return LABELS[p] ?? p;
  });
}
