import { describe, expect, it } from 'vitest';
import { cleanWatchlist, dedupe, filterMarket, itemSignal, marketKey, tabOf, topMovers, trendSignal, type MarketItem } from '../src/shared/market';

const item = (name: string, exalted: number, extra: Partial<MarketItem> = {}): MarketItem => ({
  key: marketKey(name, extra.baseType), name, tab: 'currency', divine: exalted / 600, exalted, ...extra,
});

describe('market', () => {
  it('maps poe.ninja types to tabs', () => {
    expect(tabOf('Currency')).toBe('currency');
    expect(tabOf('Breach')).toBe('fragments');
    expect(tabOf('SoulCores')).toBe('runes');
    expect(tabOf('UniqueJewels')).toBe('uniques');
  });

  it('keeps the unique variant with the most listings', () => {
    const a = item('Temporalis', 4000, { baseType: 'Silk Robe', tab: 'uniques', listingCount: 3 });
    const b = item('Temporalis', 3000, { baseType: 'Silk Robe', tab: 'uniques', listingCount: 20 });
    expect(dedupe([a, b])).toEqual([b]);
  });

  it('filters by tab and search words and sorts', () => {
    const items = [
      item('Divine Orb', 600, { change7d: 2 }),
      item('Chaos Orb', 60, { change7d: -8 }),
      item('Orb of Annulment', 120, { change7d: 15 }),
      item('Headhunter', 9000, { baseType: 'Leather Belt', tab: 'uniques' }),
    ];
    expect(filterMarket(items, { tab: 'currency', sort: 'price' }).map((i) => i.name)).toEqual(['Divine Orb', 'Orb of Annulment', 'Chaos Orb']);
    expect(filterMarket(items, { tab: 'currency', sort: 'rising' })[0].name).toBe('Orb of Annulment');
    expect(filterMarket(items, { tab: 'currency', sort: 'falling' })[0].name).toBe('Chaos Orb');
    expect(filterMarket(items, { tab: 'all', query: 'leather head', sort: 'price' }).map((i) => i.name)).toEqual(['Headhunter']);
  });

  it('top movers ignore cheap items and uniques with few listings', () => {
    const items = [
      item('Big Riser', 50, { change7d: 40 }),
      item('Cheap Riser', 10, { change7d: 300 }),
      item('Thin Unique', 500, { tab: 'uniques', baseType: 'Ring', listingCount: 2, change7d: 200 }),
      item('Faller', 80, { change7d: -25 }),
      item('No Trend', 80),
    ];
    const m = topMovers(items);
    expect(m.up.map((i) => i.name)).toEqual(['Big Riser']);
    expect(m.down.map((i) => i.name)).toEqual(['Faller']);
  });

  it('hides uniques with very few listings unless searching', () => {
    const items = [
      item('Troll Price', 9e9, { baseType: 'Glass Shank', tab: 'uniques', listingCount: 1 }),
      item('Real Unique', 600, { baseType: 'Silk Robe', tab: 'uniques', listingCount: 19 }),
    ];
    expect(filterMarket(items, { tab: 'uniques', sort: 'price' }).map((i) => i.name)).toEqual(['Real Unique']);
    expect(filterMarket(items, { tab: 'all', query: 'troll', sort: 'price', includeThin: true }).map((i) => i.name)).toEqual(['Troll Price']);
  });

  it('cleans the watchlist', () => {
    expect(cleanWatchlist(['Divine Orb', 'divine orb', '', 'Headhunter|Leather Belt'])).toEqual(['divine orb', 'headhunter|leather belt']);
    expect(cleanWatchlist('x')).toEqual([]);
  });
});

describe('trend signals', () => {
  // Kurven aus echten poe.ninja-Daten (Änderung in % gegenüber vor einer Woche, Tag für Tag)
  it('detects the patterns', () => {
    expect(trendSignal([-0.37, -3.56, -7.53, -15.71, -15.17, -17.99, -18.9])).toBe('sliding');
    expect(trendSignal([4.03, 5.84, 4.22, 6.87, 7.26, 7.95, 12.6])).toBe('climb');
    expect(trendSignal([1.11, 0.63, 15.77, 14.88, 61.83, 116.2, 218.1])).toBe('accelerating');
    expect(trendSignal([-14.04, -34.17, -2.64, 4.13, 9.36, -5.76, 106.2])).toBe('spike');
    expect(trendSignal([-37.04, -48.74, -24.41, -24.83, -31.95, -37.52, -14.92])).toBe('recovering');
  });

  it('gives no signal for flat, short or old one-off moves', () => {
    expect(trendSignal([0.5, -0.3, 0.2, 0.1, -0.4, 0.3, 0.2])).toBeUndefined();
    expect(trendSignal([5, 10])).toBeUndefined();
    expect(trendSignal(undefined)).toBeUndefined();
    // Sprung am ersten Tag, danach ruhig: schon eingepreist, kein "Spike"
    expect(trendSignal([31.63, 18, 55.82, 32.3, 42.28, 20.46, 17.54])).not.toBe('spike');
  });

  it('only for items with a reliable price, and as a filter', () => {
    const climb = [4.03, 5.84, 4.22, 6.87, 7.26, 7.95, 12.6];
    expect(itemSignal(item('Cheap', 2, { sparkline: climb }))).toBeUndefined();
    expect(itemSignal(item('Thin', 500, { tab: 'uniques', baseType: 'Ring', listingCount: 2, sparkline: climb }))).toBeUndefined();
    const items = [item('Climber', 50, { sparkline: climb }), item('Flat', 50, { sparkline: [0, 0, 0, 0, 0] })];
    expect(filterMarket(items, { tab: 'all', sort: 'price', signal: 'climb' }).map((i) => i.name)).toEqual(['Climber']);
  });
});
