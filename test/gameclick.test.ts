import { describe, expect, it } from 'vitest';
import { CLICK_FOCUS_MS, CLICK_GRACE_MS, stepGameClick, type GameClickInput, type GameClickState } from '../src/shared/gameclick';

const idle: GameClickState = { wasDown: false, outsideAt: 0 };
const base: GameClickInput = { now: 10_000, down: false, inside: false, busy: false, shownAt: 0, gameInFront: true };

/** Mehrere Abfragen nacheinander; liefert, ob bei einer davon geschlossen wurde. */
function run(steps: Partial<GameClickInput>[], start = idle): boolean {
  let state = start;
  for (const s of steps) {
    const r = stepGameClick(state, { ...base, ...s });
    if (r.close) return true;
    state = r.state;
  }
  return false;
}

describe('close the overlay on a click into the game', () => {
  it('closes on a click outside the overlay while the game is in front', () => {
    expect(run([{ down: true }])).toBe(true);
  });

  it('waits a moment for the game to come to the front after the click', () => {
    expect(run([{ down: true, gameInFront: false }, { now: 10_100, down: false, gameInFront: true }])).toBe(true);
  });

  it('stays open for clicks into another program (game never in front)', () => {
    expect(run([{ down: true, gameInFront: false }, { now: 10_000 + CLICK_FOCUS_MS + 50, gameInFront: false }, { now: 20_000, gameInFront: true }])).toBe(false);
  });

  it('stays open for clicks on the overlay, while dragging or resizing, and right after it opened', () => {
    expect(run([{ down: true, inside: true }])).toBe(false);
    expect(run([{ down: true, busy: true }])).toBe(false);
    expect(run([{ down: true, shownAt: 10_000 - CLICK_GRACE_MS + 100 }])).toBe(false);
  });

  it('a button held since before does not count – only a new press', () => {
    expect(run([{ down: true }], { wasDown: true, outsideAt: 0 })).toBe(false);
    expect(run([{ down: true }, { now: 10_050, down: true }], { wasDown: true, outsideAt: 0 })).toBe(false);
    expect(run([{ down: false }, { now: 10_100, down: true }], { wasDown: true, outsideAt: 0 })).toBe(true);
  });
});
