import { describe, expect, it } from 'vitest';
import { parseRules, RateLimiter } from '../src/main/ratelimit';

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('parseRules', () => {
  it('liest das Header-Format von GGG', () => {
    expect(parseRules('5:10:60,15:60:300')).toEqual([
      { max: 5, period: 10, restrict: 60 },
      { max: 15, period: 60, restrict: 300 },
    ]);
    expect(parseRules(null)).toEqual([]);
  });
});

describe('RateLimiter', () => {
  it('lässt eine Anfrage Puffer und wartet, bis das Fenster frei ist', () => {
    const c = clock();
    const rl = new RateLimiter([{ max: 5, period: 10, restrict: 60 }], c.now);
    for (let i = 0; i < 4; i++) {
      expect(rl.waitTime()).toBe(0);
      rl.record();
      c.advance(1000);
    }
    // 4 von 5 verbraucht → fünfte wird zurückgehalten, bis die erste aus dem 10-s-Fenster fällt
    expect(rl.waitTime()).toBe(6000 + 50);
    c.advance(6100);
    expect(rl.waitTime()).toBe(0);
  });

  it('übernimmt aktive Sperren aus dem State-Header', () => {
    const c = clock();
    const rl = new RateLimiter([{ max: 5, period: 10, restrict: 60 }], c.now);
    rl.update('5:10:60', '6:10:60');
    expect(rl.waitTime()).toBe(60_000);
  });

  it('zählt Treffer nach, die der Server kennt (z. B. offene Trade-Website)', () => {
    const c = clock();
    const rl = new RateLimiter([{ max: 5, period: 10, restrict: 60 }], c.now);
    rl.update('5:10:60', '4:10:0');
    expect(rl.waitTime()).toBeGreaterThan(0);
  });

  it('nachgetragene Treffer eines langen Fensters blockieren kein kurzes Fenster', () => {
    const c = clock();
    const rl = new RateLimiter([], c.now);
    // 1 Suche in den letzten 10 s, aber 6 in den letzten 5 Minuten (echte Antwort von GGG)
    rl.update('5:10:60,15:60:300,30:300:1800', '1:10:0,4:60:0,6:300:0');
    expect(rl.waitTime()).toBe(0);
  });

  it('blockFor setzt eine Sperre (z. B. nach 429)', () => {
    const c = clock();
    const rl = new RateLimiter([], c.now);
    rl.blockFor(30);
    expect(rl.waitTime()).toBe(30_000);
  });
});
