import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, screen, shell } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateHotkey } from '../shared/hotkey';
import { parseItemText } from '../shared/parser';
import type { StatIndex } from '../shared/stats';
import type { AppState, AppStatus, HistoryEntry, PriceResult, SaveResult, Settings, TradeSelection } from '../shared/types';
import { log, logFile } from './log';
import { buildPriceIndex, CACHE_TTL_MS, fetchLeagues, lookupPrice, makeFetchJson, type PriceIndex } from './ninja';
import { applySelection, loadStatIndex, newRareRequest, pendingRareResult, runRareSearch, type RareRequest } from './rare';
import { TradeClient } from './trade';
import { foregroundWindowTitle, isLeftButtonDown, sendCopy } from './win32';

// Fester Datenordner (%APPDATA%\poe2-pricecheck), egal ob per `npm start` oder als gebaute .exe
// mit anderem Produktnamen gestartet – so bleiben Einstellungen und Overlay-Position erhalten.
app.setPath('userData', join(app.getPath('appData'), 'poe2-pricecheck'));

// ---------- Absturzschutz ----------
// Ohne diese Handler zeigt Electron bei einem Fehler einen modalen Dialog. Der liegt hinter dem
// Spiel, blockiert die App – und das Overlay bleibt als unsichtbares Fenster über dem Spiel hängen.
// Mit eigenem Handler entfällt der Dialog; der Fehler landet im Protokoll.
process.on('uncaughtException', (err) => log('error', 'Uncaught exception', err));
process.on('unhandledRejection', (reason) => log('error', 'Unhandled promise rejection', reason));

/** IPC-Handler so kapseln, dass ein Fehler darin nie die App lahmlegt. */
function safe<A extends unknown[]>(name: string, fn: (...args: A) => unknown) {
  return (...args: A) => {
    try {
      const r = fn(...args);
      if (r instanceof Promise) r.catch((e) => log('error', `IPC ${name}`, e));
      return r;
    } catch (e) {
      log('error', `IPC ${name}`, e);
      return undefined;
    }
  };
}

const alive = (w: BrowserWindow | null): w is BrowserWindow => !!w && !w.isDestroyed();

// ---------- Konfiguration ----------

interface Config extends Settings {
  /** Fenstertitel, bei dem Strg+C ans Spiel gesendet wird. */
  gameWindowTitle: string;
  /** Kontakt für den User-Agent (von poe.ninja erbeten). Optional. */
  contact: string;
  /** Vom Nutzer verschobene Overlay-Position (linke obere Ecke); null = neben dem Mauszeiger. */
  overlayPosition: { x: number; y: number } | null;
}

const DEFAULT_CONFIG: Config = {
  league: '',
  hotkey: 'Ctrl+D',
  gameWindowTitle: 'Path of Exile 2',
  contact: '',
  gpuAcceleration: false,
  overlayScale: 1.15,
  overlayPosition: null,
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
  delete (loaded as Partial<Config> & { overlaySeconds?: number }).overlaySeconds; // aus älteren Versionen
  saveConfig(loaded);
  return loaded;
}

function saveConfig(c: Config) {
  try {
    writeFileSync(configFile(), JSON.stringify(c, null, 2));
  } catch (e) {
    log('error', 'Could not save configuration', e);
  }
}

/**
 * Ohne GPU-Beschleunigung rendert Electron die paar kleinen Fenster auf der CPU und konkurriert
 * nicht mit dem Spiel um die Grafikkarte – das Spiel läuft spürbar ruhiger. Muss vor "ready" passieren.
 */
try {
  const early = JSON.parse(readFileSync(configFile(), 'utf8')) as Partial<Config>;
  if (!early.gpuAcceleration) app.disableHardwareAcceleration();
} catch {
  app.disableHardwareAcceleration(); // Standard: aus
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

let trade: TradeClient | null = null;
let statIndex: Promise<StatIndex> | null = null;
/** Letzte Rare-Suche – das Overlay kann sie mit geänderter Mod-Auswahl wiederholen. */
let rareRequest: RareRequest | null = null;

let mainWin: BrowserWindow | null = null;
let overlayWin: BrowserWindow | null = null;
let quitting = false;

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
  const { league, hotkey, gpuAcceleration, overlayScale } = config;
  return {
    status: status(),
    settings: { league, hotkey, gpuAcceleration, overlayScale },
    overlayPositionSaved: config.overlayPosition !== null,
    logFile: logFile(),
    leagues,
    history,
  };
}

