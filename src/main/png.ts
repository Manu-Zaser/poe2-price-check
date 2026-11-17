/**
 * Kleiner PNG-Decoder für die Item-Bilder (8 Bit, RGB oder RGBA, ohne Interlacing – so liefert sie das CDN).
 * Electron gibt Bitmaps nur mit vormultiplizierter Transparenz heraus; an fast durchsichtigen Rändern
 * gehen dabei Farben verloren, und dünne Items (Speere, Stäbe) würden nicht mehr erkannt. Hier bleiben die
 * Farben exakt wie in der Datei.
 */
import { inflateSync } from 'node:zlib';

export interface DecodedPng {
  width: number;
  height: number;
  /** RGBA, nicht vormultipliziert. */
  rgba: Uint8Array;
}

const SIGNATURE = '89504e470d0a1a0a';

/** null, wenn das Format nicht unterstützt wird (dann nimmt der Aufrufer den Weg über Electron). */
export function decodePng(buf: Buffer): DecodedPng | null {
  if (buf.length < 33 || buf.subarray(0, 8).toString('hex') !== SIGNATURE) return null;
  let pos = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  const idat: Buffer[] = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      colorType = data[9];
      const interlace = data[12];
      if (bitDepth !== 8 || interlace !== 0 || (colorType !== 6 && colorType !== 2)) return null;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  if (!width || !height || colorType < 0) return null;
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }
  if (raw.length < height * (stride + 1)) return null;
  const px = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[out + x - bpp] : 0;
      const b = y > 0 ? px[out - stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[out - stride + x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) return null;
      px[out + x] = v & 255;
    }
  }
  if (bpp === 4) return { width, height, rgba: px };
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < px.length; i += 3, j += 4) {
    rgba[j] = px[i];
    rgba[j + 1] = px[i + 1];
    rgba[j + 2] = px[i + 2];
    rgba[j + 3] = 255;
  }
  return { width, height, rgba };
}
