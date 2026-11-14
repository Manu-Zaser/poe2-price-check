import type { ModMeta, ParsedItem, Rarity } from './types';

const SEPARATOR = '--------';

/**
 * Werte der Zeile "Rarity:" → interne Seltenheit.
 * Deutsche Begriffe sind noch NICHT mit echtem Spieltext geprüft.
 */
const RARITY_MAP: Record<string, Rarity> = {
  normal: 'Normal',
  magic: 'Magic',
  rare: 'Rare',
  unique: 'Unique',
  currency: 'Currency',
  gem: 'Gem',
  // Deutsch (ungeprüft)
  magisch: 'Magic',
  selten: 'Rare',
  einzigartig: 'Unique',
  'währung': 'Currency',
  gemme: 'Gem',
};

/** Schlüssel → Regex für Werte, die in beliebigen Blöcken vorkommen. */
const PATTERNS = {
  itemLevel: /^(?:Item Level|Gegenstandsstufe):\s*(\d+)/i,
  quality: /^(?:Quality|Qualität)[^:]*:\s*\+?(\d+)%/i,
  stackSize: /^(?:Stack Size|Stapelgröße):\s*([\d.,\s]+)\//i,
  gemLevel: /^(?:Level|Stufe):\s*(\d+)/i,
  corrupted: /^(?:Corrupted|Verderbt)$/i,
  unidentified: /^(?:Unidentified|Nicht identifiziert)$/i,
};

function toInt(s: string): number {
  return parseInt(s.replace(/[.,\s]/g, ''), 10);
}

/** Wert hinter dem ersten Doppelpunkt ("Item Class: Rings" → "Rings"). */
function headerValue(line: string | undefined): string | null {
  if (!line) return null;
  const idx = line.indexOf(':');
  return idx === -1 ? null : line.slice(idx + 1).trim();
}

/**
 * Kopfzeile eines Mods aus dem erweiterten Kopieren, z. B.
 * `{ Prefix Modifier "Humming" (Tier: 9) — Damage, Elemental, Lightning, Caster }`.
 * In PoE2 ist eine HÖHERE Tier-Zahl besser (umgekehrt zu PoE1).
 */
export function parseModHeader(line: string): Omit<ModMeta, 'line'> {
  const inner = line.replace(/^\{\s*/, '').replace(/\s*\}$/, '');
  const kindText = inner.match(/^(.*?)\s*Modifier\b/i)?.[1]?.toLowerCase() ?? '';
  const affix: ModMeta['affix'] = /prefix/.test(kindText)
    ? 'prefix'
    : /suffix/.test(kindText)
      ? 'suffix'
      : /implicit/.test(kindText)
        ? 'implicit'
        : 'other';
  const tier = inner.match(/\((?:Tier|Rank):\s*(\d+)\)/i);
  const name = inner.match(/"([^"]+)"/);
  return { affix, ...(tier ? { tier: Number(tier[1]) } : {}), ...(name ? { name: name[1] } : {}) };
}

/**
 * Parst den Text, den PoE2 bei Strg+C (oder Strg+Alt+C) in die Zwischenablage legt.
 * Gibt null zurück, wenn der Text nicht wie ein Item aussieht.
 */
export function parseItemText(text: string): ParsedItem | null {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // Erweitertes Kopieren (Strg+Alt+C) schreibt vor jeden Mod eine Kopfzeile in { }.
  // Die Kopfzeilen selbst kommen nicht in die Abschnitte, ihre Infos (Tier, Präfix/Suffix)
  // werden den folgenden Mod-Zeilen zugeordnet.
  const blocks: string[][] = [[]];
  const modMeta: ModMeta[] = [];
  let current: Omit<ModMeta, 'line'> | null = null;
  for (const line of lines) {
    if (line === SEPARATOR) {
      blocks.push([]);
      current = null;
    } else if (line.startsWith('{')) {
      current = parseModHeader(line);
    } else {
      blocks[blocks.length - 1].push(line);
      if (current) modMeta.push({ line, ...current });
    }
  }

  const header = blocks[0];
  if (header.length < 3) return null;

  const itemClass = headerValue(header[0]);
  const rarityRaw = headerValue(header[1]);
  if (itemClass === null || rarityRaw === null) return null;

  const rarity = RARITY_MAP[rarityRaw.toLowerCase()] ?? 'Unknown';
  const names = header.slice(2);

  const sections = blocks.slice(1).filter((b) => b.length > 0);
  const allLines = sections.flat();
  const find = (re: RegExp) => {
    for (const l of allLines) {
      const m = l.match(re);
      if (m) return m;
    }
    return null;
  };

  const unidentified = find(PATTERNS.unidentified) !== null;
  const hasOwnName = (rarity === 'Rare' || rarity === 'Unique') && names.length >= 2;

  const item: ParsedItem = {
    itemClass,
    rarity,
    name: hasOwnName ? names[0] : undefined,
    baseType: hasOwnName ? names[1] : names[0],
    corrupted: find(PATTERNS.corrupted) !== null,
    unidentified,
    sections,
    modMeta,
  };

  const ilvl = find(PATTERNS.itemLevel);
  if (ilvl) item.itemLevel = toInt(ilvl[1]);
  const q = find(PATTERNS.quality);
  if (q) item.quality = toInt(q[1]);
  const stack = find(PATTERNS.stackSize);
  if (stack) item.stackSize = toInt(stack[1]);
  // "Level: 18" steht nur bei Gemmen ("Requires: Level 78" beginnt anders).
  const gem = find(PATTERNS.gemLevel);
  if (gem && (rarity === 'Gem' || /gem/i.test(itemClass))) item.gemLevel = toInt(gem[1]);

  return item;
}
