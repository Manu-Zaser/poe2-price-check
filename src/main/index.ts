import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, screen, shell } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateHotkey } from '../shared/hotkey';
import { parseItemText } from '../shared/parser';
import type { AppState, AppStatus, HistoryEntry, PriceResult, SaveResult, Settings } from '../shared/types';
import { buildPriceIndex, CACHE_TTL_MS, fetchLeagues, lookupPrice, makeFetchJson, type PriceIndex } from './ninja';
import { foregroundWindowTitle, sendCopy } from './win32';

// ---------- Konfiguration ----------

interface Config extends Settings {
  /** Fenstertitel, bei dem Strg+C ans Spiel gesendet wird. */
  gameWindowTitle: string;
  /** Kontakt für den User-Agent (von poe.ninja erbeten). Optional. */
  contact: string;
}

const DEFAULT_CONFIG: Config = {
  league: '',
  hotkey: 'Ctrl+D',
  gameWindowTitle: 'Path of Exile 2',
  contact: '',
  overlaySeconds: 10,
};

const configFile = () => join(app.getPath('userData'), 'config.json');

function loadConfig(): Config {
  let loaded: Config = { ...DEFAULT_CONFIG };
  try {
    loaded = { ...loaded, ...JSON.parse(readFileSync(configFile(), 'utf8')) };
  } catch {
    // Datei fehlt oder ist ungültig → Standardwerte.
  }
  if (validateHotkey(loaded.hotkey)) loaded.hotkey = DEFAULT_CONFIG.hotkey;
  saveConfig(loaded);
  return loaded;
}

function saveConfig(c: Config) {
  writeFileSync(configFile(), JSON.stringify(c, null, 2));
}

// ---------- Zustand ----------

let config: Config;
let index: PriceIndex | null = null;
let loading: Promise<PriceIndex> | null = null;
let leagues: string[] = [];
let lastError: string | null = null;
let hotkeyActive = false;
let history: HistoryEntry[] = [];
let historyId = 0;

let mainWin: BrowserWindow | null = null;
let overlayWin: BrowserWindow | null = null;
let hideTimer: NodeJS.Timeout | null = null;

const userAgent = () =>
  `poe2-pricecheck/${app.getVersion()}` + (config.contact ? ` (contact: ${config.contact})` : ' (personal use)');

function status(): AppStatus {
  return {
    league: index?.league ?? (config.league || leagues[0] || null),
    fetchedAt: index?.fetchedAt ?? null,
    loading: loading !== null,
    currencyCount: index?.currency.size ?? 0,
    uniqueCount: index ? [...index.uniquesByName.values()].reduce((n, l) => n + l.length, 0) : 0,
    exaltedPerDivine: index?.exaltedPerDivine || null,
    lastError,
    hotkeyActive,
  };
}

function state(): AppState {
  const { league, hotkey, overlaySeconds } = config;
  return { status: status(), settings: { league, hotkey, overlaySeconds }, leagues, history };
}

function pushState() {
  mainWin?.webContents.send('state', state());
}

/** Liefert einen gültigen Index; lädt höchstens einmal pro Stunde neu. */
async function getIndex(): Promise<PriceIndex> {
  if (index && Date.now() - index.fetchedAt < CACHE_TTL_MS) return index;
  if (!loading) {
    loading = (async () => {
      const fetchJson = makeFetchJson(userAgent());
      leagues = await fetchLeagues(fetchJson);
      const league = config.league || leagues[0];
      return buildPriceIndex(fetchJson, league);
    })()
      .then((i) => {
        index = i;
        lastError = null;
        return i;
      })
      .catch((e: unknown) => {
        lastError = e instanceof Error ? e.message : String(e);
        throw e;
      })
      .finally(() => {
        loading = null;
        pushState();
      });
    pushState();
  }
  return loading;
}

// ---------- Hotkey ----------

function registerHotkey(acc: string): boolean {
  globalShortcut.unregisterAll();
  try {
    return globalShortcut.register(acc, () => void priceCheck());
  } catch {
    return false; // ungültiger Accelerator
  }
}

function activateHotkey() {
  hotkeyActive = registerHotkey(config.hotkey);
  lastError = hotkeyActive ? lastError : `Hotkey ${config.hotkey} ist von einem anderen Programm belegt.`;
}

async function saveSettings(patch: Partial<Settings>): Promise<SaveResult> {
  if (patch.hotkey !== undefined && patch.hotkey !== config.hotkey) {
    const invalid = validateHotkey(patch.hotkey);
    if (invalid) return { ok: false, error: invalid };
    if (!registerHotkey(patch.hotkey)) {
      activateHotkey(); // alten Hotkey wiederherstellen
      return { ok: false, error: 'Diese Kombination ist schon von einem anderen Programm belegt.' };
    }
    config.hotkey = patch.hotkey;
    hotkeyActive = true;
  }

  if (patch.overlaySeconds !== undefined) {
    config.overlaySeconds = Math.min(60, Math.max(3, Math.round(patch.overlaySeconds)));
  }

  if (patch.league !== undefined && patch.league !== config.league) {
    config.league = patch.league;
    index = null;
    getIndex().catch(() => undefined);
  }

  saveConfig(config);
  pushState();
  return { ok: true };
}

// ---------- Zwischenablage ----------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Ist PoE2 im Vordergrund, wird EINMAL Strg+C gesendet und auf den neuen Inhalt gewartet.
 * Sonst (z. B. zum Testen) wird nur die aktuelle Zwischenablage gelesen.
 * Der vorherige Inhalt der Zwischenablage wird danach wiederhergestellt.
 */
