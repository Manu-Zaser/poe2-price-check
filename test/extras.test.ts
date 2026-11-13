import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pseudoContributions, suggestPrice, weaponStats } from '../src/shared/extras';
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
    expect(get('p:ele')).toMatchObject({ statId: 'pseudo.pseudo_total_elemental_resistance', value: 18, min: 15, enabled: true });
    expect(get('p:life')).toMatchObject({ value: 10, min: 8, enabled: true });
    expect(get('p:dex')).toMatchObject({ value: 30, min: 25, enabled: true });
    expect(mods.find((m) => m.text.includes('to Dexterity') && m.kind === 'explicit')).toMatchObject({ enabled: false, coveredBy: 'Summe' });
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
    expect(q.query.filters).not.toHaveProperty('equipment_filters');
  });
});

describe('Waffen-DPS (Morbid Stinger)', () => {
  const item = parseItemText(fixture('rare-bow-morbid-stinger.txt'))!;

  it('berechnet pDPS, eDPS und Gesamt-DPS aus den Eigenschaften', () => {
    // (242+449)/2 × 1,10 = 380,05 · (37+59)/2 × 1,10 = 52,8
    expect(weaponStats(item)).toEqual({ aps: 1.1, pdps: 380.1, edps: 52.8, cdps: 0, dps: 432.9 });
  });

  it('sucht standardmäßig nach pDPS und wählt die enthaltenen Schadens-Mods ab', () => {
    const mods = buildTradeMods(item, stats);
    expect(mods.find((m) => m.key === 'w:pdps')).toMatchObject({ enabled: true, min: 323 });
    expect(mods.find((m) => m.key === 'w:dps')).toMatchObject({ enabled: false });
    expect(mods.find((m) => m.text === '207% increased Physical Damage')).toMatchObject({ enabled: false, coveredBy: 'DPS' });
    expect(mods.find((m) => m.text.startsWith('Adds 37 to 59 Cold Damage'))).toMatchObject({ enabled: false, coveredBy: 'DPS' });
    expect(mods.find((m) => m.text.includes('Accuracy'))).toMatchObject({ enabled: true });

    const q = buildSearchQuery(item, mods, { useBaseType: true, matchAll: false });
    expect(q.query.filters).toMatchObject({ equipment_filters: { filters: { pdps: { min: 323 } } } });
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
