import { describe, expect, it } from 'vitest';
import type { TradeMod } from '../src/shared/types';
import { applyWeights, DEFAULT_KEY_MODS, DEFAULT_LOW_MODS, LEGACY_DEFAULTS, parseWeightRules, slotOf, upgradeDefaults } from '../src/shared/weights';

const mod = (key: string, text: string, extra: Partial<TradeMod> = {}): TradeMod => ({ key, text, kind: 'explicit', statId: `s${key}`, value: 10, min: 10, enabled: true, ...extra });
const pseudo = (key: string, text: string): TradeMod => ({ key, text, kind: 'pseudo', statId: `p${key}`, value: 50, min: 50, enabled: true });

describe('slots and rules', () => {
  it('maps item classes to slots', () => {
    expect(slotOf('Boots')).toBe('boots');
    expect(slotOf('Wands')).toBe('caster');
    expect(slotOf('Two Hand Maces')).toBe('weapon');
    expect(slotOf('Body Armours')).toBe('body');
    expect(slotOf('Waystones')).toBeNull();
  });

  it('parses "slot: text" and treats lines without a slot as global', () => {
    expect(parseWeightRules(['boots: increased Movement Speed', '*: Thorns', 'Light Radius', 'nonsense: x'])).toEqual([
      { slot: 'boots', text: 'increased Movement Speed' },
      { slot: '*', text: 'Thorns' },
      { slot: '*', text: 'Light Radius' },
      { slot: '*', text: 'nonsense: x' },
    ]);
  });
});

describe('applyWeights', () => {
  it('ticks only key mods, keeps totals and fades low-value mods', () => {
    const mods = [
      pseudo('p', '+45% total Elemental Resistance'),
      mod('0', '30% increased Movement Speed'),
      mod('1', '+12 to Light Radius'),
      mod('2', '+20 to Dexterity'),
      mod('3', '+15% to Fire Resistance', { enabled: false, coveredBy: 'total' }),
    ];
    const { mods: out, missingKeys } = applyWeights(mods, 'Boots', DEFAULT_KEY_MODS, DEFAULT_LOW_MODS);
    const byKey = Object.fromEntries(out.map((m) => [m.key, m]));
    expect(byKey.p.enabled).toBe(true);
    expect(byKey['0']).toMatchObject({ keyMod: true, enabled: true });
    expect(byKey['1']).toMatchObject({ low: true, enabled: false });
    expect(byKey['2']).toMatchObject({ enabled: false });
    expect(byKey['3']).toMatchObject({ enabled: false, coveredBy: 'total' });
    expect(missingKeys).toEqual([]);
  });

  it('lists the key mods of the slot that the item does not have', () => {
    const { missingKeys } = applyWeights([mod('0', '+40 to maximum Life')], 'Rings', DEFAULT_KEY_MODS, DEFAULT_LOW_MODS);
    expect(missingKeys).toEqual(['Damage to Attacks', 'Rarity of Items found']);
  });

  it('falls back to all mods except low value when nothing else would be searched', () => {
    const mods = [mod('0', '+20 to Dexterity'), mod('1', '+12 to Light Radius'), mod('2', '10% increased Mana Regeneration Rate')];
    const { mods: out } = applyWeights(mods, 'Belts', DEFAULT_KEY_MODS, DEFAULT_LOW_MODS);
    expect(out.map((m) => m.enabled)).toEqual([true, false, true]);
  });

  it('leaves item classes without a slot untouched', () => {
    const mods = [mod('0', '+20 to Dexterity')];
    expect(applyWeights(mods, 'Waystones', DEFAULT_KEY_MODS, DEFAULT_LOW_MODS)).toEqual({ mods, missingKeys: [] });
  });
});

describe('research-based lists (Nov 2026)', () => {
  it('only reports key mods a weapon class can roll as missing', () => {
    const bow = applyWeights([mod('0', '+142 to Accuracy Rating')], 'Bows', DEFAULT_KEY_MODS, DEFAULT_LOW_MODS);
    expect(bow.missingKeys).toContain('additional Arrow');
    expect(bow.missingKeys).toContain('to Level of all Projectile Skills');
    expect(bow.missingKeys).not.toContain('additional bolt');
    expect(bow.missingKeys).not.toContain('to Level of all Melee Skills');

    const mace = applyWeights([], 'Two Hand Maces', DEFAULT_KEY_MODS, DEFAULT_LOW_MODS);
    expect(mace.missingKeys).toContain('to Level of all Melee Skills');
    expect(mace.missingKeys).not.toContain('to Level of all Projectile Skills');

    const spear = applyWeights([], 'Spears', DEFAULT_KEY_MODS, DEFAULT_LOW_MODS);
    expect(spear.missingKeys).toEqual(expect.arrayContaining(['to Level of all Melee Skills', 'to Level of all Projectile Skills']));
  });

  it('treats element-specific spell levels on caster weapons as key', () => {
    const { mods } = applyWeights([mod('0', '+3 to Level of all Fire Spell Skills')], 'Wands', DEFAULT_KEY_MODS, DEFAULT_LOW_MODS);
    expect(mods[0]).toMatchObject({ keyMod: true, enabled: true });
  });

  it('does not mark accuracy on weapons as low value, but stun mods', () => {
    const { mods } = applyWeights(
      [mod('0', '+142 to Accuracy Rating'), mod('1', '30% increased Stun Buildup'), mod('2', '+25% to Critical Damage Bonus')],
      'One Hand Maces', DEFAULT_KEY_MODS, DEFAULT_LOW_MODS,
    );
    expect(mods.map((m) => [!!m.low, !!m.keyMod])).toEqual([[false, false], [true, false], [false, true]]);
  });

  it('replaces unchanged earlier defaults but keeps own edits', () => {
    expect(upgradeDefaults(LEGACY_DEFAULTS.key[0], LEGACY_DEFAULTS.key, DEFAULT_KEY_MODS)).toEqual(DEFAULT_KEY_MODS);
    const own = ['boots: increased Movement Speed', 'body: Deflection'];
    expect(upgradeDefaults(own, LEGACY_DEFAULTS.key, DEFAULT_KEY_MODS)).toBe(own);
  });
});
