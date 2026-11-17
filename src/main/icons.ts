/**
 * Item-Bilder für den Ritual-Scanner: poe.ninja-Icons (web.poecdn.com) einmal laden, auf der Platte merken
 * und in Rastergröße (CELL_PX je Zelle) im Speicher halten. Die Item-Größe (z. B. 2×3) steht in der
 * Bild-Adresse selbst.
 */
import { nativeImage } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CELL_PX, downscaleBgra, iconCells, type IconImage } from '../shared/ritual';
import { decodePng } from './png';
import type { PriceMatch } from '../shared/types';

const CDN = 'https://web.poecdn.com/';

export class IconCache {
  private images = new Map<string, IconImage<PriceMatch>>();

  constructor(
    private readonly dir: string,
    private readonly userAgent: string,
  ) {}

  private file(url: string) {
    return join(this.dir, url.split('/').slice(-2).join('_').replace(/[^\w.-]/g, '_'));
  }

  /**
   * Bilder für alle Preise mit Icon bereitstellen. Fehlende werden geladen (höchstens 6 gleichzeitig) –
   * nur beim ersten Mal nennenswert (rund 1000 Bilder, ~13 MB).
   */
  async load(matches: PriceMatch[], onProgress?: (done: number, total: number) => void): Promise<IconImage<PriceMatch>[]> {
    mkdirSync(this.dir, { recursive: true });
    const todo = matches.filter((m) => m.icon && m.icon.startsWith(CDN) && !this.images.has(m.icon));
    const missing = [...new Set(todo.map((m) => m.icon!).filter((u) => !existsSync(this.file(u))))];
    let next = 0;
    let done = 0;
    const worker = async () => {
      while (next < missing.length) {
        const url = missing[next++];
        try {
          const res = await fetch(url, { headers: { 'User-Agent': this.userAgent } });
          if (res.ok) writeFileSync(this.file(url), Buffer.from(await res.arrayBuffer()));
        } catch {
          // ein fehlendes Bild = dieses Item wird nicht erkannt
        }
        onProgress?.(++done, missing.length);
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));

    for (const m of todo) {
      const url = m.icon!;
      if (this.images.has(url) || !existsSync(this.file(url))) continue;
      const buf = readFileSync(this.file(url));
      const { w, h } = iconCells(url);
      let rgba: Uint8Array;
      const png = decodePng(buf);
      if (png) {
        // Exakte Farben aus der Datei (RGBA → BGRA für die gemeinsame Verkleinerung).
        const bgra = new Uint8Array(png.rgba.length);
        for (let i = 0; i < bgra.length; i += 4) {
          bgra[i] = png.rgba[i + 2];
          bgra[i + 1] = png.rgba[i + 1];
          bgra[i + 2] = png.rgba[i];
          bgra[i + 3] = png.rgba[i + 3];
        }
        rgba = downscaleBgra(bgra, png.width, png.height, w * CELL_PX, h * CELL_PX);
      } else {
        // Ungewöhnliches Format: über Electron (vormultiplizierte Transparenz).
        const img = nativeImage.createFromBuffer(buf);
        if (img.isEmpty()) continue;
        const size = img.getSize();
        rgba = downscaleBgra(img.toBitmap(), size.width, size.height, w * CELL_PX, h * CELL_PX, true);
      }
      this.images.set(url, { w, h, rgba, ref: m });
    }
    // Jedes Bild einmal (gleiche Uniques auf mehreren Basen teilen sich ein Bild).
    const out = new Map<string, IconImage<PriceMatch>>();
    for (const m of matches) {
      const img = m.icon ? this.images.get(m.icon) : undefined;
      if (img && !out.has(m.icon!)) out.set(m.icon!, { ...img, ref: m });
    }
    return [...out.values()];
  }
}
