import { dedupe, marketKey, tabOf, type MarketItem } from '../shared/market';
import type { ParsedItem, PriceMatch, PriceResult } from '../shared/types';

const BASE = 'https://poe.ninja/poe2/api/economy';

/** poe.ninja aktualisiert PoE2-Daten etwa stündlich – öfter abzufragen bringt nichts. */
export const CACHE_TTL_MS = 60 * 60 * 1000;

export const EXCHANGE_TYPES = [
  'Currency', 'Fragments', 'Abyss', 'UncutGems', 'LineageSupportGems', 'Essences', 'SoulCores',
  'Idols', 'Runes', 'Ritual', 'Expedition', 'Delirium', 'Breach', 'Verisium',
] as const;

export const UNIQUE_TYPES = [
  'UniqueWeapons', 'UniqueArmours', 'UniqueAccessories', 'UniqueFlasks', 'UniqueCharms',
  'UniqueJewels', 'UniqueSanctumRelics', 'UniqueTablets', 'PrecursorTablets',
] as const;

// --- Antwortformate (nur die Felder, die wir nutzen) ---

interface Sparkline { totalChange?: number; data?: (number | null)[] }
interface ExchangeResponse {
  core: { rates: { exalted?: number }; primary: string };
  lines: { id: string; primaryValue: number; sparkline?: Sparkline }[];
  items: { id: string; name: string; image?: string }[];
}
interface UniqueResponse {
  core: { rates: { exalted?: number }; primary: string };
  lines: { name: string; baseType: string; primaryValue: number; listingCount?: number; corrupted?: boolean; sparkLine?: Sparkline; icon?: string }[];
}

const IMAGE_HOST = 'https://web.poecdn.com';

/** Verlauf ohne Lücken; zu wenige Punkte = keine Grafik. */
function cleanSparkline(data: (number | null)[] | undefined): number[] | undefined {
  const points = (data ?? []).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return points.length >= 2 ? points : undefined;
}

/** poe.ninja liefert Währungsbilder als relativen Pfad auf web.poecdn.com. */
function absoluteImage(src: string | undefined): string | undefined {
  if (!src) return undefined;
  if (src.startsWith('https://')) return src;
  return src.startsWith('/') ? IMAGE_HOST + src : undefined;
}

export interface PriceIndex {
  league: string;
  fetchedAt: number;
  /** Exalted pro Divine. */
  exaltedPerDivine: number;
  /** Kleingeschriebener Name → Preis. */
  currency: Map<string, PriceMatch>;
  /** Währungs-ID der Trade-API (z. B. "exalted") → Wert in Divine. */
  currencyById: Map<string, number>;
  /** Kleingeschriebener Unique-Name → Varianten (verschiedene Basistypen). */
  uniquesByName: Map<string, PriceMatch[]>;
  /** Kleingeschriebener Basistyp → Uniques auf dieser Basis (für unidentifizierte Items). */
  uniquesByBase: Map<string, PriceMatch[]>;
  /** Alles zusammen für die Marktübersicht im Hauptfenster. */
  market: MarketItem[];
}

export type FetchJson = (url: string) => Promise<unknown>;

export function makeFetchJson(userAgent: string): FetchJson {
  return async (url) => {
    const res = await fetch(url, { headers: { 'User-Agent': userAgent, Accept: 'application/json' } });
    if (!res.ok) throw new Error(`poe.ninja responded with HTTP ${res.status} for ${url}`);
    return res.json();
  };
}