let stateDirty = false;

/** Hauptfenster aktualisieren – aber nicht, solange es minimiert/versteckt ist (dann beim Wiederherstellen). */
function pushState() {
  if (!alive(mainWin) || mainWin.isMinimized() || !mainWin.isVisible()) {
    stateDirty = true;
    return;
  }
  stateDirty = false;
  mainWin.webContents.send('state', state());
}

/**
 * Liefert sofort den vorhandenen Index – auch wenn er älter als eine Stunde ist – und erneuert
 * ihn dann im Hintergrund. Nur ganz ohne Index (Start, League-Wechsel) wird auf das Laden gewartet.
 */
async function getIndex(): Promise<PriceIndex> {
  if (index) {
    if (Date.now() - index.fetchedAt >= CACHE_TTL_MS) refreshIndex().catch(() => undefined);
    return index;
  }
  return refreshIndex();
}

/** Lädt die Kurse neu; parallele Aufrufe teilen sich denselben Ladevorgang. */
function refreshIndex(): Promise<PriceIndex> {
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
        log('warn', 'Could not load prices', e);
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
  lastError = hotkeyActive ? lastError : `Hotkey ${config.hotkey} is already used by another program.`;
}

async function saveSettings(patch: Partial<Settings>): Promise<SaveResult> {
  if (patch.hotkey !== undefined && patch.hotkey !== config.hotkey) {
    const invalid = validateHotkey(patch.hotkey);
    if (invalid) return { ok: false, error: invalid };
    if (!registerHotkey(patch.hotkey)) {
      activateHotkey(); // alten Hotkey wiederherstellen
      return { ok: false, error: 'This combination is already used by another program.' };
    }
    config.hotkey = patch.hotkey;
    hotkeyActive = true;
  }

  if (patch.gpuAcceleration !== undefined) config.gpuAcceleration = patch.gpuAcceleration; // wirkt nach Neustart

  if (patch.overlayScale !== undefined && Number.isFinite(patch.overlayScale)) {
    config.overlayScale = Math.min(1.6, Math.max(0.8, Math.round(patch.overlayScale * 100) / 100));
    applyOverlayScale();
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
  // Engmaschig abfragen: PoE2 legt den Text meist nach wenigen Millisekunden ab.
  for (let waited = 0; waited < 500 && !text; waited += 10) {
    await sleep(10);
    text = await clipboard.readText();
  }
  void clipboard.writeText(previous); // Wiederherstellen muss den Preischeck nicht aufhalten
  return text;
}

// ---------- Hauptfenster ----------

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 560,
    height: 720,
    minWidth: 460,
    minHeight: 560,
    title: 'PoE2 Price Check',
    backgroundColor: '#100e0c',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#100e0c', symbolColor: '#c9a85c', height: 40 },
    show: false,
    webPreferences: { preload: join(__dirname, 'preload.js') },
  });
  mainWin.removeMenu(); // sonst öffnet Alt bei der Hotkey-Aufnahme das Menü
  void mainWin.loadFile(join(__dirname, 'app.html'));
  mainWin.once('ready-to-show', () => mainWin?.show());
  mainWin.on('closed', () => {
    mainWin = null;
    app.quit();
  });
  for (const ev of ['restore', 'show'] as const) mainWin.on(ev as 'show', () => stateDirty && pushState());
  mainWin.webContents.on('render-process-gone', (_e, details) => {
    log('error', `Main window crashed (${details.reason}) – reloading`);
    if (alive(mainWin) && !quitting) void mainWin.loadFile(join(__dirname, 'app.html'));
  });
  // Externe Links (poe.ninja) im Standardbrowser öffnen.
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ---------- Overlay ----------

