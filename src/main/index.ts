import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, screen, shell } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateHotkey } from '../shared/hotkey';
import { parseItemText } from '../shared/parser';
import { isNamedUnique, type StatIndex } from '../shared/stats';
import type { AppState, AppStatus, HistoryEntry, PriceResult, SaveResult, Settings, TradeSelection } from '../shared/types';
import { log, logFile } from './log';
import { buildPriceIndex, CACHE_TTL_MS, fetchLeagues, lookupPrice, makeFetchJson, type PriceIndex } from './ninja';
import { applySelection, idleRareResult, loadStatIndex, newRareRequest, runRareSearch, type RareRequest } from './rare';
import { TradeClient } from './trade';
import { checkForUpdates, initUpdates, installUpdate, openReleasePage, updateState } from './updater';
import { focusWindowByTitle, foregroundWindowHandle, foregroundWindowTitle, sendCopy } from './win32';

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
  overlayOpacity: 0.96,
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

/**
 * Chromium prüft unter Windows, ob ein Fenster von anderen verdeckt ist, und stellt verdeckte
 * Fenster ruhig (kein Zeichnen, keine Eingaben). Holt man das Spiel per Alt+Tab zurück, hält es das
 * Overlay fälschlich für verdeckt – es bleibt sichtbar, reagiert aber nicht mehr auf Klicks.
 * Für ein Overlay über einem Vollbild-Spiel daher abschalten (muss vor "ready" passieren).
 */
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

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

/** Projektseite – damit GGG/poe.ninja den Absender des Tools zuordnen und kontaktieren können. */
const PROJECT_URL = 'https://github.com/Manu-Zaser/poe2-price-check';

