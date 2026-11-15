import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseModLine, rollOf } from '../src/shared/mods';
import { parseItemText } from '../src/shared/parser';
import { buildSearchQuery, buildTradeMods, defaultMatchCount, defaultMin, isNamedUnique, normalDefaults, StatIndex, statRange, uniqueDefaults, type StatsData } from '../src/shared/stats';

// Echte Items aus dem Spiel; die Stat-Liste ist ein gekürzter Auszug aus /api/trade2/data/stats.
const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');
const stats = new StatIndex(JSON.parse(fixture('trade-stats.json')) as StatsData);

describe('parseModLine', () => {
  it('entfernt Wertebereiche und erkennt Marker', () => {
    expect(parseModLine('Adds 14(14-15) to 22(22-24) Cold damage to Attacks')).toMatchObject({
      text: 'Adds 14 to 22 Cold damage to Attacks',
      template: 'Adds # to # Cold damage to Attacks',
      values: [14, 22],
      kind: 'explicit',
    });
    expect(parseModLine('+18% to Fire Resistance (rune)')).toMatchObject({ kind: 'rune', template: '#% to Fire Resistance', values: [18] });
    expect(parseModLine('+3.44(3.11-3.8)% to Critical Hit Chance').values).toEqual([3.44]);
  });
});

describe('buildTradeMods – Handschuhe (Grim Claw)', () => {
  const item = parseItemText(fixture('rare-gloves-grim-claw.txt'))!;
  const mods = buildTradeMods(item, stats);
  // Nur Einzel-Mods, nicht die Summen (deren englische Texte enthalten z. B. auch "maximum Life")
  const byText = (t: string) => mods.find((m) => m.kind !== 'pseudo' && m.text.includes(t))!;

  const plain = mods.filter((m) => !["pseudo", "weapon", "defence", "misc"].includes(m.kind));

  it('findet alle Mods inklusive Rune', () => {
    expect(plain).toHaveLength(7);
    expect(plain.every((m) => m.statId !== null)).toBe(true);
  });

  it('ordnet Stat-IDs korrekt zu', () => {
    // Leben ist jetzt in der Summe "total maximum Life" enthalten und deshalb abgewählt.
    expect(byText('maximum Life')).toMatchObject({ statId: 'explicit.stat_3299347043', value: 10, enabled: false, coveredBy: 'total' });
    expect(byText('Cold damage to Attacks')).toMatchObject({ statId: 'explicit.stat_4067062424', value: 18 });
    expect(byText('Dexterity')).toMatchObject({ statId: 'explicit.stat_3261801346', value: 30, min: 30 });
    expect(byText('Fire Resistance')).toMatchObject({ kind: 'rune', statId: 'rune.stat_3372524247', enabled: false });
  });
});

describe('buildTradeMods – Bogen (Morbid Stinger)', () => {
  const item = parseItemText(fixture('rare-bow-morbid-stinger.txt'))!;
  const mods = buildTradeMods(item, stats);
  // Nur Einzel-Mods, nicht die Summen (deren englische Texte enthalten z. B. auch "maximum Life")
  const byText = (t: string) => mods.find((m) => m.kind !== 'pseudo' && m.text.includes(t))!;

  it('erkennt den Implicit ohne Marker und negiert "reduced"', () => {
    expect(byText('Projectile Range')).toMatchObject({ kind: 'implicit', statId: 'implicit.stat_3398402065', value: 50, min: 50, invert: true, enabled: false });
  });

  it('bevorzugt lokale Stats auf Waffen', () => {
    expect(byText('Accuracy Rating')).toMatchObject({ statId: 'explicit.stat_691932474', value: 142 });
  });

  it('übersetzt "an additional Arrow" und mittelt "Adds # to #"', () => {
    expect(byText('additional Arrow')).toMatchObject({ kind: 'rune', statId: 'rune.stat_3885405204', value: 1 });
    expect(byText('Cold Damage')).toMatchObject({ statId: 'explicit.stat_1037193709', value: 48 });
  });

  it('fasst gleiche Stats zusammen (144 % + 63 % increased Physical Damage)', () => {
    const phys = mods.filter((m) => m.statId === 'explicit.stat_1509134228');
    expect(phys).toHaveLength(1);
    expect(phys[0]).toMatchObject({ value: 207, min: 207, combined: true, text: '207% increased Physical Damage' });
    // Die Rune mit demselben Text bleibt eigenständig (andere Gruppe).
    expect(mods.find((m) => m.statId === 'rune.stat_1509134228')).toBeDefined();
  });

  it('übernimmt Dezimalwerte', () => {
    expect(byText('to Critical Hit Chance')).toMatchObject({ statId: 'explicit.stat_518292764', value: 3.44, min: 3.4 });
    expect(byText('Leeches')).toMatchObject({ value: 7.05, min: 7 });
  });
});

