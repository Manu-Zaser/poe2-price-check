/**
 * Preise von poe.ninja: der Index kommt aus @poe2/core/prices (gemeinsam mit dem Loot Overlay). Hier nur, was
 * Price Check zusätzlich braucht: die Markt-Liste für das Hauptfenster und die Suche nach einem geparsten Item.
 */
import {
  buildPriceIndex as buildCoreIndex,
  type FetchJson,
  type PriceIndex as CoreIndex,
} from '@poe2/core/prices';
import { dedupe, marketKey, tabOf, type MarketItem } from '../shared/market';
import type { ParsedItem, PriceResult } from '../shared/types';

export {
  CACHE_TTL_MS,
  checkPairs,
  EXCHANGE_TYPES,
  fetchLeagues,
  fetchPairs,
  makeFetchJson,
  mapLimit,
  PAIR_SPREAD,
  UNIQUE_TYPES,
  type FetchJson,
  type PairQuote,
  type PriceEntry,
} from '@poe2/core/prices';

export interface PriceIndex extends CoreIndex {
  /** Alles zusammen für die Marktübersicht im Hauptfenster. */
  market: MarketItem[];
}

/** Lädt alle Kurse einer League (über den Core) und baut die Markt-Liste. */
export async function buildPriceIndex(fetchJson: FetchJson, league: string): Promise<PriceIndex> {
  const index = await buildCoreIndex(fetchJson, league);
  const market = dedupe(index.entries.map(({ match, type }) => ({ ...match, key: marketKey(match.name, match.baseType), tab: tabOf(type) })));
  return { ...index, market };
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