const userAgent = () =>
  `poe2-pricecheck/${app.getVersion()} (+${PROJECT_URL}` + (config.contact ? `; contact: ${config.contact})` : ')');

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
  const { league, hotkey, gpuAcceleration, overlayScale, overlayOpacity } = config;
  return {
    status: status(),
    update: updateState(),
    leagueAuto: !league,
    settings: { league, hotkey, gpuAcceleration, overlayScale, overlayOpacity },
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
      // Eine von Hand gewählte League, die es nicht mehr gibt (League vorbei), auf "Automatisch" stellen.
      if (config.league && !leagues.includes(config.league)) {
        log('info', `League "${config.league}" is no longer listed – switching to automatic (${leagues[0]})`);
        config.league = '';
        saveConfig(config);
      }
      const league = config.league || leagues[0];
      if (index && index.league !== league) log('info', `League changed: ${index.league} → ${league}`);
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

  if (patch.overlayOpacity !== undefined && Number.isFinite(patch.overlayOpacity)) {
    config.overlayOpacity = clampOpacity(patch.overlayOpacity);
    applyOverlayOpacity();
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
/** Ist gerade eines unserer eigenen Fenster (Overlay, Hauptfenster) vorne? */
function ownWindowInFront(): boolean {
  const fg = foregroundWindowHandle();
  if (!fg) return false;
  return [overlayWin, mainWin].some((w) => alive(w) && w.getNativeWindowHandle().readBigUInt64LE(0) === fg);
}

async function readItemText(): Promise<string> {
  let inGame = foregroundWindowTitle() === config.gameWindowTitle;
  // Hat gerade unser Overlay (oder das Hauptfenster) den Fokus – z. B. nach einem Klick ins Overlay –
  // oder ist gar kein Fenster vorne, erst das Spiel nach vorne holen. Sonst würde nur die alte
  // Zwischenablage gelesen.
  const noForeground = foregroundWindowHandle() === 0n;
  if (!inGame && (noForeground || ownWindowInFront()) && focusWindowByTitle(config.gameWindowTitle)) {
    for (let waited = 0; waited < 300 && !inGame; waited += 20) {
      await sleep(20);
      inGame = foregroundWindowTitle() === config.gameWindowTitle;
    }
    log('info', `Hotkey while ${noForeground ? 'no window' : 'our window'} was in front – game brought back${inGame ? '' : ' (failed)'}`);
  }
  if (!inGame) {
    // Spiel nicht vorne: nur die aktuelle Zwischenablage prüfen (praktisch zum Testen).
    log('info', `Hotkey without the game in front ("${foregroundWindowTitle()}") – reading the current clipboard`);
    return clipboard.readText();
  }

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
    width: 900,
    height: 680,
    minWidth: 760,
    minHeight: 560,
    title: 'PoE2 Price Check',
    backgroundColor: '#100e0c',
    titleBarStyle: 'hidden',
    // Nur die Fenster-Buttons oben rechts, ohne eigene Leiste – Navigation sitzt in der Seitenleiste.
    titleBarOverlay: { color: '#100e0c', symbolColor: '#9a8f7c', height: 40 },
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
    // Fokussierbar, damit ein Klick das Overlay sicher erreicht (bei nicht fokussierbaren Fenstern geht
    // er über einem Vollbild-Spiel gelegentlich verloren). Beim Erscheinen nimmt es den Fokus trotzdem
    // nicht (showInactive) – erst ein Klick hinein; danach geht der Fokus ans Spiel zurück.
    focusable: true,
    alwaysOnTop: true,
    // Das Overlay rendert, während es versteckt ist – nicht drosseln.
    webPreferences: { preload: join(__dirname, 'preload.js'), backgroundThrottling: false },
  });
  overlayWin = win;
  win.setAlwaysOnTop(true, 'screen-saver');
  void win.loadFile(join(__dirname, 'overlay.html'));
  win.webContents.on('did-finish-load', () => {
    win.webContents.setZoomFactor(config.overlayScale);
    win.webContents.send('opacity', clampOpacity(config.overlayOpacity));
  });

  win.on('focus', () => log('info', 'Overlay got focus'));

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

/** 40 % ist die Untergrenze – darunter ist der Text über dem Spiel kaum noch lesbar. */
function clampOpacity(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_CONFIG.overlayOpacity;
  return Math.min(1, Math.max(0.4, Math.round(v * 100) / 100));
}

/** Hintergrund-Deckkraft sofort im offenen Overlay übernehmen. */
function applyOverlayOpacity() {
  if (!alive(overlayWin)) return;
  overlayWin.webContents.send('opacity', config.overlayOpacity);
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
  if (!overlayWin.isVisible()) {
    overlayWin.showInactive(); // Spiel behält den Fokus
    log('info', `Overlay shown at ${Math.round(origin.x)},${Math.round(y)} (${width}×${height})`);
  }
  // Über dem Spiel bleiben, auch wenn das Spiel sich zwischendurch nach vorne geholt hat.
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.moveTop();
  startOverlayWatch();
}

// ---------- Overlay nach Alt+Tab ----------

let overlayWatch: NodeJS.Timeout | null = null;
let gameWasForeground = true;

/**
 * Solange das Overlay offen ist: Kommt das Spiel (z. B. nach Alt+Tab) wieder nach vorne, das
 * Overlay erneut ganz nach oben holen und neu zeichnen lassen. Windows nimmt Fenstern beim
 * Wechsel sonst gelegentlich den "immer oben"-Status, und das Overlay nimmt keine Klicks mehr an.
 * Eine Abfrage pro Sekunde – nur ein Fenstertitel, keine Eingaben ans Spiel.
 */
function startOverlayWatch() {
  if (overlayWatch) return;
  gameWasForeground = foregroundWindowTitle() === config.gameWindowTitle;
  overlayWatch = setInterval(() => {
    if (!alive(overlayWin) || !overlayWin.isVisible()) return stopOverlayWatch();
    const gameNow = foregroundWindowTitle() === config.gameWindowTitle;
    if (gameNow && !gameWasForeground && !drag) raiseOverlay();
    gameWasForeground = gameNow;
  }, 1000);
}

function stopOverlayWatch() {
  if (!overlayWatch) return;
  clearInterval(overlayWatch);
  overlayWatch = null;
}

function raiseOverlay() {
  if (!alive(overlayWin)) return;
  // Aus- und wieder einschalten setzt den Status bei Windows zuverlässig neu.
  overlayWin.setAlwaysOnTop(false);
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.moveTop();
  overlayWin.webContents.invalidate();
  log('info', 'Game back in foreground – overlay brought to front again');
}

// ---------- Verschieben ----------

let drag: { cursor: Electron.Point; bounds: Electron.Rectangle } | null = null;

/**
 * Verschieben wird vom Overlay gesteuert: Es meldet Start, jede Bewegung und das Ende (dank
 * Pointer-Capture auch, wenn die Maus beim Loslassen außerhalb liegt). Hier wird nur dem echten
 * Mauszeiger gefolgt. Bewusst ohne Abfrage der Maustaste über Windows (GetAsyncKeyState) – die
 * meldete bei aktivem Spiel teils "nicht gedrückt" und beendete das Ziehen sofort.
 */
function startDrag() {
  if (!alive(overlayWin)) return;
  drag = { cursor: screen.getCursorScreenPoint(), bounds: overlayWin.getBounds() };
  log('info', `Overlay drag started at ${drag.bounds.x},${drag.bounds.y}`);
}

function moveDrag() {
  if (!drag || !alive(overlayWin)) return;
  const p = screen.getCursorScreenPoint();
  placing = true;
  overlayWin.setPosition(drag.bounds.x + p.x - drag.cursor.x, drag.bounds.y + p.y - drag.cursor.y);
  placing = false;
}

function endDrag() {
  if (!drag) return;
  drag = null;
  if (!alive(overlayWin)) return;
  const { x, y } = overlayWin.getBounds();
  log('info', `Overlay moved to ${x},${y}`);
  config.overlayPosition = { x, y };
  saveConfig(config);
  pushState();
}

/** Das Overlay bleibt offen, bis man es schließt (× oder Esc). */
function hideOverlay() {
  if (!alive(overlayWin)) return;
  endDrag(); // ein laufendes Verschieben endet spätestens hier
  stopOverlayWatch();
  log('info', 'Overlay closed');
  returnFocusToGame('overlay closed'); // erst Fokus ans Spiel, dann ausblenden
  overlayWin.hide();
}

// ---------- Fokus ----------
//
// Klickt man ins Overlay, wird es aktiv (sonst gehen Klicks über dem Vollbild-Spiel gelegentlich
// verloren). Verlässt die Maus das Overlay oder wird es geschlossen, bekommt das Spiel den Fokus
// zurück – wichtig, denn Strg+D kopiert das Item nur, wenn das Spiel vorne ist.
// Bewusst ohne setFocusable(false): Das deaktiviert das Fenster und hinterlässt bei Windows
// gar kein Vordergrundfenster – dann bekommt auch das Spiel den Fokus nicht zurück.

function returnFocusToGame(reason: string) {
  if (!alive(overlayWin) || !overlayWin.isFocused()) return;
  const ok = focusWindowByTitle(config.gameWindowTitle);
  log('info', `Focus back to the game (${reason})${ok ? '' : ' – failed'}`);
  // Zur Kontrolle im Log: Was ist danach wirklich vorne?
  setTimeout(() => {
    const title = foregroundWindowTitle();
    if (title !== config.gameWindowTitle) log('warn', `After focus switch the foreground is "${title}", not the game`);
  }, 150);
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
  // Uniques: poe.ninja-Preis als Vergleich mitgeben (falls gelistet).
  const ninja = item.rarity === 'Unique' ? lookupPrice(idx, item) : null;
  const req = newRareRequest(item, stats, ninja?.kind === 'priced' ? ninja.matches[0] : undefined);
  rareRequest = req;
  rememberRequest(req);
  // Keine automatische Suche – erst der Klick auf "Search" fragt pathofexile.com an.
  const result = idleRareResult(idx, req);
  showOverlay(result);
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
      rememberRequest(rareRequest);
      const result = await runRareSearch(tradeClient(), await getIndex(), rareRequest);
      next = queuedSelection;
      if (!next) {
        showOverlay(result);
        updateHistory(result);
      }
    }
  } finally {
    researching = false;
  }
}

