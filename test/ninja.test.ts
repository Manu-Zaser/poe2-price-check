import { describe, expect, it } from 'vitest';
import { buildPriceIndex, checkPairs, fetchPairs, lookupPrice, type FetchJson } from '../src/main/ninja';
import { parseItemText } from '@poe2/core/item';

const fakeFetch: FetchJson = async (url) => {
  const type = new URL(url).searchParams.get('type');
  const core = { rates: { exalted: 600 }, primary: 'divine' };
  if (url.includes('/exchange/')) {
    if (type === 'UncutGems') {
      return {
        core,
        lines: [{ id: 'uncut-skill-gem-12', primaryValue: 0.0067 }],
        items: [{ id: 'uncut-skill-gem-12', name: 'Uncut Skill Gem (Level 12)' }],
      };
    }
    if (type !== 'Currency') return { core, lines: [], items: [] };
    return {
      core,
      lines: [
        { id: 'divine', primaryValue: 1, sparkline: { totalChange: 10, data: [1, null, 4, 10] } },
        { id: 'exalted', primaryValue: 1 / 600, sparkline: { totalChange: 0, data: [0] } },
      ],
      items: [
        { id: 'divine', name: 'Divine Orb' },
        { id: 'exalted', name: 'Exalted Orb' },
      ],
    };
  }
  if (type !== 'UniqueArmours') return { core, lines: [] };
  return {
    core,
    lines: [
      { name: 'Temporalis', baseType: 'Silk Robe', primaryValue: 6694, listingCount: 18 },
      { name: 'Temporalis', baseType: 'Runemastered Silk Robe', primaryValue: 7400, listingCount: 3 },
      { name: 'Cheap Robe', baseType: 'Silk Robe', primaryValue: 0.01 },
    ],
  };
};

const item = (text: string) => parseItemText(text)!;

describe('poe.ninja-Preisindex', () => {
  it('bewertet Währung inkl. Exalted-Umrechnung', async () => {
    const index = await buildPriceIndex(fakeFetch, 'Test');
    const r = lookupPrice(index, item('Item Class: Stackable Currency\nRarity: Currency\nDivine Orb\n--------\nStack Size: 3/20'));
    expect(r.kind).toBe('priced');
    if (r.kind !== 'priced') return;
    expect(r.matches[0]).toMatchObject({ name: 'Divine Orb', divine: 1, exalted: 600, change7d: 10 });
    expect(r.stackSize).toBe(3);
  });

  it('wählt bei gleichnamigen Uniques die passende Basis', async () => {
    const index = await buildPriceIndex(fakeFetch, 'Test');
    const r = lookupPrice(index, item('Item Class: Body Armours\nRarity: Unique\nTemporalis\nSilk Robe'));
    expect(r.kind === 'priced' && r.matches.map((m) => m.divine)).toEqual([6694]);
  });

  it('listet bei unidentifizierten Uniques alle Kandidaten der Basis, teuerste zuerst', async () => {
    const index = await buildPriceIndex(fakeFetch, 'Test');
    const r = lookupPrice(index, item('Item Class: Body Armours\nRarity: Unique\nSilk Robe\n--------\nUnidentified'));
    expect(r.kind === 'priced' && r.matches.map((m) => m.name)).toEqual(['Temporalis', 'Cheap Robe']);
  });

  it('meldet Rares als (noch) nicht unterstützt', async () => {
    const index = await buildPriceIndex(fakeFetch, 'Test');
    const r = lookupPrice(index, item('Item Class: Rings\nRarity: Rare\nGale Spiral\nSapphire Ring'));
    expect(r.kind).toBe('unsupported');
  });
});

describe('poe.ninja: trend and uncut gems', () => {
  it('keeps the daily price change for the trend graphic, without gaps', async () => {
    const index = await buildPriceIndex(fakeFetch, 'Test');
    expect(index.currency.get('divine orb')?.sparkline).toEqual([1, 4, 10]);
    expect(index.currency.get('exalted orb')?.sparkline).toBeUndefined(); // one point is not a line
  });

  it('prices uncut gems by level', async () => {
    const index = await buildPriceIndex(fakeFetch, 'Test');
    const gem = item('Item Class: Uncut Skill Gems\nRarity: Currency\nUncut Skill Gem\n--------\nLevel: 12\n--------\nCreates a Skill Gem or Levels up an existing Skill Gem to level 12');
    expect(gem.gemLevel).toBe(12);
    const r = lookupPrice(index, gem);
    expect(r.kind === 'priced' && r.matches[0].name).toBe('Uncut Skill Gem (Level 12)');
  });
});

describe('poe.ninja: market list', () => {
  it('collects all prices with tab and stable key for the market page', async () => {
    const index = await buildPriceIndex(fakeFetch, 'Test');
    const byKey = new Map(index.market.map((m) => [m.key, m]));
    expect(byKey.get('divine orb')).toMatchObject({ tab: 'currency', exalted: 600, change7d: 10 });
    expect(byKey.get('uncut skill gem (level 12)')!.tab).toBe('gems');
    expect(byKey.get('temporalis|silk robe')).toMatchObject({ tab: 'uniques', baseType: 'Silk Robe', listingCount: 18 });
    expect(index.market).toHaveLength(6);
  });
});

describe('pair rates', () => {
  // Rune of Acrobatics, 19.11.2026: poe.ninja's price came from a few odd chaos trades.
  const acrobatics = [
    { currency: 'divine', rate: 1, divine: 1 },
    { currency: 'exalted', rate: 10, divine: 10 / 473.7 },
    { currency: 'chaos', rate: 11.25, divine: 11.25 / 10.76 },
  ];
  const match = { name: 'Rune of Acrobatics', divine: 1.05, exalted: 497, ninjaRef: { type: 'Runes', id: 'rune-of-acrobatics' } };

  it('takes the lower price and warns when the trade pairs disagree', () => {
    const r = checkPairs(match, acrobatics, 473.7);
    expect(r.exalted).toBeCloseTo(10);
    expect(r.divine).toBeCloseTo(0.0211, 3);
    expect(r.warning).toMatch(/10 Exalted vs 11.3 Chaos/);
  });

  it('keeps the price when the pairs agree or only one exists', () => {
    const agree = [
      { currency: 'divine', rate: 0.093, divine: 0.093 },
      { currency: 'exalted', rate: 49.5, divine: 49.5 / 473.7 },
    ];
    expect(checkPairs({ ...match, divine: 0.093, exalted: 44 }, agree, 473.7)).toEqual({ ...match, divine: 0.093, exalted: 44 });
    expect(checkPairs(match, acrobatics.slice(0, 1), 473.7)).toBe(match);
  });

  it('reads pair rates from poe.ninja and converts them to Divine', async () => {
    const fetchJson = async (url: string) => {
      expect(url).toContain('/exchange/current/details?league=Forbidden%20Rites&type=Runes&id=rune-of-acrobatics');
      return {
        core: { rates: { exalted: 473.7, chaos: 10.76 } },
        pairs: [
          { id: 'divine', rate: 1 },
          { id: 'exalted', rate: 10 },
          { id: 'chaos', rate: 11.25 },
          { id: 'mirror', rate: 0.001 },
        ],
      };
    };
    const quotes = await fetchPairs(fetchJson, 'Forbidden Rites', match.ninjaRef);
    expect(quotes.map((q) => q.currency)).toEqual(['divine', 'exalted', 'chaos']);
    expect(quotes[2].divine).toBeCloseTo(1.0455, 3);
  });
});
