/**
 * Ritual-Favours: Items im Raster an ihren Bildern erkennen.
 *
 * Das Fenster zeigt nur Bilder, keinen Text. Bepreisen lassen sich Uniques (eigenes Bild) und Währung/Omen;
 * Rares und Basen sehen aus wie ihre Basis und haben keinen Marktpreis. Vorgehen:
 *  1. Raster über die Überschrift "FAVOURS" finden (Texterkennung), skaliert mit der Bildschirmhöhe.
 *  2. Das Raster auf 24 px je Zelle verkleinern; belegte Zellen haben dunkelblauen Hintergrund.
 *  3. Jedes poe.ninja-Bild in seiner Größe (z. B. 2×2) an jede passende, belegte Stelle legen und vergleichen:
 *     Form (normierte Kreuzkorrelation) und Farbe (Farbabstand – viele Unique-Bilder sind eingefärbte
 *     Basis-Bilder; ein graues Rare passt in der Form, aber nicht in der Farbe).
 *  4. Beste Treffer ohne Überlappung übernehmen; "sicher" oder "möglich".
 * Reine Rechnung auf Pixeln – testbar ohne Bildschirm.
 */
import type { OcrLine } from './rewards';

export const CELL_PX = 24;
export const COLS = 12;
export const ROWS = 10;

/** RGB-Bild (3 Byte je Pixel). */
export interface Rgb {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Ein Vergleichsbild: RGBA in (w × CELL_PX) × (h × CELL_PX). */
export interface IconImage<T> {
  /** w × h Zellen. */
  w: number;
  h: number;
  rgba: Uint8Array;
  /** Was zu dem Bild gehört (Name, Preis …). */
  ref: T;
}

export interface RitualMatch<T> {
  ref: T;
  row: number;
  col: number;
  w: number;
  h: number;
  /** Formähnlichkeit (−1…1). */
  shape: number;
  /** Farbabstand (0 = gleich). */
  color: number;
  confidence: 'sure' | 'possible';
}

/** Lage des Rasters relativ zur Überschrift bei 1440 Pixeln Bildschirmhöhe (gemessen an echten Screenshots). */
const AT_1440 = { dx: -421.5, dy: 165, cell: 70.33 };

export function isRitualTitle(text: string): boolean {
  return /^\s*favou?rs\s*$/i.test(text);
}

/** Raster in Bildschirm-Pixeln aus der Überschrift "FAVOURS". */
export function ritualGrid(title: OcrLine, screenHeight: number): { x: number; y: number; cell: number } {
  const f = screenHeight / 1440;
  return { x: (title.x0 + title.x1) / 2 + AT_1440.dx * f, y: title.y0 + AT_1440.dy * f, cell: AT_1440.cell * f };
}

/**
 * Verkleinern durch Flächenmittelung (wie ffmpeg "area"): jeder Zielpixel ist der gewichtete Mittelwert der
 * Quellpixel, die er überdeckt. Eingabe BGRA (Electron-Bitmap), Ausgabe RGBA. Eigene Rechnung, damit
 * Raster und Icons gleich behandelt werden – die Erkennung hängt an feinen Unterschieden.
 */
export function downscaleBgra(src: Uint8Array, sw: number, sh: number, dw: number, dh: number, premultiplied = false): Uint8Array {
  const out = new Uint8Array(dw * dh * 4);
  const fx = sw / dw;
  const fy = sh / dh;
  for (let y = 0; y < dh; y++) {
    const y0 = y * fy;
    const y1 = y0 + fy;
    for (let x = 0; x < dw; x++) {
      const x0 = x * fx;
      const x1 = x0 + fx;
      let r = 0, g = 0, b = 0, a = 0, wsum = 0;
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) {
        const wy = Math.min(sy + 1, y1) - Math.max(sy, y0);
        if (wy <= 0) continue;
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
          const wx = Math.min(sx + 1, x1) - Math.max(sx, x0);
          if (wx <= 0) continue;
          const w = wx * wy;
          const i = (sy * sw + sx) * 4;
          const alpha = src[i + 3];
          // Vormultiplizierte Farben (Electron-Bitmaps) je Pixel zurückrechnen, dann mitteln – wie ffmpeg auf
          // der PNG-Datei; die Erkennungsgrenzen sind darauf abgestimmt.
          const k = premultiplied ? (alpha > 0 ? 255 / alpha : 0) : 1;
          b += src[i] * k * w;
          g += src[i + 1] * k * w;
          r += src[i + 2] * k * w;
          a += alpha * w;
          wsum += w;
        }
      }
      const o = (y * dw + x) * 4;
      out[o] = Math.min(255, r / wsum);
      out[o + 1] = Math.min(255, g / wsum);
      out[o + 2] = Math.min(255, b / wsum);
      out[o + 3] = a / wsum;
    }
  }
  return out;
}

