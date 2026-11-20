/**
 * Marktübersicht im Hauptfenster: alle Preise, die das Tool ohnehin stündlich von poe.ninja lädt,
 * nach Kategorien sortiert und durchsuchbar – ohne eine einzige zusätzliche Anfrage.
 */

export type MarketTab = 'currency' | 'fragments' | 'runes' | 'essences' | 'gems' | 'uniques';

/** Reiter der Marktseite und welche poe.ninja-Typen dazugehören. */
export const MARKET_TABS: { id: MarketTab; label: string; types: readonly string[] }[] = [
  { id: 'currency', label: 'Currency', types: ['Currency'] },
  { id: 'fragments', label: 'Fragments & league', types: ['Fragments', 'Abyss', 'Ritual', 'Expedition', 'Delirium', 'Breach', 'Verisium'] },
  { id: 'runes', label: 'Runes & cores', types: ['Runes', 'SoulCores', 'Idols'] },
  { id: 'essences', label: 'Essences', types: ['Essences'] },
  { id: 'gems', label: 'Gems', types: ['UncutGems', 'LineageSupportGems'] },
  {
    id: 'uniques', label: 'Uniques',
    types: ['UniqueWeapons', 'UniqueArmours', 'UniqueAccessories', 'UniqueFlasks', 'UniqueCharms', 'UniqueJewels', 'UniqueSanctumRelics', 'UniqueTablets', 'PrecursorTablets'],
  },
];

const TAB_BY_TYPE = new Map(MARKET_TABS.flatMap((t) => t.types.map((type) => [type, t.id] as const)));

export function tabOf(type: string): MarketTab {
  return TAB_BY_TYPE.get(type) ?? 'currency';
}

export interface MarketItem {
  /** Eindeutig und stabil (für die Watchlist): Name, bei Uniques mit Basis. */
  key: string;
  name: string;
  baseType?: string;
  tab: MarketTab;
  divine: number;
  exalted: number;
  change7d?: number;
  sparkline?: number[];
  icon?: string;
  /** Nur Uniques: Anzahl Angebote bei poe.ninja (wenige = unsicherer Preis). */
  listingCount?: number;
  /** Nur Börsen-Items: gehandeltes Volumen laut poe.ninja in Divine. */
  volumeDivine?: number;
  /** Nur Börsen-Items: Währung des Paares, aus dem poe.ninja den Preis nimmt. */
  pricedIn?: string;
  /** Nur Börsen-Items: Kennung für die Nachprüfung über alle Handelspaare. */
  ninjaRef?: { type: string; id: string };
}

export interface MarketData {
  league: string;
  fetchedAt: number;
  exaltedPerDivine: number;
  items: MarketItem[];
}

/** Ergebnis der Nachprüfung eines Börsen-Items über alle Handelspaare (nur auf Klick bzw. für die Watchlist). */
export interface MarketCheck {
  key: string;
  /** false = poe.ninja hat die Paare nicht geliefert, der Preis bleibt ungeprüft. */
  checked: boolean;
  divine: number;
  exalted: number;
  /** Hinweis: Paare widersprechen sich (dann priceAdjusted) oder das Item wird kaum gehandelt. */
  warning?: string;
  /** Preis auf den niedrigeren der widersprüchlichen Paare gesetzt. */
  priceAdjusted?: boolean;
}

export function marketKey(name: string, baseType?: string): string {
  return (baseType ? `${name}|${baseType}` : name).toLowerCase();
}

/**
 * Gleicher Unique (Name + Basis) kommt bei poe.ninja mehrfach vor (z. B. korrumpierte Varianten).
 * Für die Übersicht zählt der Eintrag mit den meisten Angeboten.
 */
export function dedupe(items: MarketItem[]): MarketItem[] {
  const best = new Map<string, MarketItem>();
  for (const it of items) {
    const prev = best.get(it.key);
    if (!prev || (it.listingCount ?? 0) > (prev.listingCount ?? 0)) best.set(it.key, it);
  }
  return [...best.values()];
}

export type MarketSort = 'price' | 'rising' | 'falling' | 'volume' | 'name';

/**
 * Uniques mit so wenigen Angeboten haben oft Fantasie- oder Troll-Preise (z. B. ein einziges Listing
 * für Millionen Divine). Sie werden in der Liste nur beim Suchen gezeigt.
 */
export const MARKET_MIN_LISTINGS = 5;

export function isThin(it: MarketItem): boolean {
  return it.listingCount !== undefined && it.listingCount < MARKET_MIN_LISTINGS;
}

// ---------- Handelsvolumen ----------
//
// Steht schon in der stündlichen Übersicht von poe.ninja – keine Zusatzanfrage. Börsen-Items: gehandeltes
// Volumen in Divine; geteilt durch den Preis ergibt das grob die Stückzahl. Uniques: Anzahl Angebote.