/** Alle Leagues; der erste Eintrag ist laut poe.ninja-Doku die aktuelle Challenge-League. */
export async function fetchLeagues(fetchJson: FetchJson): Promise<string[]> {
  const leagues = (await fetchJson(`${BASE}/leagues`)) as { id: string }[];
  if (!Array.isArray(leagues) || leagues.length === 0) throw new Error('poe.ninja returned no leagues');
  return leagues.map((l) => l.id);
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Höchstens so viele Anfragen gleichzeitig – schnell genug, ohne poe.ninja zu belasten. */
const CONCURRENCY = 4;

/** Wie Promise.all, aber mit begrenzter Parallelität; Reihenfolge der Ergebnisse bleibt erhalten. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Lädt alle Kurse einer League (23 Anfragen, max. 4 parallel). */
export async function buildPriceIndex(fetchJson: FetchJson, league: string): Promise<PriceIndex> {
  const q = (type: string) => `league=${encodeURIComponent(league)}&type=${type}`;
  const index: PriceIndex = {
    league,
    fetchedAt: Date.now(),
    exaltedPerDivine: 0,
    currency: new Map(),
    currencyById: new Map(),
    uniquesByName: new Map(),
    uniquesByBase: new Map(),
    market: [],
  };

  const urls = [
    ...EXCHANGE_TYPES.map((t) => `${BASE}/exchange/current/overview?${q(t)}`),
    ...UNIQUE_TYPES.map((t) => `${BASE}/stash/current/item/overview?${q(t)}`),
  ];
  const responses = await mapLimit(urls, CONCURRENCY, fetchJson);
  const exchange = responses.slice(0, EXCHANGE_TYPES.length) as ExchangeResponse[];
  const uniques = responses.slice(EXCHANGE_TYPES.length) as UniqueResponse[];

  // "Currency" zuerst auswerten: liefert den Divine→Exalted-Kurs für alles andere.
  for (const [i, type] of EXCHANGE_TYPES.entries()) {
    const data = exchange[i];
    const rate = data.core?.rates?.exalted ?? 0;
    if (type === 'Currency' && rate > 0) index.exaltedPerDivine = rate;
    const items = new Map(data.items.map((i) => [i.id, i]));
    for (const line of data.lines) {
      index.currencyById.set(line.id, line.primaryValue);
      const meta = items.get(line.id);
      if (!meta) continue;
      const name = meta.name;
      const match: PriceMatch = {
        name,
        ninjaRef: { type, id: line.id },
        icon: absoluteImage(meta.image),
        divine: line.primaryValue,
        exalted: line.primaryValue * (rate || index.exaltedPerDivine),
        change7d: line.sparkline?.totalChange,
        sparkline: cleanSparkline(line.sparkline?.data),
      };
      index.currency.set(name.toLowerCase(), match);
      index.market.push({ ...match, key: marketKey(name), tab: tabOf(type) });
    }
  }

  for (const [i, data] of uniques.entries()) {
    const type = UNIQUE_TYPES[i];
    const rate = data.core?.rates?.exalted ?? index.exaltedPerDivine;
    for (const line of data.lines) {
      const match: PriceMatch = {
        name: line.name,
        baseType: line.baseType,
        divine: line.primaryValue,
        exalted: line.primaryValue * rate,
        listingCount: line.listingCount,
        change7d: line.sparkLine?.totalChange,
        sparkline: cleanSparkline(line.sparkLine?.data),
        icon: absoluteImage(line.icon),
      };
      push(index.uniquesByName, line.name.toLowerCase(), match);
      push(index.uniquesByBase, line.baseType.toLowerCase(), match);
      index.market.push({ ...match, key: marketKey(line.name, line.baseType), tab: tabOf(type) });
    }
  }
  index.market = dedupe(index.market);

  return index;
}

// ---------- Kurse je Handelspaar ----------

export interface PairQuote {
  /** Währung des Paares, z. B. "exalted". */
  currency: string;
  /** Preis eines Stücks in dieser Währung. */
  rate: number;
  /** Umgerechnet in Divine. */
  divine: number;
}

interface DetailsResponse {
  core?: { rates?: Record<string, number> };
  pairs?: { id: string; rate: number; volumePrimaryValue?: number }[];
}

/**
 * Kurse eines Börsen-Items je Handelspaar (Divine, Exalted, Chaos …). poe.ninja nimmt als Preis das Paar mit
 * dem meisten Volumen; bei dünnem Handel kann das ein Ausreißer sein (z. B. ein paar Chaos-Tausche).
 */
export async function fetchPairs(fetchJson: FetchJson, league: string, ref: { type: string; id: string }): Promise<PairQuote[]> {
  const data = (await fetchJson(`${BASE}/exchange/current/details?league=${encodeURIComponent(league)}&type=${encodeURIComponent(ref.type)}&id=${encodeURIComponent(ref.id)}`)) as DetailsResponse;
  const rates = data.core?.rates ?? {};
  const out: PairQuote[] = [];
  for (const p of data.pairs ?? []) {
    if (!(p.rate > 0)) continue;
    const perDivine = p.id === 'divine' ? 1 : rates[p.id];
    if (!(perDivine > 0)) continue;
    out.push({ currency: p.id, rate: p.rate, divine: p.rate / perDivine });
  }
  return out;
}

/** Ab diesem Faktor zwischen günstigstem und teuerstem Paar gilt der Preis als widersprüchlich. */
export const PAIR_SPREAD = 3;

const CURRENCY_NAME: Record<string, string> = { divine: 'Divine', exalted: 'Exalted', chaos: 'Chaos' };
const amountText = (q: PairQuote) => `${Number(q.rate.toPrecision(3))} ${CURRENCY_NAME[q.currency] ?? q.currency}`;

/**
 * Widersprechen sich die Paare (Faktor > PAIR_SPREAD), gilt vorsichtshalber der niedrigste Kurs, mit Hinweis.
 * Sonst bleibt der poe.ninja-Preis unverändert.
 */
export function checkPairs(match: PriceMatch, quotes: PairQuote[], exaltedPerDivine: number): PriceMatch {
  if (quotes.length < 2) return match;
  const sorted = [...quotes].sort((a, b) => a.divine - b.divine);
  const low = sorted[0];
  const high = sorted[sorted.length - 1];
  if (high.divine / low.divine <= PAIR_SPREAD) return match;
  return {
    ...match,
    divine: low.divine,
    exalted: low.divine * exaltedPerDivine,
    warning: `poe.ninja's trades disagree: ${amountText(low)} vs ${amountText(high)} – few trades, check the in-game exchange. Showing the lower price.`,
  };
}

/** Sucht den Preis eines geparsten Items im Index. */
export function lookupPrice(index: PriceIndex, item: ParsedItem): PriceResult {
  const { league } = index;

  if (item.rarity === 'Unique') {
    if (item.name) {
      const all = index.uniquesByName.get(item.name.toLowerCase()) ?? [];
      // Gleicher Name kann auf mehreren Basen existieren – passende Basis bevorzugen.
      const sameBase = all.filter((m) => m.baseType?.toLowerCase() === item.baseType.toLowerCase());
      const matches = sameBase.length > 0 ? sameBase : all;
      if (matches.length > 0) return { kind: 'priced', item, source: 'poe.ninja', league, matches };
      return { kind: 'not-found', item, league, reason: `Unique "${item.name}" is not listed on poe.ninja.` };
    }
    const candidates = index.uniquesByBase.get(item.baseType.toLowerCase()) ?? [];
    if (candidates.length > 0) {
      const matches = [...candidates].sort((a, b) => b.divine - a.divine);
      return { kind: 'priced', item, source: 'poe.ninja', league, matches };
    }
    return { kind: 'not-found', item, league, reason: `No unique found on base "${item.baseType}".` };
  }

  // Ungeschliffene Gemmen stehen je Stufe bei poe.ninja: "Uncut Skill Gem (Level 12)".
  if (item.gemLevel) {
    const uncut = index.currency.get(`${item.baseType} (level ${item.gemLevel})`.toLowerCase());
    if (uncut) return { kind: 'priced', item, source: 'poe.ninja', league, matches: [uncut], stackSize: item.stackSize };
  }

  // Währung, Fragmente, Runen, Essenzen usw.
  const currency = index.currency.get(item.baseType.toLowerCase());
  if (currency) {
    return { kind: 'priced', item, source: 'poe.ninja', league, matches: [currency], stackSize: item.stackSize };
  }

  if (item.rarity === 'Rare' || item.rarity === 'Magic' || item.rarity === 'Normal') {
    return { kind: 'unsupported', item, reason: 'Normal items are not priced (no poe.ninja data).' };
  }
  return { kind: 'not-found', item, league, reason: `"${item.baseType}" is not listed on poe.ninja.` };
}
