/**
 * Vergleich eines Angebots mit dem gescannten Item: Welche der gesuchten Stats hat das Angebot
 * höher, welche niedriger? Bewusst kein Gesamtwert in einer Zahl – wie viel 10 Life gegen 5 %
 * Resistenz wert sind, hängt vom Build ab. Gezählt wird, gewichtet: Key-Mods doppelt.
 */
import { pseudoContributions, PSEUDO } from './extras';
import type { ListingDetails } from './listing';
import { toTemplate } from './mods';
import type { TradeMod } from './types';

/** Trade-Filter für Waffen-DPS, die sich mit den DPS des Angebots vergleichen lassen. */
const DPS_FILTERS = { dps: 'total', pdps: 'physical', edps: 'elemental' } as const;

/** Explizite Varianten (fractured, desecrated, crafted) zählen als derselbe Stat. */
export function compareKey(statId: string): string {
  return statId.replace(/^(explicit|fractured|desecrated|crafted)\./, 'explicit.');
}

/** Zahl einer Mod-Zeile wie bei der Suche: eine Zahl direkt, "Adds # to #" als Durchschnitt. */
function lineValue(text: string): number | null {
  const nums = (text.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (!nums.length) return null;
  return nums.length >= 2 && /\bto\b/.test(text) ? (nums[0] + nums[1]) / 2 : nums[0];
}

/**
 * Werte eines Angebots je Vergleichsschlüssel: Stat-IDs (gleiche IDs summiert), Pseudo-Summen
 * (Life, Resistenzen, Attribute – die Trade-API liefert sie beim Abruf nicht mit) und DPS.
 */
export function listingValues(d: ListingDetails): Map<string, number> {
  const out = new Map<string, number>();
  const add = (key: string, v: number) => out.set(key, Math.round(((out.get(key) ?? 0) + v) * 100) / 100);
  for (const m of d.mods) {
    const v = lineValue(m.text);
    if (v === null) continue;
    if (m.statId) add(compareKey(m.statId), v);
    for (const c of pseudoContributions(toTemplate(m.text))) add(PSEUDO[c.key].id, v * c.factor);
  }
  if (d.dps) for (const [filter, field] of Object.entries(DPS_FILTERS)) add(`filter:${filter}`, d.dps[field]);
  return out;
}

/** Vergleichsschlüssel eines eigenen Mods, oder null, wenn er nicht verglichen wird. */
export function ownKey(m: TradeMod): string | null {
  if (m.filter && m.filter in DPS_FILTERS) return `filter:${m.filter}`;
  if (m.filter || !m.statId) return null;
  return compareKey(m.statId);
}

export interface StatDelta { key: string; text: string; own: number; theirs: number; delta: number; weight: number }

export interface Comparison {
  verdict: 'better' | 'worse' | 'mixed' | 'same';
  /** Anzahl der verglichenen Stats, davon höher bzw. niedriger. */
  total: number;
  higher: number;
  lower: number;
  /** Je Vergleichsschlüssel (für die Pfeile an den Mod-Zeilen). */
  deltas: Map<string, StatDelta>;
}

/**
 * Vergleicht die angehakten Stats des eigenen Items mit einem Angebot. Fehlt ein Stat beim Angebot,
 * zählt er als 0 (also niedriger). Nicht verglichen: unwichtige Mods, "reduced"-Mods (ob weniger
 * besser ist, hängt vom Mod ab) und Mods ohne Zahl.
 */
export function compareListing(own: TradeMod[], d: ListingDetails): Comparison | null {
  const theirs = listingValues(d);
  const deltas = new Map<string, StatDelta>();
  let higherW = 0;
  let lowerW = 0;
  let higher = 0;
  let lower = 0;
  for (const m of own) {
    const key = ownKey(m);
    if (!m.enabled || m.low || m.invert || key === null || m.value === null || deltas.has(key)) continue;
    const t = theirs.get(key) ?? 0;
    const delta = Math.round((t - m.value) * 100) / 100;
    const weight = m.keyMod ? 2 : 1;
    deltas.set(key, { key, text: m.text, own: m.value, theirs: t, delta, weight });
    if (delta > 0) { higher++; higherW += weight; }
    if (delta < 0) { lower++; lowerW += weight; }
  }
  if (!deltas.size) return null;
  const verdict = higherW === 0 && lowerW === 0 ? 'same' : lowerW === 0 ? 'better' : higherW === 0 ? 'worse' : 'mixed';
  return { verdict, total: deltas.size, higher, lower, deltas };
}

/** Kurzer Text fürs Fenster, z. B. "Better · 4 of 5 stats higher". */
export function verdictText(c: Comparison): string {
  const label = { better: 'Better', worse: 'Worse', mixed: 'Mixed', same: 'Same' }[c.verdict];
  if (c.verdict === 'same') return `${label} · all ${c.total} stats equal`;
  const parts = [c.higher ? `${c.higher} higher` : '', c.lower ? `${c.lower} lower` : ''].filter(Boolean).join(', ');
  return `${label} than yours · ${parts} (of ${c.total})`;
}