describe('buildSearchQuery', () => {
  it('nutzt nur aktivierte Mods und den Basistyp', () => {
    const item = parseItemText(fixture('rare-gloves-grim-claw.txt'))!;
    const q = buildSearchQuery(item, buildTradeMods(item, stats), { useBaseType: true, matchAll: false });
    expect(q.query.type).toBe('Barbed Bracers');
    // 4 explizite Mods + 3 Summen (Elementar-Resistenzen, Leben, Geschick)
    expect(q.query.stats[0].filters).toHaveLength(7);
    expect(q.query.stats[0].filters).toContainEqual({ id: 'pseudo.pseudo_total_life', value: { min: 10 } });
    expect(q.query.stats[0].filters).not.toContainEqual(expect.objectContaining({ id: 'explicit.stat_3299347043' }));
    expect(q.sort).toEqual({ price: 'asc' });
  });

  it('verlangt standardmäßig nur einen Teil der Mods (count), auf Wunsch alle (and)', () => {
    const item = parseItemText(fixture('rare-gloves-grim-claw.txt'))!;
    const mods = buildTradeMods(item, stats);
    expect(buildSearchQuery(item, mods, { useBaseType: true, matchAll: false }).query.stats[0]).toMatchObject({ type: 'count', value: { min: 5 } });
    expect(buildSearchQuery(item, mods, { useBaseType: true, matchAll: true }).query.stats[0]).toMatchObject({ type: 'and' });
    expect(defaultMatchCount(2)).toBe(2);
    expect(defaultMatchCount(3)).toBe(2);
    expect(defaultMatchCount(6)).toBe(4);
  });

  it('nutzt ohne Basistyp die Kategorie', () => {
    const item = parseItemText(fixture('rare-bow-morbid-stinger.txt'))!;
    const q = buildSearchQuery(item, [], { useBaseType: false, matchAll: false });
    expect(q.query).not.toHaveProperty('type');
    expect(q.query.filters.type_filters.filters).toMatchObject({ category: { option: 'weapon.bow' } });
  });
});

describe('defaultMin', () => {
  it('nimmt den eigenen Wert, auf eine Nachkommastelle abgerundet', () => {
    expect(defaultMin(100)).toBe(100);
    expect(defaultMin(2)).toBe(2);
    expect(defaultMin(3.44)).toBe(3.4);
    expect(defaultMin(7.05)).toBe(7);
    expect(defaultMin(24.5)).toBe(24.5);
    expect(defaultMin(0.7)).toBe(0.7);
    expect(defaultMin(-50)).toBeUndefined();
    expect(defaultMin(null)).toBeUndefined();
  });
});

describe('Tiers im Overlay', () => {
  it('übernimmt Tier und Präfix/Suffix in die Mod-Zeilen', () => {
    const item = parseItemText(fixture('rare-gloves-advanced.txt'))!;
    const mods = buildTradeMods(item, stats);
    expect(mods.find((m) => m.kind !== 'pseudo' && m.text.includes('maximum Life'))?.tiers).toEqual([{ affix: 'prefix', tier: 2 }]);
    expect(mods.find((m) => m.text.includes('Dexterity') && m.kind === 'explicit')?.tiers).toEqual([{ affix: 'suffix', tier: 8 }]);
    // Rune ohne Kopfzeile → kein Tier
    expect(mods.find((m) => m.kind === 'rune')?.tiers).toBeUndefined();
    // Gleiches Ergebnis wie ohne Kopfzeilen (nur die Tiers kommen dazu)
    const plain = buildTradeMods(parseItemText(fixture('rare-gloves-grim-claw.txt'))!, stats);
    expect(mods.map((m) => [m.key, m.statId, m.min, m.enabled])).toEqual(plain.map((m) => [m.key, m.statId, m.min, m.enabled]));
  });
});

