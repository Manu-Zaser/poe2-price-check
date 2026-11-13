import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defenceStats, isStale, marketPrice, priceWarnings, pricingBasis, pseudoContributions, suggestPrice, weaponStats } from '../src/shared/extras';
import { parseItemText } from '../src/shared/parser';
import { buildSearchQuery, buildTradeMods, StatIndex, type StatsData } from '../src/shared/stats';
import type { Listing } from '../src/shared/types';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');
const stats = new StatIndex(JSON.parse(fixture('trade-stats.json')) as StatsData);

describe('pseudoContributions', () => {
  it('ordnet Resistenzen und Attribute den Summen zu', () => {
    expect(pseudoContributions('#% to Fire Resistance')).toEqual([{ key: 'ele', factor: 1 }]);
    expect(pseudoContributions('#% to all Elemental Resistances')).toEqual([{ key: 'ele', factor: 3 }]);
    expect(pseudoContributions('#% to Fire and Chaos Resistances')).toEqual([{ key: 'chaos', factor: 1 }, { key: 'ele', factor: 1 }]);
    expect(pseudoContributions('#% to Maximum Fire Resistance')).toEqual([]);
    expect(pseudoContributions('# to all Attributes').map((c) => c.key)).toEqual(['str', 'dex', 'int']);
    expect(pseudoContributions('# to Strength and Dexterity').map((c) => c.key)).toEqual(['str', 'dex']);
    expect(pseudoContributions('# to Accuracy Rating')).toEqual([]);
  });
});

describe('Pseudo-Summen (Grim Claw)', () => {
  const item = parseItemText(fixture('rare-gloves-grim-claw.txt'))!;
  const mods = buildTradeMods(item, stats);
  const get = (key: string) => mods.find((m) => m.key === key);

  it('bildet Summen aus allen Quellen (inkl. Rune) und wählt die Einzel-Mods ab', () => {
    expect(get('p:ele')).toMatchObject({ statId: 'pseudo.pseudo_total_elemental_resistance', value: 18, min: 18, enabled: true });
    expect(get('p:life')).toMatchObject({ value: 10, min: 10, enabled: true });
    expect(get('p:dex')).toMatchObject({ value: 30, min: 30, enabled: true });
    expect(mods.find((m) => m.text.includes('to Dexterity') && m.kind === 'explicit')).toMatchObject({ enabled: false, coveredBy: 'total' });
  });

  it('bietet Item-Level und Sockel als (abgeschaltete) Filter an', () => {
    expect(get('f:ilvl')).toMatchObject({ filter: 'ilvl', value: 75, enabled: false });
    expect(get('f:sockets')).toMatchObject({ filter: 'sockets', value: 1, enabled: false });
  });

  it('schreibt aktivierte Filter in die Suchanfrage', () => {
    const withFilters = mods.map((m) => (m.filter === 'ilvl' || m.filter === 'sockets' ? { ...m, enabled: true } : m));
    const q = buildSearchQuery(item, withFilters, { useBaseType: true, matchAll: false, instantOnly: true });
    expect(q.query.status).toEqual({ option: 'securable' });
    expect(q.query.filters.type_filters.filters).toMatchObject({ ilvl: { min: 75 } });
    expect(q.query.filters).toMatchObject({ equipment_filters: { filters: { rune_sockets: { min: 1 } } } });
  });

  it('sucht ohne Sofortkauf-Filter auch "In Person"-Angebote', () => {
    const q = buildSearchQuery(item, mods, { useBaseType: true, matchAll: false, instantOnly: false });
    expect(q.query.status).toEqual({ option: 'available' });
    // Handschuhe: Ausweichen 196 ist als Verteidigungswert aktiv, sonst keine Equipment-Filter
    expect(q.query.filters).toMatchObject({ equipment_filters: { filters: { ev: { min: 196 } } } });
    expect(Object.keys((q.query.filters as { equipment_filters: { filters: object } }).equipment_filters.filters)).toEqual(['ev']);
  });
});

