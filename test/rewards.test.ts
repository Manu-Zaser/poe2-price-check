import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bestRow, normalizeName, parseRewardLine, readRuneshape, similarity, type OcrLine } from '../src/shared/rewards';
import type { PriceMatch } from '../src/shared/types';

// What Windows text recognition read from four real Runeshape screenshots (2560×1440, left area).
const ocr = JSON.parse(readFileSync(join(__dirname, 'fixtures/ocr-runeshape.json'), 'utf8')) as Record<string, OcrLine[]>;

const price = (name: string, exalted: number): [string, PriceMatch] => [name.toLowerCase(), { name, exalted, divine: exalted / 500 }];
const names = new Map<string, PriceMatch>([
  price("Uhtred's Saga", 980),
  price('Greater Chaos Orb', 145),
  price("Greater Jeweller's Orb", 10),
  price('Cyclonic Alloy', 530),
  price('Exalted Orb', 1),
  price("Countess Seske's Rune of Archery", 173),
  price('Perfect Orb of Transmutation', 27.5),
  price('Perfect Orb of Augmentation', 161),
  price('Masterwork Rune', 787),
  price('Orb of Alchemy', 6.1),
  price("Glassblower's Bauble", 11.8),
  price('Expansive Alloy', 146),
  price('Regal Orb', 2.25),
  price('Chaos Orb', 14),
]);

const summary = (key: string) => readRuneshape(ocr[key], names)!.map((r) => `${r.count}x ${r.name}${r.match ? '' : ' (no price)'}`);

describe('reward lines', () => {
  it('reads the count, also when "1" is read as I or l, and drops trailing crumbs', () => {
    expect(parseRewardLine("IX Uhtred's Saga")).toEqual({ count: 1, name: "Uhtred's Saga" });
    expect(parseRewardLine('lx Rune of the Blossom')).toEqual({ count: 1, name: 'Rune of the Blossom' });
    expect(parseRewardLine("3x Greater Chaos Orb r.'")).toEqual({ count: 3, name: 'Greater Chaos Orb' });
    expect(parseRewardLine('3x Orb of Alchemy )')).toEqual({ count: 3, name: 'Orb of Alchemy' });
    expect(parseRewardLine('Perfect Orb Of Transmutation')).toEqual({ count: 1, name: 'Perfect Orb Of Transmutation' });
    expect(parseRewardLine('1.89 ex')).toBeNull();
  });

  it('compares names without case and punctuation', () => {
    expect(normalizeName("Glassblower’s Bauble!")).toBe('glassblowers bauble');
    expect(similarity('perfect orb of transmutation', 'perfect orb of transmutation')).toBe(1);
    expect(similarity('greater chaos orb', 'greater chaos orh')).toBeGreaterThan(0.9);
  });
});

describe('Runeshape window from real screenshots', () => {
  it('finds every reward with its count and price', () => {
    expect(summary('runen1')).toEqual(["1x Uhtred's Saga", '3x Greater Chaos Orb']);
    expect(summary('runen2')).toEqual(['1x Unique Jewellery (no price)', "1x Greater Jeweller's Orb", '1x Cyclonic Alloy', '3x Exalted Orb']);
    expect(summary('runen3')).toEqual(["1x Countess Seske's Rune of Archery", '1x Perfect Orb of Transmutation', '1x Perfect Orb of Augmentation', '1x Masterwork Rune']);
    expect(summary('runen4')).toEqual([
      '1x Cyclonic Alloy',
      '3x Orb of Alchemy',
      "3x Glassblower's Bauble",
      '1x Expansive Alloy',
      "2x Glassblower's Bauble",
      '3x Regal Orb',
      '2x Exalted Orb',
    ]);
  });

  it('values whole rows and marks the best one', () => {
    const rows = readRuneshape(ocr.runen1, names)!;
    expect(rows[1].totalExalted).toBe(435);
    expect(bestRow(rows)).toBe(0);
    expect(rows[0].rect.y0).toBeGreaterThan(0);
  });

  it('reports a missing window', () => {
    expect(readRuneshape([{ text: 'Map Objectives', x0: 0, y0: 0, x1: 10, y1: 10 }], names)).toBeNull();
  });
});
