/** Preischeck für Rares/Magic-Items über die Trade-Suche. */
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { buildSearchQuery, buildTradeMods, isNamedUnique, normalDefaults, StatIndex, tradeSearchUrl, uniqueDefaults, type StatsData } from '../shared/stats';
import { marketPrice, priceWarnings, pricingBasis, suggestPrice } from '../shared/extras';
import type { Listing, ParsedItem, PriceMatch, PriceResult, TradeMod, TradeSearch, TradeSelection } from '../shared/types';
import type { PriceIndex } from './ninja';
import { RateLimitError } from './ratelimit';
import type { FetchedListing, TradeClient } from './trade';

const STATS_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Lädt die Stat-Liste (~850 KB) höchstens einmal am Tag und legt sie als Datei ab.
 * Ist die Trade-API nicht erreichbar, wird notfalls eine ältere Datei verwendet.
 */
export async function loadStatIndex(client: TradeClient, cacheFile: string): Promise<StatIndex> {
  let cached: StatsData | null = null;
  let fresh = false;
  try {
    fresh = Date.now() - statSync(cacheFile).mtimeMs < STATS_MAX_AGE_MS;
    cached = JSON.parse(readFileSync(cacheFile, 'utf8')) as StatsData;
  } catch {
    // keine oder kaputte Datei
  }
  if (cached && fresh) return new StatIndex(cached);

  try {
    const data = await client.loadStats();
    writeFileSync(cacheFile, JSON.stringify(data));
    return new StatIndex(data);
  } catch (e) {
    if (cached) return new StatIndex(cached);
    throw e;
  }
}

export function toListing(f: FetchedListing, index: PriceIndex): Listing | null {
  const price = f.listing.price;
  if (!price) return null;
  const rate = index.currencyById.get(price.currency);
  const divine = rate !== undefined ? price.amount * rate : null;
  return {
    amount: price.amount,
    currency: price.currency,
    divine,
    exalted: divine !== null && index.exaltedPerDivine ? divine * index.exaltedPerDivine : null,
    indexed: f.listing.indexed,
    itemLevel: f.item.ilvl,
  };
}

/**
 * GGG sortiert mit eigenen Wechselkursen (z. B. 1 Chaos vor 25 Exalted). Für die Anzeige
 * nach dem Wert in Exalted laut poe.ninja sortieren; nicht umrechenbare Angebote ans Ende.
 */
export function sortByValue(listings: Listing[]): Listing[] {
  return listings
    .map((l, i) => ({ l, i }))
    .sort((a, b) => {
      const va = a.l.exalted ?? Infinity;
      const vb = b.l.exalted ?? Infinity;
      return va - vb || a.i - b.i;
    })
    .map(({ l }) => l);
}

export interface RareRequest {
  id: number;
  item: ParsedItem;
  mods: TradeMod[];
  useBaseType: boolean;
  matchAll: boolean;
  instantOnly: boolean;
  /** Uniques: poe.ninja-Preis als Vergleich. */
  reference?: PriceMatch;
  /** Schlüssel-Mods dieses Slots, die auf dem Item fehlen. */
  missingKeys?: string[];
}

let nextRequestId = 1;

export function newRareRequest(item: ParsedItem, stats: StatIndex, reference?: PriceMatch): RareRequest {
  const mods = buildTradeMods(item, stats);
  // Uniques: alle angehakten Rolls müssen passen ("4 von 6" ergibt bei festen Mods keinen Sinn).
  if (isNamedUnique(item)) return { id: nextRequestId++, item, mods: uniqueDefaults(mods), useBaseType: true, matchAll: true, instantOnly: true, reference };
  // Gemmen: nur Stufe, Qualität und Corrupted – die Beschreibungszeilen sind keine Mods.
  if (item.rarity === 'Gem') return { id: nextRequestId++, item, mods: mods.filter((m) => m.kind === 'misc'), useBaseType: true, matchAll: true, instantOnly: true };
  // Weiße Items: Basis zählt (nicht die Kategorie), dazu Item-Level.
  if (item.rarity === 'Normal') return { id: nextRequestId++, item, mods: normalDefaults(mods), useBaseType: true, matchAll: true, instantOnly: true };
  // Standard: ganze Item-Kategorie (z. B. alle Bögen, nicht nur "Obliterator Bow") – bei Rares zählen
  // die Mods, nicht die Basis. Alle angehakten Stats müssen passen. Beides per Chip umschaltbar.
  return { id: nextRequestId++, item, mods, useBaseType: false, matchAll: true, instantOnly: true };
}