async function readItemText(): Promise<string> {
  const inGame = foregroundWindowTitle() === config.gameWindowTitle;
  if (!inGame) return clipboard.readText();

  const previous = await clipboard.readText();
  await clipboard.writeText('');
  sendCopy();

  let text = '';
  for (let waited = 0; waited < 500 && !text; waited += 25) {
    await sleep(25);
    text = await clipboard.readText();
  }
  await clipboard.writeText(previous);
  return text;
}

// ---------- Fenster ----------

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 560,
    height: 720,
    minWidth: 460,
    minHeight: 560,
    title: 'PoE2 Preischeck',
    backgroundColor: '#100e0c',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#100e0c', symbolColor: '#c9a85c', height: 40 },
    show: false,
    webPreferences: { preload: join(__dirname, 'preload.js') },
  });
  mainWin.removeMenu(); // sonst öffnet Alt bei der Hotkey-Aufnahme das Menü
  mainWin.loadFile(join(__dirname, 'app.html'));
  mainWin.once('ready-to-show', () => mainWin?.show());
  mainWin.on('closed', () => app.quit());
  // Externe Links (poe.ninja) im Standardbrowser öffnen.
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
}

const OVERLAY_WIDTH = 340;

function createOverlayWindow() {
  overlayWin = new BrowserWindow({
    width: OVERLAY_WIDTH,
    height: 200,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    // Das Overlay rendert, während es versteckt ist – nicht drosseln.
    webPreferences: { preload: join(__dirname, 'preload.js'), backgroundThrottling: false },
  });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.loadFile(join(__dirname, 'overlay.html'));
}

let pendingCursor = { x: 0, y: 0 };

/** Schickt das Ergebnis ans Overlay; angezeigt wird erst, wenn es seine Höhe gemeldet hat. */
function showOverlay(result: PriceResult) {
  if (process.env.POE2PC_DEBUG) console.log('[pricecheck]', JSON.stringify(result));
  if (!overlayWin) return;
  pendingCursor = screen.getCursorScreenPoint();
  overlayWin.webContents.send('result', result, config.overlaySeconds);
}

function placeOverlay(height: number) {
  if (!overlayWin) return;
  const area = screen.getDisplayNearestPoint(pendingCursor).workArea;
  const h = Math.min(Math.ceil(height), area.height);
  const x = Math.min(Math.max(pendingCursor.x + 18, area.x), area.x + area.width - OVERLAY_WIDTH);
  const y = Math.min(Math.max(pendingCursor.y - 40, area.y), area.y + area.height - h);
  overlayWin.setBounds({ x: Math.round(x), y: Math.round(y), width: OVERLAY_WIDTH, height: h });
  overlayWin.showInactive(); // Spiel behält den Fokus

  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => overlayWin?.hide(), config.overlaySeconds * 1000);
}

// ---------- Preischeck ----------

let busy = false;

function addHistory(result: PriceResult) {
  history = [{ id: ++historyId, time: Date.now(), result }, ...history].slice(0, 25);
  pushState();
}

async function priceCheck() {
  if (busy) return; // ein Tastendruck = ein Durchlauf
  busy = true;
  try {
    const text = await readItemText();
    const item = parseItemText(text);
    if (!item) {
      showOverlay({ kind: 'error', message: 'Kein Item in der Zwischenablage. Maus über ein Item halten und erneut drücken.' });
      return;
    }
    const result = lookupPrice(await getIndex(), item);
    showOverlay(result);
    addHistory(result);
  } catch (e) {
    showOverlay({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
  } finally {
    busy = false;
  }
}

/** Zeigt eine Divine Orb als Beispiel, damit man Position und Aussehen prüfen kann. */
async function testOverlay() {
  try {
    const item = parseItemText('Item Class: Stackable Currency\nRarity: Currency\nDivine Orb\n--------\nStack Size: 3/20')!;
    showOverlay(lookupPrice(await getIndex(), item));
  } catch (e) {
    showOverlay({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
  }
}

// ---------- Start ----------

if (!app.requestSingleInstanceLock()) app.quit();

app.on('second-instance', () => {
  if (mainWin?.isMinimized()) mainWin.restore();
  mainWin?.focus();
});

app.whenReady().then(() => {
  config = loadConfig();

  ipcMain.handle('state:get', () => state());
  ipcMain.handle('settings:save', (_e, patch: Partial<Settings>) => saveSettings(patch));
  ipcMain.on('hotkey:suspend', (_e, suspend: boolean) => {
    if (suspend) {
      globalShortcut.unregisterAll();
      hotkeyActive = false;
    } else activateHotkey();
    pushState();
  });
  ipcMain.on('prices:refresh', () => {
    index = null;
    getIndex().catch(() => undefined);
  });
  ipcMain.on('history:clear', () => {
    history = [];
    pushState();
  });
  ipcMain.on('overlay:test', () => void testOverlay());
  ipcMain.on('overlay:hide', () => overlayWin?.hide());
  ipcMain.on('overlay:ready', (_e, height: number) => placeOverlay(height));

  createMainWindow();
  createOverlayWindow();
  activateHotkey();
  getIndex().catch(() => undefined); // Kurse im Hintergrund vorladen

  // Relative Zeitangaben ("vor 5 Min.") aktuell halten.
  setInterval(pushState, 60_000);
});

app.on('will-quit', () => globalShortcut.unregisterAll());