describe('uniques via trade search', () => {
  const item = parseItemText(fixture('unique-temporalis.txt'))!;
  const mods = uniqueDefaults(buildTradeMods(item, stats));

  it('treats only identified uniques as searchable', () => {
    expect(isNamedUnique(item)).toBe(true);
    expect(isNamedUnique(parseItemText(fixture('unique-unidentified.txt'))!)).toBe(false);
    expect(isNamedUnique(parseItemText(fixture('rare-ring.txt'))!)).toBe(false);
  });

  it('lists the mods but only ticks the corrupted filter by default', () => {
    const es = mods.find((m) => m.kind === 'explicit' && m.text.includes('maximum Energy Shield'))!;
    expect(es).toMatchObject({ value: 137, min: 137, enabled: false });
    expect(mods.filter((m) => m.enabled).map((m) => m.filter)).toEqual(['corrupted']);
  });

  it('searches by name and base with rarity unique', () => {
    const q = buildSearchQuery(item, mods, { useBaseType: false, matchAll: true });
    expect(q.query).toMatchObject({ name: 'Temporalis', type: 'Silk Robe' });
    expect(q.query.filters.type_filters.filters).toEqual({ rarity: { option: 'unique' } });
    expect(q.query.stats).toEqual([{ type: 'and', filters: [] }]);
    expect(q.query.filters.misc_filters?.filters).toEqual({ corrupted: { option: 'true' } });
  });

  it('adds ticked rolls with the item value as minimum', () => {
    const ticked = mods.map((m) => (m.kind === 'explicit' && m.statId ? { ...m, enabled: true } : m));
    const q = buildSearchQuery(item, ticked, { useBaseType: true, matchAll: true });
    expect(q.query.stats[0].filters).toEqual([expect.objectContaining({ value: { min: 137 } })]);
  });
});

describe('plural quantities', () => {
  it('matches "Has 3 Charm Slots" against the singular stat text', () => {
    const item = parseItemText(['Item Class: Belts', 'Rarity: Unique', 'Headhunter', 'Heavy Belt', '--------', 'Item Level: 79', '--------',
      '26% increased Stun Threshold (implicit)', 'Has 3 Charm Slots (implicit)', '--------', '+40 to Dexterity'].join('\n'))!;
    const slots = buildTradeMods(item, stats).find((m) => m.text.includes('Charm Slots'))!;
    expect(slots).toMatchObject({ statId: 'implicit.stat_1416292992', value: 3, min: 3 });
  });
});

describe('min/max and "reduced" mods', () => {
  it('passes min and max through for normal stats', () => {
    expect(statRange({ min: 10, max: 20 })).toEqual({ min: 10, max: 20 });
    expect(statRange({ max: 20 })).toEqual({ max: 20 });
    expect(statRange({})).toBeNull();
  });

  it('negates and swaps the range for inverted ("reduced") stats', () => {
    // "at least 50% reduced" = increased ≤ -50; "50–60% reduced" = increased between -60 and -50
    expect(statRange({ min: 50, invert: true })).toEqual({ max: -50 });
    expect(statRange({ min: 50, max: 60, invert: true })).toEqual({ min: -60, max: -50 });
  });

  it('uses the range in the search query', () => {
    const item = parseItemText(fixture('rare-bow-morbid-stinger.txt'))!;
    const mods = buildTradeMods(item, stats).map((m) =>
      m.text.includes('Projectile Range') ? { ...m, enabled: true, max: 60 } : { ...m, enabled: false });
    const q = buildSearchQuery(item, mods, { useBaseType: true, matchAll: true });
    expect(q.query.stats[0].filters).toEqual([{ id: 'implicit.stat_3398402065', value: { min: -60, max: -50 } }]);
  });
});

