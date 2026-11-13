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

interface Sparkline { totalChange?: number }
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
      index.currency.set(name.toLowerCase(), {
        name,
        icon: absoluteImage(meta.image),
        divine: line.primaryValue,
        exalted: line.primaryValue * (rate || index.exaltedPerDivine),
        change7d: line.sparkline?.totalChange,
      });
    }
  }

  for (const data of uniques) {
    const rate = data.core?.rates?.exalted ?? index.exaltedPerDivine;
    for (const line of data.lines) {
      const match: PriceMatch = {
        name: line.name,
        baseType: line.baseType,
        divine: line.primaryValue,
        exalted: line.primaryValue * rate,
        listingCount: line.listingCount,
        change7d: line.sparkLine?.totalChange,
        icon: absoluteImage(line.icon),
      };
      push(index.uniquesByName, line.name.toLowerCase(), match);
      push(index.uniquesByBase, line.baseType.toLowerCase(), match);
    }
  }

  return index;
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

  // Währung, Fragmente, Runen, Essenzen, ungeschliffene Gemmen usw.
  const currency = index.currency.get(item.baseType.toLowerCase());
  if (currency) {
    return { kind: 'priced', item, source: 'poe.ninja', league, matches: [currency], stackSize: item.stackSize };
  }

  if (item.rarity === 'Rare' || item.rarity === 'Magic' || item.rarity === 'Normal') {
    return { kind: 'unsupported', item, reason: 'Normal items are not priced (no poe.ninja data).' };
  }
  return { kind: 'not-found', item, league, reason: `"${item.baseType}" is not listed on poe.ninja.` };
}
