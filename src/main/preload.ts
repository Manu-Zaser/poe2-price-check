import { contextBridge, ipcRenderer } from 'electron';
import type { AppState, PriceResult, SaveResult, Settings, TradeSelection } from '../shared/types';

const api = {
  // Hauptfenster
  getState: (): Promise<AppState> => ipcRenderer.invoke('state:get'),
  onState: (cb: (s: AppState) => void) => ipcRenderer.on('state', (_e, s: AppState) => cb(s)),
  saveSettings: (patch: Partial<Settings>): Promise<SaveResult> => ipcRenderer.invoke('settings:save', patch),
  /** Während der Aufnahme eines neuen Hotkeys den globalen Hotkey abschalten. */
  suspendHotkey: (suspend: boolean) => ipcRenderer.send('hotkey:suspend', suspend),
  refreshPrices: () => ipcRenderer.send('prices:refresh'),
  clearHistory: () => ipcRenderer.send('history:clear'),
  /** Preischeck aus "Recent checks" wieder im Overlay öffnen. */
  openHistory: (id: number) => ipcRenderer.send('history:open', id),
  /** Marktübersicht (alle poe.ninja-Preise der League). */
  getMarket: (): Promise<import('../shared/market').MarketData | null> => ipcRenderer.invoke('market:get'),
  /** Item der Marktübersicht im Overlay zeigen. */
  openMarketItem: (key: string) => ipcRenderer.send('market:open', key),
  checkUpdates: () => ipcRenderer.send('update:check'),
  /** Gefundenes Update herunterladen (erst nach Bestätigung). */
  downloadUpdate: () => ipcRenderer.send('update:download'),
  /** Heruntergeladenes Update installieren (Neustart). */
  installUpdate: () => ipcRenderer.send('update:install'),
  /** Download-Seite des neuesten Releases öffnen (portable Version). */
  openReleasePage: () => ipcRenderer.send('update:open'),
  testOverlay: () => ipcRenderer.send('overlay:test'),
  restartApp: () => ipcRenderer.send('app:restart'),
  /** Eigene Fenster-Buttons des Hauptfensters. */
  windowControl: (action: 'minimize' | 'close') => ipcRenderer.send('window:control', action),
  /** Overlay erscheint wieder neben dem Mauszeiger statt an der gemerkten Stelle. */
  resetOverlayPosition: () => ipcRenderer.send('overlay:resetPosition'),

  // Overlay
  onResult: (cb: (r: PriceResult) => void) => ipcRenderer.on('result', (_e, r: PriceResult) => cb(r)),
  overlayReady: (size: { width: number; height: number }) => ipcRenderer.send('overlay:ready', size),
  /** Overlay smaller/larger by a step (saved like "Overlay size" in the settings). */
  zoomOverlay: (delta: number) => ipcRenderer.send('overlay:zoom', delta),
  /** Größe hat sich geändert (Skalierung) – Overlay soll sich neu vermessen. */
  onRemeasure: (cb: () => void) => ipcRenderer.on('remeasure', () => cb()),
  /** Deckkraft des Hintergrunds aus den Einstellungen (0.4–1). */
  onOpacity: (cb: (opacity: number) => void) => ipcRenderer.on('opacity', (_e, o: number) => cb(o)),
  dragStart: () => ipcRenderer.send('overlay:drag-start'),
  /** Maus hat sich beim Ziehen bewegt – das Fenster folgt dem Mauszeiger. */
  dragMove: () => ipcRenderer.send('overlay:drag-move'),
  dragEnd: () => ipcRenderer.send('overlay:drag-end'),
  hideOverlay: () => ipcRenderer.send('overlay:hide'),
  tradeSearch: (selection: TradeSelection) => ipcRenderer.send('trade:search', selection),
  openTrade: (url: string) => ipcRenderer.send('trade:open', url),
  /** Remembers a trade search (shown on Home). */
  saveSearch: (name: string, url: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('search:save', name, url),
  /** Opens the item on the wiki, PoE2DB or Craft of Exile (the main process builds the address). */
  openItemLink: (kind: 'wiki' | 'poe2db' | 'coe', item: { rarity: string; name?: string; baseType: string; unidentified?: boolean }): Promise<{ ok: boolean; copied?: boolean }> =>
    ipcRenderer.invoke('item:link', kind, item),
  /** Preisvorschlag (z. B. "~b/o 55 exalted") in die Zwischenablage legen. */
  copyText: (text: string) => ipcRenderer.send('clipboard:write', text),
  /** Overlay kurz fokussierbar machen, um einen Wert einzutippen. */
  focusOverlay: () => ipcRenderer.send('overlay:focus'),
  /** Maus hat das Overlay verlassen – Fokus zurück ans Spiel. */
  overlayLeave: () => ipcRenderer.send('overlay:leave'),
};

export type Api = typeof api;
contextBridge.exposeInMainWorld('api', api);
