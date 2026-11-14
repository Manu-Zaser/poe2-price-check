/**
 * Welche Mods den Preis eines Rares tragen ("key") und welche kaum zählen ("low value").
 *
 * Grundlage: Recherche (Nov. 2026) aus poe2db-Modtabellen (Patch 0.5.x), Patchnotes 0.5.0, Gear- und
 * Verkaufs-Guides – der Wert hängt an 2–3 tragenden Mods; wer alle Mods sucht, findet zu wenig und
 * verzerrt den Preis. Regeln mit dünner Quellenlage sind bewusst weggelassen. Die Listen sind Vorgaben
 * und in den Einstellungen änderbar ("slot: Text", Text = Teil des Mod-Textes, Groß-/Kleinschreibung egal).
 */
import type { TradeMod } from './types';

export type Slot =
  | 'weapon' | 'caster' | 'amulet' | 'ring' | 'belt' | 'boots' | 'gloves' | 'helmet' | 'body' | 'shield' | 'quiver' | 'jewel';

export const SLOTS: Slot[] = ['weapon', 'caster', 'amulet', 'ring', 'belt', 'boots', 'gloves', 'helmet', 'body', 'shield', 'quiver', 'jewel'];

/**
 * Feinere Ziele nur für Regeln innerhalb der Angriffswaffen: Nahkampf, Fernkampf (Speere können
 * beides), Bogen, Armbrust. So meldet z. B. ein Bogen nicht "Loads an additional bolt" als fehlend.
 */
export type WeaponGroup = 'melee' | 'ranged' | 'bow' | 'crossbow';
const WEAPON_GROUPS: Record<WeaponGroup, RegExp> = {
  melee: /^(Quarterstaves|Claws|Daggers|Spears|Flails|Talismans|One Hand \w+|Two Hand \w+)$/i,
  ranged: /^(Bows|Crossbows|Spears)$/i,
  bow: /^Bows$/i,
  crossbow: /^Crossbows$/i,
};
export const RULE_TARGETS: (Slot | WeaponGroup)[] = [...SLOTS, 'melee', 'ranged', 'bow', 'crossbow'];

const CLASS_TO_SLOT: [RegExp, Slot][] = [
  [/^(Wands|Staves|Sceptres|Foci)$/i, 'caster'],
  [/^(Bows|Crossbows|Quarterstaves|Claws|Daggers|Spears|Flails|Talismans|One Hand \w+|Two Hand \w+)$/i, 'weapon'],
  [/^Amulets$/i, 'amulet'],
  [/^Rings$/i, 'ring'],
  [/^Belts$/i, 'belt'],
  [/^Boots$/i, 'boots'],
  [/^Gloves$/i, 'gloves'],
  [/^Helmets$/i, 'helmet'],
  [/^Body Armours$/i, 'body'],
  [/^(Shields|Bucklers)$/i, 'shield'],
  [/^Quivers$/i, 'quiver'],
  [/Jewels?$/i, 'jewel'],
];

export function slotOf(itemClass: string): Slot | null {
  return CLASS_TO_SLOT.find(([re]) => re.test(itemClass))?.[1] ?? null;
}

/** Tragende Mods je Slot (Leben und Resistenzen stecken schon in den Summen und sind dort angehakt). */
export const DEFAULT_KEY_MODS: string[] = [
  // Angriffswaffen – lokaler Schaden, Angriffsgeschwindigkeit und Crit-Chance laufen über DPS/Crit-Zeilen
  'melee: to Level of all Melee Skills',
  'ranged: to Level of all Projectile Skills',
  'weapon: Critical Damage Bonus',
  'weapon: Elemental Damage with Attacks',
  'bow: additional Arrow',
  'crossbow: additional bolt',
  // Zauberwaffen – "Spell Skills" trifft auch elementspezifische Level ("all Fire Spell Skills")
  'caster: Spell Skills',
  'caster: increased Cast Speed',
  'caster: Critical Hit Chance for Spells',
  'caster: increased Spell Damage',
  // Schmuck
  'amulet: to Level of all',
  'amulet: to Spirit',
  'ring: Damage to Attacks',
  'ring: Rarity of Items found',
  // Rüstung
  'boots: increased Movement Speed',
  'gloves: increased Attack Speed',
  'gloves: Damage to Attacks',
  'gloves: to Level of all Melee Skills',
  'gloves: to Level of all Projectile Skills',
  'helmet: to Level of all Minion Skills',
  'helmet: Critical Hit Chance',
  'helmet: to Spirit',
  'body: to Spirit',
  'body: Deflection',
  'body: Maximum Elemental Resistances',
  // Köcher – "+1 Projectile Skills" seit 0.5 nur noch +1, daher nicht mehr Hauptwert, aber weiter dabei
  'quiver: Damage with Bow Skills',
  'quiver: Damage to Attacks',
  'quiver: Critical Hit Chance for Attacks',
  'quiver: Critical Damage Bonus for Attack',
  'quiver: increased Attack Speed',
  'quiver: to Level of all Projectile Skills',
  // Jewels
  'jewel: Critical Hit Chance',
  'jewel: Critical Damage Bonus',
  'jewel: maximum Energy Shield',
];

/**
 * Mods, die kaum Preis machen – standardmäßig nicht gesucht und blass markiert.
 * Bewusst NICHT "Accuracy Rating" für Waffen: das träfe den wertvollen Hybrid aus
 * "% increased Physical Damage" und Accuracy.
 */
export const DEFAULT_LOW_MODS: string[] = [
  '*: Light Radius',
  '*: Attribute Requirements',
  '*: per enemy killed',
  '*: per Enemy Hit',
  '*: Stun Threshold',
  '*: Thorns',
  '*: Knockback',
  'weapon: Stun Duration',
  'weapon: Stun Buildup',
  'helmet: Accuracy Rating',
];

