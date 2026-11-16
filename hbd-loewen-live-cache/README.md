# HBD Löwen Live – statische Mobile-Webapp mit JSON-Cache

Diese Version löst den bisherigen 403-Fehler **architektonisch**: Beim Öffnen der App gibt es keine Anfrage an handball.net. Ein separater GitHub-Actions-Job lädt öffentliche Daten, normalisiert sie in eigene JSON-Dateien und veröffentlicht App und Cache gemeinsam über GitHub Pages.

```text
handball.net ── nur GitHub Action ──> public/data/*.json
                                         │
                                         └──> GitHub Pages ──> Smartphone
```

Wenn die Datenquelle ausfällt oder mit HTTP 403 antwortet, überschreibt der Job den letzten erfolgreichen Datenstand nicht. Die App bleibt benutzbar und kennzeichnet den Stand als veraltet.

## Enthalten

- konsequent mobile Oberfläche im dunklen Löwen-Stil
- Bereiche **Live**, **Spiele** und **Tabelle**
- Live-Spielstand, Minute, Halbzeit und letzte Ereignisse, soweit geliefert
- nächstes Spiel und letztes Ergebnis
- Filter nach Mannschaft und Spielstatus
- Tabellen je Staffel, soweit öffentlich verfügbar
- installierbare PWA mit Service Worker
- automatische Browser-Aktualisierung aus dem eigenen JSON-Cache
- GitHub Action für Abruf, Tests, Cache-Persistenz und Pages-Deployment
- kein Framework und keine npm-Abhängigkeiten
- Tests mit lokalem Mock der externen Quelle

## Cache-Dateien

| Datei | Inhalt |
|---|---|
| `public/data/matches.json` | normalisierte Spiele und Ergebnisse |
| `public/data/live.json` | aktuell als live erkannte Spiele |
| `public/data/events.json` | Spielereignisse nach Match-ID |
| `public/data/standings.json` | Tabellen nach Staffel-/Phase-ID |
| `public/data/teams.json` | Mannschaften und erkannte Staffeln |
| `public/data/meta.json` | Aktualisierungsstatus, Zähler und Diagnosedaten |

Die Webapp liest ausschließlich diese Dateien. Der Projektcheck bricht ab, falls im Frontend ein direkter API-Abruf auftaucht.

## Lokal testen

Voraussetzung: Node.js 20 oder neuer.

```bash
npm test
npm run check
npm run build
npm run serve
```

Danach `http://localhost:8080` öffnen. Auf macOS kann alternativ `START.command` doppelt angeklickt werden. Ein `npm install` ist nicht erforderlich.

Beim ersten lokalen Start sind die öffentlichen JSON-Dateien absichtlich leer. Es gibt keine erfundenen Demo-Ergebnisse. Für einen isolierten Kompletttest verwendet die Testsuite einen lokalen Mock-Server.

## Einmaliger realer Datenabruf

```bash
npm run fetch
```

Nützliche optionale Umgebungsvariablen:

```bash
HANDBALL_CLUB_ID=0cxs2qb \
SEASON_ID=2627 \
SEASON_START=2026-07-01 \
SEASON_END=2027-06-30 \
npm run fetch
```

Die Team-Liste und Saison stehen in `config/teams.json`. Die derzeit vorkonfigurierten 13 Mannschaften stammen aus dem öffentlichen Vereinsprofil. IDs oder Bezeichnungen können dort ohne Codeänderung korrigiert werden.

### Datenadapter

Der Adapter verwendet standardmäßig die öffentlich von der Website genutzte Basis `https://www.handball.net/api/new` und versucht zuerst einen Club-Abruf. Liefert dieser nichts, werden Mannschaften mit Pause nacheinander abgefragt. Pagination, Timeout, Rate-Limit-Pausen und ein eigener, transparenter User-Agent sind eingebaut.

Da es keine zugesagte öffentliche API-Stabilität gibt, akzeptiert der Normalisierer mehrere bekannte Feldformen. Endpunkte können ohne Codeänderung angepasst werden:

