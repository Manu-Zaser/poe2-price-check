/**
 * Details eines Angebots aus dem Abruf der Trade-API (fetch) – für das kleine Fenster, das beim
 * Darüberfahren über eine Angebotszeile erscheint.
 *
 * Die API liefert Mod-Texte mit Verweis-Markup ("+12% to [Resistances|Cold Resistance]"), Mods als
 * Objekte mit Tier und Wertebereich und Eigenschaften wie Rüstung oder Energieschild.
 */

export type ListingModKind = 'implicit' | 'explicit' | 'rune' | 'enchant' | 'fractured' | 'desecrated' | 'crafted';

export interface ListingMod {
  kind: ListingModKind;
  text: string;
  /** Tier laut API, z. B. "P2" oder "S5"; zusammengefasste Mods "P3 + P5". */
  tier?: string;
  /** Höchstwert des Tiers, z. B. "71" bzw. "38 to 59". */
  max?: string;
  /** Stat-ID wie in der Suche ("explicit.stat_3484657501"), zum Abgleich mit den gesuchten Stats. */
  statId?: string;
}

export interface ListingDetails {
  name: string;
  base: string;
  rarity?: string;
  ilvl?: number;
  corrupted?: boolean;
  /** Eigenschaften wie "Armour: 202", "Physical Damage: 50-90". */
  properties: string[];
  mods: ListingMod[];
  /** Waffen: DPS laut Trade-API (gesamt, physisch, elementar). */
  dps?: { total: number; physical: number; elemental: number };
  /** Waffen: Elemente des elementaren Schadens (für die Symbole hinter Elemental DPS). */
  elements?: Element[];
}

export type Element = 'fire' | 'cold' | 'lightning';

/** Die API färbt Werte über einen Typ-Index: 4 = Feuer, 5 = Kälte, 6 = Blitz. */
const ELEMENT_BY_TYPE: Record<number, Element> = { 4: 'fire', 5: 'cold', 6: 'lightning' };

/**
 * Elemente aus den Schadens-Eigenschaften. Zwei Elemente stehen als "Elemental Damage" mit mehreren
 * Werten ([["11-17", 5], ["1-73", 6]] → Kälte, Blitz), ein einzelnes als "Fire/Cold/Lightning Damage".
 */
export function elementsOf(properties: unknown): Element[] {
  if (!Array.isArray(properties)) return [];
  const out = new Set<Element>();
  for (const p of properties as ApiProperty[]) {
    if (!/Elemental|Fire|Cold|Lightning/i.test(p.name ?? '')) continue;
    for (const [, type] of p.values ?? []) if (ELEMENT_BY_TYPE[type]) out.add(ELEMENT_BY_TYPE[type]);
  }
  return [...out];
}

/** "[EnergyShield|Energy Shield]" → "Energy Shield", "[Armour]" → "Armour". */
export function cleanMarkup(text: string): string {
  return text.replace(/\[([^\]|]+)\|([^\]]+)\]/g, '$2').replace(/\[([^\]]+)\]/g, '$1');
}

interface ApiProperty { name?: string; values?: [string, number][]; displayMode?: number }
interface ApiMod { description?: string; hash?: string; mods?: { tier?: string; magnitudes?: { min?: string; max?: string }[] }[] }

function property(p: ApiProperty): string | null {
  const name = cleanMarkup(p.name ?? '').trim();
  const values = (p.values ?? []).map((v) => v[0]).filter(Boolean);
  if (!name || !values.length) return null; // z. B. nur die Item-Klasse ("Boots")
  // displayMode 3: Platzhalter im Namen ("{0} to {1} Physical Damage")
  if (p.displayMode === 3 && /\{\d\}/.test(name)) return name.replace(/\{(\d)\}/g, (_, i) => values[Number(i)] ?? '');
  return `${name}: ${values.join(', ')}`;
}

function mod(kind: ListingModKind, raw: unknown): ListingMod | null {
  if (typeof raw === 'string') return { kind, text: cleanMarkup(raw) };
  const m = raw as ApiMod;
  if (!m?.description) return null;
  const first = m.mods?.[0];
  const maxes = (first?.magnitudes ?? []).map((g) => g.max).filter((v): v is string => !!v);
  return {
    kind,
    text: cleanMarkup(m.description),
    ...(tierOf(m) ? { tier: tierOf(m) } : {}),
    ...(maxes.length ? { max: maxes.join(' to ') } : {}),
    ...(m.hash?.startsWith('stat.') ? { statId: m.hash.slice(5) } : {}),
  };
}

/** Alle Tiers einer Zeile – mehrere, wenn das Spiel zwei Mods zu einer Zeile zusammenfasst. */
function tierOf(m: ApiMod): string {
  return (m.mods ?? []).map((x) => x.tier).filter((t): t is string => !!t).join(' + ');
}

const MOD_FIELDS: [string, ListingModKind][] = [
  ['enchantMods', 'enchant'],
  ['runeMods', 'rune'],
  ['implicitMods', 'implicit'],
  ['fracturedMods', 'fractured'],
  ['explicitMods', 'explicit'],
  ['desecratedMods', 'desecrated'],
  ['craftedMods', 'crafted'],
];

/** Item-Objekt aus /api/trade2/fetch → Anzeige-Details. Unbekanntes wird übersprungen. */
export function listingDetails(item: Record<string, unknown>): ListingDetails {
  const mods: ListingMod[] = [];
  for (const [field, kind] of MOD_FIELDS) {
    const list = item[field];
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      const m = mod(kind, raw);
      if (m) mods.push(m);
    }
  }
  const properties = (Array.isArray(item.properties) ? (item.properties as ApiProperty[]) : [])
    .map(property)
    .filter((p): p is string => p !== null);
  return {
    name: typeof item.name === 'string' ? item.name : '',
    base: String(item.baseType ?? item.typeLine ?? ''),
    ...(typeof item.rarity === 'string' ? { rarity: item.rarity } : {}),
    ...(typeof item.ilvl === 'number' ? { ilvl: item.ilvl } : {}),
    ...(item.corrupted === true ? { corrupted: true } : {}),
    properties,
    mods,
    ...dpsOf(item.extended),
    ...(elementsOf(item.properties).length ? { elements: elementsOf(item.properties) } : {}),
  };
}

/** Die Trade-API rechnet die DPS selbst aus ("extended": dps, pdps, edps). */
function dpsOf(extended: unknown): { dps?: ListingDetails['dps'] } {
  const e = extended as { dps?: unknown; pdps?: unknown; edps?: unknown } | undefined;
  if (!e || typeof e.dps !== 'number' || e.dps <= 0) return {};
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : 0);
  return { dps: { total: num(e.dps), physical: num(e.pdps), elemental: num(e.edps) } };
}