/** RGBA → RGB. */
export function rgbaToRgb(rgba: Uint8Array): Uint8Array {
  const rgb = new Uint8Array((rgba.length / 4) * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    rgb[j] = rgba[i];
    rgb[j + 1] = rgba[i + 1];
    rgb[j + 2] = rgba[i + 2];
  }
  return rgb;
}

/** Breite und Höhe in Zellen aus der Bild-Adresse (…/gen/image/<base64-JSON>/…); ohne Angabe 1×1. */
export function iconCells(url: string): { w: number; h: number } {
  try {
    const seg = url.split('/gen/image/')[1].split('/')[0];
    const json = JSON.parse(Buffer.from(seg, 'base64').toString('utf8')) as unknown[];
    const o = (json[2] ?? {}) as { w?: number; h?: number };
    return { w: Math.max(1, Math.min(4, o.w ?? 1)), h: Math.max(1, Math.min(4, o.h ?? 1)) };
  } catch {
    return { w: 1, h: 1 };
  }
}

/** Belegte Zellen: Anteil dunkelblauer Hintergrund-Pixel. */
export function occupancy(grid: Rgb): boolean[][] {
  const occ: boolean[][] = [];
  for (let r = 0; r < ROWS; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < COLS; c++) {
      let navy = 0;
      let n = 0;
      for (let y = r * CELL_PX + 2; y < (r + 1) * CELL_PX - 2; y++) {
        for (let x = c * CELL_PX + 2; x < (c + 1) * CELL_PX - 2; x++) {
          const i = (y * grid.width + x) * 3;
          const R = grid.data[i];
          const G = grid.data[i + 1];
          const B = grid.data[i + 2];
          if (B > R + 15 && B > G + 10 && B < 110) navy++;
          n++;
        }
      }
      row.push(navy / n > 0.06);
    }
    occ.push(row);
  }
  return occ;
}

/** Ab hier gilt ein Treffer als sicher bzw. möglich. */
export const SURE = { shape: 0.66, color: 0.33 };
export const POSSIBLE = { shape: 0.6, color: 0.26 };
/** Kandidaten darunter werden gar nicht weiter betrachtet. */
const MIN_SHAPE = 0.55;

interface Prepared<T> {
  icon: IconImage<T>;
  /** Pixel-Indizes im Icon (deckende Pixel) und dazu passende Versätze im Raster-Ausschnitt. */
  idx: Int32Array;
  off: Int32Array;
  /** Icon-Werte je Kanal minus Mittelwert. */
  cen: Float32Array;
  norm: number;
  chroma: Float32Array;
}

function chroma2(r: number, g: number, b: number): [number, number] {
  const lum = (r + g + b) / 3 + 8;
  return [(r - g) / lum, (b - (r + g) / 2) / lum];
}

function prepare<T>(icon: IconImage<T>, gridWidth: number): Prepared<T> | null {
  const W = icon.w * CELL_PX;
  const H = icon.h * CELL_PX;
  const idx: number[] = [];
  const off: number[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (icon.rgba[(y * W + x) * 4 + 3] > 128) {
        idx.push(y * W + x);
        off.push(y * gridWidth + x);
      }
    }
  }
  if (idx.length < 20) return null;
  const n = idx.length;
  const mean = [0, 0, 0];
  for (const i of idx) for (let k = 0; k < 3; k++) mean[k] += icon.rgba[i * 4 + k];
  for (let k = 0; k < 3; k++) mean[k] /= n;
  const cen = new Float32Array(n * 3);
  const chroma = new Float32Array(n * 2);
  let norm = 0;
  idx.forEach((i, j) => {
    for (let k = 0; k < 3; k++) {
      const v = icon.rgba[i * 4 + k] - mean[k];
      cen[j * 3 + k] = v;
      norm += v * v;
    }
    const [a, b] = chroma2(icon.rgba[i * 4], icon.rgba[i * 4 + 1], icon.rgba[i * 4 + 2]);
    chroma[j * 2] = a;
    chroma[j * 2 + 1] = b;
  });
  return { icon, idx: Int32Array.from(idx), off: Int32Array.from(off), cen, norm: Math.sqrt(norm), chroma };
}