const OVERLAY_WIDTH = 340; // Startbreite; das Overlay meldet seine echte Größe

function createOverlayWindow() {
  const win = new BrowserWindow({
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
  overlayWin = win;
  win.setAlwaysOnTop(true, 'screen-saver');
  void win.loadFile(join(__dirname, 'overlay.html'));
  win.webContents.on('did-finish-load', () => win.webContents.setZoomFactor(config.overlayScale));

  // Vom Nutzer verschoben (Ziehen an der Kopfzeile) → Position für künftige Preischecks merken.
  win.on('moved', () => {
    if (!alive(win) || placing) return;
    const { x, y } = win.getBounds();
    config.overlayPosition = { x, y };
    saveConfig(config);
    pushState();
  });

  // Stürzt der Inhalt ab oder hängt, darf kein unsichtbares Fenster über dem Spiel zurückbleiben.
  const recover = (why: string) => {
    log('error', `Overlay ${why} – recreating`);
    if (quitting) return;
    if (alive(win)) win.destroy();
    if (overlayWin === win) createOverlayWindow();
  };
  win.webContents.on('render-process-gone', (_e, d) => recover(`crashed (${d.reason})`));
  win.on('unresponsive', () => recover('not responding'));
}

/** true, während wir das Fenster selbst positionieren (nicht als "vom Nutzer verschoben" werten). */
let placing = false;
let pendingCursor = { x: 0, y: 0 };

/** Schickt das Ergebnis ans Overlay; angezeigt wird erst, wenn es seine Größe gemeldet hat. */
function showOverlay(result: PriceResult) {
  if (process.env.POE2PC_DEBUG) console.log('[pricecheck]', JSON.stringify(result));
  if (!alive(overlayWin)) return;
  pendingCursor = screen.getCursorScreenPoint();
  overlayWin.webContents.send('result', result);
}

/** Ziel-Position: offenes Overlay bleibt stehen, sonst gemerkte Position, sonst neben dem Mauszeiger. */
function overlayOrigin(width: number, height: number): { x: number; y: number } {
  if (alive(overlayWin) && overlayWin.isVisible()) {
    const b = overlayWin.getBounds();
    return { x: b.x, y: b.y };
  }
  const saved = config.overlayPosition;
  if (saved) {
    // Nur verwenden, wenn die Stelle noch auf einem Bildschirm liegt (Monitor abgesteckt?).
    const area = screen.getDisplayNearestPoint(saved).workArea;
    const onScreen = saved.x >= area.x - 50 && saved.x < area.x + area.width - 50 && saved.y >= area.y - 10 && saved.y < area.y + area.height - 50;
    if (onScreen) return saved;
  }
  const area = screen.getDisplayNearestPoint(pendingCursor).workArea;
  return {
    x: Math.min(Math.max(pendingCursor.x + 18, area.x), area.x + area.width - width),
    y: Math.min(Math.max(pendingCursor.y - 40, area.y), area.y + area.height - height),
  };
}

/** Größe neu anwenden: Zoom setzen und das Overlay sich neu vermessen lassen. */
function applyOverlayScale() {
  if (!alive(overlayWin)) return;
  overlayWin.webContents.setZoomFactor(config.overlayScale);
  overlayWin.webContents.send('remeasure');
}

function placeOverlay(size: { width: number; height: number }) {
  if (!alive(overlayWin)) return;
  // Das Overlay misst in CSS-Pixeln; mit Zoom ist das Fenster entsprechend größer.
  const scale = config.overlayScale;
  const width = Math.max(100, Math.ceil((Number(size.width) || OVERLAY_WIDTH) * scale));
  const rawHeight = Math.ceil((Number(size.height) || 200) * scale);
  const origin = overlayOrigin(width, rawHeight);
  const area = screen.getDisplayNearestPoint(origin).workArea;
  const height = Math.max(60, Math.min(rawHeight, area.height));
  // Unten nicht aus dem Bildschirm ragen lassen.
  const y = Math.max(area.y, Math.min(origin.y, area.y + area.height - height));
  placing = true;
  try {
    overlayWin.setBounds({ x: Math.round(origin.x), y: Math.round(y), width, height });
  } finally {
    setTimeout(() => (placing = false), 50);
  }
  if (!overlayWin.isVisible()) overlayWin.showInactive(); // Spiel behält den Fokus
}

// ---------- Verschieben ----------

let drag: { cursor: Electron.Point; bounds: Electron.Rectangle; timer: NodeJS.Timeout } | null = null;

/**
 * Overlay folgt dem Mauszeiger, bis die linke Maustaste losgelassen wird. Die Taste wird direkt
 * abgefragt – so endet das Ziehen auch dann sauber, wenn die Maus beim Loslassen außerhalb liegt.
 */
function startDrag() {
  if (!alive(overlayWin) || drag) return;
  const win = overlayWin;
  drag = {
    cursor: screen.getCursorScreenPoint(),
    bounds: win.getBounds(),
    timer: setInterval(() => {
      if (!drag || !alive(win) || !isLeftButtonDown()) return endDrag();
      const p = screen.getCursorScreenPoint();
      placing = true;
      win.setPosition(drag.bounds.x + p.x - drag.cursor.x, drag.bounds.y + p.y - drag.cursor.y);
      placing = false;
    }, 16),
  };
}

function endDrag() {
  if (!drag) return;
  clearInterval(drag.timer);
  drag = null;
  if (!alive(overlayWin)) return;
  const { x, y } = overlayWin.getBounds();
  config.overlayPosition = { x, y };
  saveConfig(config);
  pushState();
}

/** Das Overlay bleibt offen, bis man es schließt (× oder Esc). */
function hideOverlay() {
  if (!alive(overlayWin)) return;
  overlayWin.hide();
  overlayWin.setFocusable(false); // Spiel bekommt den Fokus zurück, nächstes Overlay stiehlt ihn nicht
}

// ---------- Trade-Suche (Rares) ----------

function tradeClient(): TradeClient {
  return (trade ??= new TradeClient(userAgent()));
}

function getStatIndex(): Promise<StatIndex> {
  statIndex ??= loadStatIndex(tradeClient(), join(app.getPath('userData'), 'trade-stats.json')).catch((e) => {
    statIndex = null; // beim nächsten Mal erneut versuchen
    log('warn', 'Could not load trade stat list', e);
    throw e;
  });
  return statIndex;
}

/**
 * Zeigt das Overlay sofort mit den erkannten Mods ("Suche läuft …") und ergänzt die
 * Angebote, sobald die Trade-API antwortet (~0,5 s für Suche + Abruf).
 */
async function rareCheck(item: NonNullable<ReturnType<typeof parseItemText>>): Promise<PriceResult> {
  const [idx, stats] = await Promise.all([getIndex(), getStatIndex()]);
  const req = newRareRequest(item, stats);
  rareRequest = req;
  showOverlay(pendingRareResult(idx, req));
  const result = await runRareSearch(tradeClient(), idx, req);
  // Wurde inzwischen "Suchen" gedrückt, gehört das Overlay schon der neueren Suche.
  if (rareRequest === req) showOverlay(result);
  return result;
}

/** "Suchen" im Overlay. Ein zweiter Klick während der Suche wird vorgemerkt und danach ausgeführt. */
let researching = false;
let queuedSelection: TradeSelection | null = null;

async function rareResearch(selection: TradeSelection) {
  if (!rareRequest) return;
  if (researching) {
    queuedSelection = selection;
    return;
  }
  researching = true;
  try {
    let next: TradeSelection | null = selection;
    while (next) {
      queuedSelection = null;
      rareRequest = applySelection(rareRequest, next);
      const result = await runRareSearch(tradeClient(), await getIndex(), rareRequest);
      next = queuedSelection;
      if (!next) showOverlay(result);
    }
  } finally {
    researching = false;
  }
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
      showOverlay({ kind: 'error', message: 'No item in the clipboard. Hover over an item and press the hotkey again.' });
      return;
    }
    const isRareLike = item.rarity === 'Rare' || item.rarity === 'Magic';
    if (isRareLike) {
      addHistory(await rareCheck(item)); // rareCheck zeigt das Overlay selbst (zweistufig)
    } else {
      const result = lookupPrice(await getIndex(), item);
      showOverlay(result);
      addHistory(result);
    }
  } catch (e) {
    log('error', 'Price check failed', e);
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
  if (!alive(mainWin)) return;
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.focus();
});