```bash
HANDBALL_API_BASE=https://www.handball.net/api/new
MATCH_DETAIL_PATH='matches/{id}'
STANDINGS_PATH='standings?phase_id={phaseId}'
```

`COMPUTE_STANDINGS_FROM_PHASE=true` aktiviert als optionalen Rückfall das Berechnen einer Tabelle aus einem vollständigen Staffel-Spielplan. Standardmäßig ist das im Workflow deaktiviert, um zusätzliche Requests zu vermeiden.

## Auf GitHub veröffentlichen

1. Auf GitHub ein **neues leeres Repository** anlegen.
2. Den Inhalt dieses Ordners in das Repository übertragen.
3. Den Standardbranch `main` verwenden.
4. Unter **Settings → Pages → Build and deployment → Source** den Eintrag **GitHub Actions** wählen.
5. Unter **Actions** den Workflow **„Daten aktualisieren und GitHub Pages veröffentlichen“** öffnen und einmal über **Run workflow** starten.
6. Nach erfolgreichem Lauf steht die URL in der Deployment-Zusammenfassung, typischerweise:

   ```text
   https://DEIN-NAME.github.io/REPOSITORY-NAME/
   ```

Der Workflow läuft danach alle fünf Minuten. GitHub behandelt Zeitpläne als Best-Effort; eine minutengenaue Echtzeitgarantie gibt es nicht. Die App prüft ihr eigenes JSON regelmäßig neu und benötigt dafür keine handball.net-Verbindung.

## Verhalten bei 403 oder Ausfall

- Schlägt ein Abruf vollständig fehl, endet der Fetch-Schritt kontrolliert mit Exit-Code 2.
- `matches.json`, `live.json`, `events.json` und `standings.json` bleiben unverändert.
- Der letzte erfolgreiche Cache wird weiter ausgeliefert.
- Der Workflow deployt die App trotzdem.
- In `meta.json` und im Workflow-Log stehen kompakte Diagnosedaten.
- Nur erfolgreiche Abrufe werden in das Repository zurückgeschrieben.

Damit ist ein 403 kein Startfehler der App mehr, sondern lediglich ein fehlgeschlagener Hintergrund-Refresh.

## Aktualisierungsfrequenz anpassen

In `.github/workflows/pages.yml`:

```yaml
schedule:
  - cron: "*/5 * * * *"
```

Für geringere Last kann beispielsweise `17 * * * *` verwendet werden (einmal pro Stunde). Vor einer produktiven Nutzung sollten die Nutzungsbedingungen und technischen Hinweise der Datenquelle geprüft werden. Keine Zugangssperren umgehen und die Frequenz bei 429/403 reduzieren.

## Tabellen und Live-Ereignisse

Diese Daten sind nicht bei jedem Wettbewerb oder Spiel vorhanden. Die App zeigt nur Werte, die im Cache stehen:

- kein erfundener Live-Status
- keine künstlichen Tore
- keine Demo-Tabelle im Produktiv-Cache
- verständlicher Leerzustand, wenn die Quelle nichts liefert

## Projektstruktur

```text
.github/workflows/pages.yml  # Fetch + Test + Pages-Deployment
config/teams.json            # Club, Saison, Mannschaften
public/                      # vollständig statische PWA
public/data/                 # veröffentlichter eigener JSON-Cache
scripts/fetch-data.mjs       # einziger Zugriff auf die externe Quelle
scripts/lib/normalize.mjs    # Normalisierung und Tabellenberechnung
scripts/build.mjs            # public -> dist
scripts/serve.mjs            # lokaler statischer Testserver
test/                        # Unit- und Integrationstests
```

## Branding

Das mitgelieferte `L`-Schild ist ein neutrales Platzhalter-Icon. Für das offizielle Vereinslogo und Vereinsfotos sollten freigegebene Dateien des Vereins in `public/icons/` abgelegt und Manifest/HTML entsprechend angepasst werden.

## Lizenz

Quellcode: MIT. Daten, Namen, Logos und Inhalte der externen Quelle unterliegen den jeweiligen Rechteinhabern und Nutzungsbedingungen.
