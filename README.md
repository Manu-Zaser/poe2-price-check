# PoE2 Preischeck

Kleines Overlay für Path of Exile 2: Maus über ein Item, **Strg+D** drücken, Preis erscheint neben dem Cursor.

> This product isn't affiliated with or endorsed by Grinding Gear Games in any way.

## Starten

```bash
npm install
npm start
```

Das Hauptfenster zeigt Hotkey, League, Kurse und den Verlauf deiner Preischecks. Schließen beendet das Tool.

**Hotkey ändern:** Übersicht → „Hotkey ändern“ → neue Kombination drücken. Erlaubt sind Strg/Alt + Taste oder eine
F-Taste allein. Kombinationen wie Strg+C werden abgelehnt, weil das Spiel sie braucht. Esc bricht ab.
PoE2 im Modus **Fenster/Vollbild-Fenster** spielen, sonst liegt das Overlay unter dem Spiel.

## Was es kann (Phase 1)

- Währung, Fragmente, Runen, Essenzen, Gemmen usw. → Preis pro Stück und für den Stapel
- Uniques (auch unidentifiziert: alle möglichen Uniques der Basis)
- Datenquelle: [poe.ninja](https://poe.ninja/docs/api), höchstens einmal pro Stunde geladen

Rares/Magic brauchen die Trade-Suche → Phase 2.

## Regeln (GGG Developer Docs)

- Ein Hotkey-Druck = **eine** Aktion im Spiel (ein Strg+C), Zwischenablage wird pro Druck einmal gelesen.
- Strg+C wird nur gesendet, wenn das Fenster „Path of Exile 2“ im Vordergrund ist. Sonst wird nur die aktuelle
  Zwischenablage geprüft (praktisch zum Testen).
- Kein Speicherlesen, keine Client-Änderung, keine Automatisierung.

## Konfiguration

Hotkey, League und Overlay-Dauer stellst du in der Oberfläche ein. Gespeichert wird alles in
`%APPDATA%\poe2-pricecheck\config.json`:

| Feld | Standard | Bedeutung |
|---|---|---|
| `league` | `""` | leer = aktuelle Challenge-League |
| `hotkey` | `Ctrl+D` | Electron-Accelerator |
| `gameWindowTitle` | `Path of Exile 2` | Fenstertitel des Spiels |
| `contact` | `""` | optionaler Kontakt im User-Agent |
| `overlaySeconds` | `10` | Anzeigedauer des Overlays |

## Entwicklung

```bash
npm test           # Vitest (Parser, Preisindex, Hotkeys)
npm run typecheck  # tsc
```

Aufbau: `src/shared/parser.ts` (Item-Text), `src/shared/hotkey.ts` (Hotkey-Aufnahme und -Prüfung),
`src/main/ninja.ts` (Preise), `src/main/win32.ts` (Strg+C via SendInput), `src/main/index.ts` (Hotkey, Fenster, IPC),
`src/renderer/` (Hauptfenster `app.*`, Overlay `overlay.*`).

Debug-Ausgabe der Ergebnisse: Umgebungsvariable `POE2PC_DEBUG=1` setzen.
