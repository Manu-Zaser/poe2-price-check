/**
 * Overlay schließen, wenn man wieder ins Spiel klickt: Entscheidung pro Abfrage (alle 50 ms) aus dem Zustand
 * der Maustasten, der Lage des Mauszeigers und dem Vordergrundfenster. Rein, damit sie testbar ist.
 */

/** Klicks direkt nach dem Öffnen zählen nicht (z. B. die Maus noch vom Hotkey-Moment gedrückt). */
export const CLICK_GRACE_MS = 400;
/** So lange darf es dauern, bis das Spiel nach dem Klick vorne ist; sonst war es ein anderes Programm. */
export const CLICK_FOCUS_MS = 400;

export interface GameClickState {
  /** War beim letzten Mal eine Maustaste gedrückt? */
  wasDown: boolean;
  /** Zeitpunkt eines Klicks außerhalb des Overlays, der noch auf das Spiel im Vordergrund wartet (0 = keiner). */
  outsideAt: number;
}

export interface GameClickInput {
  now: number;
  /** Maustaste gerade gedrückt. */
  down: boolean;
  /** Mauszeiger über dem Overlay. */
  inside: boolean;
  /** Overlay wird gerade verschoben oder in der Größe geändert. */
  busy: boolean;
  /** Wann das Overlay erschienen ist. */
  shownAt: number;
  /** Das Spiel ist das Vordergrundfenster. */
  gameInFront: boolean;
}

export function stepGameClick(state: GameClickState, input: GameClickInput): { state: GameClickState; close: boolean } {
  const pressed = input.down && !state.wasDown;
  let outsideAt = state.outsideAt;
  if (pressed && !input.busy && !input.inside && input.now - input.shownAt > CLICK_GRACE_MS) outsideAt = input.now;
  if (outsideAt && input.now - outsideAt > CLICK_FOCUS_MS) outsideAt = 0; // in ein anderes Programm geklickt
  if (outsideAt && input.gameInFront) return { state: { wasDown: input.down, outsideAt: 0 }, close: true };
  return { state: { wasDown: input.down, outsideAt }, close: false };
}