describe('Waffen-DPS (Morbid Stinger)', () => {
  const item = parseItemText(fixture('rare-bow-morbid-stinger.txt'))!;

  it('berechnet pDPS, eDPS und Gesamt-DPS aus den Eigenschaften', () => {
    // (242+449)/2 × 1,10 = 380,05 · (37+59)/2 × 1,10 = 52,8
    expect(weaponStats(item)).toEqual({ aps: 1.1, pdps: 380.1, edps: 52.8, cdps: 0, dps: 432.9, crit: 8.44 });
  });

  it('searches the overall critical hit chance instead of the local crit mod', () => {
    const mods = buildTradeMods(item, stats);
    // "Critical Hit Chance: 8.44%" from the properties (base + local mod + quality), minimum rounded down
    expect(mods.find((m) => m.key === 'w:crit')).toMatchObject({ kind: 'weapon', filter: 'crit', value: 8.44, min: 8.4, enabled: true });
    expect(mods.find((m) => m.text === '+3.44% to Critical Hit Chance')).toMatchObject({ enabled: false, coveredBy: 'crit' });
    const q = buildSearchQuery(item, mods, { useBaseType: true, matchAll: true });
    expect(q.query.filters.equipment_filters?.filters).toMatchObject({ crit: { min: 8.4 } });
  });

  it('sucht standardmäßig nach pDPS und wählt die enthaltenen Schadens-Mods ab', () => {
    const mods = buildTradeMods(item, stats);
    expect(mods.find((m) => m.key === 'w:pdps')).toMatchObject({ enabled: true, min: 380.1 });
    expect(mods.find((m) => m.key === 'w:dps')).toMatchObject({ enabled: false });
    expect(mods.find((m) => m.text === '207% increased Physical Damage')).toMatchObject({ enabled: false, coveredBy: 'DPS' });
    expect(mods.find((m) => m.text.startsWith('Adds 37 to 59 Cold Damage'))).toMatchObject({ enabled: false, coveredBy: 'DPS' });
    expect(mods.find((m) => m.text.includes('Accuracy'))).toMatchObject({ enabled: true });

    const q = buildSearchQuery(item, mods, { useBaseType: true, matchAll: false });
    expect(q.query.filters).toMatchObject({ equipment_filters: { filters: { pdps: { min: 380.1 } } } });
  });

  it('liefert für Nicht-Waffen keine DPS', () => {
    expect(weaponStats(parseItemText(fixture('rare-gloves-grim-claw.txt'))!)).toBeNull();
  });
});

describe('suggestPrice', () => {
  const l = (exalted: number): Listing => ({ amount: exalted, currency: 'exalted', divine: exalted / 600, exalted, indexed: '' });

  it('liegt knapp unter dem Median der günstigsten Angebote', () => {
    // Median der 3 günstigsten (40, 50, 60) = 50 → 95 % = 47,5 → 48
    expect(suggestPrice([l(40), l(50), l(60), l(70), l(900)], 600)).toMatchObject({ amount: 48, currency: 'exalted', note: '~b/o 48 exalted', basedOn: 3 });
    // Reihenfolge der Angebote egal (GGG sortiert mit eigenen Kursen)
    expect(suggestPrice([l(183), l(25), l(61)], 600)).toMatchObject({ amount: 58 });
  });

  it('schlägt ab 1 Divine in Divine vor', () => {
    expect(suggestPrice([l(1500), l(1600), l(1800)], 600)).toMatchObject({ currency: 'divine', amount: 2.5, note: '~b/o 2.5 divine' });
  });

  it('gibt ohne umrechenbare Angebote nichts zurück', () => {
    expect(suggestPrice([], 600)).toBeNull();
    expect(suggestPrice([{ ...l(5), exalted: null }], 600)).toBeNull();
  });
});

