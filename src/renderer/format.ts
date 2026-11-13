import type { PriceMatch } from '../shared/types';

function num(n: number, digits: number): string {
  return n.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Sinnvolle Nachkommastellen je nach Größenordnung. */
export function amount(n: number): string {
  if (n >= 100 || Number.isInteger(n)) return num(n, 0);
  if (n >= 10) return num(n, 1);
  if (n >= 0.01) return num(n, 2);
  return num(n, 3);
}

export interface PriceParts {
  value: string;
  unit: 'Div' | 'Ex';
  /** Umrechnung in die jeweils andere Währung, falls aussagekräftig. */
  alt?: string;
}

/** Ab 1 Divine in Divine, darunter in Exalted. */
export function priceParts(divine: number, exalted: number): PriceParts {
  if (divine >= 1 || exalted === 0) {
    return { value: amount(divine), unit: 'Div', alt: exalted > 0 && divine < 50 ? `≈ ${amount(exalted)} Ex` : undefined };
  }
  return { value: amount(exalted), unit: 'Ex', alt: divine >= 0.01 ? `≈ ${amount(divine)} Div` : undefined };
}

export function priceText(m: Pick<PriceMatch, 'divine' | 'exalted'>, factor = 1): string {
  const p = priceParts(m.divine * factor, m.exalted * factor);
  return `${p.value} ${p.unit}`;
}

export function timeAgo(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return 'gerade eben';
  const m = Math.round(s / 60);
  if (m < 60) return `vor ${m} Min.`;
  const h = Math.round(m / 60);
  return `vor ${h} Std.`;
}

const CURRENCY_SHORT: Record<string, string> = { exalted: 'Ex', divine: 'Div', chaos: 'Chaos', alch: 'Alch', annul: 'Annul', regal: 'Regal', vaal: 'Vaal' };

/** Trade-Währungs-ID → Kurzname. */
export function currencyShort(id: string): string {
  return CURRENCY_SHORT[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

/** "vor 3 Std." für ISO-Zeitstempel; Tage ab 48 Std. */
export function ageFromIso(iso: string, now = Date.now()): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  const h = (now - ms) / 3_600_000;
  if (h >= 36) return `vor ${Math.round(h / 24)} T.`;
  return timeAgo(ms, now);
}

export function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

/** "" → null (ohne Minimum), ungültig → NaN. Komma und Punkt als Dezimaltrenner. */
export function parseMin(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}
