import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodePng } from '../src/main/png';
import { CELL_PX, COLS, downscaleBgra, iconCells, isRitualTitle, matchRitual, occupancy, ritualGrid, ROWS, unmatchedCells, type IconImage } from '../src/shared/ritual';

// Ritual Favours grids from five real screenshots (2560×1440), shrunk to 24 px per cell as the app does it,
// and the real poe.ninja pictures of the items found there plus look-alikes that must be rejected.
const dir = join(__dirname, 'fixtures/ritual');
const grid = (n: number) => ({ width: COLS * CELL_PX, height: ROWS * CELL_PX, data: new Uint8Array(gunzipSync(readFileSync(join(dir, `ritual${n}-grid.rgb.gz`)))) });
// Favours only offer uniques and omens – the app compares only those pictures.
const list = (JSON.parse(readFileSync(join(dir, 'icons.json'), 'utf8')) as { name: string; kind: string; file: string; url: string }[]).filter(
  (it) => it.kind === 'unique' || it.name.startsWith('Omen of '),
);
const icons: IconImage<string>[] = list.map((it) => {
  const png = decodePng(readFileSync(join(dir, it.file)))!;
  const { w, h } = iconCells(it.url);
  const bgra = new Uint8Array(png.rgba.length);
  for (let i = 0; i < bgra.length; i += 4) {
    bgra[i] = png.rgba[i + 2];
    bgra[i + 1] = png.rgba[i + 1];
    bgra[i + 2] = png.rgba[i];
    bgra[i + 3] = png.rgba[i + 3];
  }
  return { w, h, rgba: downscaleBgra(bgra, png.width, png.height, w * CELL_PX, h * CELL_PX), ref: it.name };
});
const found = (n: number) => matchRitual(grid(n), icons).map((m) => `${m.confidence === 'sure' ? '' : '? '}${m.ref} @${m.col + 1},${m.row + 1}`);

describe('ritual grid', () => {
  it('finds the grid from the FAVOURS title, scaled to the screen height', () => {
    expect(isRitualTitle('FAVOURS')).toBe(true);
    expect(isRitualTitle('Favors')).toBe(true);
    expect(isRitualTitle('896 TRIBUTE')).toBe(false);
    const g = ritualGrid({ text: 'FAVOURS', x0: 768, y0: 192, x1: 895, y1: 216 }, 1440);
    expect(Math.round(g.x)).toBe(410);
    expect(Math.round(g.y)).toBe(357);
    expect(g.cell).toBeCloseTo(70.33);
    expect(ritualGrid({ text: 'FAVOURS', x0: 576, y0: 144, x1: 671, y1: 162 }, 1080).cell).toBeCloseTo(52.6, 1);
    // Smaller UI (or a picture shown at 91 %): the title is narrower, so is the grid – whatever the screen height.
    expect(ritualGrid({ text: 'FAVOURS', x0: 700, y0: 180, x1: 815.6, y1: 202 }, 1440).cell).toBeCloseTo(64.0, 1);
    // Implausible title width (misread): fall back to the screen height.
    expect(ritualGrid({ text: 'FAVOURS', x0: 700, y0: 180, x1: 710, y1: 202 }, 1440).cell).toBeCloseTo(70.33);
  });

  it('reads the item size from the picture address', () => {
    expect(iconCells(list.find((x) => x.name === 'Hoghunt')!.url)).toEqual({ w: 2, h: 4 });
    expect(iconCells(list.find((x) => x.name === 'Omen of Bartering')!.url)).toEqual({ w: 1, h: 1 });
  });

  it('tells occupied cells from empty ones', () => {
    const occ = occupancy(grid(1));
    expect(occ[0].slice(0, 5)).toEqual([true, true, true, true, false]);
    expect(occ[9].slice(0, 4)).toEqual([true, true, true, false]);
    expect(occ.flat().filter(Boolean).length).toBe(43);
  });
});

describe('recognising items in real screenshots', () => {
  it('finds uniques and omens, sure ones plain and unsure ones marked', () => {
    expect(found(1)).toEqual([
      'Silverthorne @3,1',
      'Omen of Bartering @3,10',
      'Wandering Reliquary @3,7',
      'Hoghunt @4,3',
      "Daevata's Wind @1,6",
      '? Shankgonne @2,5',
      '? Greymake @1,1',
    ]);
    expect(found(2)).toEqual(['The Devouring Diadem @1,8', 'Birth of Fury @1,5', '? Greymake @1,1', 'Revered Resin @1,7', '? Shyaba @3,5']);
    expect(found(3)).toEqual(['The Vile Knight @1,5', 'Glowswarm @2,1', "Brynhand's Mark @1,7", 'The Everlasting Gaze @1,10']);
  });

  it('recognises items shown greyed out (not enough tribute) by their shape', () => {
    // In ritual4 everything is greyed out: grey versions of coloured unique pictures.
    const m = matchRitual(grid(4), icons);
    expect(m.map((x) => x.ref)).toEqual(expect.arrayContaining(['The Rat Cage', 'Leer Cast', 'Surge of the Tide', 'Demon Stitcher', 'Gifts from Above']));
    expect(m.find((x) => x.ref === 'The Rat Cage')).toMatchObject({ confidence: 'sure', dimmed: true, col: 1, row: 0 });
    expect(found(5)).toEqual(['Gloamgown @3,1', 'Omen of Gambling @3,10']);
  });

  it('counts the cells nobody recognised', () => {
    const g = grid(1);
    expect(unmatchedCells(g, matchRitual(g, icons))).toBe(12);
  });
});