describe('sortByValue', () => {
  it('sortiert nach umgerechnetem Wert, nicht nach GGGs Reihenfolge', async () => {
    const { sortByValue } = await import('../src/main/rare');
    const mk = (amount: number, currency: string, exalted: number | null): Listing => ({ amount, currency, divine: null, exalted, indexed: '' });
    const sorted = sortByValue([mk(1, 'chaos', 61), mk(25, 'exalted', 25), mk(3, 'mirror', null), mk(3, 'chaos', 183)]);
    expect(sorted.map((l) => `${l.amount} ${l.currency}`)).toEqual(['25 exalted', '1 chaos', '3 chaos', '3 mirror']);
  });
});

describe('Verteidigung (Rüstungen)', () => {
  const item = parseItemText(fixture('rare-body-armour-hybrid.txt'))!;
  const mods = buildTradeMods(item, stats);
  const get = (key: string) => mods.find((m) => m.key === key);

  it('liest die angezeigten Verteidigungswerte (nur aus den Eigenschaften)', () => {
    expect(defenceStats(item)).toEqual({ ar: 0, ev: 812, es: 245, block: 0, spirit: 0 });
    expect(defenceStats(parseItemText(fixture('rare-bow-morbid-stinger.txt'))!)).toBeNull();
  });

  it('sucht nach Ausweichen und Energieschild und wählt die lokalen Verteidigungs-Mods ab', () => {
    expect(get('d:ev')).toMatchObject({ kind: 'defence', filter: 'ev', value: 812, min: 812, enabled: true });
    expect(get('d:es')).toMatchObject({ filter: 'es', value: 245, min: 245, enabled: true });
    expect(get('d:ar')).toBeUndefined();
    expect(mods.find((m) => m.text.includes('increased Evasion and Energy Shield'))).toMatchObject({ enabled: false, coveredBy: 'defence' });
    expect(mods.find((m) => m.text.includes('to Evasion Rating'))).toMatchObject({ enabled: false, coveredBy: 'defence' });
    // Leben und Resistenzen sind keine Verteidigungswerte – die laufen über die Summen.
    expect(get('p:life')).toMatchObject({ enabled: true, value: 112 });
    expect(get('p:ele')).toMatchObject({ enabled: true, value: 33 });
  });

  it('schreibt Verteidigungswerte als Equipment-Filter in die Suche', () => {
    const q = buildSearchQuery(item, mods, { useBaseType: true, matchAll: false, instantOnly: true });
    expect(q.query.filters).toMatchObject({ equipment_filters: { filters: { ev: { min: 812 }, es: { min: 245 } } } });
  });
});

describe('coveredByDefence', () => {
  it('erkennt lokale Verteidigungs-Mods, aber nicht Sonder-Mods', async () => {
    const { coveredByDefence } = await import('../src/shared/extras');
    for (const t of ['# to Armour', '# to Evasion Rating', '# to maximum Energy Shield', '#% increased Armour and Evasion',
      '#% increased Evasion and Energy Shield', '#% increased Armour, Evasion and Energy Shield', '#% increased Energy Shield']) {
      expect(coveredByDefence(t), t).toBe(true);
    }
    for (const t of ['#% increased Energy Shield Recharge Rate', 'Break #% increased Armour', '# to maximum Life']) {
      expect(coveredByDefence(t), t).toBe(false);
    }
  });
});

