/**
 * Clientseitige Rate-Limits für die Trade-API.
 *
 * GGG schickt pro Antwort die Regeln (X-Rate-Limit-Ip: "max:periode:sperre,…") und den
 * aktuellen Stand (X-Rate-Limit-Ip-State: "treffer:periode:aktive_sperre,…"). Wer die Grenze
 * reißt, wird für "sperre" Sekunden blockiert – bei der Suche bis zu 30 Minuten. Deshalb
 * rechnen wir vorher selbst mit und lassen eine Anfrage Puffer (die Trade-Website im Browser
 * zählt auf dieselbe IP).
 */

export interface Rule { max: number; period: number; restrict: number }

export function parseRules(header: string | null | undefined): Rule[] {
  if (!header) return [];
  return header.split(',').map((part) => {
    const [max, period, restrict] = part.split(':').map(Number);
    return { max, period, restrict };
  }).filter((r) => r.max > 0 && r.period > 0);
}

export function parseState(header: string | null | undefined): { hits: number; period: number; restricted: number }[] {
  if (!header) return [];
  return header.split(',').map((part) => {
    const [hits, period, restricted] = part.split(':').map(Number);
    return { hits, period, restricted };
  });
}

export class RateLimitError extends Error {
  constructor(readonly waitMs: number) {
    super(`Trade-API: Rate-Limit erreicht – bitte ${Math.ceil(waitMs / 1000)} s warten.`);
  }
}

export class RateLimiter {
  private history: number[] = [];
  private blockedUntil = 0;

  constructor(private rules: Rule[], private now: () => number = Date.now) {}

  /** Eine Anfrage Puffer, sobald die Grenze nicht winzig ist. */
  private effectiveMax(rule: Rule): number {
    return rule.max > 3 ? rule.max - 1 : rule.max;
  }

  /** Millisekunden, die bis zur nächsten erlaubten Anfrage gewartet werden muss. */
  waitTime(): number {
    const now = this.now();
    let wait = Math.max(0, this.blockedUntil - now);
    for (const rule of this.rules) {
      const windowStart = now - rule.period * 1000;
      const inWindow = this.history.filter((t) => t > windowStart);
      const max = this.effectiveMax(rule);
      if (inWindow.length >= max) {
        // Die älteste Anfrage, die "zu viel" ist, muss erst aus dem Fenster fallen.
        const oldest = inWindow[inWindow.length - max];
        wait = Math.max(wait, oldest + rule.period * 1000 - now + 50);
      }
    }
    return wait;
  }

  record(): void {
    const now = this.now();
    this.history.push(now);
    const longest = Math.max(0, ...this.rules.map((r) => r.period)) * 1000;
    this.history = this.history.filter((t) => t > now - longest);
  }

  /** Regeln und Zustand aus den Antwort-Headern übernehmen. */
  update(rulesHeader: string | null, stateHeader: string | null): void {
    const rules = parseRules(rulesHeader);
    if (rules.length) this.rules = rules;
    const now = this.now();
    for (const s of parseState(stateHeader)) {
      if (s.restricted > 0) this.blockedUntil = Math.max(this.blockedUntil, now + s.restricted * 1000);
      // Server zählt mehr als wir (z. B. Trade-Website offen) → fehlende Treffer nachtragen.
      // Sie landen kurz nach Fensterbeginn, damit sie kürzere Fenster (10 s) nicht fälschlich füllen.
      const rule = this.rules.find((r) => r.period === s.period);
      if (!rule) continue;
      const windowStart = now - s.period * 1000;
      const ours = this.history.filter((t) => t > windowStart).length;
      for (let i = ours; i < s.hits; i++) this.history.push(windowStart + 1000);
    }
    this.history.sort((a, b) => a - b);
  }

  blockFor(seconds: number): void {
    this.blockedUntil = Math.max(this.blockedUntil, this.now() + seconds * 1000);
  }
}
