import { describe, expect, it } from 'vitest';
import { buildPriceIndex, lookupPrice, type FetchJson } from '../src/main/ninja';
import { parseItemText } from '../src/shared/parser';

const fakeFetch: FetchJson = async (url) => {
  const type = new URL(url).searchParams.get('type');
  const core = { rates: { exalted: 600 }, primary: 'divine' };
  if (url.includes('/exchange/')) {
    if (type !== 'Currency') return { core, lines: [], items: [] };
    return {
      core,
      lines: [
        { id: 'divine', primaryValue: 1, sparkline: { totalChange: 10 } },
        { id: 'exalted', primaryValue: 1 / 600 },
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