// ---------- Preischeck ----------

let busy = false;

const HISTORY_SIZE = 15;

function addHistory(result: PriceResult) {
  history = [{ id: ++historyId, time: Date.now(), result }, ...history].slice(0, HISTORY_SIZE);
  pushState();
}

/**
 * Suchanfragen der letzten Preischecks – damit ein Eintrag aus "Recent checks" wieder im Overlay
 * geöffnet und dort erneut gesucht werden kann.
 */
const recentRequests = new Map<number, RareRequest>();

function rememberRequest(req: RareRequest) {
  recentRequests.set(req.id, req);
  while (recentRequests.size > HISTORY_SIZE) recentRequests.delete(recentRequests.keys().next().value!);
}

/** Eintrag aus "Recent checks" im Overlay öffnen (ohne neue Anfrage). */
function openHistoryEntry(id: number) {
  const entry = history.find((h) => h.id === id);
  if (!entry) return;
  const r = entry.result;
  if (r.kind === 'trade') rareRequest = recentRequests.get(r.requestId) ?? rareRequest;
  showOverlay(r);
}

/** Ergebnis einer Suche im Verlauf beim zugehörigen Preischeck eintragen (gleiche requestId). */
function updateHistory(result: PriceResult) {
  if (result.kind !== 'trade' || result.pending) return;
  const entry = history.find((h) => h.result.kind === 'trade' && h.result.requestId === result.requestId);
  if (!entry) return;
  entry.result = result;
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
    // Rares, Magic-Items und identifizierte Uniques laufen über die Trade-Suche (Mod-Liste im Overlay).
    const isRareLike = item.rarity === 'Rare' || item.rarity === 'Magic' || isNamedUnique(item);
    // Weiße Items: was poe.ninja kennt (z. B. Währung mit "Rarity: Normal"), bleibt dort,
    // alles andere (Basen, Waystones …) geht wie Rares über die Trade-Suche.
    const ninja = isRareLike ? null : lookupPrice(await getIndex(), item);
    if (isRareLike || (item.rarity === 'Normal' && ninja?.kind !== 'priced')) {
      addHistory(await rareCheck(item)); // rareCheck zeigt das Overlay selbst
    } else if (ninja) {
      showOverlay(ninja);
      addHistory(ninja);
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
  ipcMain.on('history:open', safe('history:open', (_e, id: number) => openHistoryEntry(Number(id))));
  ipcMain.on('update:check', safe('update:check', () => void checkForUpdates()));
  ipcMain.on('update:install', safe('update:install', () => installUpdate()));
  ipcMain.on('update:open', safe('update:open', () => openReleasePage()));
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
    overlayWin.focus();
  }));
  ipcMain.on('overlay:leave', safe('overlay:leave', () => returnFocusToGame('mouse left the overlay')));
  // Verschieben: Der Renderer meldet nur Start/Ende, die Bewegung folgt dem echten Mauszeiger.
  ipcMain.on('overlay:drag-start', safe('overlay:drag-start', () => startDrag()));
  ipcMain.on('overlay:drag-move', safe('overlay:drag-move', () => moveDrag()));
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
  initUpdates({ userAgent: userAgent(), onChange: pushState });
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
