/**
 * Zusätzliche Suchkriterien für Rares: Pseudo-Summen (z. B. Resistenzen gesamt),
 * Waffen-DPS, Item-Level und Rune-Sockel – plus ein Verkaufspreis-Vorschlag.
 */
import type { ModLine } from './mods';
import type { Listing, ParsedItem, TradeMod } from './types';

// ---------- Pseudo-Summen ----------

interface PseudoDef { id: string; label: (v: string) => string }

export const PSEUDO: Record<string, PseudoDef> = {
  ele: { id: 'pseudo.pseudo_total_elemental_resistance', label: (v) => `+${v}% total Elemental Resistance` },
  chaos: { id: 'pseudo.pseudo_total_chaos_resistance', label: (v) => `+${v}% total Chaos Resistance` },
  life: { id: 'pseudo.pseudo_total_life', label: (v) => `+${v} total maximum Life` },
  mana: { id: 'pseudo.pseudo_total_mana', label: (v) => `+${v} total maximum Mana` },
  str: { id: 'pseudo.pseudo_total_strength', label: (v) => `+${v} total Strength` },
  dex: { id: 'pseudo.pseudo_total_dexterity', label: (v) => `+${v} total Dexterity` },
  int: { id: 'pseudo.pseudo_total_intelligence', label: (v) => `+${v} total Intelligence` },
};

const ELEMENTS = new Set(['Fire', 'Cold', 'Lightning']);
const ATTRS: Record<string, string> = { Strength: 'str', Dexterity: 'dex', Intelligence: 'int' };

