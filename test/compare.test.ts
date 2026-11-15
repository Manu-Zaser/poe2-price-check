import { describe, expect, it } from 'vitest';
import { compareListing, listingValues, verdictText } from '../src/shared/compare';
import type { ListingDetails } from '../src/shared/listing';
import type { TradeMod } from '../src/shared/types';

const details = (mods: ListingDetails['mods'], dps?: ListingDetails['dps']): ListingDetails => ({ name: '', base: 'Boots', properties: [], mods, ...(dps ? { dps } : {}) });
const own = (statId: string, value: number, extra: Partial<TradeMod> = {}): TradeMod => ({ key: statId, text: statId, kind: 'explicit', statId, value, enabled: true, ...extra });

describe('listingValues', () => {
  it('reads stat values, sums pseudo totals and averages "Adds # to #"', () => {
    const v = listingValues(details([
      { kind: 'explicit', text: '+80 to maximum Life', statId: 'explicit.stat_life' },
      { kind: 'implicit', text: '+20 to maximum Life', statId: 'implicit.stat_life' },
      { kind: 'explicit', text: '+12% to Fire and Cold Resistances', statId: 'explicit.stat_fc' },
      { kind: 'rune', text: '+10% to Lightning Resistance', statId: 'rune.stat_light' },
      { kind: 'explicit', text: 'Adds 12 to 21 Physical Damage', statId: 'explicit.stat_adds' },
      { kind: 'fractured', text: '30% increased Movement Speed', statId: 'fractured.stat_ms' },
    ], { total: 200, physical: 150, elemental: 50 }));
    expect(v.get('explicit.stat_life')).toBe(80);
    expect(v.get('pseudo.pseudo_total_life')).toBe(100);
    expect(v.get('pseudo.pseudo_total_elemental_resistance')).toBe(34);
    expect(v.get('explicit.stat_adds')).toBe(16.5);
    expect(v.get('explicit.stat_ms')).toBe(30); // fractured zählt wie explicit
    expect(v.get('filter:pdps')).toBe(150);
  });
});

describe('compareListing', () => {
  const listing = details([
    { kind: 'explicit', text: '+90 to maximum Life', statId: 'explicit.stat_life' },
    { kind: 'explicit', text: '35% increased Movement Speed', statId: 'explicit.stat_ms' },
  ]);

  it('is better when every searched stat is at least as high', () => {
    const c = compareListing([own('pseudo.pseudo_total_life', 80), own('explicit.stat_ms', 30)], listing)!;
    expect(c.verdict).toBe('better');
    expect(c.higher).toBe(2);
    expect(c.deltas.get('explicit.stat_ms')!.delta).toBe(5);
    expect(verdictText(c)).toBe('Better than yours · 2 higher (of 2)');
  });

  it('counts a missing stat as lower and gives a mixed verdict', () => {
    const c = compareListing([own('explicit.stat_ms', 30), own('explicit.stat_rarity', 15)], listing)!;
    expect(c.verdict).toBe('mixed');
    expect(c.deltas.get('explicit.stat_rarity')!.theirs).toBe(0);
  });

  it('skips unticked, low-value and "reduced" mods', () => {
    const c = compareListing([
      own('explicit.stat_ms', 40),
      own('explicit.stat_life', 200, { enabled: false }),
      own('explicit.stat_light', 20, { low: true }),
      own('explicit.stat_x', 10, { invert: true }),
    ], listing)!;
    expect(c.total).toBe(1);
    expect(c.verdict).toBe('worse');
  });

  it('compares weapon DPS and returns null when nothing can be compared', () => {
    const w = details([], { total: 300, physical: 250, elemental: 50 });
    const dps: TradeMod = { key: 'w:pdps', text: 'pdps', kind: 'weapon', statId: null, filter: 'pdps', value: 250, enabled: true };
    expect(compareListing([dps], w)!.verdict).toBe('same');
    expect(compareListing([{ ...dps, filter: 'ilvl' }], w)).toBeNull();
  });
});
