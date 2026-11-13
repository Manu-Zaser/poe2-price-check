export type Rarity = 'Normal' | 'Magic' | 'Rare' | 'Unique' | 'Currency' | 'Gem' | 'Unknown';

/** Strukturiertes Ergebnis aus dem Strg+C-Text eines Items. */
export interface ParsedItem {
  itemClass: string;
  rarity: Rarity;
  /** Eigenname (nur bei Rare/Unique, sofern identifiziert). */
  name?: string;
  baseType: string;
  itemLevel?: number;
  quality?: number;
  stackSize?: number;
  corrupted: boolean;
  unidentified: boolean;
  /** Textblöcke zwischen den "--------"-Trennern (ohne Kopfblock). */
  sections: string[][];
}

export interface PriceMatch {
  name: string;
  baseType?: string;
  /** Preis pro Stück in Divine Orbs. */
  divine: number;
  /** Preis pro Stück in Exalted Orbs. */
  exalted: number;
  listingCount?: number;
  /** Kursänderung der letzten 7 Tage in Prozent. */
  change7d?: number;
  /** Absolute Bild-URL (web.poecdn.com). */
  icon?: string;
}

export type PriceResult =
  | { kind: 'priced'; item: ParsedItem; source: 'poe.ninja'; league: string; matches: PriceMatch[]; stackSize?: number }
  | { kind: 'not-found'; item: ParsedItem; league: string; reason: string }
  | { kind: 'unsupported'; item: ParsedItem; reason: string }
  | { kind: 'error'; message: string };

/** Einstellungen, die in der Oberfläche änderbar sind. */
export interface Settings {
  /** Leer = aktuelle Challenge-League von poe.ninja. */
  league: string;
  /** Electron-Accelerator, z. B. "CommandOrControl+D". */
  hotkey: string;
  overlaySeconds: number;
}

export interface AppStatus {
  league: string | null;
  /** Zeitpunkt (ms) des letzten erfolgreichen Ladens. */
  fetchedAt: number | null;
  loading: boolean;
  currencyCount: number;
  uniqueCount: number;
  exaltedPerDivine: number | null;
  lastError: string | null;
  hotkeyActive: boolean;
}

export interface HistoryEntry {
  id: number;
  time: number;
  result: PriceResult;
}

export interface AppState {
  status: AppStatus;
  settings: Settings;
  leagues: string[];
  history: HistoryEntry[];
}

export type SaveResult = { ok: true } | { ok: false; error: string };
