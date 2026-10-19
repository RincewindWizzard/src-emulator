# Icom IC-M330GE – Funkgeräte-Emulator

Browser-Emulator des UKW-Seefunkgeräts **Icom IC-M330GE** (Basis-Bedienungsanleitung, deutsche Fassung) zur Vorbereitung auf die praktische SRC-Funkprüfung.
Rein statische Seite (TypeScript + Vite, keine Laufzeit-Abhängigkeiten, kein Backend).

## Funktionen

**Gerät (nach Handbuch)**
- Frontplatte mit Display, Softtasten, ◄ ► ▲ ▼, ENT, CLR, MENU, 16/C, DIAL (PWR/VOL/SQL) und DISTRESS-Taste mit Schutzkappe, dazu das Mikrofon (PTT, ▲▼, HI/LO, 16/C)
- Ein-/Ausschalten (DIAL 1 s halten), Lautstärke, Rauschsperre (Rauschen/BUSY wie am Gerät), Kanalwahl, Kanal 16, Rufkanal (16/C 1 s halten), Sendeleistung 25 W/1 W (15, 17, 75, 76 nur 1 W, Kanal 70 sendet nicht), Time-out-Timer (5 min)
- Softtasten-Seiten (◄/►): DISTRESS, OTHER DSC, SCAN, DW/TW, CHAN, HI/LO, AQUA, ★, NAME, BKLT, LOG
- Scan (normal/Priorität), Dual-/Tri-Watch, Favoritenkanäle, Kanalnamen, Hintergrundbeleuchtung
- Vollständiger Menübaum: Distress, Other DSC, GPS, Configuration, DSC Log, Radio Settings, DSC Settings, Radio Info, ATIS ID Input
- MMSI-Ersteingabe (über „Werkseinstellungen“ im Übungsbereich), manuelle Positionseingabe
- **DSC**: Notalarm (Kappe anheben, 3 s halten, Countdown-Töne, „Waiting for ACK“, automatische Wiederholung, Quittung), Einzel-/Gruppen-/Allschiffs-/Testruf, empfangene Rufe mit Alarm, Logs
- Töne (Tastenton, Alarm, DSC) und Rauschen/Signal über WebAudio

**Übungsumgebung** (rechts): Funkverkehr auf beliebigen Kanälen erzeugen, eingehende DSC-Rufe auslösen, Antwortverhalten der Gegenstelle, GPS an/aus.

**Prüfungsmodus „Notmeldung“**
1. Es wird ein Szenario ausgegeben (Schiffsname, Rufzeichen, MMSI, Position, Notlage, Personenzahl).
2. Sie bedienen das Gerät (Kappe, DSC-Notalarm mit passender Notlage, Quittung abwarten, Kanal 16, 25 W) und sprechen die Meldung **bei gedrückter PTT-Taste ins Mikrofon** (Spracherkennung des Browsers).
3. Die Küstenfunkstelle („Bremen Rescue Radio“) antwortet per Sprachausgabe, fragt Fehlendes nach und bestätigt am Ende.
4. Zum Schluss erscheint eine **Checkliste** (✓ erledigt, ! verbesserbar, ✗ vergessen) zu Bedienung am Gerät und Inhalt der Meldung (MAYDAY 3×, Schiffsname 3×, Rufzeichen, MMSI, Wiederholung, Position, Notlage, Hilfe, Personen, weitere Angaben, „Kommen“). Fehlerkennungen können per Klick korrigiert werden.

Hinweise: Die Spracherkennung (Web Speech API) funktioniert in Chrome/Edge (HTTPS nötig, Audio geht an den Browser-Anbieter). In anderen Browsern gibt es eine Texteingabe als Ersatz. „MAYDAY“ wird im Deutschen teils falsch erkannt – dann Erkennungssprache „English“ wählen oder in der Auswertung korrigieren.

## Bedienung

Maus/Touch auf die Tasten. Halten: DIAL 1 s = Ein/Aus, 16/C 1 s = Rufkanal, DISTRESS 3 s (Kappe vorher anklicken), PTT = Senden. Tastatur: Pfeiltasten, `Enter` = ENT, `Esc`/`⌫` = CLR, `M` = MENU, `1`–`4` = Softtasten, `C` = 16/C, `H` = HI/LO, `Leertaste` = PTT, `[` `]` = DIAL drehen, `P` = DIAL drücken.

## Entwicklung

```bash
npm install
npm run dev        # Entwicklungsserver
npm test           # Unit-Tests (vitest)
npm run build      # Produktions-Build nach dist/
```

## Deployment (GitHub Pages)

`.github/workflows/deploy.yml` testet, baut und veröffentlicht bei jedem Push auf `main` (oder manuell über „Run workflow“).
Einmalig im Repository unter **Settings → Pages → Build and deployment → Source: GitHub Actions** auswählen.

## Abweichungen vom echten Gerät

Das Basis-Handbuch beschreibt nur einen Teil der Abläufe. Nicht im Handbuch Beschriebenes ist nach Erfahrung mit Icom-Geräten nachempfunden und kann vom Original abweichen, u. a.: genaue Texte/Bildschirmlayouts, Wertebereiche (Lautstärke 0–30, Squelch 0–9), Gruppen-/Allschiffs-/Testruf, Notlagen-Liste, Key Assignment, Scan-Verhalten ohne Favoriten (scannt dann alle Kanäle), Kanalliste (INT, vereinfachte ATIS-Gruppe). Alle MMSI und Stationen sind fiktiv. Zur Prüfungsvorbereitung ersetzt das Werkzeug weder das offizielle Handbuch noch Übung am echten Gerät.