app.on('before-quit', () => (quitting = true));
app.on('child-process-gone', (_e, d) => log('warn', `Child process gone: ${d.type} (${d.reason})`));

app.whenReady().then(() => {
  config = loadConfig();
  log('info', `Start ${app.getVersion()}, GPU ${config.gpuAcceleration ? 'on' : 'off'}`);

  ipcMain.handle('state:get', safe('state:get', () => state()));
  ipcMain.handle('settings:save', safe('settings:save', (_e, patch: Partial<Settings>) => saveSettings(patch)));
  ipcMain.on('hotkey:suspend', safe('hotkey:suspend', (_e, suspend: boolean) => {
    if (suspend) {
      globalShortcut.unregisterAll();
      hotkeyActive = false;
    } else activateHotkey();
    pushState();
  }));
  ipcMain.on('prices:refresh', safe('prices:refresh', () => refreshIndex().catch(() => undefined)));
  ipcMain.on('history:clear', safe('history:clear', () => {
    history = [];
    pushState();
  }));
  ipcMain.on('overlay:test', safe('overlay:test', () => testOverlay()));
  ipcMain.on('overlay:resetPosition', safe('overlay:resetPosition', () => {
    config.overlayPosition = null;
    saveConfig(config);
    pushState();
  }));
  ipcMain.on('app:restart', safe('app:restart', () => {
    app.relaunch();
    app.exit(0);
  }));
  ipcMain.on('overlay:hide', safe('overlay:hide', () => hideOverlay()));
  // Das Overlay ist normalerweise nicht fokussierbar (das Spiel behält Tastatur und Maus).
  // Nur wenn man in ein Eingabefeld klickt, bekommt es kurz den Fokus zum Tippen.
  ipcMain.on('overlay:focus', safe('overlay:focus', () => {
    if (!alive(overlayWin)) return;
    overlayWin.setFocusable(true);
    overlayWin.focus();
  }));
  // Verschieben: Der Renderer meldet nur Start/Ende, die Bewegung folgt dem echten Mauszeiger.
  ipcMain.on('overlay:drag-start', safe('overlay:drag-start', () => startDrag()));
  ipcMain.on('overlay:drag-end', safe('overlay:drag-end', () => endDrag()));
  ipcMain.on('overlay:ready', safe('overlay:ready', (_e, size: { width: number; height: number }) => placeOverlay(size)));
  ipcMain.on('trade:search', safe('trade:search', (_e, selection: TradeSelection) => rareResearch(selection)));
  ipcMain.on('clipboard:write', safe('clipboard:write', (_e, text: string) => {
    // Nur kurze Preis-Notizen zulassen, nichts Beliebiges aus dem Renderer.
    if (typeof text === 'string' && /^~(b\/o|price) [\d.]+ [a-z]+$/.test(text)) void clipboard.writeText(text);
  }));
  ipcMain.on('trade:open', safe('trade:open', (_e, url: string) => {
    // Nur echte Trade-Links öffnen, nichts Beliebiges aus dem Renderer.
    if (typeof url === 'string' && url.startsWith('https://www.pathofexile.com/trade2/search/poe2/')) void shell.openExternal(url);
  }));

  createMainWindow();
  createOverlayWindow();
  activateHotkey();
  // Alles, was der erste Preischeck braucht, schon beim Start laden.
  getIndex().catch(() => undefined);
  getStatIndex().catch(() => undefined);
  // Kurse stündlich proaktiv erneuern, damit kein Preischeck auf poe.ninja warten muss.
  setInterval(() => refreshIndex().catch(() => undefined), CACHE_TTL_MS);

  // Relative Zeitangaben ("vor 5 Min.") aktuell halten.
  setInterval(() => pushState(), 60_000);
});

app.on('will-quit', () => globalShortcut.unregisterAll());
