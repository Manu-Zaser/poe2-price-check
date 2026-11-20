import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mapLimit, type PriceIndex } from '../src/main/ninja';
import { applySelection, idleRareResult, newRareRequest, runRareSearch } from '../src/main/rare';
import { parseMin } from '../src/renderer/format';
import type { TradeClient } from '@poe2/core/trade';
import { parseItemText } from '@poe2/core/item';
import { StatIndex, type StatsData } from '../src/shared/stats';

describe('mapLimit', () => {
  it('begrenzt die Parallelität und behält die Reihenfolge', async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 4, 2, 3, 0], 2, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, n * 3));
      running--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30, 0]);
    expect(peak).toBe(2);
  });
});

describe('Rare-Suche', () => {
  const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');
  const stats = new StatIndex(JSON.parse(fixture('trade-stats.json')) as StatsData);
  const index = { league: 'Test', exaltedPerDivine: 600, currencyById: new Map([['exalted', 1 / 600]]) } as unknown as PriceIndex;

  function fakeClient() {
    const calls = { search: 0, fetch: 0 };
    const client = {
      search: async () => (calls.search++, { id: 'q1', total: 3, result: ['a', 'b', 'c'] }),
      fetchListings: async () => (calls.fetch++, [{ id: 'a', listing: { indexed: '2026-11-01T00:00:00Z', price: { amount: 5, currency: 'exalted', type: '~b/o' } }, item: { ilvl: 80 } }]),
    } as unknown as TradeClient;
    return { client, calls };
  }

  it('shows the mods right away without searching, with "all stats must match" on', () => {
    const req = newRareRequest(parseItemText(fixture('rare-gloves-grim-claw.txt'))!, stats);
    const p = idleRareResult(index, req);
    // No request to pathofexile.com until "Search" is clicked
    expect(p).toMatchObject({ kind: 'trade', search: null, matchAll: true });
    expect(p).not.toHaveProperty('pending');
    expect(p.kind === 'trade' && p.mods.filter((m) => m.kind !== 'pseudo' && m.kind !== 'defence' && m.kind !== 'misc').length).toBe(7);
  });

  it('verwendet dieselbe Suche innerhalb einer Minute wieder (keine erneuten Anfragen)', async () => {
    const { client, calls } = fakeClient();
    const req = newRareRequest(parseItemText(fixture('rare-bow-morbid-stinger.txt'))!, stats);
    const first = await runRareSearch(client, index, req);
    const second = await runRareSearch(client, index, req);
    expect(calls).toEqual({ search: 1, fetch: 1 });
    expect(second.kind === 'trade' && second.search?.listings[0]).toMatchObject({ amount: 5, exalted: 5 });
    expect(first.kind === 'trade' && second.kind === 'trade' && first.search === second.search).toBe(true);
  });

  it('fragt bei geänderter Auswahl neu an', async () => {
    const { client, calls } = fakeClient();
    const req = newRareRequest(parseItemText(fixture('rare-bow-morbid-stinger.txt'))!, stats);
    await runRareSearch(client, index, { ...req, matchAll: false, useBaseType: true });
    expect(calls.search).toBe(1);
  });
});

describe('Overlay-Auswahl', () => {
  const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');
  const stats = new StatIndex(JSON.parse(fixture('trade-stats.json')) as StatsData);

  it('übernimmt Haken, geänderte und gelöschte Mindestwerte', () => {
    const req = newRareRequest(parseItemText(fixture('rare-gloves-grim-claw.txt'))!, stats);
    const life = req.mods.find((m) => m.text.includes('maximum Life'))!;
    const dex = req.mods.find((m) => m.text.includes('Dexterity'))!;
    const rarity = req.mods.find((m) => m.text.includes('Rarity'))!;
    const next = applySelection(req, {
      enabled: [life.key, dex.key],
      mins: { [life.key]: 5, [dex.key]: null },
      useBaseType: false,
      matchAll: true,
      instantOnly: false,
    });
    const get = (k: string) => next.mods.find((m) => m.key === k)!;
    expect(get(life.key)).toMatchObject({ enabled: true, min: 5 });
    expect(get(dex.key)).toMatchObject({ enabled: true, min: undefined });
    expect(get(rarity.key)).toMatchObject({ enabled: false, min: 12 }); // unverändert (80 % von 15), nur abgewählt
    expect(next).toMatchObject({ useBaseType: false, matchAll: true, id: req.id });
  });
});

describe('parseMin', () => {
  it('versteht Komma, Punkt und leere Eingaben', () => {
    expect(parseMin('15,5')).toBe(15.5);
    expect(parseMin(' 20 ')).toBe(20);
    expect(parseMin('')).toBeNull();
    expect(parseMin('abc')).toBeNaN();
  });
});
