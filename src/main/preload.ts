import { contextBridge, ipcRenderer } from 'electron';
import type { AppState, PriceResult, SaveResult, Settings } from '../shared/types';

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

  // Overlay
  onResult: (cb: (r: PriceResult, seconds: number) => void) =>
    ipcRenderer.on('result', (_e, r: PriceResult, seconds: number) => cb(r, seconds)),
  overlayReady: (height: number) => ipcRenderer.send('overlay:ready', height),
  hideOverlay: () => ipcRenderer.send('overlay:hide'),
};

export type Api = typeof api;
contextBridge.exposeInMainWorld('api', api);
