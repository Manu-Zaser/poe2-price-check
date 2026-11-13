/**
 * Zuordnung von Mod-Zeilen zu Stat-IDs der Trade-Suche (/api/trade2/data/stats)
 * und Aufbau der Suchanfrage.
 */
import { extractModLines, toTemplate, type ModKind, type ModLine } from './mods';
import { buildExtraMods } from './extras';
import type { ParsedItem, TradeMod } from './types';

export interface StatEntry { id: string; text: string; type: string }
export interface StatsData { result: { id: string; label: string; entries: StatEntry[] }[] }

/** Item-Klassen, auf denen Mods nie "lokal" sind. */
const NON_LOCAL_CLASSES = /ring|amulet|belt|jewel|flask|charm|relic|tablet|waystone/i;

interface Variant { template: string; sign: number; fixedValue?: number }

/** Schreibweisen, unter denen ein Mod in der Stat-Liste stehen kann. */
function variants(line: ModLine): Variant[] {
  const out: Variant[] = [{ template: line.template, sign: 1 }];
  // "50% reduced X" steht als "#% increased X" mit negativem Wert in der Liste.
  const swapped = line.template
    .replace(/\breduced\b/g, 'increased')
    .replace(/\bless\b/g, 'more');
  if (swapped !== line.template) out.push({ template: swapped, sign: -1 });
  // "fire an additional Arrow" → "fire # additional Arrows"
  const additional = line.template.match(/^(.*)\ban additional (\w+)(.*)$/);
  if (additional) out.push({ template: `${additional[1]}# additional ${additional[2]}s${additional[3]}`, sign: 1, fixedValue: 1 });
  return out;
}

export class StatIndex {
  /** Template → Gruppe (explicit/implicit/…) → Eintrag */
  private byTemplate = new Map<string, Map<string, StatEntry>>();
  readonly size: number;

  constructor(data: StatsData) {
    let n = 0;
    for (const group of data.result) {
      for (const entry of group.entries) {
        const key = toTemplate(entry.text);
        let groups = this.byTemplate.get(key);
        if (!groups) this.byTemplate.set(key, (groups = new Map()));
        if (!groups.has(group.id)) groups.set(group.id, entry);
        n++;
      }
    }
    this.size = n;
  }

  private lookup(template: string, kind: ModKind, allowLocal: boolean): StatEntry | undefined {
    const keys = allowLocal ? [`${template} (Local)`, template] : [template];
    for (const key of keys) {
      const groups = this.byTemplate.get(key);
      if (!groups) continue;
      const entry = groups.get(kind) ?? groups.get('explicit');
      if (entry) return entry;
    }
    return undefined;
  }

  /** Passende Stat-ID plus Vergleichswert, oder null. */
  match(line: ModLine, item: ParsedItem): { id: string; value: number | null } | null {
    const allowLocal = !NON_LOCAL_CLASSES.test(item.itemClass);
    for (const v of variants(line)) {
      const entry = this.lookup(v.template, line.kind, allowLocal);
      if (!entry) continue;
      return { id: entry.id, value: statValue(line, v) };
    }
    return null;
  }

  isKnown(line: ModLine): boolean {
    return variants(line).some((v) => this.byTemplate.has(v.template) || this.byTemplate.has(`${v.template} (Local)`));
  }
}

