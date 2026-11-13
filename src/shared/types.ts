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

/** Ein Mod eines Rares, wie er im Overlay zur Auswahl steht. */
export interface TradeMod {
  key: string;
  text: string;
  kind: 'explicit' | 'implicit' | 'rune' | 'enchant' | 'crafted' | 'fractured' | 'desecrated';
  /** null = nicht in der Trade-Suche gefunden (wird ausgegraut). */
  statId: string | null;
  value: number | null;
  min?: number;
  enabled: boolean;
  /** Aus mehreren Zeilen mit derselben Stat-ID zusammengefasst. */
  combined?: boolean;
}

/** Auswahl aus dem Overlay für "Neu suchen". */
export interface TradeSelection {
  enabled: string[];
  /** Mod-Key → Mindestwert; null = ohne Mindestwert. Fehlende Keys behalten ihren Wert. */
  mins: Record<string, number | null>;
  useBaseType: boolean;
  matchAll: boolean;
}

export interface Listing {
  amount: number;
  currency: string;
  /** Umgerechnet in Divine (über poe.ninja), falls Kurs bekannt. */
  divine: number | null;
  exalted: number | null;
  /** ISO-Zeitpunkt, seit dem das Angebot gelistet ist. */
  indexed: string;
  itemLevel?: number;
}

export interface TradeSearch {
  queryId: string;
  url: string;
  total: number;
  listings: Listing[];
  icon?: string;
}

export type PriceResult =
  | { kind: 'priced'; item: ParsedItem; source: 'poe.ninja'; league: string; matches: PriceMatch[]; stackSize?: number }
  | {
      kind: 'trade';
      /** Gleiche ID = dieselbe Rare-Prüfung (Neusuche); das Overlay aktualisiert dann nur die Ergebnisse. */
      requestId: number;
      item: ParsedItem;
      league: string;
      mods: TradeMod[];
      useBaseType: boolean;
      matchAll: boolean;
      /** null = Suche lief nicht (z. B. Rate-Limit), dann steht der Grund in error. */
      search: TradeSearch | null;
      error?: string;
      /** true = Suche läuft noch; Overlay zeigt die Mods schon an. */
      pending?: boolean;
    }
  | { kind: 'not-found'; item: ParsedItem; league: string; reason: string }
  | { kind: 'unsupported'; item: ParsedItem; reason: string }
  | { kind: 'error'; message: string };

/** Einstellungen, die in der Oberfläche änderbar sind. */
export interface Settings {
  /** Leer = aktuelle Challenge-League von poe.ninja. */
  league: string;
  /** Electron-Accelerator, z. B. "CommandOrControl+D". */
  hotkey: string;
  /** GPU-Beschleunigung für die App-Fenster (Standard aus, schont das Spiel). Wirkt nach Neustart. */
  gpuAcceleration: boolean;
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
  /** true = Overlay wurde verschoben und erscheint immer an dieser Stelle. */
  overlayPositionSaved: boolean;
  logFile: string;
  leagues: string[];
  history: HistoryEntry[];
}

export type SaveResult = { ok: true } | { ok: false; error: string };
