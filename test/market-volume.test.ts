import { describe, expect, it } from 'vitest';
import { filterMarket, isSuspect, liquidity, marketKey, topMovers, tradedUnits, volumeText, type MarketItem } from '../src/shared/market';

// Preise in Divine bei 520 Ex je Divine, Volumen wie in poe.ninjas Übersicht (volumePrimaryValue, in Divine).
const ex = (name: string, divine: number, volumeDivine: number, extra: Partial<MarketItem> = {}): MarketItem => ({
  key: marketKey(name), name, tab: 'runes', divine, exalted: divine * 520, volumeDivine, ninjaRef: { type: 'Runes', id: name }, ...extra,
});

describe('trade volume from the poe.ninja overview', () => {
  const acrobatics = ex('Rune of Acrobatics', 1, 1.17, { change7d: 900 });
  const masterwork = ex('Masterwork Rune', 1.71, 242.5, { change7d: 12 });
  const mid = ex('Craiceann\'s Rune of Recovery', 1, 8, { change7d: -20 });

  it('estimates traded units and rates the volume', () => {
    expect(tradedUnits(masterwork)).toBeCloseTo(141.8, 1);
    expect(liquidity(acrobatics)).toBe('low');
    expect(liquidity(mid)).toBe('medium');
    expect(liquidity(masterwork)).toBe('high');
    expect(volumeText(masterwork)).toBe('≈ 142 traded');
    expect(volumeText(acrobatics)).toBe('≈ 1.2 traded');
  });

  it('rates uniques by their listings', () => {
    const u = (n: number) => ({ key: 'x', name: 'X', tab: 'uniques' as const, divine: 1, exalted: 520, listingCount: n });
    expect([u(4), u(15), u(80)].map(liquidity)).toEqual(['low', 'medium', 'high']);
    expect(volumeText(u(1))).toBe('1 listing');
  });

  it('warns only for valuable items with very few trades', () => {
    expect(isSuspect(acrobatics)).toBe(true);
    expect(isSuspect(ex('Cheap Rune', 0.01, 0.005))).toBe(false); // 5 Ex – egal, wenn ungenau
    expect(isSuspect(masterwork)).toBe(false);
  });

  it('keeps rarely traded items out of the weekly movers and can hide them in the list', () => {
    const items = [acrobatics, masterwork, mid];
    expect(topMovers(items).up.map((i) => i.name)).toEqual(['Masterwork Rune']);
    expect(filterMarket(items, { tab: 'runes', sort: 'price', tradedOnly: true }).map((i) => i.name)).toEqual(['Masterwork Rune', "Craiceann's Rune of Recovery"]);
    expect(filterMarket(items, { tab: 'runes', sort: 'volume' }).map((i) => i.name)).toEqual(['Masterwork Rune', "Craiceann's Rune of Recovery", 'Rune of Acrobatics']);
  });
});
