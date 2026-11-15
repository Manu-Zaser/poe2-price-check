import { describe, expect, it } from 'vitest';
import { cleanMarkup, listingDetails } from '../src/shared/listing';

// Shape as returned by /api/trade2/fetch (trimmed real response, Nov 2026)
const item = {
  name: '',
  typeLine: 'Sanctified Apostle Leggings of the Lion',
  baseType: 'Apostle Leggings',
  rarity: 'Magic',
  ilvl: 73,
  properties: [
    { name: 'Boots', values: [], displayMode: 0 },
    { name: '[Armour]', values: [['202', 1]], displayMode: 0 },
    { name: '[EnergyShield|Energy Shield]', values: [['53', 1]], displayMode: 0 },
  ],
  explicitMods: [
    { description: '+68 to [Armour|Armour]', hash: 'stat.explicit.stat_3484657501', mods: [{ name: 'Sanctified', tier: 'P2', magnitudes: [{ min: '47', max: '71' }] }] },
    { description: '+17 to [Strength|Strength]', hash: 'stat.explicit.stat_4080418644', mods: [{ name: 'of the Lion', tier: 'S5', magnitudes: [{ min: '17', max: '20' }] }] },
  ],
  runeMods: ['+12% to [Resistances|Cold Resistance]'],
  corrupted: true,
};

describe('listing details', () => {
  it('removes the reference markup from texts', () => {
    expect(cleanMarkup('+16 to maximum [EnergyShield|Energy Shield]')).toBe('+16 to maximum Energy Shield');
    expect(cleanMarkup('[Armour]')).toBe('Armour');
  });

  it('turns a fetched item into name, properties and mods with tier, max and stat id', () => {
    const d = listingDetails(item);
    expect(d).toMatchObject({ name: '', base: 'Apostle Leggings', rarity: 'Magic', ilvl: 73, corrupted: true });
    expect(d.properties).toEqual(['Armour: 202', 'Energy Shield: 53']);
    expect(d.mods).toEqual([
      { kind: 'rune', text: '+12% to Cold Resistance' },
      { kind: 'explicit', text: '+68 to Armour', tier: 'P2', max: '71', statId: 'explicit.stat_3484657501' },
      { kind: 'explicit', text: '+17 to Strength', tier: 'S5', max: '20', statId: 'explicit.stat_4080418644' },
    ]);
  });

  it('takes total, physical and elemental DPS from the trade API', () => {
    const bow = listingDetails({ baseType: 'Recurve Bow', extended: { dps: 151.25, pdps: 87.5, edps: 63.75 } });
    expect(bow.dps).toEqual({ total: 151.3, physical: 87.5, elemental: 63.8 });
    expect(listingDetails({ baseType: 'Boots', extended: { hashes: {} } }).dps).toBeUndefined();
  });

  it('reads the elements of the elemental damage (4 fire, 5 cold, 6 lightning)', () => {
    const bow = listingDetails({
      baseType: 'Recurve Bow',
      properties: [{ name: '[Physical] Damage', values: [['41-76', 0]] }, { name: '[ElementalDamage|Elemental] Damage', values: [['11-17', 5], ['1-73', 6]] }],
    });
    expect(bow.elements).toEqual(['cold', 'lightning']);
    // ein einzelnes Element heißt "Fire Damage" usw. (echte Angebote, Nov. 2026)
    const fire = listingDetails({ baseType: 'Bow', properties: [{ name: 'Fire Damage', values: [['55-85', 4]] }, { name: '[Chaos] Damage', values: [['14-32', 7]] }] });
    expect(fire.elements).toEqual(['fire']);
    expect(listingDetails({ baseType: 'Bow', properties: [{ name: 'Lightning Damage', values: [['1-147', 6]] }] }).elements).toEqual(['lightning']);
    expect(listingDetails({ baseType: 'Boots' }).elements).toBeUndefined();
  });

  it('copes with missing fields', () => {
    expect(listingDetails({ ilvl: 80 })).toEqual({ name: '', base: '', ilvl: 80, properties: [], mods: [] });
  });
});

describe('combined mod tiers', () => {
  it('lists every tier of a line the game merged from two mods', () => {
    const d = listingDetails({
      baseType: 'Bow',
      explicitMods: [{ description: '193% increased [Physical] Damage', mods: [{ tier: 'P3' }, { tier: 'P5' }] }],
    });
    expect(d.mods[0].tier).toBe('P3 + P5');
  });
});