export type Liquidity = 'low' | 'medium' | 'high';

/** Unter so vielen gehandelten Stück reicht ein einzelner Ausreißer-Tausch für einen falschen Preis. */
export const LOW_TRADED_UNITS = 3;
export const HIGH_TRADED_UNITS = 20;
export const LOW_LISTINGS = 10;
export const HIGH_LISTINGS = 40;
/** Ab diesem Wert lohnt die Warnung bei dünnem Handel (bei Kleinkram ist ein falscher Preis egal). */
export const SUSPECT_MIN_EXALTED = 20;

/** Grob gehandelte Stückzahl eines Börsen-Items (Volumen ÷ Preis). */
export function tradedUnits(it: MarketItem): number | undefined {
  if (it.volumeDivine === undefined || !(it.divine > 0)) return undefined;
  return it.volumeDivine / it.divine;
}

export function liquidity(it: MarketItem): Liquidity | undefined {
  const units = tradedUnits(it);
  if (units !== undefined) return units < LOW_TRADED_UNITS ? 'low' : units < HIGH_TRADED_UNITS ? 'medium' : 'high';
  if (it.listingCount !== undefined) return it.listingCount < LOW_LISTINGS ? 'low' : it.listingCount < HIGH_LISTINGS ? 'medium' : 'high';
  return undefined;
}

/** Preis eines wertvollen Items, der auf ganz wenigen Tauschen beruht – kann deutlich daneben liegen. */
export function isSuspect(it: MarketItem): boolean {
  return liquidity(it) === 'low' && it.exalted >= SUSPECT_MIN_EXALTED && it.key !== 'divine orb';
}

/** Kurzer Text zum Volumen für Tooltips und die Unterzeile. */
export function volumeText(it: MarketItem): string | undefined {
  const units = tradedUnits(it);
  if (units !== undefined) {
    const n = units >= 10 ? Math.round(units).toLocaleString('en-US') : units >= 1 ? units.toFixed(1).replace(/\.0$/, '') : '<1';
    return `≈ ${n} traded`;
  }
  if (it.listingCount !== undefined) return `${it.listingCount} listing${it.listingCount === 1 ? '' : 's'}`;
  return undefined;
}

/** Zum Sortieren nach Volumen: Börsen-Items nach Volumen in Divine, Uniques nach Angeboten (dahinter). */
function volumeRank(it: MarketItem): number {
  if (it.volumeDivine !== undefined) return 1e6 + it.volumeDivine;
  return it.listingCount ?? -1;
}

