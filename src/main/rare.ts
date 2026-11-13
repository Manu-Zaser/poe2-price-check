/** Preischeck für Rares/Magic-Items über die Trade-Suche. */
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { buildSearchQuery, buildTradeMods, StatIndex, tradeSearchUrl, type StatsData } from '../shared/stats';
import type { Listing, ParsedItem, PriceResult, TradeMod, TradeSearch, TradeSelection } from '../shared/types';
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

export interface RareRequest {
  id: number;
  item: ParsedItem;
  mods: TradeMod[];
  useBaseType: boolean;
  matchAll: boolean;
}

let nextRequestId = 1;

export function newRareRequest(item: ParsedItem, stats: StatIndex): RareRequest {
  return { id: nextRequestId++, item, mods: buildTradeMods(item, stats), useBaseType: true, matchAll: false };
}

function baseResult(index: PriceIndex, req: RareRequest) {
  return { kind: 'trade' as const, requestId: req.id, item: req.item, league: index.league, mods: req.mods, useBaseType: req.useBaseType, matchAll: req.matchAll };
}

/** Zwischenstand fürs Overlay, solange die Trade-API noch antwortet. */
export function pendingRareResult(index: PriceIndex, req: RareRequest): PriceResult {
  return { ...baseResult(index, req), search: null, pending: true };
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

  if (!req.mods.some((m) => m.enabled && m.statId)) {
    return { ...base, search: null, error: 'Keine Mods ausgewählt. Mindestens einen Mod anhaken und neu suchen.' };
  }

  try {
    const query = buildSearchQuery(req.item, req.mods, { useBaseType: req.useBaseType, matchAll: req.matchAll });
    const cacheKey = `${index.league}
${JSON.stringify(query)}`;
    const cached = cachedSearch(cacheKey);
    if (cached) return { ...base, search: cached };

    const found = await client.search(index.league, query);
    const fetched = await client.fetchListings(found.id, found.result.slice(0, 10));
    const listings = fetched.map((f) => toListing(f, index)).filter((l): l is Listing => l !== null);
    const search: TradeSearch = {
      queryId: found.id,
      url: tradeSearchUrl(index.league, found.id),
      total: found.total,
      listings,
      icon: fetched.find((f) => f.item.icon)?.item.icon,
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
  const mods = req.mods.map((m) => {
    const min = m.key in sel.mins ? (sel.mins[m.key] ?? undefined) : m.min;
    return { ...m, enabled: m.statId !== null && enabled.has(m.key), min };
  });
  return { ...req, mods, useBaseType: sel.useBaseType, matchAll: sel.matchAll };
}
