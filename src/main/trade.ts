/**
 * Client für die Trade-Suche von pathofexile.com (/api/trade2).
 *
 * Hinweis: Diese Endpunkte sind nicht Teil der dokumentierten GGG-API. Alle bekannten
 * Preischeck-Tools nutzen sie; wir halten uns strikt an die gemeldeten Rate-Limits,
 * fragen nur auf ausdrücklichen Tastendruck/Klick an und senden keine Login-Cookies.
 */
import { RateLimiter, RateLimitError } from './ratelimit';
import type { StatsData } from '../shared/stats';

const BASE = 'https://www.pathofexile.com/api/trade2';

/** Nur so lange warten wir still; darüber bekommt der Nutzer eine Meldung. */
const MAX_SILENT_WAIT_MS = 4000;

export interface SearchResponse { id: string; total: number; result: string[] }

export interface FetchedListing {
  id: string;
  listing: { indexed: string; price?: { amount: number; currency: string; type: string } };
  item: { icon?: string; ilvl?: number; baseType?: string };
}

export class TradeApiError extends Error {}

type FetchImpl = typeof fetch;

export class TradeClient {
  // Startwerte = beobachtete Limits; werden mit jeder Antwort aktualisiert.
  readonly searchLimiter = new RateLimiter([{ max: 5, period: 10, restrict: 60 }, { max: 15, period: 60, restrict: 300 }, { max: 30, period: 300, restrict: 1800 }]);
  readonly fetchLimiter = new RateLimiter([{ max: 12, period: 4, restrict: 10 }, { max: 16, period: 12, restrict: 300 }]);

  constructor(private userAgent: string, private fetchImpl: FetchImpl = fetch) {}

  private async request<T>(limiter: RateLimiter, url: string, init: RequestInit = {}): Promise<T> {
    const wait = limiter.waitTime();
    if (wait > MAX_SILENT_WAIT_MS) throw new RateLimitError(wait);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));

    limiter.record();
    const res = await this.fetchImpl(url, {
      ...init,
      headers: { 'User-Agent': this.userAgent, Accept: 'application/json', ...(init.headers ?? {}) },
    });
    limiter.update(res.headers.get('x-rate-limit-ip'), res.headers.get('x-rate-limit-ip-state'));

    if (res.status === 429) {
      const retry = Number(res.headers.get('retry-after') ?? 60);
      limiter.blockFor(retry);
      throw new RateLimitError(retry * 1000);
    }
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { error?: { message?: string } };
        if (body.error?.message) message = body.error.message;
      } catch {
        // kein JSON
      }
      throw new TradeApiError(`Trade-API: ${message}`);
    }
    return (await res.json()) as T;
  }

  /** Stat-Liste für die Zuordnung von Mods (ändert sich nur mit Patches). */
  async loadStats(): Promise<StatsData> {
    const res = await this.fetchImpl(`${BASE}/data/stats`, { headers: { 'User-Agent': this.userAgent } });
    if (!res.ok) throw new TradeApiError(`Trade-API: Stat-Liste nicht ladbar (HTTP ${res.status})`);
    return (await res.json()) as StatsData;
  }

  search(league: string, query: unknown): Promise<SearchResponse> {
    return this.request(this.searchLimiter, `${BASE}/search/poe2/${encodeURIComponent(league)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(query),
    });
  }

  /** Holt höchstens 10 Angebote (Limit der API pro Abruf). */
  async fetchListings(queryId: string, ids: string[]): Promise<FetchedListing[]> {
    if (ids.length === 0) return [];
    const res = await this.request<{ result: (FetchedListing | null)[] }>(
      this.fetchLimiter,
      `${BASE}/fetch/${ids.slice(0, 10).join(',')}?query=${encodeURIComponent(queryId)}`,
    );
    return res.result.filter((r): r is FetchedListing => r !== null);
  }
}
