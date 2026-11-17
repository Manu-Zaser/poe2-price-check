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

type LinkItem = Pick<ParsedItem, 'rarity' | 'name' | 'baseType' | 'unidentified'>;

/** Uniques heißen in Wiki und PoE2DB wie das Unique, alles andere wie die Basis. */
const pageTitle = (item: LinkItem) => (item.rarity === 'Unique' && item.name && !item.unidentified ? item.name : item.baseType);

/** Seite im Community-Wiki: Uniques unter ihrem Namen, alles andere unter der Basis. */
export function wikiUrl(item: LinkItem): string {
  return `https://www.poe2wiki.net/wiki/${encodeURIComponent(pageTitle(item).replace(/ /g, '_'))}`;
}

/** Seite auf PoE2DB (poe2db.tw): Basis mit Mod-Tabellen, Unique mit allen Rolls. */
export function poe2dbUrl(item: LinkItem): string {
  return `https://poe2db.tw/us/${encodeURIComponent(pageTitle(item).replace(/ /g, '_'))}`;
}

/** Craft of Exile (PoE2): das Item lässt sich dort aus der Zwischenablage importieren. */
export const CRAFT_OF_EXILE_URL = 'https://www.craftofexile.com/?game=poe2';

/** Items, die man craften kann – nur dafür ist Craft of Exile sinnvoll. */
export function isCraftable(item: Pick<ParsedItem, 'rarity' | 'itemLevel'> & { itemClass?: string }): boolean {
  return (item.rarity === 'Normal' || item.rarity === 'Magic' || item.rarity === 'Rare') && !!item.itemLevel && !/Waystone|Tablet|Currency/i.test(item.itemClass ?? '');
}