/** Form (Kreuzkorrelation über die deckenden Pixel) und Farbabstand an einer Rasterstelle. */
function score<T>(p: Prepared<T>, grid: Rgb, row: number, col: number): { shape: number; color: number } {
  const base = row * CELL_PX * grid.width + col * CELL_PX;
  const n = p.off.length;
  const mean = [0, 0, 0];
  for (let j = 0; j < n; j++) {
    const i = (base + p.off[j]) * 3;
    mean[0] += grid.data[i];
    mean[1] += grid.data[i + 1];
    mean[2] += grid.data[i + 2];
  }
  mean[0] /= n;
  mean[1] /= n;
  mean[2] /= n;
  let dot = 0;
  let norm = 0;
  let col2 = 0;
  for (let j = 0; j < n; j++) {
    const i = (base + p.off[j]) * 3;
    const r = grid.data[i];
    const g = grid.data[i + 1];
    const b = grid.data[i + 2];
    const vr = r - mean[0];
    const vg = g - mean[1];
    const vb = b - mean[2];
    dot += vr * p.cen[j * 3] + vg * p.cen[j * 3 + 1] + vb * p.cen[j * 3 + 2];
    norm += vr * vr + vg * vg + vb * vb;
    const [ca, cb] = chroma2(r, g, b);
    col2 += Math.abs(ca - p.chroma[j * 2]) + Math.abs(cb - p.chroma[j * 2 + 1]);
  }
  const d = Math.sqrt(norm) * p.norm;
  return { shape: d > 0 ? dot / d : 0, color: col2 / (2 * n) };
}

/**
 * Erkennt Items im Raster (grid: COLS × ROWS Zellen à CELL_PX). Liefert sichere und mögliche Treffer, ohne
 * Überlappung, beste zuerst.
 */
export function matchRitual<T>(grid: Rgb, icons: IconImage<T>[]): RitualMatch<T>[] {
  const occ = occupancy(grid);
  const cands: RitualMatch<T>[] = [];
  for (const icon of icons) {
    if (icon.w > COLS || icon.h > ROWS) continue;
    let prepared: Prepared<T> | null | undefined;
    for (let r = 0; r + icon.h <= ROWS; r++) {
      for (let c = 0; c + icon.w <= COLS; c++) {
        let full = true;
        for (let y = r; y < r + icon.h && full; y++) for (let x = c; x < c + icon.w && full; x++) full = occ[y][x];
        if (!full) continue;
        if (prepared === undefined) prepared = prepare(icon, grid.width);
        if (!prepared) break;
        const s = score(prepared, grid, r, c);
        if (s.shape < MIN_SHAPE) continue;
        const sure = s.shape >= SURE.shape && s.color <= SURE.color;
        const possible = s.shape >= POSSIBLE.shape && s.color <= POSSIBLE.color;
        if (!sure && !possible) continue;
        cands.push({ ref: icon.ref, row: r, col: c, w: icon.w, h: icon.h, shape: s.shape, color: s.color, confidence: sure ? 'sure' : 'possible' });
      }
      if (prepared === null) break;
    }
  }
  cands.sort((a, b) => b.shape - a.shape);
  const used: boolean[][] = Array.from({ length: ROWS }, () => Array<boolean>(COLS).fill(false));
  const out: RitualMatch<T>[] = [];
  for (const m of cands) {
    let free = true;
    for (let y = m.row; y < m.row + m.h && free; y++) for (let x = m.col; x < m.col + m.w && free; x++) free = !used[y][x];
    if (!free) continue;
    for (let y = m.row; y < m.row + m.h; y++) for (let x = m.col; x < m.col + m.w; x++) used[y][x] = true;
    out.push(m);
  }
  return out;
}

/** Belegte Zellen, die keinem Treffer gehören (Rares, Basen, Unbekanntes) – grob als Anzahl Items geschätzt. */
export function unmatchedCells(grid: Rgb, matches: RitualMatch<unknown>[]): number {
  const occ = occupancy(grid);
  for (const m of matches) for (let y = m.row; y < m.row + m.h; y++) for (let x = m.col; x < m.col + m.w; x++) occ[y][x] = false;
  return occ.flat().filter(Boolean).length;
}
