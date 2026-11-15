/** Kursverlauf und Trend – gemeinsam für Overlay und Marktübersicht. */
import { el } from './api';
import { amount } from './format';

/** Änderung in 7 Tagen als "▲ 12%" (grün), "▼ 8%" (rot) oder "■ 0.2%" (grau). */
export function trend(change?: number): HTMLElement | null {
  if (change === undefined || !Number.isFinite(change)) return null;
  const dir = change > 0.5 ? 'up' : change < -0.5 ? 'down' : 'flat';
  const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '■';
  return el('span', `trend ${dir}`, `${arrow} ${amount(Math.abs(change))}%`);
}

/**
 * Mini-Grafik des Kursverlaufs (poe.ninja: Änderung in % je Tag). Die Null-Linie ist der Stand
 * vor einer Woche – darüber teurer, darunter günstiger geworden.
 */
export function sparkline(points: number[], change?: number): SVGSVGElement {
  const W = 72;
  const H = 22;
  const lo = Math.min(0, ...points);
  const hi = Math.max(0, ...points);
  const span = hi - lo || 1;
  const x = (i: number) => (i / (points.length - 1)) * (W - 2) + 1;
  const y = (v: number) => H - 1 - ((v - lo) / span) * (H - 2);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', `spark ${change === undefined ? '' : change > 0.5 ? 'up' : change < -0.5 ? 'down' : 'flat'}`);
  const zero = document.createElementNS(ns, 'line');
  zero.setAttribute('x1', '0');
  zero.setAttribute('x2', String(W));
  zero.setAttribute('y1', String(y(0)));
  zero.setAttribute('y2', String(y(0)));
  zero.setAttribute('class', 'spark-zero');
  const line = document.createElementNS(ns, 'polyline');
  line.setAttribute('points', points.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' '));
  line.setAttribute('class', 'spark-line');
  svg.append(zero, line);
  const title = document.createElementNS(ns, 'title');
  title.textContent = `Price change over the last ${points.length} days (poe.ninja)`;
  svg.append(title);
  return svg;
}
