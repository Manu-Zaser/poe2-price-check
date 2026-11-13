import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseItemText } from '../src/shared/parser';

// Hinweis: Die Fixtures sind nach dem bekannten PoE-Format nachgebaut.
// Echte, im Spiel kopierte Texte sollten sie ersetzen bzw. ergänzen.
const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

describe('parseItemText', () => {
  it('erkennt Währung mit Stapelgröße', () => {
    const item = parseItemText(fixture('currency-divine.txt'))!;
    expect(item.rarity).toBe('Currency');
    expect(item.baseType).toBe('Divine Orb');
    expect(item.name).toBeUndefined();
    expect(item.stackSize).toBe(7);
  });

  it('erkennt Uniques mit Name, Basistyp, Qualität und Corrupted', () => {
    const item = parseItemText(fixture('unique-temporalis.txt'))!;
    expect(item).toMatchObject({
      itemClass: 'Body Armours',
      rarity: 'Unique',
      name: 'Temporalis',
      baseType: 'Silk Robe',
      itemLevel: 79,
      quality: 20,
      corrupted: true,
      unidentified: false,
    });
  });

  it('ignoriert { }-Zeilen aus Strg+Alt+C', () => {
    const item = parseItemText(fixture('rare-ring.txt'))!;
    expect(item.rarity).toBe('Rare');
    expect(item.name).toBe('Gale Spiral');
    expect(item.baseType).toBe('Sapphire Ring');
    expect(item.sections.flat().some((l) => l.startsWith('{'))).toBe(false);
    expect(item.sections.flat()).toContain('+64 to maximum Life');
  });

  it('erkennt unidentifizierte Uniques (nur Basistyp)', () => {
    const item = parseItemText(fixture('unique-unidentified.txt'))!;
    expect(item.unidentified).toBe(true);
    expect(item.name).toBeUndefined();
    expect(item.baseType).toBe('Silk Robe');
  });

  it('verträgt Windows-Zeilenumbrüche', () => {
    const item = parseItemText(fixture('currency-divine.txt').replace(/\n/g, '\r\n'))!;
    expect(item.baseType).toBe('Divine Orb');
  });

  it('liefert null für beliebigen Text', () => {
    expect(parseItemText('hallo welt')).toBeNull();
    expect(parseItemText('')).toBeNull();
  });

  it('liest Stapelgrößen mit Tausendertrennzeichen', () => {
    const text = 'Item Class: Stackable Currency\nRarity: Currency\nExalted Orb\n--------\nStack Size: 1,234/5,000';
    expect(parseItemText(text)!.stackSize).toBe(1234);
  });
});
