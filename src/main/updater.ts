/**
 * Updates über GitHub-Releases.
 *
 * - Installierte Version (Installer): Beim Start und alle 6 Stunden wird nachgesehen. Eine neue
 *   Version wird erst nach Bestätigung heruntergeladen ("Download") und beim Beenden installiert –
 *   oder sofort per "Restart now". Nie ungefragt mitten im Spiel.
 * - Portable exe (und Entwicklung): kann sich nicht selbst ersetzen. Hier wird nur nachgesehen,
 *   ob es eine neuere Version gibt, und ein Knopf zur Download-Seite angeboten.
 *
 * Es wird nur öffentlich bei github.com nachgefragt; es werden keine Daten gesendet.
 */
import { app, shell } from 'electron';
import { compareVersions } from '../shared/version';
import type { UpdateState } from '../shared/types';
import { log } from './log';

const OWNER = 'Manu-Zaser';
const REPO = 'poe2-price-check';
export const RELEASES_URL = `https://github.com/${OWNER}/${REPO}/releases/latest`;
const LATEST_API = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;

/** Kurz nach dem Start nachsehen (nicht sofort, damit der Start nicht wartet). */
const FIRST_CHECK_MS = 3_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

/** electron-builder setzt diese Variable, wenn die portable exe läuft. */
const portable = !!process.env.PORTABLE_EXECUTABLE_DIR;
const selfUpdating = app.isPackaged && !portable;

let state: UpdateState = { status: 'idle', current: app.getVersion(), selfUpdating };
let onChange: () => void = () => undefined;
let userAgent = 'poe2-pricecheck';
// electron-updater nur in der installierten Version laden.
let updater: typeof import('electron-updater').autoUpdater | null = null;

function set(patch: Partial<UpdateState>) {
  state = { ...state, ...patch };
  onChange();
}

export function updateState(): UpdateState {
  return state;
}

export function initUpdates(opts: { userAgent: string; onChange: () => void }) {
  userAgent = opts.userAgent;
  onChange = opts.onChange;
  if (selfUpdating) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    updater = (require('electron-updater') as typeof import('electron-updater')).autoUpdater;
    updater.autoDownload = false; // erst nach Bestätigung (downloadUpdate)
    updater.autoInstallOnAppQuit = true;
    updater.logger = null;
    updater.on('checking-for-update', () => set({ status: 'checking', error: undefined }));
    updater.on('update-not-available', () => set({ status: 'none', checkedAt: Date.now() }));
    updater.on('update-available', (info) => {
      log('info', `Update ${info.version} available – waiting for confirmation`);
      set({ status: 'available', version: info.version, checkedAt: Date.now() });
    });
    updater.on('download-progress', (p) => set({ status: 'downloading', percent: Math.round(p.percent) }));
    updater.on('update-downloaded', (info) => {
      log('info', `Update ${info.version} downloaded – installs on restart`);
      set({ status: 'ready', version: info.version, percent: 100 });
    });
    updater.on('error', (e) => {
      log('warn', 'Update check failed', e);
      set({ status: 'error', error: 'Could not check for updates.', checkedAt: Date.now() });
    });
  }
  setTimeout(() => void checkForUpdates(), FIRST_CHECK_MS);
  setInterval(() => void checkForUpdates(), CHECK_EVERY_MS);
}

export async function checkForUpdates(): Promise<void> {
  if (state.status === 'checking' || state.status === 'downloading' || state.status === 'ready') return;
  if (updater) {
    try {
      await updater.checkForUpdates();
    } catch {
      // wird über das "error"-Ereignis gemeldet
    }
    return;
  }
  // Portable / Entwicklung: nur nachsehen.
  set({ status: 'checking', error: undefined });
  try {
    const res = await fetch(LATEST_API, { headers: { 'User-Agent': userAgent, Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error(`GitHub responded with HTTP ${res.status}`);
    const latest = ((await res.json()) as { tag_name?: string }).tag_name ?? '';
    const newer = latest && compareVersions(latest, state.current) > 0;
    if (newer) log('info', `Update ${latest} available (download page)`);
    set({ status: newer ? 'available' : 'none', version: newer ? latest.replace(/^v/i, '') : undefined, checkedAt: Date.now() });
  } catch (e) {
    log('warn', 'Update check failed', e);
    set({ status: 'error', error: 'Could not check for updates.', checkedAt: Date.now() });
  }
}

/** Installierte Version: gefundenes Update herunterladen (nach Bestätigung im Hauptfenster). */
export function downloadUpdate() {
  if (!updater || state.status !== 'available') return;
  log('info', `Downloading update ${state.version}`);
  set({ status: 'downloading', percent: 0 });
  updater.downloadUpdate().catch(() => undefined); // Fehler kommen über das "error"-Ereignis
}

/** Installierte Version: sofort neu starten und das heruntergeladene Update installieren. */
export function installUpdate() {
  if (updater && state.status === 'ready') updater.quitAndInstall(true, true);
}

export function openReleasePage() {
  void shell.openExternal(RELEASES_URL);
}