/**
 * Frühere Standardlisten: Wer sie unverändert hat, bekommt beim Start die neuen Vorgaben
 * (eigene Änderungen bleiben unangetastet).
 */
export const LEGACY_DEFAULTS: { key: string[][]; low: string[][] } = {
  key: [[
    'boots: increased Movement Speed', 'amulet: to Level of all', 'amulet: to Spirit', 'body: to Spirit', 'body: Deflection',
    'caster: to Level of all Spell Skills', 'caster: increased Cast Speed', 'caster: Critical Hit Chance for Spells',
    'caster: increased Spell Damage', 'weapon: to Level of all Melee Skills', 'weapon: to Level of all Projectile Skills',
    'gloves: increased Attack Speed', 'gloves: to Level of all Melee Skills', 'gloves: to Level of all Projectile Skills',
    'gloves: Damage to Attacks', 'ring: Damage to Attacks', 'ring: Rarity of Items found', 'helmet: to Level of all Minion Skills',
    'helmet: Critical Hit Chance', 'quiver: to Level of all Projectile Skills', 'quiver: Damage to Attacks',
    'jewel: Critical Hit Chance', 'jewel: Critical Damage Bonus', 'jewel: maximum Energy Shield',
  ]],
  low: [['*: Light Radius', '*: Thorns', '*: Stun Threshold', '*: Attribute Requirements', '*: Knockback', '*: per enemy killed', 'helmet: Accuracy Rating']],
};

/** Gespeicherte Liste → aktuelle Vorgabe, falls sie einer früheren Vorgabe exakt entspricht. */
export function upgradeDefaults(list: string[], legacy: string[][], current: string[]): string[] {
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
  return legacy.some((old) => same(list, old)) ? [...current] : list;
}

export interface WeightRule { slot: Slot | WeaponGroup | '*'; text: string }

/** "boots: increased Movement Speed" → Regel; ohne gültiges Präfix gilt sie für alle Slots. */
export function parseWeightRules(lines: string[]): WeightRule[] {
  const rules: WeightRule[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^([a-z*]+)\s*:\s*(.+)$/i);
    const slot = m?.[1].toLowerCase();
    if (m && (slot === '*' || RULE_TARGETS.includes(slot as Slot))) rules.push({ slot: slot as WeightRule['slot'], text: m[2].trim() });
    else rules.push({ slot: '*', text: line });
  }
  return rules;
}

/** Bereinigt eine Liste aus den Einstellungen (leere Zeilen, Doppelte). */
export function cleanWeightList(lines: string[]): string[] {
  const seen = new Set<string>();
  return lines.map((l) => l.trim()).filter((l) => l && !seen.has(l.toLowerCase()) && seen.add(l.toLowerCase()));
}

const EXTRA_KINDS = new Set<TradeMod['kind']>(['pseudo', 'weapon', 'defence', 'misc']);
/** Mods, die man standardmäßig anhaken darf (wie bisher: keine Runen, Implicits, Enchants). */
const SELECTABLE = (m: TradeMod) => !!m.statId && !m.coveredBy && m.kind !== 'rune' && m.kind !== 'implicit' && m.kind !== 'enchant';

export interface Weighted {
  mods: TradeMod[];
  /** Schlüssel-Mods dieses Slots, die auf dem Item fehlen (Text wie in der Regel). */
  missingKeys: string[];
}

/**
 * Markiert Schlüssel- und Low-Value-Mods und legt die Standard-Auswahl fest: Summen/DPS/Verteidigung
 * wie gehabt, von den Item-Mods nur die Schlüssel-Mods. Hat ein Item gar nichts davon, bleibt es beim
 * bisherigen Verhalten (alle Mods außer Low Value), damit die Suche nicht leer läuft.
 */
export function applyWeights(mods: TradeMod[], itemClass: string, keyLines: string[], lowLines: string[]): Weighted {
  const slot = slotOf(itemClass);
  // Regel gilt für alle Slots, genau diesen Slot oder eine passende Waffengruppe (melee, bow …).
  const applies = (r: WeightRule) =>
    r.slot === '*' || r.slot === slot || (slot === 'weapon' && r.slot in WEAPON_GROUPS && WEAPON_GROUPS[r.slot as WeaponGroup].test(itemClass));
  const forSlot = (rules: WeightRule[]) => rules.filter(applies);
  const keyRules = slot ? forSlot(parseWeightRules(keyLines)) : [];
  const lowRules = forSlot(parseWeightRules(lowLines));
  const hits = (m: TradeMod, r: WeightRule) => m.text.toLowerCase().includes(r.text.toLowerCase());

  const weighted = mods.map((m) => {
    if (EXTRA_KINDS.has(m.kind)) return m;
    const key = keyRules.some((r) => hits(m, r));
    const low = !key && lowRules.some((r) => hits(m, r));
    const next: TradeMod = { ...m, ...(key ? { keyMod: true } : {}), ...(low ? { low: true } : {}) };
    if (SELECTABLE(m)) next.enabled = key && (m.value === null || m.value > 0);
    return next;
  });

  // Ohne Schlüssel-Mods und ohne Summen/DPS/Verteidigung: bisherige Auswahl, aber ohne Low Value.
  const anything = weighted.some((m) => m.enabled && m.kind !== 'misc');
  if (!anything) {
    for (const m of weighted) {
      if (!EXTRA_KINDS.has(m.kind) && SELECTABLE(m) && !m.low && (m.value === null || m.value > 0)) m.enabled = true;
    }
  }

  const missingKeys = keyRules.filter((r) => r.slot !== '*' && !mods.some((m) => hits(m, r))).map((r) => r.text);
  return { mods: weighted, missingKeys };
}
