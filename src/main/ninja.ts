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
  /** Kleingeschriebener Unique-Name → Varianten (verschiedene Basistypen). */
  uniquesByName: Map<string, PriceMatch[]>;
  /** Kleingeschriebener Basistyp → Uniques auf dieser Basis (für unidentifizierte Items). */
  uniquesByBase: Map<string, PriceMatch[]>;
}

export type FetchJson = (url: string) => Promise<unknown>;

export function makeFetchJson(userAgent: string): FetchJson {
  return async (url) => {
    const res = await fetch(url, { headers: { 'User-Agent': userAgent, Accept: 'application/json' } });
    if (!res.ok) throw new Error(`poe.ninja antwortet mit HTTP ${res.status} für ${url}`);
    return res.json();
  };
}

/** Alle Leagues; der erste Eintrag ist laut poe.ninja-Doku die aktuelle Challenge-League. */
export async function fetchLeagues(fetchJson: FetchJson): Promise<string[]> {
  const leagues = (await fetchJson(`${BASE}/leagues`)) as { id: string }[];
  if (!Array.isArray(leagues) || leagues.length === 0) throw new Error('poe.ninja liefert keine Leagues');
  return leagues.map((l) => l.id);
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Lädt alle Kurse einer League. Anfragen laufen nacheinander, um poe.ninja zu schonen. */
export async function buildPriceIndex(fetchJson: FetchJson, league: string): Promise<PriceIndex> {
  const q = (type: string) => `league=${encodeURIComponent(league)}&type=${type}`;
  const index: PriceIndex = {
    league,
    fetchedAt: Date.now(),
    exaltedPerDivine: 0,
    currency: new Map(),
    uniquesByName: new Map(),
    uniquesByBase: new Map(),
  };

  for (const type of EXCHANGE_TYPES) {
    const data = (await fetchJson(`${BASE}/exchange/current/overview?${q(type)}`)) as ExchangeResponse;
    const rate = data.core?.rates?.exalted ?? 0;
    if (type === 'Currency' && rate > 0) index.exaltedPerDivine = rate;
    const items = new Map(data.items.map((i) => [i.id, i]));
    for (const line of data.lines) {
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

  for (const type of UNIQUE_TYPES) {
    const data = (await fetchJson(`${BASE}/stash/current/item/overview?${q(type)}`)) as UniqueResponse;
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
      return { kind: 'not-found', item, league, reason: `Unique "${item.name}" ist bei poe.ninja nicht gelistet.` };
    }
    const candidates = index.uniquesByBase.get(item.baseType.toLowerCase()) ?? [];
    if (candidates.length > 0) {
      const matches = [...candidates].sort((a, b) => b.divine - a.divine);
      return { kind: 'priced', item, source: 'poe.ninja', league, matches };
    }
    return { kind: 'not-found', item, league, reason: `Kein Unique auf Basis "${item.baseType}" gefunden.` };
  }

  // Währung, Fragmente, Runen, Essenzen, ungeschliffene Gemmen usw.
  const currency = index.currency.get(item.baseType.toLowerCase());
  if (currency) {
    return { kind: 'priced', item, source: 'poe.ninja', league, matches: [currency], stackSize: item.stackSize };
  }

  if (item.rarity === 'Rare' || item.rarity === 'Magic' || item.rarity === 'Normal') {
    return { kind: 'unsupported', item, reason: 'Rare/Magic/Normal-Items brauchen die Trade-Suche (kommt in Phase 2).' };
  }
  return { kind: 'not-found', item, league, reason: `"${item.baseType}" ist bei poe.ninja nicht gelistet.` };
}
