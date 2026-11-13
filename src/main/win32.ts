/**
 * Minimale Win32-Anbindung über koffi (FFI, keine nativen Builds nötig).
 *
 * Regelkonformität: Pro Hotkey-Druck wird GENAU EIN Strg+Alt+C (Item kopieren) ans Spiel gesendet
 * (eine Aktion pro Tastendruck). Es wird kein Speicher gelesen und nichts injiziert.
 */
import koffi from 'koffi';

const user32 = koffi.load('user32.dll');

const MOUSEINPUT = koffi.struct('MOUSEINPUT', {
  dx: 'long', dy: 'long', mouseData: 'uint32', dwFlags: 'uint32', time: 'uint32', dwExtraInfo: 'uintptr_t',
});
const KEYBDINPUT = koffi.struct('KEYBDINPUT', {
  wVk: 'uint16', wScan: 'uint16', dwFlags: 'uint32', time: 'uint32', dwExtraInfo: 'uintptr_t',
});
const HARDWAREINPUT = koffi.struct('HARDWAREINPUT', { uMsg: 'uint32', wParamL: 'uint16', wParamH: 'uint16' });
const INPUT_UNION = koffi.union('INPUT_UNION', { mi: MOUSEINPUT, ki: KEYBDINPUT, hi: HARDWAREINPUT });
const INPUT = koffi.struct('INPUT', { type: 'uint32', u: INPUT_UNION });

const SendInput = user32.func('uint32 __stdcall SendInput(uint32 cInputs, INPUT *pInputs, int cbSize)');
const GetAsyncKeyState = user32.func('int16 __stdcall GetAsyncKeyState(int vKey)');
const GetForegroundWindow = user32.func('void* __stdcall GetForegroundWindow()');
const GetWindowTextW = user32.func('int __stdcall GetWindowTextW(void* hWnd, _Out_ uint16_t* lpString, int nMaxCount)');
const FindWindowW = user32.func('void* __stdcall FindWindowW(const char16_t* lpClassName, const char16_t* lpWindowName)');
const SetForegroundWindow = user32.func('bool __stdcall SetForegroundWindow(void* hWnd)');

const INPUT_KEYBOARD = 1;
const KEYEVENTF_KEYUP = 0x0002;
const VK_CONTROL = 0x11;
const VK_MENU = 0x12; // Alt
const VK_C = 0x43;

function key(vk: number, up: boolean) {
  const input = { type: INPUT_KEYBOARD, u: { ki: { wVk: vk, wScan: 0, dwFlags: up ? KEYEVENTF_KEYUP : 0, time: 0, dwExtraInfo: 0 } } };
  SendInput(1, [input], koffi.sizeof(INPUT));
}

function isDown(vk: number): boolean {
  return (GetAsyncKeyState(vk) & 0x8000) !== 0;
}

/** Sendet ein einzelnes Strg+C an das Vordergrundfenster. */
export function sendCopy(): void {
  // Strg+Alt+C = erweitertes Kopieren: wie Strg+C, aber mit Tier/Präfix/Suffix je Mod.
  // Weiterhin genau EINE Aktion im Spiel (Item-Text kopieren).
  const ctrlHeld = isDown(VK_CONTROL);
  const altHeld = isDown(VK_MENU);
  if (!ctrlHeld) key(VK_CONTROL, false);
  if (!altHeld) key(VK_MENU, false);
  key(VK_C, false);
  key(VK_C, true);
  if (!altHeld) key(VK_MENU, true);
  if (!ctrlHeld) key(VK_CONTROL, true);
}

/** Handle des aktuellen Vordergrundfensters als Zahl (0 = keins) – zum Vergleich mit eigenen Fenstern. */
export function foregroundWindowHandle(): bigint {
  const hwnd = GetForegroundWindow();
  return hwnd ? koffi.address(hwnd) : 0n;
}

/** Titel des aktuellen Vordergrundfensters. */
export function foregroundWindowTitle(): string {
  const hwnd = GetForegroundWindow();
  if (!hwnd) return '';
  const buf = new Uint16Array(512);
  const len = GetWindowTextW(hwnd, buf, buf.length);
  return String.fromCharCode(...buf.subarray(0, Math.max(0, len)));
}

/**
 * Holt das Fenster mit diesem Titel (das Spiel) wieder in den Vordergrund. Nur ein Fensterwechsel –
 * keine Eingabe ans Spiel. Klappt, solange unser Overlay gerade das Vordergrundfenster ist.
 */
export function focusWindowByTitle(title: string): boolean {
  const hwnd = FindWindowW(null, title);
  if (!hwnd) return false;
  return !!SetForegroundWindow(hwnd);
}
