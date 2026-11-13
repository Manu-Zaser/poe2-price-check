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
  testOverlay: () => ipcRenderer.send('overlay:test'),
  restartApp: () => ipcRenderer.send('app:restart'),
  /** Overlay erscheint wieder neben dem Mauszeiger statt an der gemerkten Stelle. */
  resetOverlayPosition: () => ipcRenderer.send('overlay:resetPosition'),

  // Overlay
  onResult: (cb: (r: PriceResult) => void) => ipcRenderer.on('result', (_e, r: PriceResult) => cb(r)),
  overlayReady: (size: { width: number; height: number }) => ipcRenderer.send('overlay:ready', size),
  /** Größe hat sich geändert (Skalierung) – Overlay soll sich neu vermessen. */
  onRemeasure: (cb: () => void) => ipcRenderer.on('remeasure', () => cb()),
  dragStart: () => ipcRenderer.send('overlay:drag-start'),
  dragEnd: () => ipcRenderer.send('overlay:drag-end'),
  hideOverlay: () => ipcRenderer.send('overlay:hide'),
  tradeSearch: (selection: TradeSelection) => ipcRenderer.send('trade:search', selection),
  openTrade: (url: string) => ipcRenderer.send('trade:open', url),
  /** Preisvorschlag (z. B. "~b/o 55 exalted") in die Zwischenablage legen. */
  copyText: (text: string) => ipcRenderer.send('clipboard:write', text),
  /** Overlay kurz fokussierbar machen, um einen Wert einzutippen. */
  focusOverlay: () => ipcRenderer.send('overlay:focus'),
};

export type Api = typeof api;
contextBridge.exposeInMainWorld('api', api);