function baseResult(index: PriceIndex, req: RareRequest) {
  return {
    kind: 'trade' as const, requestId: req.id, item: req.item, league: index.league, mods: req.mods,
    useBaseType: req.useBaseType, matchAll: req.matchAll, instantOnly: req.instantOnly,
    ...(req.reference ? { reference: req.reference } : {}),
    ...(index.exaltedPerDivine ? { exaltedPerDivine: index.exaltedPerDivine } : {}),
    ...(req.missingKeys?.length ? { missingKeys: req.missingKeys } : {}),
  };
}

/**
 * Erste Ansicht nach dem Hotkey: Mods und Filter, aber noch keine Suche. Gesucht wird erst mit
 * Klick auf "Search" – so geht keine Anfrage an pathofexile.com, bevor die Auswahl passt.
 */
export function idleRareResult(index: PriceIndex, req: RareRequest): PriceResult {
  return { ...baseResult(index, req), search: null };
}


/**
 * Gleiche Suche innerhalb einer Minute (z. B. dasselbe Item zweimal geprüft oder zwischen
 * zwei Auswahlen hin und her) → Ergebnis wiederverwenden: schneller und schont die Rate-Limits.
 */
const SEARCH_CACHE_TTL_MS = 60_000;
const searchCache = new Map<string, { at: number; search: TradeSearch }>();

function cachedSearch(key: string): TradeSearch | undefined {
  const now = Date.now();
  for (const [k, v] of searchCache) if (now - v.at > SEARCH_CACHE_TTL_MS) searchCache.delete(k);
  return searchCache.get(key)?.search;
}

/** Eine Suche + ein Abruf der 10 günstigsten Angebote = 2 Anfragen pro Preischeck. */
export async function runRareSearch(client: TradeClient, index: PriceIndex, req: RareRequest): Promise<PriceResult> {
  const base = baseResult(index, req);

  // Uniques und weiße Basen lassen sich auch ganz ohne Mods suchen (Name bzw. Basis reichen).
  if (!isNamedUnique(req.item) && req.item.rarity !== 'Normal' && req.item.rarity !== 'Gem' && !req.mods.some((m) => m.enabled && (m.statId || m.filter))) {
    return { ...base, search: null, error: 'No mods selected. Tick at least one mod and search again.' };
  }

  try {
    const query = buildSearchQuery(req.item, req.mods, { useBaseType: req.useBaseType, matchAll: req.matchAll, instantOnly: req.instantOnly });
    const cacheKey = `${index.league}
${JSON.stringify(query)}`;
    const cached = cachedSearch(cacheKey);
    if (cached) return { ...base, search: cached };

    const found = await client.search(index.league, query);
    // 20 günstigste Angebote = zwei Abrufe zu je 10 (API-Grenze), parallel. Scheitert der zweite
    // (z. B. Rate-Limit), reichen die ersten 10.
    const [first, second] = await Promise.allSettled([
      client.fetchListings(found.id, found.result.slice(0, 10)),
      found.result.length > 10 ? client.fetchListings(found.id, found.result.slice(10, 20)) : Promise.resolve([]),
    ]);
    if (first.status === 'rejected') throw first.reason;
    const fetched = [...first.value, ...(second.status === 'fulfilled' ? second.value : [])];
    const listings = sortByValue(fetched.map((f) => toListing(f, index)).filter((l): l is Listing => l !== null));
    const search: TradeSearch = {
      queryId: found.id,
      url: tradeSearchUrl(index.league, found.id),
      total: found.total,
      listings,
      icon: fetched.find((f) => f.item.icon)?.item.icon,
      // Vorschlag und typischer Preis aus aktuellen Angeboten; alte zählen nur, wenn es sonst keine gibt.
      suggestion: suggestPrice(pricingBasis(listings).listings, index.exaltedPerDivine || null),
      market: marketPrice(listings, index.exaltedPerDivine || null),
      warnings: priceWarnings(found.total, listings),
    };
    searchCache.set(cacheKey, { at: Date.now(), search });
    return { ...base, search };
  } catch (e) {
    const message = e instanceof RateLimitError || e instanceof Error ? e.message : String(e);
    return { ...base, search: null, error: message };
  }
}

/** Auswahl aus dem Overlay (Haken, Mindestwerte, Schalter) auf eine Rare-Suche anwenden. */
export function applySelection(req: RareRequest, sel: TradeSelection): RareRequest {
  const enabled = new Set(sel.enabled);
  const maxs = sel.maxs ?? {};
  const mods = req.mods.map((m) => {
    const min = m.key in sel.mins ? (sel.mins[m.key] ?? undefined) : m.min;
    const max = m.key in maxs ? (maxs[m.key] ?? undefined) : m.max;
    return { ...m, enabled: (m.statId !== null || !!m.filter) && enabled.has(m.key), min, max };
  });
  return { ...req, mods, useBaseType: sel.useBaseType, matchAll: sel.matchAll, instantOnly: sel.instantOnly };
}
