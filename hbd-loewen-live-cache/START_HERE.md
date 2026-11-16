# Hier starten

## Nur lokal ansehen

1. Prüfe, ob Node.js installiert ist: `node --version` (mindestens Version 20).
2. Öffne diesen Hauptordner im Terminal.
3. Starte: `npm run serve`
4. Öffne: `http://localhost:8080`

Auf einem Mac kannst du stattdessen `START.command` doppelklicken. Beim ersten Start sind Spiele und Tabellen noch leer, weil keine erfundenen Daten mitgeliefert werden.

## Als echte App mit automatischen Daten veröffentlichen

1. Erstelle auf GitHub ein leeres Repository.
2. Lade **alle Dateien und Ordner aus diesem Hauptordner** hoch – einschließlich `.github`.
3. Öffne im Repository **Settings → Pages**.
4. Wähle bei **Source** den Eintrag **GitHub Actions**.
5. Öffne **Actions**.
6. Wähle **Daten aktualisieren und GitHub Pages veröffentlichen**.
7. Klicke **Run workflow**.
8. Nach erfolgreichem Lauf steht die App-URL in der Zusammenfassung des Deployments.

Danach läuft der Datenjob automatisch. Die Smartphone-App selbst greift nie direkt auf handball.net zu.

## Falls der Datenjob 403 meldet

Die App bleibt online und zeigt den letzten erfolgreichen Cache. Öffne in GitHub den letzten Workflow-Lauf und prüfe den Schritt **Öffentliche Daten in JSON-Cache laden**. Reduziere bei wiederholter Ablehnung die Frequenz in `.github/workflows/pages.yml` oder starte den Workflow später erneut. Keine Sperre umgehen.

Ausführliche technische Hinweise stehen in `README.md`.
