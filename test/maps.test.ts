import { describe, expect, it } from 'vitest';
import { cleanDangerList, DEFAULT_DANGER_MODS, isMapItem, markDangerous, wikiUrl } from '../src/shared/maps';
import type { TradeMod } from '../src/shared/types';

const mod = (key: string, text: string, kind: TradeMod['kind'] = 'explicit'): TradeMod => ({ key, text, kind, statId: null, value: null, enabled: false });

describe('waystones and tablets', () => {
  it('recognises map items by item class', () => {
    expect(isMapItem({ itemClass: 'Waystones' })).toBe(true);
    expect(isMapItem({ itemClass: 'Tablet' })).toBe(true);
    expect(isMapItem({ itemClass: 'Bows' })).toBe(false);
  });

  it('marks mods that contain a dangerous text, case-insensitive', () => {
    const mods = [
      mod('0', 'Players have 60% less Recovery Rate of Life and Energy Shield'),
      mod('1', 'Monsters deal 30% of Damage as Extra Chaos'),
      mod('2', '+25% increased Pack size'),
      mod('p', 'Players are cursed with Enfeeble', 'pseudo'),
    ];
    const marked = markDangerous(mods, ['less recovery rate', 'AS EXTRA CHAOS', 'are Cursed with']);
    expect(marked.map((m) => !!m.danger)).toEqual([true, true, false, false]);
  });

  it('cleans the list from the settings', () => {
    expect(cleanDangerList(['  Penetrate ', '', 'penetrate', 'Break Armour'])).toEqual(['Penetrate', 'Break Armour']);
    expect(cleanDangerList(DEFAULT_DANGER_MODS)).toEqual(DEFAULT_DANGER_MODS);
  });
});

describe('wikiUrl', () => {
  it('uses the unique name, otherwise the base type', () => {
    expect(wikiUrl({ rarity: 'Unique', name: 'Headhunter', baseType: 'Heavy Belt', unidentified: false })).toBe('https://www.poe2wiki.net/wiki/Headhunter');
    expect(wikiUrl({ rarity: 'Unique', baseType: 'Heavy Belt', unidentified: true })).toBe('https://www.poe2wiki.net/wiki/Heavy_Belt');
    expect(wikiUrl({ rarity: 'Rare', name: 'Morbid Stinger', baseType: 'Obliterator Bow', unidentified: false })).toBe('https://www.poe2wiki.net/wiki/Obliterator_Bow');
    expect(wikiUrl({ rarity: 'Unique', name: "Death's Harp", baseType: 'Bow', unidentified: false })).toBe("https://www.poe2wiki.net/wiki/Death's_Harp");
  });
});
