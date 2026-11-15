import { describe, expect, it } from 'vitest';
import { buildPriceIndex, lookupPrice, type FetchJson } from '../src/main/ninja';
import { parseItemText } from '../src/shared/parser';

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
