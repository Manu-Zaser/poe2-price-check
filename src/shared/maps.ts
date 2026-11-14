/**
 * Waystones und Tablets: gefährliche Mods erkennen, damit man sie vor dem Einsetzen sieht.
 * Die Liste ist eine Vorgabe – jeder Build fürchtet andere Mods, deshalb ist sie in den
 * Einstellungen frei änderbar (ein Textstück pro Zeile, Groß-/Kleinschreibung egal).
 */
import type { ParsedItem, TradeMod } from './types';

export const DEFAULT_DANGER_MODS: string[] = [
  'less Recovery Rate',
  'are Cursed with',
  'as Extra Chaos',
  'increased Critical Hit Chance',
  'Critical Damage Bonus',
  'additional Projectiles',
  'additional times',
  'maximum Player Resistances',
  'Penetrate',
  'Break Armour',
  'chance to Poison',
  'less Cooldown Recovery',
];

/** Gegenstände, auf denen Map-Mods stehen. */
export function isMapItem(item: Pick<ParsedItem, 'itemClass'>): boolean {
  return /waystone|tablet/i.test(item.itemClass);
}

/** Bereinigt die Liste aus den Einstellungen (leere Zeilen, Doppelte, Leerzeichen). */
export function cleanDangerList(lines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || seen.has(line.toLowerCase())) continue;
    seen.add(line.toLowerCase());
    out.push(line);
  }
  return out;
}

/** Markiert Mods, deren Text eines der Textstücke enthält. */
export function markDangerous(mods: TradeMod[], patterns: string[]): TradeMod[] {
  const needles = patterns.map((p) => p.toLowerCase()).filter(Boolean);
  if (!needles.length) return mods;
  return mods.map((m) => {
    if (m.kind === 'pseudo' || m.kind === 'weapon' || m.kind === 'defence' || m.kind === 'misc') return m;
    const text = m.text.toLowerCase();
    return needles.some((n) => text.includes(n)) ? { ...m, danger: true } : m;
  });
}

// ---------- Wiki ----------

/** Seite im Community-Wiki: Uniques unter ihrem Namen, alles andere unter der Basis. */
export function wikiUrl(item: Pick<ParsedItem, 'rarity' | 'name' | 'baseType' | 'unidentified'>): string {
  const title = item.rarity === 'Unique' && item.name && !item.unidentified ? item.name : item.baseType;
  return `https://www.poe2wiki.net/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}