describe('category vs. base type', () => {
  it('searches the whole category by default and falls back to the base for unknown classes', () => {
    const bow = parseItemText(fixture('rare-bow-morbid-stinger.txt'))!;
    const q = buildSearchQuery(bow, [], { useBaseType: false, matchAll: true });
    expect(q.query).not.toHaveProperty('type');
    expect(q.query.filters.type_filters.filters).toMatchObject({ category: { option: 'weapon.bow' } });

    const odd = { ...bow, itemClass: 'Something New' };
    const q2 = buildSearchQuery(odd, [], { useBaseType: false, matchAll: true });
    expect(q2.query).toMatchObject({ type: 'Obliterator Bow' });
    expect(q2.query.filters.type_filters.filters).not.toHaveProperty('category');
  });
});

describe('normal (white) items', () => {
  const item = parseItemText([
    'Item Class: Body Armours', 'Rarity: Normal', 'Corsair Coat', '--------',
    'Evasion Rating: 412', '--------', 'Requires: Level 65', '--------', 'Item Level: 82',
  ].join('\n'))!;
  const mods = normalDefaults(buildTradeMods(item, stats));

  it('parses the base without a name', () => {
    expect(item).toMatchObject({ rarity: 'Normal', baseType: 'Corsair Coat', itemLevel: 82 });
    expect(item.name).toBeUndefined();
  });

  it('only ticks item level and corrupted state by default', () => {
    expect(mods.filter((m) => m.enabled).map((m) => m.filter).sort()).toEqual(['corrupted', 'ilvl']);
    expect(mods.find((m) => m.key === 'd:ev')).toMatchObject({ value: 412, enabled: false });
  });

  it('searches white bases of this base type with at least this item level', () => {
    const q = buildSearchQuery(item, mods, { useBaseType: true, matchAll: true });
    expect(q.query).toMatchObject({ type: 'Corsair Coat' });
    expect(q.query.filters.type_filters.filters).toEqual({ rarity: { option: 'normal' }, ilvl: { min: 82 } });
  });
});

describe('roll quality', () => {
  it('rates a value within its range from the advanced copy', () => {
    expect(rollOf('+142(124-149) to Accuracy Rating')).toEqual({ quality: 0.72, range: '124–149', max: '149' });
    expect(rollOf('+19(17-19)% to Critical Damage Bonus')).toEqual({ quality: 1, range: '17–19', max: '19' });
    // several numbers: average of both
    expect(rollOf('Adds 37(31-38) to 59(47-59) Cold Damage')).toEqual({ quality: 0.93, range: '31–38 / 47–59', max: '38 to 59' });
    expect(rollOf('+10 to Strength')).toBeUndefined();
    expect(parseModLine('+3.44(3.11-3.8)% to Critical Hit Chance').roll?.quality).toBe(0.48);
  });

  it('is attached to the trade mods, one entry per summed line', () => {
    const bow = parseItemText(fixture('rare-bow-morbid-stinger.txt'))!;
    const mods = buildTradeMods(bow, stats);
    expect(mods.find((m) => m.text.includes('Accuracy'))?.rolls).toEqual([{ quality: 0.72, range: '124–149', max: '149' }]);
    // 144(135-154)% + 63(55-64)% increased Physical Damage are summed into one stat
    expect(mods.find((m) => m.text === '207% increased Physical Damage')?.rolls).toEqual([
      { quality: 0.47, range: '135–154', max: '154' },
      { quality: 0.89, range: '55–64', max: '64' },
    ]);
  });
});

describe('tradeSellerUrl', () => {
  it('adds the seller filter to the search and keeps the original query untouched', async () => {
    const { tradeSellerUrl } = await import('../src/shared/stats');
    const query = { query: { status: { option: 'securable' }, filters: { type_filters: { filters: {} } } }, sort: { price: 'asc' } };
    const url = tradeSellerUrl('Rise of the Abyssal', query, 'Seller#1234');
    expect(url.startsWith('https://www.pathofexile.com/trade2/search/poe2/Rise%20of%20the%20Abyssal?q=')).toBe(true);
    const q = JSON.parse(decodeURIComponent(url.split('?q=')[1]));
    expect(q.query.filters.trade_filters).toEqual({ filters: { account: { input: 'Seller#1234' } } });
    expect(q.query.filters.type_filters).toEqual({ filters: {} });
    expect(q.sort).toEqual({ price: 'asc' });
    expect((query.query.filters as Record<string, unknown>).trade_filters).toBeUndefined();
  });
});
