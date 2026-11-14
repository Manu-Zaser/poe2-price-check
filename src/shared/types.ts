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
  /** Tier/Präfix-Infos je Mod-Zeile (nur beim erweiterten Kopieren vorhanden). */
  modMeta?: ModMeta[];
}

export interface ModMeta {
  /** Mod-Zeile genau wie im Kopiertext (inkl. Wertebereich). */
  line: string;
  affix: 'prefix' | 'suffix' | 'implicit' | 'other';
  /** Tier laut Spiel; in PoE2 ist höher = besser. */
  tier?: number;
  name?: string;
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
  /** pseudo = Summe (z. B. Resistenzen gesamt), weapon = DPS, misc = Item-Level/Sockel. */
  kind: 'explicit' | 'implicit' | 'rune' | 'enchant' | 'crafted' | 'fractured' | 'desecrated' | 'pseudo' | 'weapon' | 'defence' | 'misc';
  /** null = nicht in der Trade-Suche gefunden (wird ausgegraut). */
  statId: string | null;
  value: number | null;
  min?: number;
  /** Höchstwert (wie auf der Trade-Seite); meist leer. */
  max?: number;
  /**
   * "reduced"/"less"-Mods stehen in der Stat-Liste als "increased"/"more" mit negativem Wert.
   * value/min/max sind dann so angegeben, wie es auf dem Item steht (positiv); die Suche negiert sie.
   */
  invert?: boolean;
  enabled: boolean;
  /** Mod-Text mit "#" statt Zahlen (z. B. "# to Evasion Rating"); bleibt auch beim Zusammenfassen gleich. */
  template?: string;
  /** Aus mehreren Zeilen mit derselben Stat-ID zusammengefasst. */
  combined?: boolean;
  /** Kein Stat, sondern ein Item-Filter der Trade-Suche. */
  filter?: 'dps' | 'pdps' | 'edps' | 'crit' | 'ar' | 'ev' | 'es' | 'block' | 'spirit' | 'ilvl' | 'sockets' | 'corrupted';
  /** Waystones/Tablets: Mod steht auf der Liste gefährlicher Mods (Einstellungen). */
  danger?: boolean;
  /** Abgewählt, weil schon in einer Summe bzw. den DPS enthalten. */
  coveredBy?: 'total' | 'DPS' | 'crit' | 'defence';
  /** Tier(s) laut Spiel (bei zusammengefassten Mods mehrere). In PoE2: höher = besser. */
  tiers?: { affix: ModMeta['affix']; tier: number }[];
}

/** Auswahl aus dem Overlay für "Neu suchen". */
export interface TradeSelection {
  enabled: string[];
  /** Nur Sofortkauf-Angebote (Instant Buyout). */
  instantOnly: boolean;
  /** Mod-Key → Mindestwert; null = ohne Mindestwert. Fehlende Keys behalten ihren Wert. */
  mins: Record<string, number | null>;
  /** Mod-Key → Höchstwert; null = ohne Höchstwert. Fehlende Keys behalten ihren Wert. */
  maxs?: Record<string, number | null>;
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
  suggestion?: import('./extras').PriceSuggestion | null;
  /** Typischer Preis (Median der günstigsten aktuellen Angebote). */
  market?: import('./extras').MarketPrice | null;
  /** Hinweise zur Verlässlichkeit (wenig Treffer, nur alte Angebote). */
  warnings?: string[];
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
      instantOnly: boolean;
      /** null = Suche lief nicht (z. B. Rate-Limit), dann steht der Grund in error. */
      search: TradeSearch | null;
      error?: string;
      /** true = Suche läuft noch; Overlay zeigt die Mods schon an. */
      pending?: boolean;
      /** Uniques: Preis laut poe.ninja als Vergleich zu den Trade-Angeboten. */
      reference?: PriceMatch;
      /** Kurs zum Zeitpunkt der Suche (für die Anzeige "1 Div = 640 Ex"). */
      exaltedPerDivine?: number;
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
  /** Skalierung des Overlays (1 = 100 %). */
  overlayScale: number;
  /** Deckkraft des Overlay-Hintergrunds (0.4–1; 1 = undurchsichtig). Text bleibt immer voll sichtbar. */
  overlayOpacity: number;
  /** Hotkey: Item direkt auf der Trade-Seite öffnen ("" = aus). */
  hotkeyTrade: string;
  /** Hotkey: Item im Wiki öffnen ("" = aus). */
  hotkeyWiki: string;
  /** Schließen des Hauptfensters lässt das Tool im Infobereich weiterlaufen. */
  closeToTray: boolean;
  /** Mit Windows starten (unsichtbar, nur im Infobereich). */
  startWithWindows: boolean;
  /** Waystones/Tablets: Textstücke gefährlicher Mods. */
  dangerMods: string[];
}

export type HotkeySetting = 'hotkey' | 'hotkeyTrade' | 'hotkeyWiki';

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
  /** Welche Hotkeys registriert sind (false = von einem anderen Programm belegt). Fehlt = aus. */
  hotkeysActive: Partial<Record<HotkeySetting, boolean>>;
  /** Start mit Windows ist möglich (nur in der gepackten App). */
  canStartWithWindows: boolean;
}

export interface HistoryEntry {
  id: number;
  time: number;
  result: PriceResult;
}

/** Stand der Update-Prüfung (GitHub-Releases). */
export interface UpdateState {
  status: 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error';
  /** Laufende Version. */
  current: string;
  /** Neue Version (bei available/downloading/ready). */
  version?: string;
  /** Download-Fortschritt in % (installierte Version). */
  percent?: number;
  error?: string;
  checkedAt?: number;
  /** true = installierte Version, aktualisiert sich selbst; false = portable exe (nur Hinweis + Download-Seite). */
  selfUpdating: boolean;
}

export interface AppState {
  status: AppStatus;
  update: UpdateState;
  /** true = League automatisch (aktuelle Challenge-League laut poe.ninja). */
  leagueAuto: boolean;
  settings: Settings;
  /** true = Overlay wurde verschoben und erscheint immer an dieser Stelle. */
  overlayPositionSaved: boolean;
  logFile: string;
  leagues: string[];
  history: HistoryEntry[];
}

export type SaveResult = { ok: true } | { ok: false; error: string };
