import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseModLine } from '../src/shared/mods';
import { parseItemText } from '../src/shared/parser';
import { buildSearchQuery, buildTradeMods, defaultMatchCount, defaultMin, StatIndex, type StatsData } from '../src/shared/stats';

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
    expect(byText('Projectile Range')).toMatchObject({ kind: 'implicit', statId: 'implicit.stat_3398402065', value: -50, enabled: false });
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