/** Liste eines Reiters, gefiltert nach Suchtext und sortiert. */
export function filterMarket(
  items: MarketItem[],
  opts: { tab: MarketTab | 'all'; query?: string; sort: MarketSort; includeThin?: boolean; signal?: TrendSignal; tradedOnly?: boolean },
): MarketItem[] {
  const words = (opts.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const list = items.filter(
    (it) =>
      (opts.tab === 'all' || it.tab === opts.tab) &&
      words.every((w) => it.key.includes(w)) &&
      (opts.includeThin || !isThin(it)) &&
      (!opts.signal || itemSignal(it) === opts.signal) &&
      (!opts.tradedOnly || liquidity(it) !== 'low'),
  );
  const change = (it: MarketItem) => it.change7d ?? 0;
  const cmp: Record<MarketSort, (a: MarketItem, b: MarketItem) => number> = {
    price: (a, b) => b.exalted - a.exalted,
    rising: (a, b) => change(b) - change(a),
    falling: (a, b) => change(a) - change(b),
    volume: (a, b) => volumeRank(b) - volumeRank(a),
    name: (a, b) => a.name.localeCompare(b.name),
  };
  return list.sort((a, b) => cmp[opts.sort](a, b) || b.exalted - a.exalted);
}

/** Mindestwert für "Top movers" – billiger Kram schwankt prozentual stark, ohne dass es zählt. */
export const MOVER_MIN_EXALTED = 20;
/** Uniques mit so wenigen Angeboten haben zufällige Kursausschläge. */
export const MOVER_MIN_LISTINGS = 10;

/** Größte Gewinner und Verlierer der Woche unter Items, deren Preis belastbar ist. */
export function topMovers(items: MarketItem[], n = 5): { up: MarketItem[]; down: MarketItem[] } {
  // Nur Items mit genug Handel: sonst erzeugt ein einzelner Ausreißer-Tausch "+900 %".
  const solid = items.filter(
    (it) => it.change7d !== undefined && it.exalted >= MOVER_MIN_EXALTED && (it.listingCount === undefined || it.listingCount >= MOVER_MIN_LISTINGS) && liquidity(it) !== 'low',
  );
  const up = solid.filter((it) => it.change7d! > 0).sort((a, b) => b.change7d! - a.change7d!).slice(0, n);
  const down = solid.filter((it) => it.change7d! < 0).sort((a, b) => a.change7d! - b.change7d!).slice(0, n);
  return { up, down };
}

/** Watchlist aus den Einstellungen bereinigen: Kleinbuchstaben, keine Dubletten, höchstens 40. */
export function cleanWatchlist(keys: unknown): string[] {
  if (!Array.isArray(keys)) return [];
  const out: string[] = [];
  for (const k of keys) {
    const key = String(k).trim().toLowerCase().slice(0, 120);
    if (key && !out.includes(key)) out.push(key);
  }
  return out.slice(0, 40);
}

// ---------- Trend-Signale ----------
//
// Beschreiben, was in den letzten 7 Tagen passiert ist – keine Vorhersage. poe.ninja liefert je Item
// nur die Änderung in % gegenüber dem Stand vor einer Woche, Tag für Tag (z. B. [-2.2, -3.1, …, -6.2]).

export type TrendSignal = 'spike' | 'accelerating' | 'climb' | 'recovering' | 'sliding';

export const SIGNAL_INFO: Record<TrendSignal, { label: string; hint: string }> = {
  spike: { label: 'Spike', hint: 'Most of the rise came in a single day – often hype or price fixing, can drop again fast.' },
  accelerating: { label: 'Accelerating', hint: 'Rising, and faster over the last two days than before.' },
  climb: { label: 'Steady climb', hint: 'Went up on most days – a steady trend, not a single jump.' },
  recovering: { label: 'Recovering', hint: 'Fell first, now clearly rising again.' },
  sliding: { label: 'Sliding', hint: 'Falling on most days and close to its weekly low.' },
};

/** Mindestens so viele Tage Verlauf, sonst ist jedes Muster Zufall. */
const MIN_POINTS = 4;

/** Unter diesem Wert ist jedes Muster Rauschen (ein paar Käufe verschieben den Preis um zig Prozent). */
export const SIGNAL_MIN_EXALTED = 5;

/** Signal eines Items – nur wenn der Preis belastbar ist (genug Wert, genug Angebote). */
export function itemSignal(it: MarketItem): TrendSignal | undefined {
  if (it.exalted < SIGNAL_MIN_EXALTED || isThin(it) || liquidity(it) === 'low') return undefined;
  return trendSignal(it.sparkline);
}

export function trendSignal(points: number[] | undefined): TrendSignal | undefined {
  if (!points || points.length < MIN_POINTS) return undefined;
  // Kurs relativ zum Stand vor einer Woche (1 = unverändert) und die Schritte von Tag zu Tag.
  const level = [1, ...points.map((p) => 1 + p / 100)];
  if (level.some((l) => !(l > 0))) return undefined;
  const steps = level.slice(1).map((l, i) => l / level[i] - 1);
  const n = steps.length;
  const last = level[n];
  const total = last - 1;
  const ups = steps.filter((s) => s > 0.002).length;
  const downs = steps.filter((s) => s < -0.002).length;
  const biggest = Math.max(...steps);
  const low = Math.min(...level);
  const lowAt = level.indexOf(low);

  // Ein einzelner Tag der letzten drei trägt den Großteil des Anstiegs (ältere Sprünge sind schon eingepreist).
  const biggestAt = steps.indexOf(biggest);
  if (total >= 0.15 && biggest >= 0.25 && biggest >= 0.6 * total && biggestAt >= n - 3) return 'spike';
  // Die letzten zwei Tage steigen beide und stärker als die Woche davor.
  const before = level[n - 2] - 1;
  const lastTwo = last / level[n - 2] - 1;
  if (total >= 0.05 && steps[n - 1] > 0 && steps[n - 2] > 0 && lastTwo >= 0.08 && lastTwo > Math.max(before, 0) * 1.5) return 'accelerating';
  // An den meisten Tagen gestiegen.
  if (total >= 0.05 && ups >= Math.ceil(0.7 * n) && downs <= n - Math.ceil(0.7 * n) && biggest <= 0.6 * total) return 'climb';
  // Tief in der Wochenmitte, seitdem klar erholt.
  if (lowAt >= 2 && lowAt <= n - 2 && low <= 0.9 && last / low - 1 >= 0.12 && last >= level[n - 2] && steps[n - 1] >= 0) return 'recovering';
  // Fällt an den meisten Tagen und liegt nahe am Wochentief.
  if (total <= -0.05 && downs >= Math.ceil(0.6 * n) && last <= low * 1.02) return 'sliding';
  return undefined;
}
