/**
 * Belohnungs-Scanner: Text, den die Windows-Texterkennung aus einem Bildschirmausschnitt gelesen hat, in
 * Belohnungen mit Preisen verwandeln. Hier nur reine Logik (testbar ohne Bildschirm):
 *  - Runeshape-Fenster: Zeilen wie "1x Rune of the Blossom" / "3x Greater Chaos Orb" unter dem Titel.
 *  - Namen tolerant gegen die bekannten poe.ninja-Namen abgleichen (Texterkennung liest "1x" oft als "lx",
 *    hängt Krümel an oder verschluckt Buchstaben).
 */
import type { PriceMatch } from './types';

/** Eine von der Texterkennung gelesene Zeile; Koordinaten in Bildschirm-Pixeln. */
export interface OcrLine {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface RewardRow {
  count: number;
  /** Erkannter Name (aus der Preisliste), sonst der gelesene Text. */
  name: string;
  /** Text, wie er gelesen wurde. */
  raw: string;
  /** Preis pro Stück (poe.ninja), wenn der Name erkannt wurde. */
  match?: PriceMatch;
  /** Übereinstimmung des gelesenen Namens mit dem erkannten (0…1). */
  confidence: number;
  /** Wert der ganzen Zeile in Exalted (count × Preis). */
  totalExalted?: number;
  /** Position auf dem Bildschirm. */
  rect: { x0: number; y0: number; x1: number; y1: number };
  /** Ritual: nur "möglich" erkannt (Bild ähnlich, aber nicht sicher) – mit Ctrl+D nachprüfen. */
  possible?: boolean;
  /** Ritual: wo das Item im Raster liegt, z. B. "column 3, row 1". */
  where?: string;
}

/** Titel des Fensters ("Runeshape Combinations"); die Texterkennung liest die Zierschrift oft schief. */
const TITLE = /shape|combin/i;

/** Ab dieser Übereinstimmung gilt ein Name als erkannt. */
export const MIN_CONFIDENCE = 0.8;

/** Kleinbuchstaben, nur Buchstaben/Ziffern/Leerzeichen – Apostrophe und Satzzeichen zählen nicht. */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’'`´]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Ähnlichkeit 0…1 (1 = gleich) zweier bereits normalisierter Namen. */
export function similarity(a: string, b: string): number {
  const len = Math.max(a.length, b.length);
  return len ? 1 - levenshtein(a, b) / len : 1;
}

/**
 * "IX Uhtred's Saga" → { count: 1, name: "Uhtred's Saga" }. Die Texterkennung liest "1" oft als I, l oder |
 * und lässt "1x" manchmal ganz weg (dann 1). Krümel am Zeilenende ("Orb r.'", "Alchemy )") fallen weg.
 */
export function parseRewardLine(text: string): { count: number; name: string } | null {
  const t = text.trim();
  const m = t.match(/^([0-9Il|!]{1,3})\s*[xX×]\s+(.+)$/);
  let count = 1;
  let name = t;
  if (m) {
    count = Number(m[1].replace(/[Il|!]/g, '1')) || 1;
    name = m[2];
  }
  // Krümel am Ende: kurze Nicht-Wort-Reste nach dem letzten Wort.
  name = name.replace(/(\s+[^A-Za-z\s]{1,3}|\s+[a-z]\W{0,2}|\s*[^A-Za-z\s'’]+)$/u, '').trim();
  if (!/[A-Za-z]{3}/.test(name)) return null;
  return { count, name };
}

/** Bester Treffer aus der Preisliste für einen gelesenen Namen. */
export function bestMatch(raw: string, names: Map<string, PriceMatch>): { match: PriceMatch; confidence: number } | null {
  const n = normalizeName(raw);
  let best: { match: PriceMatch; confidence: number } | null = null;
  for (const [key, match] of names) {
    const k = normalizeName(key);
    // Grobe Vorauswahl: Längen weit auseinander → kann nicht passen.
    if (Math.abs(k.length - n.length) > Math.max(4, n.length * 0.3)) continue;
    const c = similarity(n, k);
    if (!best || c > best.confidence) best = { match, confidence: c };
    if (c === 1) break;
  }
  return best;
}

/**
 * Runeshape-Fenster aus den gelesenen Zeilen: alles unterhalb des Titels, was wie eine Belohnung aussieht.
 * Gibt null zurück, wenn kein Titel gefunden wurde (Fenster nicht offen).
 */
export function readRuneshape(lines: OcrLine[], names: Map<string, PriceMatch>): RewardRow[] | null {
  const sorted = [...lines].sort((a, b) => a.y0 - b.y0);
  const title = sorted.find((l) => TITLE.test(l.text));
  if (!title) return null;
  const rows: RewardRow[] = [];
  for (const line of sorted) {
    if (line.y0 <= title.y1) continue;
    // Nur das Fenster selbst: Zeilen enden rechts vom Titelanfang und nicht weit hinter dem Titel.
    if (line.x1 < title.x0 || line.x1 > title.x1 + 1.5 * (title.x1 - title.x0)) continue;
    const parsed = parseRewardLine(line.text);
    if (!parsed) continue;
    const hit = bestMatch(parsed.name, names);
    const ok = hit && hit.confidence >= MIN_CONFIDENCE;
    rows.push({
      count: parsed.count,
      name: ok ? hit.match.name : parsed.name,
      raw: line.text,
      ...(ok ? { match: hit.match, totalExalted: hit.match.exalted * parsed.count } : {}),
      confidence: hit?.confidence ?? 0,
      rect: { x0: line.x0, y0: line.y0, x1: line.x1, y1: line.y1 },
    });
  }
  return rows;
}

/** Index der wertvollsten Zeile (null, wenn keine einen Preis hat). */
export function bestRow(rows: RewardRow[]): number | null {
  let best: number | null = null;
  rows.forEach((r, i) => {
    if (r.totalExalted !== undefined && (best === null || r.totalExalted > rows[best].totalExalted!)) best = i;
  });
  return best;
}
