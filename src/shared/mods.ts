import type { ModMeta, ParsedItem } from './types';

/** Herkunft eines Mods – entspricht den Gruppen in /api/trade2/data/stats. */
export type ModKind = 'explicit' | 'implicit' | 'rune' | 'enchant' | 'crafted' | 'fractured' | 'desecrated';

export interface ModLine {
  /** Bereinigter Text, wie er im Spiel steht (ohne Wertebereiche und Marker). */
  text: string;
  kind: ModKind;
  /** Text mit Zahlen als "#" und ohne "+" davor, z. B. "# to maximum Life". */
  template: string;
  /** Alle Zahlen der Zeile in Reihenfolge. */
  values: number[];
  /** Aus der Kopfzeile des erweiterten Kopierens (falls vorhanden). */
  affix?: ModMeta['affix'];
  tier?: number;
  /** Wie gut der Wert innerhalb seines Bereichs gerollt ist (0–1); nur beim erweiterten Kopieren. */
  roll?: ModRoll;
}

export interface ModRoll {
  /** 0 = schlechtester, 1 = bester möglicher Wert (bei mehreren Zahlen der Durchschnitt). */
  quality: number;
  /** Möglicher Bereich, z. B. "124–149" oder "14–15 / 22–24". */
  range: string;
  /** Höchstwert dieses Tiers, z. B. "149" bzw. "38 to 59" bei "Adds # to #". */
  max: string;
}

const RANGE = /(-?\d+(?:\.\d+)?)\((-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)\)/g;

/**
 * Roll-Qualität aus den Wertebereichen des erweiterten Kopierens: "+142(124-149)" → 72 %.
 * Bei "reduced"-Mods ist ein größerer Wert ebenfalls der bessere Roll des Mods.
 */
export function rollOf(raw: string): ModRoll | undefined {
  const ranges = [...raw.matchAll(RANGE)].map((m) => ({ v: Number(m[1]), lo: Number(m[2]), hi: Number(m[3]) }));
  if (!ranges.length) return undefined;
  const parts = ranges.map(({ v, lo, hi }) => (hi === lo ? 1 : Math.min(1, Math.max(0, (v - lo) / (hi - lo)))));
  const quality = Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 100) / 100;
  return {
    quality,
    range: ranges.map(({ lo, hi }) => `${lo}–${hi}`).join(' / '),
    max: ranges.map(({ hi }) => String(hi)).join(' to '),
  };
}

const MARKERS: Record<string, ModKind> = {
  implicit: 'implicit',
  rune: 'rune',
  enchant: 'enchant',
  crafted: 'crafted',
  fractured: 'fractured',
  desecrated: 'desecrated',
};

const NUMBER = /[+-]?\d+(?:\.\d+)?/g;

/** Zeilen, die nie Mods sind. */
const NOT_A_MOD = /^(Item Level|Requires|Sockets|Quality|Rarity|Item Class|Stack Size|Corrupted|Unidentified|Mirrored|Right click|Place into|Note):?/i;

export function toTemplate(text: string): string {
  return text.replace(NUMBER, '#').replace(/\+#/g, '#').replace(/\s+/g, ' ').trim();
}

/** Bereinigt eine Mod-Zeile und erkennt Marker wie "(rune)" oder "(implicit)". */
export function parseModLine(raw: string, fallbackKind: ModKind = 'explicit'): ModLine {
  let text = raw.trim();
  let kind = fallbackKind;

  const marker = text.match(/\s*\((implicit|rune|enchant|crafted|fractured|desecrated)\)$/i);
  if (marker) {
    kind = MARKERS[marker[1].toLowerCase()];
    text = text.slice(0, marker.index).trim();
  }

  const roll = rollOf(text);
  text = text
    .replace(/\s+—\s+Unscalable Value$/i, '')
    // Wertebereiche aus dem erweiterten Kopieren: "14(14-15)" → "14"
    .replace(/\((-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)\)/g, '')
    .trim();

  const values = (text.match(NUMBER) ?? []).map(Number);
  return { text, kind, template: toTemplate(text), values, ...(roll ? { roll } : {}) };
}

/**
 * Sucht die Mod-Zeilen eines Items. Abschnitte nach "Item Level" gelten als Mod-Abschnitte,
 * sofern sie nicht offensichtlich etwas anderes sind (Flavour-Text, Hinweise).
 * Ohne Marker ist der LETZTE Mod-Abschnitt explizit, frühere sind Implicits.
 */
export function extractModLines(item: ParsedItem, isModText: (line: ModLine) => boolean): ModLine[] {
  const ilvlIndex = item.sections.findIndex((s) => s.some((l) => /^Item Level:/i.test(l)));
  const candidates = item.sections.slice(ilvlIndex + 1);

  // Abschnitt → geparste Zeilen; nur Abschnitte, in denen mindestens eine Zeile als Mod erkannt wird.
  const meta = new Map((item.modMeta ?? []).map((m) => [m.line, m]));
  const withMeta = (raw: string): ModLine => {
    const line = parseModLine(raw);
    const m = meta.get(raw);
    if (!m) return line;
    // Die Kopfzeile weiß sicher, ob es ein Implicit ist – zuverlässiger als die Abschnitts-Heuristik.
    const kind = m.affix === 'implicit' && line.kind === 'explicit' ? 'implicit' : line.kind;
    return { ...line, kind, affix: m.affix, ...(m.tier !== undefined ? { tier: m.tier } : {}) };
  };
  const sections = candidates
    .map((lines) => lines.filter((l) => !NOT_A_MOD.test(l)).map(withMeta))
    .filter((lines) => lines.length > 0 && lines.some(isModText));

  const unmarkedIdx = sections
    .map((lines, i) => (lines.every((l) => l.kind === 'explicit') ? i : -1))
    .filter((i) => i >= 0);
  const lastUnmarked = unmarkedIdx[unmarkedIdx.length - 1];

  // Nicht erkannte Zeilen in Mod-Abschnitten bleiben drin – die Oberfläche zeigt sie ausgegraut.
  const result: ModLine[] = [];
  sections.forEach((lines, i) => {
    for (const line of lines) {
      // Präfix/Suffix laut Kopfzeile ist immer explizit, auch im vorletzten Abschnitt.
      const knownAffix = line.affix === 'prefix' || line.affix === 'suffix';
      const unmarked = line.kind === 'explicit' && !knownAffix;
      result.push(unmarked && i !== lastUnmarked ? { ...line, kind: 'implicit' } : line);
    }
  });
  return result;
}