/** "Adds # to #" wird über den Durchschnitt gesucht, sonst über die (einzige) Zahl. */
function statValue(line: ModLine, v: Variant): number | null {
  if (v.fixedValue !== undefined) return v.fixedValue;
  const hashes = (v.template.match(/#/g) ?? []).length;
  if (hashes === 0 || line.values.length === 0) return null;
  const nums = line.values.slice(0, hashes).map(Math.abs);
  const raw = hashes >= 2 ? nums.reduce((a, b) => a + b, 0) / nums.length : nums[0];
  return round(raw * v.sign);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Standard-Mindestwert = der Wert des Items selbst, auf eine Nachkommastelle abgerundet
 * (ganze Zahlen bleiben ganz): 30 → 30, 3.44 → 3.4, 7.05 → 7.
 */
export function defaultMin(value: number | null): number | undefined {
  if (value === null || value <= 0) return undefined;
  return floorOneDecimal(value);
}

export function floorOneDecimal(value: number): number {
  if (Number.isInteger(value)) return value;
  // kleiner Zuschlag gegen Gleitkomma-Fehler (z. B. 0.7 * 10 = 6.9999…)
  return Math.floor(value * 10 + 1e-9) / 10;
}

/** Erzeugt die Mod-Liste, die im Overlay angezeigt und für die Suche verwendet wird. */
export function buildTradeMods(item: ParsedItem, stats: StatIndex): TradeMod[] {
  const mods: TradeMod[] = [];
  const byStat = new Map<string, TradeMod>();

  const lines = extractModLines(item, (l) => stats.isKnown(l));
  lines.forEach((line, i) => {
    const m = stats.match(line, item);
    const value = m?.value ?? null;

    // Gleiche Stat-ID mehrfach (z. B. zwei Zeilen "% increased Physical Damage" aus Präfix + Hybrid-Mod):
    // Die Trade-Suche kennt nur die Summe.
    const same = m ? byStat.get(m.id) : undefined;
    if (same && same.value !== null && value !== null && (line.template.match(/#/g) ?? []).length === 1) {
      same.value = Math.round((same.value + value) * 100) / 100;
      same.min = defaultMin(same.value);
      same.text = line.template.replace('#', amountText(same.value));
      same.combined = true;
      if (line.tier !== undefined) same.tiers = [...(same.tiers ?? []), { affix: line.affix ?? 'other', tier: line.tier }];
      return;
    }

    // Standardauswahl: explizite (auch fractured/desecrated) Mods; Runen und Implicits sind meist austauschbar bzw. fix.
    const selectable = line.kind !== 'rune' && line.kind !== 'implicit' && line.kind !== 'enchant';
    const mod: TradeMod = {
      key: `${i}`,
      text: line.text,
      kind: line.kind,
      statId: m?.id ?? null,
      value,
      min: defaultMin(value),
      enabled: m !== null && selectable && (value === null || value > 0),
      ...(line.tier !== undefined ? { tiers: [{ affix: line.affix ?? 'other', tier: line.tier }] } : {}),
    };
    if (m) byStat.set(m.id, mod);
    mods.push(mod);
  });
  // Summen, DPS, Item-Level, Sockel davor; abgedeckte Einzel-Mods werden dabei abgewählt.
  return [...buildExtraMods(item, lines, mods), ...mods];
}

function amountText(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/**
 * Wie viele der angehakten Mods ein Angebot mindestens haben muss.
 * Alle 6 Mods eines Rares exakt wiederzufinden klappt fast nie – ähnliche Items mit
 * 4 von 6 Mods sind für die Preiseinschätzung aussagekräftiger.
 */
export function defaultMatchCount(enabled: number): number {
  if (enabled <= 2) return enabled;
  return Math.max(2, enabled - 2);
}

/** Item-Klasse aus dem Kopiertext → Kategorie-Filter der Trade-Suche. */
const CATEGORIES: Record<string, string> = {
  Gloves: 'armour.gloves', Boots: 'armour.boots', Helmets: 'armour.helmet', 'Body Armours': 'armour.chest',
  Shields: 'armour.shield', Foci: 'armour.focus', Bucklers: 'armour.buckler', Quivers: 'armour.quiver',
  Rings: 'accessory.ring', Amulets: 'accessory.amulet', Belts: 'accessory.belt', Jewels: 'jewel',
  Bows: 'weapon.bow', Crossbows: 'weapon.crossbow', Wands: 'weapon.wand', Sceptres: 'weapon.sceptre',
  Staves: 'weapon.staff', Quarterstaves: 'weapon.warstaff', Claws: 'weapon.claw', Daggers: 'weapon.dagger',
  'One Hand Swords': 'weapon.onesword', 'One Hand Axes': 'weapon.oneaxe', 'One Hand Maces': 'weapon.onemace',
  Spears: 'weapon.spear', Flails: 'weapon.flail', 'Two Hand Swords': 'weapon.twosword', 'Two Hand Axes': 'weapon.twoaxe',
  'Two Hand Maces': 'weapon.twomace', Talismans: 'weapon.talisman',
  'Life Flasks': 'flask.life', 'Mana Flasks': 'flask.mana', Charms: 'flask.charm',
};

export function categoryFor(itemClass: string): string | undefined {
  return CATEGORIES[itemClass];
}

export interface SearchOptions {
  /** Nur Items mit genau diesem Basistyp suchen. */
  useBaseType: boolean;
  /** true = alle angehakten Mods müssen passen, sonst nur defaultMatchCount() davon. */
  matchAll: boolean;
  /** true = nur Sofortkauf (Instant Buyout), sonst auch "In Person". */
  instantOnly?: boolean;
}

/** JSON für POST /api/trade2/search/poe2/{league}. */
export function buildSearchQuery(item: ParsedItem, mods: TradeMod[], opts: SearchOptions) {
  const filters = mods
    .filter((m) => m.enabled && m.statId && !m.filter)
    .map((m) => ({ id: m.statId!, ...(m.min !== undefined ? { value: { min: m.min } } : {}) }));

  const typeFilters: Record<string, unknown> = { rarity: { option: 'nonunique' } };
  const category = categoryFor(item.itemClass);
  if (!opts.useBaseType && category) typeFilters.category = { option: category };
  const equipment: Record<string, { min: number }> = {};
  for (const m of mods) {
    if (!m.enabled || !m.filter || m.min === undefined) continue;
    if (m.filter === 'ilvl') typeFilters.ilvl = { min: m.min };
    else if (m.filter === 'sockets') equipment.rune_sockets = { min: m.min };
    else equipment[m.filter] = { min: m.min };
  }

  return {
    query: {
      status: { option: opts.instantOnly ? 'securable' : 'available' },
      ...(opts.useBaseType ? { type: item.baseType } : {}),
      stats: [
        opts.matchAll || filters.length <= 2
          ? { type: 'and', filters }
          : { type: 'count', filters, value: { min: defaultMatchCount(filters.length) } },
      ],
      filters: {
        type_filters: { filters: typeFilters },
        ...(Object.keys(equipment).length ? { equipment_filters: { filters: equipment } } : {}),
      },
    },
    sort: { price: 'asc' },
  };
}

export function tradeSearchUrl(league: string, queryId: string): string {
  return `https://www.pathofexile.com/trade2/search/poe2/${encodeURIComponent(league)}/${queryId}`;
}