describe('Corrupted-Status', () => {
  it('sucht standardmäßig nur Items mit demselben Status', () => {
    const clean = parseItemText(fixture('rare-gloves-grim-claw.txt'))!;
    const cleanMods = buildTradeMods(clean, stats);
    expect(cleanMods.find((m) => m.key === 'f:corrupted')).toMatchObject({ text: 'Not corrupted', filter: 'corrupted', enabled: true });
    expect(buildSearchQuery(clean, cleanMods, { useBaseType: true, matchAll: false }).query.filters).toMatchObject({
      misc_filters: { filters: { corrupted: { option: 'false' } } },
    });

    const corrupted = parseItemText(fixture('rare-gloves-grim-claw.txt') + '\n--------\nCorrupted')!;
    const corruptedMods = buildTradeMods(corrupted, stats);
    expect(corruptedMods.find((m) => m.key === 'f:corrupted')).toMatchObject({ text: 'Corrupted' });
    expect(buildSearchQuery(corrupted, corruptedMods, { useBaseType: true, matchAll: false }).query.filters).toMatchObject({
      misc_filters: { filters: { corrupted: { option: 'true' } } },
    });
  });

  it('lässt den Filter weg, wenn er abgewählt ist', () => {
    const item = parseItemText(fixture('rare-gloves-grim-claw.txt'))!;
    const mods = buildTradeMods(item, stats).map((m) => (m.filter === 'corrupted' ? { ...m, enabled: false } : m));
    expect(buildSearchQuery(item, mods, { useBaseType: true, matchAll: false }).query.filters).not.toHaveProperty('misc_filters');
  });
});

describe('market price and stale listings', () => {
  const now = Date.parse('2026-11-13T12:00:00Z');
  const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString();
  const l = (exalted: number, age: number): Listing => ({ amount: exalted, currency: 'exalted', divine: exalted / 600, exalted, indexed: daysAgo(age) });

  it('marks listings older than 14 days as stale', () => {
    expect(isStale(l(10, 13), now)).toBe(false);
    expect(isStale(l(10, 15), now)).toBe(true);
    expect(isStale({ ...l(10, 1), indexed: '' }, now)).toBe(false);
  });

  it('uses the median of the cheapest current listings and ignores an old outlier', () => {
    // Like Grim Claw: a 61-day-old 30 Ex listing in front of real prices around 1 Div
    const listings = [l(30, 61), l(600, 10), l(620, 2), l(3000, 5)];
    expect(pricingBasis(listings, now)).toMatchObject({ staleIgnored: 1 });
    expect(marketPrice(listings, 600, now)).toMatchObject({ exalted: 620, divine: 620 / 600, basedOn: 3, staleIgnored: 1 });
  });

  it('falls back to all listings when fewer than 2 are current', () => {
    const listings = [l(30, 61), l(600, 50), l(620, 2)];
    expect(marketPrice(listings, 600, now)).toMatchObject({ exalted: 600, staleIgnored: 0 });
    expect(marketPrice(listings, null, now)).toBeNull();
  });

  it('warns about few results and only old listings', () => {
    const old = [l(30, 61), l(600, 50)];
    expect(priceWarnings(6, old, now)).toHaveLength(2);
    expect(priceWarnings(50, [l(30, 1)], now)).toEqual([]);
  });

  it('adds the divine equivalent to suggestions in exalted', () => {
    expect(suggestPrice([l(600, 1), l(620, 1), l(640, 1)], 650)).toMatchObject({ currency: 'exalted', amount: 590, approxDivine: 590 / 650 });
  });
});

describe('summed defence mods (Vengeance Wrap)', () => {
  // Two hybrid prefixes each add flat and % evasion – the mods are summed into one line each.
  const item = parseItemText([
    'Item Class: Body Armours', 'Rarity: Rare', 'Vengeance Wrap', 'Corsair Coat', '--------',
    'Evasion Rating: 2849 (augmented)', '--------', 'Requires: Level 65', '--------', 'Item Level: 81', '--------',
    '+200 to Evasion Rating', '+184 to Evasion Rating', '80% increased Evasion Rating', '62% increased Evasion Rating',
    '+38% to Fire Resistance',
  ].join('\n'))!;
  const mods = buildTradeMods(item, stats);

  it('searches the overall evasion and hides the summed evasion mods under it', () => {
    expect(mods.find((m) => m.key === 'd:ev')).toMatchObject({ value: 2849, enabled: true });
    expect(mods.find((m) => m.text === '384 to Evasion Rating')).toMatchObject({ combined: true, enabled: false, coveredBy: 'defence' });
    expect(mods.find((m) => m.text === '142% increased Evasion Rating')).toMatchObject({ combined: true, enabled: false, coveredBy: 'defence' });
  });
});