/** Zu welchen Pseudo-Summen trägt eine Mod-Zeile bei – und mit welchem Faktor? */
export function pseudoContributions(template: string): { key: string; factor: number }[] {
  const res = template.match(/^#% to (.+) Resistances?$/);
  if (res && !/maximum/i.test(res[1])) {
    if (res[1] === 'all Elemental') return [{ key: 'ele', factor: 3 }];
    const parts = res[1].split(' and ');
    const out: { key: string; factor: number }[] = [];
    let ele = 0;
    for (const p of parts) {
      if (ELEMENTS.has(p)) ele++;
      else if (p === 'Chaos') out.push({ key: 'chaos', factor: 1 });
      else return []; // unbekannte Form – lieber nicht mitzählen
    }
    if (ele) out.push({ key: 'ele', factor: ele });
    return out;
  }
  if (template === '# to maximum Life') return [{ key: 'life', factor: 1 }];
  if (template === '# to maximum Mana') return [{ key: 'mana', factor: 1 }];
  const attr = template.match(/^# to (.+)$/);
  if (attr) {
    if (attr[1] === 'all Attributes') return ['str', 'dex', 'int'].map((key) => ({ key, factor: 1 }));
    const parts = attr[1].split(' and ');
    if (parts.every((p) => p in ATTRS)) return parts.map((p) => ({ key: ATTRS[p], factor: 1 }));
  }
  return [];
}

// ---------- Waffen-DPS ----------

export interface WeaponStats {
  aps: number; pdps: number; edps: number; cdps: number; dps: number;
  /** Kritische Trefferchance in %, wie angezeigt (0 = keine Angabe). */
  crit: number;
  /** Elemente des elementaren Schadens (für die Symbole hinter Elemental DPS). */
  elements: ('fire' | 'cold' | 'lightning')[];
}

const DAMAGE_LINE = /^(Physical|Fire|Cold|Lightning|Chaos|Elemental) Damage:\s*(.+)$/i;
const RANGE = /(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)/g;

/** Liest Schaden und Angriffe pro Sekunde aus dem Eigenschaften-Block (inkl. Qualität, wie angezeigt). */
export function weaponStats(item: ParsedItem): WeaponStats | null {
  const lines = item.sections.flat();
  const apsLine = lines.find((l) => /^Attacks per Second:/i.test(l));
  if (!apsLine) return null;
  const aps = Number(apsLine.match(/(\d+(?:\.\d+)?)/)?.[1]);
  if (!aps) return null;

  let phys = 0;
  let ele = 0;
  let chaos = 0;
  const elements = new Set<'fire' | 'cold' | 'lightning'>();
  for (const line of lines) {
    const m = line.match(DAMAGE_LINE);
    if (!m) continue;
    let avg = 0;
    for (const r of m[2].matchAll(RANGE)) avg += (Number(r[1]) + Number(r[2])) / 2;
    const type = m[1].toLowerCase();
    if (type === 'physical') phys += avg;
    else if (type === 'chaos') chaos += avg;
    else {
      ele += avg;
      // "Cold Damage: 37-59" bzw. "Elemental Damage: 11-17 (cold), 1-73 (lightning)"
      if (type === 'fire' || type === 'cold' || type === 'lightning') elements.add(type);
      for (const e of m[2].matchAll(/\((fire|cold|lightning)\)/gi)) elements.add(e[1].toLowerCase() as 'fire' | 'cold' | 'lightning');
    }
  }
  const round = (n: number) => Math.round(n * 10) / 10;
  // Gesamtwert inkl. Basis, lokaler Mods und Qualität – aussagekräftiger als der einzelne Mod.
  const crit = Number(lines.find((l) => /^Critical Hit Chance:/i.test(l))?.match(/(\d+(?:\.\d+)?)%/)?.[1] ?? 0);
  return { aps, pdps: round(phys * aps), edps: round(ele * aps), cdps: round(chaos * aps), dps: round((phys + ele + chaos) * aps), crit, elements: [...elements] };
}

/**
 * pDPS und Gesamt-DPS so, als hätte die Waffe 20 % Qualität. Qualität zählt bei Waffen wie
 * "increased Physical Damage": angezeigt = (Basis + flach) × (100 + inc + Q) / 100.
 * null, wenn die Waffe schon 20 % (oder mehr) hat oder keinen physischen Schaden.
 */
export function q20Dps(item: Pick<ParsedItem, 'quality'>, lines: Pick<ModLine, 'template' | 'values'>[], w: WeaponStats): { pdps: number; dps: number } | null {
  const q = item.quality ?? 0;
  if (q >= 20 || w.pdps <= 0) return null;
  const inc = lines.filter((l) => l.template === '#% increased Physical Damage').reduce((sum, l) => sum + (l.values[0] ?? 0), 0);
  const pdps = Math.round(w.pdps * ((100 + inc + 20) / (100 + inc + q)) * 10) / 10;
  return { pdps, dps: Math.round((w.dps - w.pdps + pdps) * 10) / 10 };
}

/** Lokale Schadens-Mods, die in den DPS schon enthalten sind. */
const DPS_MODS = [/^#% increased Physical Damage$/, /^Adds # to # (Physical|Fire|Cold|Lightning|Chaos) Damage$/, /^#% increased Attack Speed$/];

export function coveredByDps(template: string): boolean {
  return DPS_MODS.some((re) => re.test(template));
}

/** Lokale Crit-Mods einer Waffe, die in der angezeigten Critical Hit Chance schon enthalten sind. */
const CRIT_MODS = [/^#% to Critical Hit Chance$/, /^#% increased Critical Hit Chance$/];

export function coveredByCrit(template: string): boolean {
  return CRIT_MODS.some((re) => re.test(template));
}

// ---------- Verteidigung (Rüstungen) ----------

export interface DefenceStats { ar: number; ev: number; es: number; block: number; spirit: number }

const DEFENCE_LINES: [keyof DefenceStats, RegExp][] = [
  ['ar', /^Armour:\s*([\d.]+)/i],
  ['ev', /^Evasion Rating:\s*([\d.]+)/i],
  ['es', /^Energy Shield:\s*([\d.]+)/i],
  ['block', /^Block chance:\s*([\d.]+)/i],
  ['spirit', /^Spirit:\s*([\d.]+)/i],
];

/**
 * Liest die Verteidigungswerte aus dem Eigenschaften-Block (wie im Spiel angezeigt, inkl. Qualität
 * und lokaler Mods). Nur Abschnitte vor "Requires"/"Item Level" – damit Mod-Zeilen nicht mitzählen.
 */
export function defenceStats(item: ParsedItem): DefenceStats | null {
  const props: string[] = [];
  for (const section of item.sections) {
    if (section.some((l) => /^(Requires|Item Level|Sockets):/i.test(l))) break;
    props.push(...section);
  }
  const d: DefenceStats = { ar: 0, ev: 0, es: 0, block: 0, spirit: 0 };
  let found = false;
  for (const line of props) {
    for (const [key, re] of DEFENCE_LINES) {
      const m = line.match(re);
      if (m) {
        d[key] = Number(m[1]);
        found = true;
      }
    }
  }
  return found ? d : null;
}

/** Lokale Verteidigungs-Mods, die in den angezeigten Werten schon enthalten sind. */
const DEFENCE_MODS = [
  /^# to (Armour|Evasion Rating|maximum Energy Shield)$/,
  /^#% increased (Armour|Evasion( Rating)?|Energy Shield)( and (Armour|Evasion( Rating)?|Energy Shield))?$/,
  /^#% increased Armour, Evasion and Energy Shield$/,
];

export function coveredByDefence(template: string): boolean {
  return DEFENCE_MODS.some((re) => re.test(template));
}

// ---------- Zusatz-Kriterien ----------

/** Mindestwert = eigener Wert, auf eine Nachkommastelle abgerundet. */
function minOf(value: number): number {
  if (Number.isInteger(value)) return value;
  return Math.floor(value * 10 + 1e-9) / 10;
}

/**
 * Erzeugt Pseudo-, Waffen- und sonstige Filter-Zeilen und schaltet dabei die Einzel-Mods ab,
 * die durch eine Summe bzw. die DPS bereits abgedeckt sind.
 */
export function buildExtraMods(item: ParsedItem, lines: ModLine[], mods: TradeMod[]): TradeMod[] {
  const extras: TradeMod[] = [];

  // Pseudo-Summen über alle Mod-Quellen (explizit, implicit, Rune …)
  const totals = new Map<string, number>();
  const coveredTemplates = new Set<string>();
  for (const line of lines) {
    const contrib = pseudoContributions(line.template);
    if (!contrib.length || line.values.length === 0) continue;
    for (const c of contrib) totals.set(c.key, (totals.get(c.key) ?? 0) + line.values[0] * c.factor);
    coveredTemplates.add(line.template);
  }
  for (const [key, total] of totals) {
    if (total <= 0) continue;
    const def = PSEUDO[key];
    const v = Math.round(total * 100) / 100;
    extras.push({ key: `p:${key}`, text: def.label(String(v)), kind: 'pseudo', statId: def.id, value: v, min: minOf(v), enabled: true });
  }

  // Waffen-DPS
  const w = weaponStats(item);
  if (w && w.dps > 0) {
    const main = w.pdps >= w.dps * 0.6 ? 'pdps' : w.edps >= w.dps * 0.6 ? 'edps' : 'dps';
    const rows: [TradeMod['filter'], string, number][] = [
      ['dps', `${w.dps} total DPS`, w.dps],
      ['pdps', `${w.pdps} physical DPS`, w.pdps],
      ['edps', `${w.edps} elemental DPS`, w.edps],
    ];
    // DPS bei 20 % Qualität: Qualität erhöht den physischen Schaden wie "increased Physical Damage".
    const q20 = q20Dps(item, lines, w);
    for (const [filter, text, value] of rows) {
      if (value <= 0) continue;
      const atQ20 = filter === 'pdps' ? q20?.pdps : filter === 'dps' ? q20?.dps : undefined;
      extras.push({
        key: `w:${filter}`, text, kind: 'weapon', statId: null, filter, value, min: minOf(value), enabled: filter === main,
        ...(atQ20 !== undefined && atQ20 > value ? { q20: atQ20 } : {}),
        ...(filter === 'edps' && w.elements.length ? { elements: w.elements } : {}),
      });
    }
  }
  // Gesamte Crit-Chance der Waffe statt des einzelnen "+#% to Critical Hit Chance"-Mods.
  if (w && w.crit > 0) {
    extras.push({ key: 'w:crit', text: `${w.crit}% Critical Hit Chance`, kind: 'weapon', statId: null, filter: 'crit', value: w.crit, min: minOf(w.crit), enabled: true });
  }

  // Verteidigung: Rüstung/Ausweichen/Energieschild an, Block/Spirit zur Auswahl
  const d = w ? null : defenceStats(item);
  if (d) {
    const rows: [NonNullable<TradeMod['filter']>, string, number, boolean][] = [
      ['ar', `${d.ar} Armour`, d.ar, true],
      ['ev', `${d.ev} Evasion Rating`, d.ev, true],
      ['es', `${d.es} Energy Shield`, d.es, true],
      ['block', `${d.block}% Block chance`, d.block, false],
      ['spirit', `${d.spirit} Spirit`, d.spirit, false],
    ];
    for (const [filter, text, value, on] of rows) {
      if (value <= 0) continue;
      extras.push({ key: `d:${filter}`, text, kind: 'defence', statId: null, filter, value, min: minOf(value), enabled: on });
    }
  }

  // Gemmen: Stufe (an) und Qualität (an, falls vorhanden) als Filter
  if (item.rarity === 'Gem') {
    if (item.gemLevel) extras.push({ key: 'f:gem_level', text: 'Gem level', kind: 'misc', statId: null, filter: 'gem_level', value: item.gemLevel, min: item.gemLevel, enabled: true });
    const q = item.quality ?? 0;
    extras.push({ key: 'f:quality', text: 'Quality', kind: 'misc', statId: null, filter: 'quality', value: q, min: q || undefined, enabled: q > 0 });
  }

  // Corrupted-Status: standardmäßig nur Items mit demselben Status suchen (wichtig für den Preis)
  extras.push({ key: 'f:corrupted', text: item.corrupted ? 'Corrupted' : 'Not corrupted', kind: 'misc', statId: null, filter: 'corrupted', value: null, enabled: true });

  // Item-Level und Rune-Sockel (standardmäßig aus)
  if (item.itemLevel) {
    extras.push({ key: 'f:ilvl', text: 'Item level', kind: 'misc', statId: null, filter: 'ilvl', value: item.itemLevel, min: item.itemLevel, enabled: false });
  }
  const sockets = item.sections.flat().find((l) => /^Sockets:/i.test(l));
  const socketCount = sockets ? (sockets.slice(sockets.indexOf(':') + 1).match(/\bS\b/g) ?? []).length : 0;
  if (socketCount > 0) {
    extras.push({ key: 'f:sockets', text: 'Rune sockets', kind: 'misc', statId: null, filter: 'sockets', value: socketCount, min: socketCount, enabled: false });
  }

  // Abgedeckte Einzel-Mods abwählen (bleiben sichtbar und können wieder angehakt werden).
  const dpsActive = extras.some((e) => e.kind === 'weapon' && e.filter !== 'crit' && e.enabled);
  const critActive = extras.some((e) => e.filter === 'crit' && e.enabled);
  const defenceActive = extras.some((e) => e.kind === 'defence' && e.enabled);
  for (const m of mods) {
    if (m.kind === 'pseudo' || m.kind === 'weapon' || m.kind === 'defence' || m.kind === 'misc') continue;
    // Über das Template statt den Text: zusammengefasste Mods ("384 to Evasion Rating" aus zwei Zeilen)
    // haben einen neuen Text, aber dasselbe Template.
    const template = m.template ?? lines.find((l) => l.text === m.text)?.template ?? '';
    const byPseudo = coveredTemplates.has(template) && pseudoContributions(template).some((c) => totals.get(c.key)! > 0);
    const byDps = dpsActive && (coveredByDps(template) || (m.combined && /increased Physical Damage$/.test(m.text)));
    const byDefence = defenceActive && coveredByDefence(template);
    const byCrit = critActive && coveredByCrit(template);
    if (byPseudo || byDps || byDefence || byCrit) {
      m.enabled = false;
      m.coveredBy = byPseudo ? 'total' : byDps ? 'DPS' : byCrit ? 'crit' : 'defence';
    }
  }
  return extras;
}

// ---------- Verkaufspreis-Vorschlag ----------

export interface PriceSuggestion {
  amount: number;
  currency: 'exalted' | 'divine';
  /** Text für die Notiz im Stash-Tab, z. B. "~b/o 55 exalted". */
  note: string;
  /** Auf wie vielen Angeboten der Vorschlag beruht. */
  basedOn: number;
  /** Vorschlag umgerechnet in Divine (bei Vorschlägen in Exalted), falls Kurs bekannt. */
  approxDivine?: number;
}

function niceRound(n: number): number {
  if (n >= 100) return Math.round(n / 5) * 5;
  if (n >= 10) return Math.round(n);
  if (n >= 1) return Math.round(n * 2) / 2;
  return Math.round(n * 10) / 10;
}

/**
 * Leicht unter dem Median der 3 günstigsten Angebote, damit das Item zügig verkauft wird.
 * (Die Preise streuen oft stark; ein Median über mehr Angebote läge deutlich zu hoch.)
 * Ab 1 Divine in Divine, sonst in Exalted.
 */
export function suggestPrice(listings: Listing[], exaltedPerDivine: number | null, n = 3): PriceSuggestion | null {
  const values = listings.slice(0, n).map((l) => l.exalted).filter((v): v is number => v !== null && v > 0);
  if (values.length === 0) return null;
  values.sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  const median = values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
  const target = median * 0.95;

  if (exaltedPerDivine && target >= exaltedPerDivine) {
    const amount = Math.max(1, niceRound(target / exaltedPerDivine));
    return { amount, currency: 'divine', note: `~b/o ${amount} divine`, basedOn: values.length };
  }
  const amount = Math.max(1, niceRound(target));
  return {
    amount, currency: 'exalted', note: `~b/o ${amount} exalted`, basedOn: values.length,
    ...(exaltedPerDivine ? { approxDivine: amount / exaltedPerDivine } : {}),
  };
}

// ---------- Marktpreis und Verlässlichkeit ----------

export interface MarketPrice {
  divine: number;
  exalted: number;
  /** Auf wie vielen Angeboten der Wert beruht. */
  basedOn: number;
}

/**
 * Typischer Preis = Median der n günstigsten Angebote. Robuster als das günstigste Angebot allein.
 * Alte Angebote zählen voll mit: Sie sind kaufbar, und die Suche filtert bereits auf die gewünschten Stats.
 */
export function marketPrice(listings: Listing[], exaltedPerDivine: number | null, n = 3): MarketPrice | null {
  if (!exaltedPerDivine) return null;
  const values = listings.slice(0, n).map((l) => l.exalted).filter((v): v is number => v !== null && v > 0);
  if (values.length === 0) return null;
  values.sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  const exalted = values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
  return { exalted, divine: exalted / exaltedPerDivine, basedOn: values.length };
}

/** Wenig Treffer = der Preis ist nur grob; dann lieber Mods abwählen. */
export const FEW_RESULTS = 10;

/** Hinweis, wenn der angezeigte Preis wenig aussagekräftig ist (sehr wenige Treffer). */
export function priceWarnings(total: number): string[] {
  if (total > 0 && total < FEW_RESULTS) {
    return [`Only ${total} result${total === 1 ? '' : 's'} – untick some mods for a more reliable price.`];
  }
  return [];
}
